import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db.js";
import { ArtifactService } from "./artifacts.js";
import { DeclaredArtifactService } from "./declared-artifacts.js";

describe("DeclaredArtifactService", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-declared-art-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reuses an artifact already persisted from the canonical task event", () => {
    const canonical = new ArtifactService(db).create({
      taskId: "task-1",
      title: "Launch brief",
      kind: "report",
      path: "/workspace/launch.md",
    });

    const declared = new DeclaredArtifactService(db).declare({
      taskId: "task-1",
      runAttemptId: "attempt-1",
      title: "Launch brief",
      kind: "report",
      path: "/workspace/launch.md",
      declaredBy: "provider",
    });

    expect(declared.id).toBe(canonical.id);
    expect(new ArtifactService(db).list("task-1")).toHaveLength(1);
  });
});
