import { describe, expect, it } from "vitest";
import {
  adminActionRank,
  dailyActionRank,
  dailyBeforeAdmin,
  orderedAdminActions,
  orderedDailyActions,
  PALETTE_PRIMARY_NAV_IDS,
  paletteSectionForAction,
  paletteSectionOrder,
  shouldShowRunSetupInPalette,
} from "./command-palette-policy";

describe("shouldShowRunSetupInPalette", () => {
  it("hides setup when readiness is healthy", () => {
    expect(shouldShowRunSetupInPalette({ readinessBlocked: false })).toBe(
      false,
    );
  });

  it("shows setup only when readiness is blocked", () => {
    expect(shouldShowRunSetupInPalette({ readinessBlocked: true })).toBe(true);
  });
});

describe("palette ranking", () => {
  it("places daily sections before admin", () => {
    const order = paletteSectionOrder();
    expect(dailyBeforeAdmin(order)).toBe(true);
    expect(order.indexOf("daily")).toBeLessThan(order.indexOf("admin"));
    expect(order.indexOf("stop")).toBeLessThan(order.indexOf("admin"));
    expect(order.indexOf("recent")).toBeLessThan(order.indexOf("admin"));
    expect(order.indexOf("goto")).toBeLessThan(order.indexOf("admin"));
    // Daily work band: actions → stop running → open recent → navigate
    expect(order.indexOf("daily")).toBeLessThan(order.indexOf("conversations"));
    expect(order.indexOf("conversations")).toBeLessThan(order.indexOf("stop"));
    expect(order.indexOf("daily")).toBeLessThan(order.indexOf("stop"));
    expect(order.indexOf("stop")).toBeLessThan(order.indexOf("recent"));
    expect(order.indexOf("recent")).toBeLessThan(order.indexOf("goto"));
  });

  it("ranks new task before other daily actions", () => {
    expect(dailyActionRank("new_task")).toBeLessThan(
      dailyActionRank("open_inbox"),
    );
    expect(dailyActionRank("open_inbox")).toBeLessThan(
      dailyActionRank("shortcuts"),
    );
    expect(dailyActionRank("new_task")).toBeLessThan(
      dailyActionRank("stop_task"),
    );
    expect(dailyActionRank("stop_task")).toBeLessThan(
      dailyActionRank("open_recent"),
    );
  });

  it("demotes setup/billing/docs/settings into admin", () => {
    const blocked = { readinessBlocked: true, signedIn: true };
    expect(paletteSectionForAction("run_setup", blocked)).toBe("admin");
    expect(paletteSectionForAction("billing", blocked)).toBe("admin");
    expect(paletteSectionForAction("docs", blocked)).toBe("admin");
    expect(paletteSectionForAction("usage", blocked)).toBe("admin");
    expect(paletteSectionForAction("open_settings", blocked)).toBe("admin");
    expect(paletteSectionForAction("new_task", blocked)).toBe("daily");
  });

  it("hides run_setup section when healthy", () => {
    expect(
      paletteSectionForAction("run_setup", {
        readinessBlocked: false,
        signedIn: true,
      }),
    ).toBeNull();
  });

  it("orders admin items with setup first when present", () => {
    expect(adminActionRank("run_setup")).toBeLessThan(adminActionRank("usage"));
    expect(adminActionRank("usage")).toBeLessThan(adminActionRank("billing"));
    expect(adminActionRank("billing")).toBeLessThan(adminActionRank("docs"));
    expect(adminActionRank("docs")).toBeLessThan(
      adminActionRank("open_settings"),
    );
  });

  it("orderedDailyActions puts new task first and omits sign-in when signed in", () => {
    const signedIn = orderedDailyActions({
      signedIn: true,
      hasInbox: true,
      hasShortcuts: true,
    });
    expect(signedIn[0]).toBe("new_task");
    expect(signedIn).toContain("open_inbox");
    expect(signedIn).not.toContain("sign_in");

    const signedOut = orderedDailyActions({
      signedIn: false,
      hasInbox: false,
      hasShortcuts: false,
    });
    expect(signedOut).toEqual(["new_task", "sign_in"]);
  });

  it("orderedAdminActions omits setup when healthy and ranks demoted items", () => {
    const healthy = orderedAdminActions({
      readinessBlocked: false,
      hasUsage: true,
      hasBilling: true,
      hasDocs: true,
      hasSetup: true,
      hasSettings: true,
    });
    expect(healthy).not.toContain("run_setup");
    expect(healthy[0]).toBe("usage");
    expect(healthy).toContain("open_settings");
    expect(healthy.indexOf("billing")).toBeLessThan(healthy.indexOf("docs"));

    const blocked = orderedAdminActions({
      readinessBlocked: true,
      hasUsage: true,
      hasBilling: false,
      hasDocs: false,
      hasSetup: true,
      hasSettings: true,
    });
    expect(blocked[0]).toBe("run_setup");
    expect(blocked).toEqual(["run_setup", "usage", "open_settings"]);
  });

  it("primary nav excludes settings (settings is admin-only)", () => {
    expect(PALETTE_PRIMARY_NAV_IDS).not.toContain("settings");
    expect(PALETTE_PRIMARY_NAV_IDS).toContain("home");
    expect(PALETTE_PRIMARY_NAV_IDS).toContain("tasks");
  });
});
