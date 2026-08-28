import { describe, expect, it } from "vitest";
import {
  clampMediaDuration,
  isMediaAspectRatio,
  isMediaPresetVoice,
  MEDIA_ASPECT_RATIOS,
  MEDIA_DURATION_MAX,
  mediaKindFromTokens,
  stillImagePathFromAttachments,
  weaveMediaStudioGoal,
} from "./media-studio.js";

describe("media studio options", () => {
  it("includes 4:3 and 3:4 plus the usual frames", () => {
    expect(MEDIA_ASPECT_RATIOS).toEqual(
      expect.arrayContaining(["4:3", "3:4", "16:9", "9:16", "1:1"]),
    );
    expect(isMediaAspectRatio("4:3")).toBe(true);
    expect(isMediaAspectRatio("21:9")).toBe(false);
  });

  it("clamps duration to 1–15 seconds", () => {
    expect(clampMediaDuration(0)).toBe(1);
    expect(clampMediaDuration(12.4)).toBe(12);
    expect(clampMediaDuration(99)).toBe(MEDIA_DURATION_MAX);
    expect(clampMediaDuration("nope")).toBe(6);
  });

  it("accepts grok preset voices", () => {
    expect(isMediaPresetVoice("eve")).toBe(true);
    expect(isMediaPresetVoice("narrator")).toBe(false);
  });

  it("picks a still image from attachments for image-to-video", () => {
    expect(
      stillImagePathFromAttachments([
        { path: "/ws/notes.md" },
        { sourcePath: "/ws/hero.png" },
      ]),
    ).toBe("/ws/hero.png");
    expect(stillImagePathFromAttachments([{ path: "/ws/clip.mp4" }])).toBeNull();
  });

  it("weaves duration, 4:3, voice, still, and workspace videos/ into the goal", () => {
    const goal = weaveMediaStudioGoal("Make a teaser", {
      kind: "video",
      durationSec: 10,
      aspectRatio: "4:3",
      voice: "ara",
      stillImagePath: "/ws/poster.jpg",
    });
    expect(goal).toContain("Make a teaser");
    expect(goal).toContain("Duration: 10 seconds");
    expect(goal).toContain("Aspect ratio: 4:3");
    expect(goal).toContain('preset voice "ara"');
    expect(goal).toContain("Animate this still image");
    expect(goal).toContain("/ws/poster.jpg");
    expect(goal).toMatch(/workspace videos\//);
    expect(goal).toMatch(/Artifacts/);
  });

  it("weaves image aspect and workspace images/ folder", () => {
    const goal = weaveMediaStudioGoal("Product shot", {
      kind: "image",
      aspectRatio: "3:4",
    });
    expect(goal).toContain("Aspect ratio: 3:4");
    expect(goal).toMatch(/workspace images\//);
    expect(goal).not.toContain("Duration:");
  });

  it("detects image vs video from slash/intent tokens", () => {
    expect(mediaKindFromTokens("video", "/video")).toBe("video");
    expect(mediaKindFromTokens("image")).toBe("image");
    expect(mediaKindFromTokens("brief")).toBeNull();
    expect(mediaKindFromTokens("the video looks dark")).toBeNull();
  });
});
