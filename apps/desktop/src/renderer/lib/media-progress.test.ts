import { describe, expect, it } from "vitest";
import {
  mediaToolKind,
  openToolsFromWork,
  runningMediaKind,
} from "./media-progress";

describe("mediaToolKind", () => {
  it("classifies video tools", () => {
    expect(mediaToolKind("image_to_video")).toBe("video");
    expect(mediaToolKind("reference_to_video")).toBe("video");
    expect(mediaToolKind("Image_To_Video")).toBe("video");
  });

  it("classifies image tools", () => {
    expect(mediaToolKind("generate_image")).toBe("image");
    expect(mediaToolKind("imagine")).toBe("image");
    expect(mediaToolKind("edit_image")).toBe("image");
  });

  it("returns null for non-media and empty", () => {
    expect(mediaToolKind("shell")).toBeNull();
    expect(mediaToolKind("read_file")).toBeNull();
    expect(mediaToolKind(undefined)).toBeNull();
    expect(mediaToolKind(null)).toBeNull();
    expect(mediaToolKind("")).toBeNull();
  });

  it("does not treat inspection/transport tools as generation", () => {
    // Merely mentioning image/video must not trigger a rendering card.
    expect(mediaToolKind("view_image")).toBeNull();
    expect(mediaToolKind("read_image")).toBeNull();
    expect(mediaToolKind("download_video")).toBeNull();
    expect(mediaToolKind("list_images")).toBeNull();
    expect(mediaToolKind("convert_video")).toBeNull();
    // Real producers still classify.
    expect(mediaToolKind("image_to_video")).toBe("video");
    expect(mediaToolKind("generate_image")).toBe("image");
  });
});

describe("runningMediaKind", () => {
  it("returns the newest running media tool", () => {
    expect(
      runningMediaKind([
        { tool: "shell", status: "running" },
        { tool: "image_to_video", status: "running" },
      ]),
    ).toBe("video");
  });

  it("ignores completed media tools", () => {
    expect(
      runningMediaKind([
        { tool: "image_to_video", status: "ok" },
        { tool: "shell", status: "running" },
      ]),
    ).toBeNull();
  });
});

describe("openToolsFromWork", () => {
  it("keeps unmatched tool_requests as running", () => {
    const open = openToolsFromWork([
      { kind: "tool_request", payload: { tool: "generate_image" } },
      { kind: "tool_request", payload: { tool: "shell", command: "ls" } },
      { kind: "tool_result", payload: { tool: "shell", ok: true } },
    ]);
    expect(open).toEqual([
      { tool: "generate_image", status: "running", detail: undefined },
    ]);
    expect(runningMediaKind(open)).toBe("image");
  });
});
