/**
 * Free Desk: first interactive tasks.create after gateway start must not
 * require a Desk product lease or entitlement fail-closed env.
 *
 * Production order for a fresh gateway's first interactive create:
 *   wireEntitlementEnforcement (Gateway.start) — runtime readiness only
 *   → TaskSubmissionService.submit
 *   → requireGrokAdmissionSync (admits when no product lease guard)
 */
import { afterEach, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EngineAdapter } from "../engine-types.js";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { RunAttemptService } from "./run-attempts.js";
import { TaskSubmissionService } from "./task-submission.js";
import { desktopRequestContext } from "./request-context.js";
import {
  wireEntitlementEnforcement,
  ENTITLEMENT_FAIL_CLOSED_ENV,
} from "./entitlement-composition.js";

describe("first interactive submit after free Desk wire", () => {
  let db: Db | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  async function wireFree(
    submission: TaskSubmissionService,
  ) {
    let engine: EngineAdapter = {
      executesOwnTools: false,
      run: async () => {},
      cancel: async () => {},
    };
    const noop = { setEntitlementGuard() {} };

    return wireEntitlementEnforcement({
      taskSubmission: submission,
      scheduler: noop,
      runner: noop,
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      env: {
        // Product-license fail-closed is ignored on free Desk.
        [ENTITLEMENT_FAIL_CLOSED_ENV]: "1",
        GROKDESK_PACKAGED: "1",
        GROKDESK_RUNTIME_READINESS_FAIL_CLOSED: "0",
      },
    });
  }

  it("admits first interactive create without product lease state", async () => {
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ent-submit-db-"));
    db = openDatabase(path.join(dataDir, "t.sqlite"));
    const tasks = new TaskService(db);
    const runs = new RunAttemptService(db);
    const submission = new TaskSubmissionService(tasks, runs);
    const ws = path.join(dataDir, "ws");
    await fsp.mkdir(ws, { recursive: true });

    const guard = await wireFree(submission);
    // Free Desk: no product-lease guard when runtime readiness is not required.
    expect(guard).toBeNull();

    expect(() =>
      submission.submit(
        { goal: "first interactive create", workspaceRoots: [ws] },
        desktopRequestContext("req-first-interactive"),
      ),
    ).not.toThrow();

    db.close();
    db = null;
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  it("still admits when fail-closed env is set and no lease is present", async () => {
    const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ent-submit-db-"));
    db = openDatabase(path.join(dataDir, "t.sqlite"));
    const tasks = new TaskService(db);
    const runs = new RunAttemptService(db);
    const submission = new TaskSubmissionService(tasks, runs);
    const ws = path.join(dataDir, "ws");
    await fsp.mkdir(ws, { recursive: true });

    await wireFree(submission);

    expect(() =>
      submission.submit(
        { goal: "free path without lease", workspaceRoots: [ws] },
        desktopRequestContext("req-free-unactivated"),
      ),
    ).not.toThrow();

    db.close();
    db = null;
    await fsp.rm(dataDir, { recursive: true, force: true });
  });
});
