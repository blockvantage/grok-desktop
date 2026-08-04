import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../db.js";
import { OperationReceiptService } from "./operation-receipts.js";

describe("OperationReceiptService redaction", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-or-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("redacts secret keys and inline password/token assignments", () => {
    const db = openDatabase(path.join(dir, "t.sqlite"));
    const svc = new OperationReceiptService(db);
    const r = svc.append({
      action: "tool:shell",
      decision: "deny",
      detail: {
        apiKey: "sk-live-should-not-appear",
        command: "curl -H token=abc123 password=hunter2 https://x",
      },
    });
    expect(r.detail.apiKey).toBe("[REDACTED]");
    expect(String(r.detail.command)).toContain("token=[REDACTED]");
    expect(String(r.detail.command)).toContain("password=[REDACTED]");
    expect(JSON.stringify(r.detail)).not.toMatch(/hunter2|abc123|sk-live/);
    db.close();
  });

  it("isolates corrupt detail_json rows instead of throwing", () => {
    const db = openDatabase(path.join(dir, "t.sqlite"));
    const svc = new OperationReceiptService(db);
    const r = svc.append({
      taskId: "t-corrupt",
      action: "tool:shell",
      decision: "allow",
      detail: { ok: true },
    });
    db.prepare(`UPDATE operation_receipts SET detail_json = ? WHERE id = ?`).run(
      "not-json{",
      r.id,
    );
    const listed = svc.listForTask("t-corrupt");
    expect(listed).toHaveLength(1);
    expect(listed[0]!.detail).toEqual({ _corruptDetail: true });
    db.close();
  });
});
