import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPrefs,
  DEFAULT_PREFS,
  diffNewInboxIds,
  loadPrefs,
  savePrefs,
} from "./prefs";

describe("mobile prefs (P3)", () => {
  beforeEach(async () => {
    await clearPrefs();
  });

  it("loads defaults then persists overrides", async () => {
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
    await savePrefs({
      ...DEFAULT_PREFS,
      defaultQuality: "crisp",
      preferredDisplayId: "ext-1",
      pipEnabled: false,
      notifyInbox: false,
    });
    const loaded = await loadPrefs();
    expect(loaded.defaultQuality).toBe("crisp");
    expect(loaded.preferredDisplayId).toBe("ext-1");
    expect(loaded.pipEnabled).toBe(false);
    expect(loaded.notifyInbox).toBe(false);
  });

  it("diffNewInboxIds reports only unseen items", () => {
    const { newIds, nextSeen } = diffNewInboxIds(["a"], ["a", "b", "c"]);
    expect(newIds).toEqual(["b", "c"]);
    expect(nextSeen).toEqual(["a", "b", "c"]);
    expect(diffNewInboxIds(["a", "b", "c"], ["a", "b", "c"]).newIds).toEqual(
      [],
    );
  });

  it("drops oversized display id and caps seen inbox ids", async () => {
    await savePrefs({
      ...DEFAULT_PREFS,
      preferredDisplayId: "d".repeat(65),
      seenInboxIds: Array.from({ length: 250 }, (_, i) => `id-${i}`),
    });
    const loaded = await loadPrefs();
    expect(loaded.preferredDisplayId).toBeNull();
    expect(loaded.seenInboxIds).toHaveLength(200);
    expect(loaded.seenInboxIds[0]).toBe("id-0");
    expect(loaded.seenInboxIds[199]).toBe("id-199");
  });
});
