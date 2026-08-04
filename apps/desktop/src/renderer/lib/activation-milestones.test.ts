import { describe, expect, it } from "vitest";
import {
  activationStarterGoal,
  emptyMilestones,
  loadMilestones,
  patchMilestones,
  saveMilestones,
} from "./activation-milestones";

function mem(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
  } as Storage;
}

describe("activation-milestones", () => {
  it("persists milestones", () => {
    const storage = mem();
    const m = patchMilestones(emptyMilestones(), {
      accountResolved: true,
      demoMode: true,
    });
    saveMilestones(m, storage);
    expect(loadMilestones(storage).demoMode).toBe(true);
  });

  it("never seeds folder-specific goal without a folder", () => {
    expect(
      activationStarterGoal({ hasFolder: false }).toLowerCase(),
    ).not.toContain("this folder");
    expect(
      activationStarterGoal({ hasFolder: true, folderName: "Repo" }),
    ).toContain("Repo");
  });
});
