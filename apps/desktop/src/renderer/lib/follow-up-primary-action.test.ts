import { describe, it, expect } from "vitest";
import {
  followUpPrimaryAction,
  followUpPlaceholderKey,
  attachmentPathsForQueue,
} from "./follow-up-primary-action";

describe("followUpPrimaryAction", () => {
  it("stop when live and empty", () => {
    expect(followUpPrimaryAction({ isLive: true, goal: "  " })).toBe("stop");
    expect(followUpPrimaryAction({ isLive: true, goal: "hi" })).toBe("send");
    expect(followUpPrimaryAction({ isLive: false, goal: "" })).toBe("send");
  });
});

describe("followUpPlaceholderKey", () => {
  it("picks live vs default", () => {
    expect(
      followUpPlaceholderKey({ isTerminal: true, isLive: false }),
    ).toBe("workspace.followUp");
    expect(
      followUpPlaceholderKey({ isTerminal: false, isLive: true }),
    ).toBe("workspace.followUpLive");
    expect(
      followUpPlaceholderKey({ isTerminal: false, isLive: false }),
    ).toBe("workspace.followUp");
  });
});

describe("attachmentPathsForQueue", () => {
  it("prefers stagedPath", () => {
    expect(
      attachmentPathsForQueue([
        { stagedPath: "/s/a", sourcePath: "/src/a" },
        { sourcePath: "/src/b" },
        {},
      ]),
    ).toEqual(["/s/a", "/src/b"]);
  });
});
