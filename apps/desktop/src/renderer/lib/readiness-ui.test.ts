import { describe, it, expect } from "vitest";
import {
  projectDesktopReadiness,
  readinessInputFromAppState,
} from "./readiness-ui";

describe("projectDesktopReadiness", () => {
  it("is clear when all free-app dimensions ok (no license row)", () => {
    const r = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: true,
        signedIn: true,
        workspaceSelected: true,
      }),
    );
    expect(r.blocked).toBe(false);
    expect(r.items).toHaveLength(3);
    expect(r.items.map((i) => i.id)).not.toContain("license");
    expect(r.blockedItems).toHaveLength(0);
  });

  it("surfaces runtime blockers with CTAs (never open-license)", () => {
    const r = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: false,
        signedIn: true,
        workspaceSelected: true,
      }),
    );
    expect(r.blocked).toBe(true);
    expect(r.blockedItems.map((i) => i.id)).toEqual(["runtime"]);
    expect(r.blockedItems[0]!.ctaAction).toBe("install-runtime");
    expect(r.blockedItems.some((i) => i.ctaAction === "open-license")).toBe(
      false,
    );
  });

  it("never-signed-in uses distinct reason key", () => {
    const r = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: true,
        signedIn: false,
        neverSignedIn: true,
        workspaceSelected: true,
      }),
    );
    const signIn = r.items.find((i) => i.id === "sign_in")!;
    expect(signIn.reasonKey).toBe("readiness.signIn.never");
  });

  it("signInRequired false keeps checklist clear when not signed in", () => {
    const r = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: true,
        signedIn: false,
        signInRequired: false,
        workspaceSelected: true,
      }),
    );
    expect(r.blockedItems.map((i) => i.id)).not.toContain("sign_in");
  });
});
