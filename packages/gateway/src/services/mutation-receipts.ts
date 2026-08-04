import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import type { IpcRequest } from "@grokdesk/shared";

export interface MutationReceipt {
  id: string;
  principalId: string;
  method: string;
  clientMutationId: string;
  requestHash: string;
  result: unknown;
  createdAt: string;
}

export type MutationOutcome =
  | { kind: "duplicate"; receipt: MutationReceipt }
  | { kind: "conflict"; receipt: MutationReceipt }
  | { kind: "fresh" };

export type AtomicMutationOutcome<T> =
  | { kind: "fresh"; result: T; receipt: MutationReceipt }
  | { kind: "duplicate"; result: T; receipt: MutationReceipt };

/**
 * Pull clientMutationId from IPC params when present and non-empty.
 * Pure helper so Gateway.handle stays thin (Phase 6 extract).
 */
export function extractClientMutationId(
  req: Pick<IpcRequest, "params">,
): string | undefined {
  const params = req.params as { clientMutationId?: unknown } | undefined;
  if (
    params &&
    typeof params === "object" &&
    typeof params.clientMutationId === "string" &&
    params.clientMutationId.length > 0
  ) {
    return params.clientMutationId;
  }
  return undefined;
}

/**
 * Principal key for mutation receipts: authenticated remote device, else desktop.
 */
export function mutationPrincipalId(ctx: {
  transport: string;
  principalDeviceId: string | null;
}): string {
  if (ctx.transport === "remote" && ctx.principalDeviceId) {
    return ctx.principalDeviceId;
  }
  if (ctx.transport === "desktop") return "desktop";
  return ctx.principalDeviceId ?? "unknown";
}

function stableHash(method: string, params: unknown): string {
  const payload = JSON.stringify({ method, params: canonicalize(params) });
  return createHash("sha256").update(payload).digest("hex");
}

export type MutationSingleFlightKey = {
  principalId: string;
  method: string;
  clientMutationId: string;
};

type MutationFlight = {
  requestHash: string;
  promise: Promise<unknown>;
};

/**
 * Process-local reservation for mutations that have not produced a durable
 * receipt yet. Followers with the same payload share the leader result.
 */
/** Cap concurrent in-flight mutation keys (pathological clientMutationId spam). */
const MAX_MUTATION_FLIGHTS = 256;

export class MutationSingleFlight {
  private flights = new Map<string, MutationFlight>();

  run<T>(
    key: MutationSingleFlightKey,
    params: unknown,
    dispatch: () => Promise<T> | T,
  ): Promise<T> {
    const flightKey = JSON.stringify([
      key.principalId,
      key.method,
      key.clientMutationId,
    ]);
    const requestHash = stableHash(key.method, params);
    const existing = this.flights.get(flightKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return Promise.reject(
          new Error("clientMutationId reused with different payload"),
        );
      }
      return existing.promise as Promise<T>;
    }
    if (this.flights.size >= MAX_MUTATION_FLIGHTS) {
      return Promise.reject(new Error("too many concurrent mutations"));
    }

    let resolve!: (result: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.flights.set(flightKey, { requestHash, promise });
    void (async () => {
      try {
        resolve(await dispatch());
      } catch (error) {
        reject(error);
      } finally {
        const current = this.flights.get(flightKey);
        if (current?.promise === promise) this.flights.delete(flightKey);
      }
    })();
    return promise;
  }
}

/** Stable JSON for hashing: sort object keys, drop clientMutationId. */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (key === "clientMutationId") continue;
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

export class MutationReceiptService {
  constructor(private db: Db) {}

