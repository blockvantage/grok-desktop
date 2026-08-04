import { describe, it, expect } from "vitest";
import { topbarSearchPlaceholder } from "./topbar-search";

const labels = {
  tasks: "Search tasks",
  artifacts: "Search artifacts",
  memory: "Search memory",
  scheduled: "Search schedules",
  default: "Search",
};

describe("topbarSearchPlaceholder", () => {
  it("maps nav to labels", () => {
    expect(topbarSearchPlaceholder("tasks", labels)).toBe("Search tasks");
    expect(topbarSearchPlaceholder("artifacts", labels)).toBe(
      "Search artifacts",
    );
    expect(topbarSearchPlaceholder("memory", labels)).toBe("Search memory");
    expect(topbarSearchPlaceholder("scheduled", labels)).toBe(
      "Search schedules",
    );
    expect(topbarSearchPlaceholder("home", labels)).toBe("Search");
    expect(topbarSearchPlaceholder("settings", labels)).toBe("Search");
  });
});
