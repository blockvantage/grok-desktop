import { describe, expect, it } from "vitest";
import {
  searchOwnerForNav,
  shouldShowTopbarSearch,
  shouldShowViewLocalSearch,
} from "./view-search-policy";

describe("view-search-policy", () => {
  it("gives Artifacts a single topbar search (no view-local field)", () => {
    expect(searchOwnerForNav("artifacts")).toBe("topbar");
    expect(shouldShowViewLocalSearch("artifacts")).toBe(false);
    expect(shouldShowTopbarSearch("artifacts")).toBe(true);
  });

  it("uses topbar for tasks without a second owner", () => {
    expect(searchOwnerForNav("tasks")).toBe("topbar");
    expect(shouldShowViewLocalSearch("tasks")).toBe(false);
    expect(shouldShowTopbarSearch("tasks")).toBe(true);
  });

  it("uses topbar for memory and scheduled lists", () => {
    for (const nav of ["memory", "scheduled"] as const) {
      expect(searchOwnerForNav(nav)).toBe("topbar");
      expect(shouldShowViewLocalSearch(nav)).toBe(false);
      expect(shouldShowTopbarSearch(nav)).toBe(true);
    }
  });

  it("hides list search on home and settings", () => {
    expect(searchOwnerForNav("home")).toBe("none");
    expect(shouldShowTopbarSearch("home")).toBe(false);
    expect(shouldShowViewLocalSearch("home")).toBe(false);
    expect(searchOwnerForNav("settings")).toBe("none");
    expect(shouldShowTopbarSearch("settings")).toBe(false);
  });

  it("never assigns local ownership (no stacked dual fields)", () => {
    for (const nav of [
      "home",
      "tasks",
      "artifacts",
      "memory",
      "scheduled",
      "settings",
    ]) {
      expect(shouldShowViewLocalSearch(nav)).toBe(false);
      // Exactly one of topbar | none — not both topbar and local.
      const owner = searchOwnerForNav(nav);
      expect(owner === "topbar" || owner === "none").toBe(true);
    }
  });
});
