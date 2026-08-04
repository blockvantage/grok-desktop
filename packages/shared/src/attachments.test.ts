import { describe, expect, it } from "vitest";
import {
  attachmentKindForName,
  buildAttachmentsPromptBlock,
  isAllowedAttachmentSize,
  MAX_ATTACHMENTS,
  mergeGoalWithAttachments,
  sanitizeAttachmentFileName,
} from "./attachments.js";

describe("attachments", () => {
  it("classifies image / audio / file", () => {
    expect(attachmentKindForName("a.PNG")).toBe("image");
    expect(attachmentKindForName("v.wav")).toBe("audio");
    expect(attachmentKindForName("r.pdf")).toBe("file");
  });

  it("sanitizes names", () => {
    expect(sanitizeAttachmentFileName("../../x y.png")).toBe("x-y.png");
    // Must never return path segments that escape the attachments dir.
    expect(sanitizeAttachmentFileName("..")).toBe("file");
    expect(sanitizeAttachmentFileName(".")).toBe("file");
    expect(sanitizeAttachmentFileName("...")).toBe("file");
  });

  it("enforces size + count caps", () => {
    expect(isAllowedAttachmentSize("image", 14 * 1024 * 1024)).toBe(true);
    expect(isAllowedAttachmentSize("image", 16 * 1024 * 1024)).toBe(false);
    expect(MAX_ATTACHMENTS).toBe(10);
  });

  it("builds prompt block with sections", () => {
    const block = buildAttachmentsPromptBlock([
      {
        id: "1",
        name: "hero.png",
        sourcePath: "/tmp/hero.png",
        kind: "image",
        stagedPath: "/ws/attachments/hero.png",
      },
      {
        id: "2",
        name: "r.pdf",
        sourcePath: "/Users/me/r.pdf",
        kind: "file",
      },
    ]);
    expect(block).toContain("Attached images");
    expect(block).toContain("/ws/attachments/hero.png");
    expect(block).toContain("Attached files");
    expect(block).toContain("/Users/me/r.pdf");
  });

  it("merges goal with attachment block", () => {
    const g = mergeGoalWithAttachments("Do the thing", [
      {
        id: "1",
        name: "a.pdf",
        sourcePath: "/x/a.pdf",
        kind: "file",
      },
    ]);
    expect(g.startsWith("Do the thing")).toBe(true);
    expect(g).toContain("/x/a.pdf");
  });
});
