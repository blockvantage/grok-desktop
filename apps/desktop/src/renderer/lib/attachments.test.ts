import { describe, expect, it } from "vitest";
import {
  addPathsToAttachments,
  imageExtFromMime,
  removeAttachment,
  type ClientAttachment,
} from "./attachments";

describe("client attachments", () => {
  it("adds paths with kinds and enforces max", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/tmp/f${i}.txt`);
    const { items, error } = addPathsToAttachments([], paths);
    expect(items.length).toBe(10);
    expect(error).toBe("max_attachments");
  });

  it("dedupes by resolved path", () => {
    const a: ClientAttachment[] = [];
    const r1 = addPathsToAttachments(a, ["/tmp/a.png"]);
    const r2 = addPathsToAttachments(r1.items, ["/tmp/a.png"]);
    expect(r2.items.length).toBe(1);
  });

  it("removes by id", () => {
    const { items } = addPathsToAttachments([], ["/tmp/a.pdf"]);
    expect(removeAttachment(items, items[0]!.id)).toHaveLength(0);
  });

  it("classifies image vs file", () => {
    const { items } = addPathsToAttachments([], [
      "/tmp/shot.PNG",
      "/tmp/notes.pdf",
    ]);
    expect(items[0]!.kind).toBe("image");
    expect(items[1]!.kind).toBe("file");
  });
});

describe("imageExtFromMime", () => {
  it("maps common image mimes", () => {
    expect(imageExtFromMime("image/png")).toBe("png");
    expect(imageExtFromMime("image/webp")).toBe("webp");
    expect(imageExtFromMime("image/jpeg")).toBe("jpg");
  });
});
