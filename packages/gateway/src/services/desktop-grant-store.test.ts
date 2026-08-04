import { describe, it, expect } from "vitest";
import { DesktopGrantStore } from "./desktop-grant-store.js";

describe("DesktopGrantStore", () => {
  it("defaults to not granted", () => {
    const s = new DesktopGrantStore();
    expect(s.get("root-1")).toEqual({ granted: false, displayId: null });
  });

  it("stores grant and displayId by root", () => {
    const s = new DesktopGrantStore();
    s.set("root-1", true, "main");
    expect(s.get("root-1")).toEqual({ granted: true, displayId: "main" });
    s.set("root-1", false);
    expect(s.get("root-1")).toEqual({ granted: false, displayId: null });
  });

  it("isolates roots", () => {
    const s = new DesktopGrantStore();
    s.set("a", true, "1");
    s.set("b", true, "2");
    expect(s.get("a").displayId).toBe("1");
    expect(s.get("b").displayId).toBe("2");
  });

  it("evicts oldest roots when over max entries", () => {
    const s = new DesktopGrantStore(2);
    s.set("a", true, "1");
    s.set("b", true, "2");
    s.set("c", true, "3");
    expect(s.size()).toBe(2);
    expect(s.get("a").granted).toBe(false); // default — evicted
    expect(s.get("b").granted).toBe(true);
    expect(s.get("c").granted).toBe(true);
  });

  it("delete removes a root grant", () => {
    const s = new DesktopGrantStore();
    s.set("root-1", true, "main");
    expect(s.delete("root-1")).toBe(true);
    expect(s.get("root-1").granted).toBe(false);
    expect(s.delete("missing")).toBe(false);
  });

  it("refreshing a root does not evict it first", () => {
    const s = new DesktopGrantStore(2);
    s.set("a", true, "1");
    s.set("b", true, "2");
    s.set("a", true, "1b"); // refresh a — b becomes oldest
    s.set("c", true, "3");
    expect(s.get("a").displayId).toBe("1b");
    expect(s.get("b").granted).toBe(false);
    expect(s.get("c").granted).toBe(true);
  });
});
