import { describe, expect, it } from "vitest";
import {
  MAX_FOLDER_ORDER_ENTRIES,
  MAX_FOLDER_ORDER_KEY_CHARS,
  MAX_FOLDER_ORDER_RAW_CHARS,
  capFolderOrder,
  parseFolderOrderRaw,
} from "./folder-order";

describe("folder-order bounds", () => {
  it("parses and caps valid string arrays", () => {
    expect(parseFolderOrderRaw(JSON.stringify(["/a", "/b"]))).toEqual([
      "/a",
      "/b",
    ]);
    const many = Array.from({ length: 100 }, (_, i) => `/f${i}`);
    expect(parseFolderOrderRaw(JSON.stringify(many))).toHaveLength(
      MAX_FOLDER_ORDER_ENTRIES,
    );
  });

  it("rejects oversized raw payloads and non-arrays", () => {
    expect(parseFolderOrderRaw("x".repeat(MAX_FOLDER_ORDER_RAW_CHARS + 1))).toEqual(
      [],
    );
    expect(parseFolderOrderRaw('{"not":"array"}')).toEqual([]);
    expect(parseFolderOrderRaw(null)).toEqual([]);
  });

  it("trims keys and caps length on save", () => {
    const long = "k".repeat(MAX_FOLDER_ORDER_KEY_CHARS + 20);
    const capped = capFolderOrder([`  ${long}  `, "", "ok"]);
    expect(capped).toEqual([long.slice(0, MAX_FOLDER_ORDER_KEY_CHARS), "ok"]);
  });
});
