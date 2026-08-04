import { describe, it, expect } from "vitest";
import { isAudioPath, isMediaPath, isVideoPath } from "./api";

describe("isAudioPath / isMediaPath", () => {
  it("detects audio extensions", () => {
    expect(isAudioPath("x/track.mp3")).toBe(true);
    expect(isAudioPath("x/clip.mp4")).toBe(false);
    expect(isAudioPath("x/track.wav")).toBe(true);
    expect(isAudioPath("x/song.m4a")).toBe(true);
    expect(isAudioPath("x/song.aac")).toBe(true);
    expect(isAudioPath("x/song.ogg")).toBe(true);
    expect(isAudioPath("x/song.flac")).toBe(true);
    expect(isAudioPath(null)).toBe(false);
    expect(isAudioPath(undefined)).toBe(false);
  });

  it("includes audio in isMediaPath", () => {
    expect(isMediaPath("x/track.wav")).toBe(true);
    expect(isMediaPath("x/clip.mp4")).toBe(true);
    expect(isMediaPath("x/shot.png")).toBe(true);
    expect(isMediaPath("x/note.md")).toBe(false);
  });

  it("does not treat audio as video", () => {
    expect(isVideoPath("x/track.mp3")).toBe(false);
  });
});
