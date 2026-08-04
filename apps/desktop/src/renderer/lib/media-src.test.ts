import { describe, it, expect } from "vitest";
import { videoDisplaySrc } from "@/lib/media-src";

describe("videoDisplaySrc", () => {
  it("appends a first-frame fragment to plain srcs", () => {
    expect(videoDisplaySrc("grokdesk-asset://local/abc")).toBe(
      "grokdesk-asset://local/abc#t=0.001",
    );
  });

  it("does not double-append or touch data urls", () => {
    expect(videoDisplaySrc("x#t=0.001")).toBe("x#t=0.001");
    expect(videoDisplaySrc("data:video/mp4;base64,AAAA")).toBe(
      "data:video/mp4;base64,AAAA",
    );
  });

  it("passes through empty strings", () => {
    expect(videoDisplaySrc("")).toBe("");
  });
});
