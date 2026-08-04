import { describe, it, expect, beforeEach } from "vitest";
import { DesktopPolicyStore } from "./desktop-policy-store";

describe("DesktopPolicyStore", () => {
  let store: DesktopPolicyStore;

  beforeEach(() => {
    store = new DesktopPolicyStore();
    store.setPermissions({
      captureGranted: true,
      inputGranted: true,
      captureDetail: "ok",
      inputDetail: "ok",
      platform: "darwin",
    });
    store.setMachine({ enabled: true });
    store.setGrant("t1", true);
  });

  it("denies when machine disabled", () => {
    store.setMachine({ enabled: false });
    const r = store.authorize("t1", "desktop_screenshot", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("desktop_disabled_machine");
  });

  it("denies when task grant off", () => {
    store.setGrant("t1", false);
    const r = store.authorize("t1", "desktop_screenshot", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("desktop_disabled_task");
  });

  it("denies when globally paused", () => {
    store.setGlobalPaused(true);
    const r = store.authorize("t1", "desktop_click", { x: 1, y: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("desktop_paused");
  });

  it("allows screenshot while softPaused but not click", () => {
    store.setSoftPaused("t1", true);
    expect(store.authorize("t1", "desktop_screenshot", {}).ok).toBe(true);
    const click = store.authorize("t1", "desktop_click", { x: 1, y: 2 });
    expect(click.ok).toBe(false);
    if (!click.ok) expect(click.code).toBe("desktop_yielded");
  });

  it("rate limits per task", () => {
    store.setMachine({ enabled: true, maxActionsPerTask: 2, maxActionsPerMinute: 100 });
    expect(store.authorize("t1", "desktop_wait", { ms: 1 }).ok).toBe(true);
    expect(store.authorize("t1", "desktop_wait", { ms: 1 }).ok).toBe(true);
    const r = store.authorize("t1", "desktop_wait", { ms: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("desktop_rate_limited");
  });

  it("denies password manager frontmost", () => {
    const r = store.authorize(
      "t1",
      "desktop_type",
      { text: "secret" },
      { app: "1Password", title: "Vault" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("desktop_denied_target");
  });

  it("requires capture permission for screenshot", () => {
    store.setPermissions({
      captureGranted: false,
      inputGranted: true,
      captureDetail: "missing",
      inputDetail: "ok",
      platform: "darwin",
    });
    const r = store.authorize("t1", "desktop_screenshot", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("desktop_permission_capture");
  });

  it("requires input permission for click", () => {
    store.setPermissions({
      captureGranted: true,
      inputGranted: false,
      captureDetail: "ok",
      inputDetail: "missing",
      platform: "darwin",
    });
    const r = store.authorize("t1", "desktop_click", { x: 0, y: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("desktop_permission_input");
  });

  it("resume clears softPaused", () => {
    store.setSoftPaused("t1", true);
    store.resume("t1");
    expect(store.getTaskState("t1")?.softPaused).toBe(false);
    expect(store.authorize("t1", "desktop_click", { x: 1, y: 1 }).ok).toBe(
      true,
    );
  });
});
