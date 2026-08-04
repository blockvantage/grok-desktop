import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { MemoryService } from "./memory.js";

describe("MemoryService", () => {
  let dir: string;
  let db: Db;
  let memory: MemoryService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-mem-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    memory = new MemoryService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("upserts and lists memory", () => {
    memory.upsert({
      kind: "brand",
      title: "Voice",
      content: "Direct, witty, no fluff",
    });
    expect(memory.list("brand")).toHaveLength(1);
  });

  it("retrieves relevant items for a goal", () => {
    memory.upsert({
      kind: "standing",
      title: "Always",
      content: "Be concise",
    });
    memory.upsert({
      kind: "brand",
      title: "Marketing voice",
      content: "Campaign copy should be punchy and product-led",
    });
    memory.upsert({
      kind: "project",
      title: "Unrelated",
      content: "Plumbing inventory spreadsheet formulas",
    });
    const hits = memory.retrieve("write marketing campaign copy");
    expect(hits.some((h) => h.kind === "standing")).toBe(true);
    const preamble = memory.formatPreamble(hits);
    expect(preamble).toMatch(/standing|Marketing/i);
  });
});
