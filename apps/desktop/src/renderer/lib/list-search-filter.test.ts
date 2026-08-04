import { describe, it, expect } from "vitest";
import {
  matchesSearchQuery,
  filterSchedulesBySearch,
  filterMemoriesBySearch,
  filterArtifactsBySearch,
} from "./list-search-filter";

describe("matchesSearchQuery", () => {
  it("empty query matches all", () => {
    expect(matchesSearchQuery("", "x")).toBe(true);
    expect(matchesSearchQuery("  ", "x")).toBe(true);
  });

  it("case-insensitive substring", () => {
    expect(matchesSearchQuery("FOO", "my Foo bar")).toBe(true);
    expect(matchesSearchQuery("z", "abc")).toBe(false);
  });
});

describe("filterSchedulesBySearch", () => {
  const items = [
    { name: "Daily", goalTemplate: "standup notes" },
    { name: "Weekly", goalTemplate: "ship report" },
  ];

  it("filters by name or goal", () => {
    expect(filterSchedulesBySearch(items, "ship")).toEqual([items[1]]);
    expect(filterSchedulesBySearch(items, "Daily")).toEqual([items[0]]);
    expect(filterSchedulesBySearch(items, "")).toEqual(items);
  });
});

describe("filterMemoriesBySearch", () => {
  it("filters title/content", () => {
    const items = [
      { title: "Alpha", content: "one" },
      { title: "Beta", content: "two alpha" },
    ];
    expect(filterMemoriesBySearch(items, "alpha")).toEqual(items);
    expect(filterMemoriesBySearch(items, "two")).toEqual([items[1]]);
  });
});

describe("filterArtifactsBySearch", () => {
  it("filters title/path/kind", () => {
    const items = [
      { title: "Report", path: "/a.md", kind: "report" },
      { title: "Shot", path: "/b.png", kind: "media" },
    ];
    expect(filterArtifactsBySearch(items, "png")).toEqual([items[1]]);
    expect(filterArtifactsBySearch(items, "report")).toEqual([items[0]]);
  });
});
