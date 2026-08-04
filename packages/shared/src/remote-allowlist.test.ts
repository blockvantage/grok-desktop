import { describe, expect, it } from "vitest";
import { isRemoteAllowedMethod, listRemoteAllowedMethods } from "./remote-allowlist.js";

describe("remote-allowlist", () => {
  it("allows coworker control methods", () => {
    expect(isRemoteAllowedMethod("tasks.list")).toBe(true);
    expect(isRemoteAllowedMethod("tasks.create")).toBe(true);
    expect(isRemoteAllowedMethod("tasks.approve")).toBe(true);
    expect(isRemoteAllowedMethod("tasks.pauseAll")).toBe(true);
    expect(isRemoteAllowedMethod("events.list")).toBe(true);
    expect(isRemoteAllowedMethod("inbox.list")).toBe(true);
    expect(isRemoteAllowedMethod("tray.status")).toBe(true);
    expect(isRemoteAllowedMethod("workspace.ensureTemp")).toBe(true);
    expect(isRemoteAllowedMethod("remote.telepresence.start")).toBe(true);
    expect(isRemoteAllowedMethod("remote.telepresence.input")).toBe(true);
    expect(isRemoteAllowedMethod("remote.telepresence.listDisplays")).toBe(true);
    expect(isRemoteAllowedMethod("remote.rekey")).toBe(true);
  });

  it("allows P2 schedule and memory methods", () => {
    expect(isRemoteAllowedMethod("schedule.list")).toBe(true);
    expect(isRemoteAllowedMethod("schedule.create")).toBe(true);
    expect(isRemoteAllowedMethod("schedule.setEnabled")).toBe(true);
    expect(isRemoteAllowedMethod("memory.list")).toBe(true);
    expect(isRemoteAllowedMethod("memory.upsert")).toBe(true);
    expect(isRemoteAllowedMethod("memory.delete")).toBe(true);
  });

  it("denies auth and license mutation from phone", () => {
    expect(isRemoteAllowedMethod("auth.signIn")).toBe(false);
    expect(isRemoteAllowedMethod("license.activate")).toBe(false);
    expect(isRemoteAllowedMethod("connectors.enable")).toBe(false);
    expect(isRemoteAllowedMethod("settings.set")).toBe(false);
    // Full settings blob includes license key + MCP env — never for remote
    expect(isRemoteAllowedMethod("settings.get")).toBe(false);
    expect(isRemoteAllowedMethod("schedule.delete")).toBe(false);
  });

  it("denies all outbox methods from remote clients", () => {
    for (const method of [
      "outbox.enqueue",
      "outbox.list",
      "outbox.update",
      "outbox.remove",
      "outbox.retry",
      "outbox.sendNow",
      "outbox.summary",
    ]) {
      expect(isRemoteAllowedMethod(method)).toBe(false);
    }
  });

  it("lists methods stably", () => {
    const list = listRemoteAllowedMethods();
    expect(list).toContain("tasks.list");
    expect(list).toContain("schedule.create");
    expect(list).toContain("memory.upsert");
    expect(list).toEqual([...list].sort());
  });
});
