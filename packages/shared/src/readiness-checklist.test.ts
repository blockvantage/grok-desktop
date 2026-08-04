import { describe, it, expect } from "vitest";
import {
  blockedReadinessItems,
  buildReadinessChecklist,
  isReadinessBlocked,
  readinessDimensionOrder,
} from "./readiness-checklist.js";

describe("buildReadinessChecklist", () => {
  it("returns three free-app dimensions in stable order (no license)", () => {
    const items = buildReadinessChecklist({
      runtimeOk: true,
      signInOk: true,
      workspaceOk: true,
    });
    expect(items.map((i) => i.id)).toEqual([...readinessDimensionOrder()]);
    expect(items.map((i) => i.id)).not.toContain("license");
    expect(isReadinessBlocked(items)).toBe(false);
    expect(blockedReadinessItems(items)).toHaveLength(0);
  });

  it("blocks create when runtime is missing (license never blocks)", () => {
    const items = buildReadinessChecklist({
      runtimeOk: false,
      runtimeCode: "missing",
      signInOk: true,
      workspaceOk: true,
    });
    expect(isReadinessBlocked(items)).toBe(true);
    const blocked = blockedReadinessItems(items);
    expect(blocked.map((b) => b.id)).toEqual(["runtime"]);
    expect(blocked[0]!.ctaAction).toBe("install-runtime");
    expect(blocked.some((b) => b.ctaAction === "open-license")).toBe(false);
  });

  it("distinguishes never-signed-in from reauth", () => {
    const never = buildReadinessChecklist({
      runtimeOk: true,
      signInOk: false,
      neverSignedIn: true,
      workspaceOk: true,
    });
    const reauth = buildReadinessChecklist({
      runtimeOk: true,
      signInOk: false,
      neverSignedIn: false,
      workspaceOk: true,
    });
    expect(never.find((i) => i.id === "sign_in")!.reasonKey).toBe(
      "readiness.signIn.never",
    );
    expect(reauth.find((i) => i.id === "sign_in")!.reasonKey).toBe(
      "readiness.signIn.reauth",
    );
  });

  it("treats sign-in as ok when not required", () => {
    const items = buildReadinessChecklist({
      runtimeOk: true,
      signInOk: false,
      signInRequired: false,
      workspaceOk: true,
    });
    expect(items.find((i) => i.id === "sign_in")!.status).toBe("ok");
    expect(isReadinessBlocked(items)).toBe(false);
  });

  it("workspace missing has choose-workspace CTA", () => {
    const items = buildReadinessChecklist({
      runtimeOk: true,
      signInOk: true,
      workspaceOk: false,
    });
    const ws = items.find((i) => i.id === "workspace")!;
    expect(ws.status).toBe("blocked");
    expect(ws.ctaAction).toBe("choose-workspace");
  });

  it("runtime installing has no install CTA (in progress)", () => {
    const items = buildReadinessChecklist({
      runtimeOk: false,
      runtimeCode: "installing",
      signInOk: true,
      workspaceOk: true,
    });
    const rt = items.find((i) => i.id === "runtime")!;
    expect(rt.status).toBe("blocked");
    expect(rt.ctaAction).toBeNull();
    expect(rt.reasonKey).toBe("readiness.runtime.installing");
  });
});
