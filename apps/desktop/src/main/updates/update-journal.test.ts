import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  UpdateJournalStore,
  assertNoSecretsInJournalObject,
  isValidPhaseTransition,
  journalVersionRefs,
  parseUpdateJournalRecord,
  planJournalRecovery,
  type UpdateJournalRecord,
  UPDATE_TRANSACTION_PHASES,
} from "./update-journal.js";

const PHASE_CHAIN = [
  "idle",
  "checking",
  "available",
  "downloading",
  "verifying",
  "staged",
  "waiting_for_idle",
  "installing",
  "restarting",
  "post_update_verification",
  "committed",
] as const;

function baseRecord(
  phase: UpdateJournalRecord["phase"],
  overrides: Partial<UpdateJournalRecord> = {},
): UpdateJournalRecord {
  return {
    schemaVersion: 1,
    phase,
    channel: "stable",
    target: "darwin-arm64",
    installed: { deskVersion: "1.0.0", grokVersion: "0.9.0" },
    targetPair: {
      pairId: "pair-1.1.0-0.9.4",
      deskVersion: "1.1.0",
      grokVersion: "0.9.4",
      requiredCapabilities: ["agent", "managed-no-self-update"],
    },
    previousRuntime: {
      version: "0.9.0",
      target: "darwin-arm64",
      digestSha256: "a".repeat(64),
    },
    manifestSequence: 7,
    manifestPayloadSha256: "b".repeat(64),
    stagedGrok: {
      kind: "grok",
      artifactId: "art-grok-0.9.4",
      version: "0.9.4",
      digestSha256: "c".repeat(64),
      sizeBytes: 100,
      path: "/tmp/staged/grok",
    },
    stagedDesk: {
      kind: "desk",
      artifactId: "art-desk-1.1.0",
      version: "1.1.0",
      digestSha256: "d".repeat(64),
      sizeBytes: 200,
      path: "",
    },
    customerAction: "none",
    attempts: 1,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("update-journal state machine", () => {
  it("accepts the full forward chain", () => {
    for (let i = 0; i < PHASE_CHAIN.length - 1; i++) {
      expect(
        isValidPhaseTransition(PHASE_CHAIN[i]!, PHASE_CHAIN[i + 1]!),
      ).toBe(true);
    }
  });

  it("rejects skipping install without staging", () => {
    expect(isValidPhaseTransition("available", "installing")).toBe(false);
    expect(isValidPhaseTransition("checking", "committed")).toBe(false);
  });

  it("allows cancel/reset to idle from pre-install phases", () => {
    for (const phase of [
      "checking",
      "available",
      "downloading",
      "verifying",
      "staged",
      "waiting_for_idle",
    ] as const) {
      expect(isValidPhaseTransition(phase, "idle")).toBe(true);
    }
  });
});

describe("update-journal parse + secrets", () => {
  it("parses a complete record", () => {
    const rec = parseUpdateJournalRecord(baseRecord("staged"));
    expect(rec?.phase).toBe("staged");
    expect(rec?.targetPair?.pairId).toBe("pair-1.1.0-0.9.4");
    expect(rec?.targetPair?.requiredCapabilities).toEqual([
      "agent",
      "managed-no-self-update",
    ]);
    expect(rec?.stagedGrok?.digestSha256).toBe("c".repeat(64));
  });

  it("rejects grant/entitlement secret fields", () => {
    expect(() =>
      assertNoSecretsInJournalObject({
        ...baseRecord("downloading"),
        grantToken: "secret-grant",
      }),
    ).toThrow(/secret/i);

    expect(
      parseUpdateJournalRecord({
        ...baseRecord("downloading"),
        downloadUrl: "https://example.com/secret",
      }),
    ).toBeNull();
  });

  it("rejects corrupt digests and schema", () => {
    expect(
      parseUpdateJournalRecord({
        ...baseRecord("staged"),
        stagedGrok: {
          ...baseRecord("staged").stagedGrok!,
          digestSha256: "not-hex",
        },
      }),
    ).toBeNull();
    expect(
      parseUpdateJournalRecord({ ...baseRecord("idle"), schemaVersion: 99 }),
    ).toBeNull();
  });
});

describe("update-journal recovery plans", () => {
  it("covers every transaction phase with an idempotent plan", () => {
    for (const phase of UPDATE_TRANSACTION_PHASES) {
      const plan = planJournalRecovery(baseRecord(phase));
      expect(plan.phase === phase || plan.action !== "none" || phase === "idle").toBe(
        true,
      );
      expect(plan.reason.length).toBeGreaterThan(0);
    }
  });

  it("preserves staged pair across waiting_for_idle restart", () => {
    const plan = planJournalRecovery(baseRecord("waiting_for_idle", {
      customerAction: "approve_restart",
    }));
    expect(plan.action).toBe("await_idle_or_install");
    if (plan.action !== "await_idle_or_install") return;
    expect(plan.targetPair.deskVersion).toBe("1.1.0");
    expect(plan.stagedGrok?.version).toBe("0.9.4");
    expect(plan.customerAction).toBe("approve_restart");
  });

  it("resumes post_update_verification after crash during install/restart", () => {
    for (const phase of ["installing", "restarting"] as const) {
      const plan = planJournalRecovery(baseRecord(phase));
      expect(plan.action).toBe("post_update_verification");
      if (plan.action !== "post_update_verification") return;
      expect(plan.previousRuntime?.version).toBe("0.9.0");
    }
  });

  it("resets pre-stage phases without losing installed identity in the plan", () => {
    const plan = planJournalRecovery(baseRecord("checking", {
      targetPair: undefined,
      stagedGrok: undefined,
      stagedDesk: undefined,
    }));
    expect(plan.action).toBe("reset_idle");
    if (plan.action !== "reset_idle") return;
    expect(plan.preserveInstalled).toBe(true);
  });

  it("resumes download without requiring a re-resolve of the pair", () => {
    const plan = planJournalRecovery(baseRecord("downloading"));
    expect(plan.action).toBe("resume_download");
    if (plan.action !== "resume_download") return;
    expect(plan.targetPair.pairId).toBe("pair-1.1.0-0.9.4");
  });

  it("clears committed journals", () => {
    const plan = planJournalRecovery(baseRecord("committed"));
    expect(plan.action).toBe("clear_committed");
  });
});

describe("UpdateJournalStore durability", () => {
  let dir: string;
  let store: UpdateJournalStore;
  let clock: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-update-journal-"));
    clock = Date.parse("2026-07-16T12:00:00.000Z");
    store = new UpdateJournalStore({
      userData: dir,
      now: () => {
        const d = new Date(clock);
        clock += 1000;
        return d;
      },
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("atomically persists transitions and recovers after simulated restart", () => {
    const idle = store.createIdle({
      channel: "stable",
      target: "darwin-arm64",
      installed: { deskVersion: "1.0.0", grokVersion: "0.9.0" },
    });
    store.write(idle);

    store.transition("checking");
    store.transition("available", {
      targetPair: {
        pairId: "pair-1.1.0-0.9.4",
        deskVersion: "1.1.0",
        grokVersion: "0.9.4",
      },
      manifestSequence: 7,
      manifestPayloadSha256: "b".repeat(64),
    });
    store.transition("downloading", { attempts: 1 });
    store.transition("verifying", {
      stagedGrok: {
        kind: "grok",
        artifactId: "art-grok",
        version: "0.9.4",
        digestSha256: "c".repeat(64),
        sizeBytes: 10,
        path: path.join(dir, "staging", "grok"),
      },
    });
    store.transition("staged", {
      stagedDesk: {
        kind: "desk",
        artifactId: "art-desk",
        version: "1.1.0",
        digestSha256: "d".repeat(64),
        sizeBytes: 20,
        path: "",
      },
    });

    // Simulate process death + new store instance.
    const restarted = new UpdateJournalStore({ userData: dir });
    const loaded = restarted.load();
    expect(loaded?.phase).toBe("staged");
    expect(loaded?.installed.deskVersion).toBe("1.0.0");
    expect(loaded?.targetPair?.deskVersion).toBe("1.1.0");

    const plan = restarted.recoverPlan();
    expect(plan.action).toBe("await_idle_or_install");

    // Inject restart at each remaining transition and assert recovery.
    for (const phase of [
      "waiting_for_idle",
      "installing",
      "restarting",
      "post_update_verification",
      "committed",
    ] as const) {
      const s = new UpdateJournalStore({ userData: dir });
      const cur = s.load();
      expect(cur).not.toBeNull();
      if (phase === "waiting_for_idle" && cur!.phase === "staged") {
        s.transition(phase, { customerAction: "approve_restart" });
      } else if (cur!.phase !== phase) {
        // walk forward one step when legal
        if (isValidPhaseTransition(cur!.phase, phase)) {
          s.transition(phase, {
            customerAction: "approve_restart",
            previousRuntime: {
              version: "0.9.0",
              target: "darwin-arm64",
              digestSha256: "a".repeat(64),
            },
          });
        }
      }
      const after = new UpdateJournalStore({ userData: dir });
      const rec = after.load();
      expect(rec).not.toBeNull();
      const recovery = after.recoverPlan();
      // Active installed pair identity never lost.
      expect(rec!.installed).toEqual({
        deskVersion: "1.0.0",
        grokVersion: "0.9.0",
      });
      expect(recovery.reason.length).toBeGreaterThan(0);
    }
  });

  it("rejects illegal transition writes", () => {
    store.write(
      store.createIdle({
        channel: "stable",
        target: "darwin-arm64",
        installed: { deskVersion: "1.0.0", grokVersion: "0.9.0" },
      }),
    );
    expect(() => store.transition("installing")).toThrow(
      /invalid_phase_transition/,
    );
  });

  it("applyRecoveryBookkeeping clears committed without double-install side effects", () => {
    store.write(baseRecord("committed"));
    const plan = store.recoverPlan();
    expect(plan.action).toBe("clear_committed");
    const after = store.applyRecoveryBookkeeping(plan);
    expect(after).toBeNull();
    expect(store.load()).toBeNull();
  });

  it("journalVersionRefs retains staged and previous versions for GC", () => {
    const refs = journalVersionRefs(baseRecord("staged"));
    expect(refs.versions).toEqual(
      expect.arrayContaining(["0.9.4", "0.9.0"]),
    );
    expect(refs.stagingPaths).toContain("/tmp/staged/grok");
  });

  it("is idempotent when transitioning to the same phase", () => {
    store.write(baseRecord("staged"));
    const a = store.transition("staged");
    const b = store.transition("staged");
    expect(a.phase).toBe("staged");
    expect(b.phase).toBe("staged");
    expect(b.attempts).toBe(a.attempts);
  });
});
