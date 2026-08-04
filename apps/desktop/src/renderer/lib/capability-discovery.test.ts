import { describe, expect, it } from "vitest";
import {
  dismissDiscovery,
  filterDismissedHints,
  pickCapabilityHints,
  type UsageSignals,
} from "./capability-discovery";

const base: UsageSignals = {
  hasUsedQueue: false,
  scheduleCount: 0,
  hasUsedBrowser: false,
  connectorCount: 0,
  memoryCount: 0,
  recipeCount: 0,
  hasExported: false,
  hasMultiTasked: false,
  hasRemote: false,
  doneCount: 2,
};

describe("capability-discovery", () => {
  it("returns empty before first completed task", () => {
    expect(pickCapabilityHints({ ...base, doneCount: 0 })).toEqual([]);
  });

  it("surfaces highest-weight unused capabilities", () => {
    const hints = pickCapabilityHints(base, 3);
    expect(hints).toHaveLength(3);
    expect(hints[0]!.id).toBe("queue_stack");
    expect(hints.map((h) => h.id)).not.toContain("remote"); // lower weight, not in top 3
  });

  it("hides discovered capabilities", () => {
    const hints = pickCapabilityHints(
      {
        ...base,
        hasUsedQueue: true,
        scheduleCount: 2,
        hasUsedBrowser: true,
      },
      5,
    );
    expect(hints.map((h) => h.id)).not.toContain("queue_stack");
    expect(hints.map((h) => h.id)).not.toContain("schedules");
    expect(hints.map((h) => h.id)).not.toContain("browser");
  });

  it("respects dismissals", () => {
    const mem = (() => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => {
          m.set(k, v);
        },
      };
    })();
    dismissDiscovery("queue_stack", mem);
    const hints = pickCapabilityHints(base, 3);
    const filtered = filterDismissedHints(
      hints,
      new Set(["queue_stack"]),
    );
    expect(filtered.map((h) => h.id)).not.toContain("queue_stack");
  });
});
