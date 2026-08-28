import { describe, expect, it } from "vitest";
import { GROKDESK_VERSION } from "@grokdesk/shared";
import {
  allWhatsNew,
  compareVersions,
  DESK_WHATS_NEW,
  highestWhatsNewVersion,
  shouldShowWhatsNew,
  unseenWhatsNew,
} from "./whats-new";

describe("whats-new", () => {
  it("lists Desk notes for the current app version", () => {
    expect(DESK_WHATS_NEW[0]?.version).toBe(GROKDESK_VERSION);
    expect(DESK_WHATS_NEW[0]?.itemKeys.length).toBeGreaterThan(0);
  });

  it("shows unseen notes until the current version is marked seen", () => {
    const unseen = unseenWhatsNew({ lastSeenVersion: null });
    expect(shouldShowWhatsNew(unseen)).toBe(true);
    expect(unseen.some((e) => e.source === "desk")).toBe(true);

    const seen = unseenWhatsNew({
      lastSeenVersion: GROKDESK_VERSION,
      runtimeVersion: "1.0.9",
    });
    expect(shouldShowWhatsNew(seen)).toBe(false);
  });

  it("includes matching runtime notes when the CLI is new enough", () => {
    const withRuntime = unseenWhatsNew({
      lastSeenVersion: "0.9.0",
      runtimeVersion: "1.0.10",
    });
    expect(withRuntime.some((e) => e.source === "runtime")).toBe(true);
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
  });

  it("lists matching notes for Settings even after they are marked seen", () => {
    const all = allWhatsNew("1.0.10");
    expect(all.some((e) => e.source === "desk")).toBe(true);
    expect(all.some((e) => e.source === "runtime")).toBe(true);
    expect(highestWhatsNewVersion(all, "1.0.0")).toBe("1.0.10");
  });
});