  /** Synchronous transaction boundary for an unkeyed local acceptance. */
  runAtomically<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }

  /**
   * Accept a mutation and persist its result in the same synchronous SQLite
   * transaction as every durable write performed by `operation`.
   *
   * better-sqlite3 transactions must stay synchronous. Callers may compose
   * other services backed by this same Db; nested transactions become
   * savepoints and the outer commit remains the sole acceptance boundary.
   */
  acceptAtomically<T>(
    principalId: string,
    method: string,
    clientMutationId: string,
    params: unknown,
    operation: () => T,
  ): AtomicMutationOutcome<T> {
    return this.db.transaction(() => {
      const existing = this.begin(
        principalId,
        method,
        clientMutationId,
        params,
      );
      if (existing.kind === "conflict") {
        throw new Error("clientMutationId reused with different payload");
      }
      if (existing.kind === "duplicate") {
        return {
          kind: "duplicate" as const,
          result: existing.receipt.result as T,
          receipt: existing.receipt,
        };
      }

      const result = operation();
      const receipt = this.commit(
        principalId,
        method,
        clientMutationId,
        params,
        result,
        { requireInsert: true },
      );
      return { kind: "fresh" as const, result, receipt };
    })();
  }

  /**
   * Look up an existing receipt for this principal/method/clientMutationId.
   * Returns duplicate (same payload), conflict (different payload), or fresh.
   */
  begin(
    principalId: string,
    method: string,
    clientMutationId: string,
    params: unknown,
  ): MutationOutcome {
    const requestHash = stableHash(method, params);
    const row = this.db
      .prepare(
        `SELECT id, principal_id as principalId, method, client_mutation_id as clientMutationId,
                request_hash as requestHash, result_json as resultJson, created_at as createdAt
         FROM mutation_receipts
         WHERE principal_id = ? AND method = ? AND client_mutation_id = ?`,
      )
      .get(principalId, method, clientMutationId) as
      | {
          id: string;
          principalId: string;
          method: string;
          clientMutationId: string;
          requestHash: string;
          resultJson: string;
          createdAt: string;
        }
      | undefined;

    if (!row) return { kind: "fresh" };

    let result: unknown = null;
    try {
      result = JSON.parse(row.resultJson) as unknown;
    } catch {
      result = { _corruptResult: true };
    }
    const receipt: MutationReceipt = {
      id: row.id,
      principalId: row.principalId,
      method: row.method,
      clientMutationId: row.clientMutationId,
      requestHash: row.requestHash,
      result,
      createdAt: row.createdAt,
    };

    if (row.requestHash !== requestHash) {
      return { kind: "conflict", receipt };
    }
    return { kind: "duplicate", receipt };
  }

  commit(
    principalId: string,
    method: string,
    clientMutationId: string,
    params: unknown,
    result: unknown,
    opts?: { requireInsert?: boolean },
  ): MutationReceipt {
    const now = new Date().toISOString();
    const id = randomUUID();
    const requestHash = stableHash(method, params);
    // Insert-or-ignore under race: concurrent duplicates keep the first row.
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO mutation_receipts
        (id, principal_id, method, client_mutation_id, request_hash, result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const info = insert.run(
      id,
      principalId,
      method,
      clientMutationId,
      requestHash,
      JSON.stringify(result ?? null),
      now,
    );
    if (info.changes === 0) {
      if (opts?.requireInsert) {
        // A competing process won after our in-transaction read. Throwing
        // rolls every write in the caller's outer acceptance transaction back;
        // the client can retry and observe the winner's durable receipt.
        throw new Error("mutation acceptance raced; retry the same request");
      }
      const existing = this.begin(
        principalId,
        method,
        clientMutationId,
        params,
      );
      if (existing.kind === "duplicate" || existing.kind === "conflict") {
        return existing.receipt;
      }
    }
    return {
      id,
      principalId,
      method,
      clientMutationId,
      requestHash,
      result,
      createdAt: now,
    };
  }

  /**
   * Drop receipts older than maxAgeDays so idempotency storage cannot grow
   * without bound on long-lived desks (remote offline queue flushes).
   */
  prune(maxAgeDays = 14): number {
    const cutoff = new Date(
      Date.now() - maxAgeDays * 24 * 3600_000,
    ).toISOString();
    const r = this.db
      .prepare(`DELETE FROM mutation_receipts WHERE created_at < ?`)
      .run(cutoff);
    return r.changes ?? 0;
  }
}

/** Methods that accept clientMutationId and are queueable mutations. */
export const IDEMPOTENT_MUTATION_METHODS = new Set([
  "tasks.create",
  "tasks.delete",
  "tasks.cancel",
  "tasks.setTitle",
  "tasks.approve",
  /** Mid-run ACP interjection — same dedupe model as follow-up create. */
  "task.interject",
  "memory.create",
  "memory.update",
  "memory.delete",
  "schedules.create",
  "schedules.update",
  "schedules.delete",
  "schedules.setEnabled",
  "remote.rekey",
  "remote.devices.revoke",
  "remote.telepresence.start",
  "remote.telepresence.stop",
]);
