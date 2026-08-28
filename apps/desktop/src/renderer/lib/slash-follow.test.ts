import { describe, it, expect } from "vitest";
import {
  shouldPickFolderForSlash,
  slashSideAction,
} from "./slash-follow";

describe("slash-follow", () => {
  it("detects organize without root", () => {
    expect(
      shouldPickFolderForSlash({ id: "organize", kind: "fill" }, ""),
    ).toBe(true);
    expect(
      shouldPickFolderForSlash({ id: "organize", kind: "fill" }, "/ws"),
    ).toBe(false);
    expect(
      shouldPickFolderForSlash({ id: "other", kind: "fill" }, ""),
    ).toBe(false);
  });

  it("maps side actions", () => {
    expect(slashSideAction({ id: "x", kind: "run", action: "pickFolder" })).toBe(
      "pickFolder",
    );
    expect(
      slashSideAction({ id: "x", kind: "run", action: "openSchedule" }),
    ).toBe("openSchedule");
    expect(slashSideAction({ id: "x", kind: "run" })).toBeNull();
    expect(slashSideAction({ id: "x", kind: "run", action: "compact" })).toBe(
      "compact",
    );
    expect(slashSideAction({ id: "x", kind: "run", action: "rewind" })).toBe(
      "rewind",
    );
    expect(slashSideAction({ id: "x", kind: "run", action: "remember" })).toBe(
      "remember",
    );
  });
});
