import { describe, it, expect } from "vitest";
import {
  HOST_WRITE_FILE_MAX_CHARS,
  writeFilePayload,
  writeFileReceiptDetail,
  writeFileSuccessOutput,
} from "./host-write-file.js";

describe("host-write-file", () => {
  it("returns null for non-write tools or missing path", () => {
    expect(
      writeFilePayload({ id: "1", tool: "shell", path: "/x" }),
    ).toBeNull();
    expect(
      writeFilePayload({ id: "1", tool: "write_file" }),
    ).toBeNull();
  });

  it("extracts content and byte length", () => {
    const p = writeFilePayload({
      id: "1",
      tool: "write_file",
      path: "/ws/a.txt",
      meta: { content: "hello" },
    });
    expect(p).toEqual({ content: "hello", bytes: 5 });
    expect(writeFileSuccessOutput("/ws/a.txt")).toBe("wrote /ws/a.txt");
    expect(writeFileReceiptDetail("/ws/a.txt", 5)).toEqual({
      tool: "write_file",
      path: "/ws/a.txt",
      bytes: 5,
    });
  });

  it("rejects content above HOST_WRITE_FILE_MAX_CHARS", () => {
    expect(
      writeFilePayload({
        id: "1",
        tool: "write_file",
        path: "/ws/a.txt",
        meta: { content: "x".repeat(HOST_WRITE_FILE_MAX_CHARS + 1) },
      }),
    ).toBeNull();
    expect(
      writeFilePayload({
        id: "1",
        tool: "write_file",
        path: "/ws/a.txt",
        meta: { content: "x".repeat(HOST_WRITE_FILE_MAX_CHARS) },
      })?.bytes,
    ).toBe(HOST_WRITE_FILE_MAX_CHARS);
  });
});
