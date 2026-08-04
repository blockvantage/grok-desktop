import { describe, expect, it, vi } from "vitest";
import {
  missingAttachmentPaths,
  workspacePathExists,
} from "./queue-attachments";

describe("missingAttachmentPaths", () => {
  it("returns empty when no paths", async () => {
    expect(await missingAttachmentPaths(undefined, () => true)).toEqual([]);
    expect(await missingAttachmentPaths([], () => true)).toEqual([]);
  });

  it("lists only paths that fail the exists probe", async () => {
    const exists = (p: string) => p !== "/gone.png";
    expect(
      await missingAttachmentPaths(
        ["/ok.png", "/gone.png", "/also-ok.pdf"],
        exists,
      ),
    ).toEqual(["/gone.png"]);
  });

  it("treats thrown exists checks as missing", async () => {
    const exists = vi.fn(async (p: string) => {
      if (p === "/boom") throw new Error("io");
      return true;
    });
    expect(await missingAttachmentPaths(["/ok", "/boom"], exists)).toEqual([
      "/boom",
    ]);
  });
});

describe("workspacePathExists", () => {
  it("returns true when read succeeds", async () => {
    expect(await workspacePathExists("/a", async () => ({ ok: true }))).toBe(
      true,
    );
  });

  it("returns false when read throws", async () => {
    expect(
      await workspacePathExists("/missing", async () => {
        throw new Error("File not found");
      }),
    ).toBe(false);
  });
});
