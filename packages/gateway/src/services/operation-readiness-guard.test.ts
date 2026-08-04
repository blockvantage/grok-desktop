import { describe, expect, it, vi } from "vitest";
import {
  createOperationReadinessGuard,
  isIdleFromStatuses,
  isInstallBlockingStatus,
  isOperationAdmissionError,
  OperationAdmissionError,
  INSTALL_BLOCKING_TASK_STATUSES,
} from "./operation-readiness-guard.js";

describe("install-blocking statuses", () => {
  it("treats running, waiting_approval, and waiting_user as active", () => {
    expect(INSTALL_BLOCKING_TASK_STATUSES).toEqual([
      "running",
      "waiting_approval",
      "waiting_user",
    ]);
    for (const s of INSTALL_BLOCKING_TASK_STATUSES) {
      expect(isInstallBlockingStatus(s)).toBe(true);
    }
    expect(isInstallBlockingStatus("done")).toBe(false);
    expect(isInstallBlockingStatus("queued")).toBe(false);
    expect(isInstallBlockingStatus("blocked")).toBe(false);
  });

  it("isIdleFromStatuses is true only without blocking work", () => {
    expect(isIdleFromStatuses(["done", "cancelled"])).toBe(true);
    expect(isIdleFromStatuses(["running"])).toBe(false);
    expect(isIdleFromStatuses(["waiting_approval", "done"])).toBe(false);
    expect(isIdleFromStatuses(["waiting_user"])).toBe(false);
  });
});

describe("createOperationReadinessGuard", () => {
  it("reports idle when no blocking tasks", async () => {
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => ["done", "queued"] },
    });
    expect(await guard.isIdle()).toBe(true);
    const snap = await guard.getIdleSnapshot();
    expect(snap.activeCount).toBe(0);
  });

  it("blocks install when work is active", async () => {
    const guard = createOperationReadinessGuard({
      tasks: {
        listTaskStatuses: () => ["running", "waiting_approval"],
      },
    });
    expect(await guard.isIdle()).toBe(false);
    await expect(guard.assertIdleForInstall("switch")).rejects.toSatisfy(
      (err: unknown) =>
        isOperationAdmissionError(err) && err.code === "work_active",
    );
  });

  it("blocks new Grok admission while update admission is paused", async () => {
    let paused = true;
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => [] },
      update: {
        isAdmissionPaused: () => paused,
      },
    });
    const denied = await guard.checkGrokAdmission("interactive");
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.code).toBe("admission_paused");

    await expect(guard.assertGrokAdmission("scheduled")).rejects.toBeInstanceOf(
      OperationAdmissionError,
    );

    paused = false;
    const allowed = await guard.checkGrokAdmission("interactive");
    expect(allowed.ok).toBe(true);
  });

  it("composes with entitlement admission (read-only)", async () => {
    const assertCapability = vi.fn(async () => {
      throw new Error("lease expired");
    });
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => [] },
      entitlement: { assertCapability },
    });
    const check = await guard.checkGrokAdmission("remote");
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe("entitlement_read_only");
  });

  it("allows Grok admission when entitlement ok and not paused", async () => {
    const assertCapability = vi.fn(async () => undefined);
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => ["done"] },
      update: { isAdmissionPaused: () => false },
      entitlement: {
        assertCapability,
        checkCapability: async () => ({ ok: true as const }),
      },
    });
    await guard.assertGrokAdmission("follow_up");
    expect(assertCapability).not.toHaveBeenCalled(); // checkCapability path
  });

  it("allows local_read even when admission is paused", async () => {
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => ["running"] },
      update: { isAdmissionPaused: () => true },
    });
    await expect(
      guard.assertLocal("local_read", "export"),
    ).resolves.toBeUndefined();
  });

  it("uses update.isIdle override when provided", async () => {
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => ["running"] },
      update: {
        isAdmissionPaused: () => false,
        isIdle: () => true, // override: coordinator says idle
      },
    });
    expect(await guard.isIdle()).toBe(true);
  });

  it("covers protected entrypoint action names", async () => {
    const entrypoints = [
      "interactive",
      "follow_up",
      "revision",
      "retry",
      "remote",
      "scheduled",
      "queued_execution",
      "provider_inference",
      "title_generation",
      "dictation",
    ] as const;
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => [] },
      update: { isAdmissionPaused: () => true },
    });
    for (const action of entrypoints) {
      const check = await guard.checkGrokAdmission(action);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.code).toBe("admission_paused");
    }
  });

  it("blocks Grok after security deadline via main-only setSecurityPolicy", async () => {
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => [] },
      update: { isAdmissionPaused: () => false },
    });

    // Before policy is set, Grok work is allowed.
    await expect(guard.assertGrokAdmission("interactive")).resolves.toBeUndefined();

    // Main composition applies signed policy (renderer IPC must not call this).
    guard.setSecurityPolicy({
      blockGrokOperations: true,
      code: "security_deadline",
      message: "deadline passed",
      securityDeadline: "2026-07-10T00:00:00.000Z",
    });

    const check = await guard.checkGrokAdmission("scheduled");
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe("security_deadline");

    // Local read/export preserved.
    await expect(
      guard.assertLocal("local_read", "export"),
    ).resolves.toBeUndefined();
    await expect(
      guard.assertLocal("recovery", "runtime_repair"),
    ).resolves.toBeUndefined();

    expect(guard.getSecurityPolicy()?.code).toBe("security_deadline");
  });

  it("blocks Grok on runtime revocation and clears when policy is lifted", async () => {
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => [] },
    });
    guard.setSecurityPolicy({
      blockGrokOperations: true,
      code: "runtime_revoked",
      message: "artifact revoked",
    });
    await expect(guard.assertGrokAdmission("remote")).rejects.toSatisfy(
      (err: unknown) =>
        isOperationAdmissionError(err) && err.code === "runtime_revoked",
    );

    guard.setSecurityPolicy(null);
    await expect(guard.assertGrokAdmission("remote")).resolves.toBeUndefined();
  });

  it("honors update.isSecurityBlocked pull hook", async () => {
    let blocked = true;
    const guard = createOperationReadinessGuard({
      tasks: { listTaskStatuses: () => [] },
      update: {
        isAdmissionPaused: () => false,
        isSecurityBlocked: () => blocked,
      },
    });
    const denied = await guard.checkGrokAdmission("interactive");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("security_block");
    blocked = false;
    expect((await guard.checkGrokAdmission("interactive")).ok).toBe(true);
  });
});
