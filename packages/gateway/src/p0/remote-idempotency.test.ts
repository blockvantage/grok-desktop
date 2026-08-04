import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import {
  extractClientMutationId,
  MutationReceiptService,
  mutationPrincipalId,
} from "../services/mutation-receipts.js";

describe("REMOTE-02 mutation idempotency receipts", () => {
  let dir: string;
  let db: Db;
  let svc: MutationReceiptService;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-mut-"));
    dbPath = path.join(dir, "t.sqlite");
    db = openDatabase(dbPath);
    svc = new MutationReceiptService(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns original result for duplicate clientMutationId", () => {
    const params = { goal: "a", workspaceRoots: ["/w"] };
    expect(
      svc.begin("dev-a", "tasks.create", "m1", params).kind,
    ).toBe("fresh");
    const receipt = svc.commit(
      "dev-a",
      "tasks.create",
      "m1",
      params,
      { id: "task-1", status: "queued" },
    );
    const dup = svc.begin("dev-a", "tasks.create", "m1", params);
    expect(dup.kind).toBe("duplicate");
    if (dup.kind === "duplicate") {
      expect(dup.receipt.result).toEqual(receipt.result);
    }
  });

  it("conflicts when same id is reused with different payload", () => {
    svc.commit(
      "dev-a",
      "tasks.create",
      "m2",
      { goal: "one" },
      { id: "t1" },
    );
    const outcome = svc.begin("dev-a", "tasks.create", "m2", { goal: "two" });
    expect(outcome.kind).toBe("conflict");
  });

  it("can require a fresh receipt insert for an outer atomic acceptance", () => {
    const params = { goal: "winner" };
    svc.commit(
      "dev-a",
      "tasks.create",
      "race-id",
      params,
      { id: "winner" },
    );

    expect(() =>
      svc.commit(
        "dev-a",
        "tasks.create",
        "race-id",
        params,
        { id: "loser" },
        { requireInsert: true },
      ),
    ).toThrow("mutation acceptance raced");
  });

  it("isolates principals — device B cannot see device A receipt", () => {
    svc.commit(
      "dev-a",
      "tasks.create",
      "shared-id",
      { goal: "a" },
      { id: "ta" },
    );
    expect(
      svc.begin("dev-b", "tasks.create", "shared-id", { goal: "a" }).kind,
    ).toBe("fresh");
  });

  it("survives database reopen (gateway restart)", () => {
    svc.commit(
      "dev-a",
      "tasks.create",
      "persist-1",
      { goal: "x" },
      { id: "tx" },
    );
    const db2 = openDatabase(dbPath);
    const svc2 = new MutationReceiptService(db2);
    const outcome = svc2.begin(
      "dev-a",
      "tasks.create",
      "persist-1",
      { goal: "x" },
    );
    expect(outcome.kind).toBe("duplicate");
    if (outcome.kind === "duplicate") {
      expect((outcome.receipt.result as { id: string }).id).toBe("tx");
    }
    db2.close();
  });

  it("extractClientMutationId reads non-empty string only", () => {
    expect(
      extractClientMutationId({ params: { clientMutationId: "abc" } }),
    ).toBe("abc");
    expect(extractClientMutationId({ params: { clientMutationId: "" } })).toBe(
      undefined,
    );
    expect(extractClientMutationId({ params: {} })).toBe(undefined);
    expect(
      extractClientMutationId({ params: { clientMutationId: 12 as unknown as string } }),
    ).toBe(undefined);
  });

  it("mutationPrincipalId binds remote to device and desktop to desktop", () => {
    expect(
      mutationPrincipalId({
        transport: "remote",
        principalDeviceId: "phone-A",
      }),
    ).toBe("phone-A");
    expect(
      mutationPrincipalId({ transport: "desktop", principalDeviceId: null }),
    ).toBe("desktop");
    expect(
      mutationPrincipalId({ transport: "remote", principalDeviceId: null }),
    ).toBe("unknown");
  });
});
