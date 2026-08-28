/**
 * sessions.search / sessions.list / sessions.foreignList IPC (Phase 3.4).
 * Desk-local search is always-on; ACP overlay is best-effort fail-open.
 */
import {
  parseSessionHeadlessPolicy,
  SESSION_HEADLESS_DEFAULT,
  type ForeignSessionSummary,
  type SessionHeadlessPolicy,
  type SessionSearchView,
  type Task,
} from "@grokdesk/shared";
import {
  buildSessionSearchView,
  deskHitsFromTasks,
  rosterHitsFromTasks,
  scanForeignSessionsFromHome,
} from "./session-roster.js";

export type SessionRosterDeps = {
  listTasks: () => Task[];
  needsInputIds?: () => Set<string>;
  searchAcp?: (input: {
    query: string;
    headless?: SessionHeadlessPolicy;
    limit?: number;
  }) => Promise<SessionSearchView | null>;
  listAcp?: (input?: {
    headless?: SessionHeadlessPolicy;
    limit?: number;
  }) => Promise<SessionSearchView | null>;
  scanForeign?: (opts: {
    cwd?: string | null;
  }) => ForeignSessionSummary[];
};

export const SESSION_ROSTER_METHODS = new Set([
  "sessions.search",
  "sessions.list",
  "sessions.foreignList",
]);

export function isSessionRosterMethod(method: string): boolean {
  return SESSION_ROSTER_METHODS.has(method);
}

function headlessOf(params: Record<string, unknown>): SessionHeadlessPolicy {
  return parseSessionHeadlessPolicy(params.headless);
}

function limitOf(params: Record<string, unknown>, fallback: number): number {
  const n = params.limit;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

async function overlayAcp(
  fn: (() => Promise<SessionSearchView | null>) | undefined,
): Promise<SessionSearchView | null> {
  if (!fn) return null;
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function dispatchSessionRosterMethod(
  method: string,
  params: Record<string, unknown>,
  deps: SessionRosterDeps,
): Promise<unknown> {
  switch (method) {
    case "sessions.search": {
      const query = typeof params.query === "string" ? params.query : "";
      const headless = headlessOf(params);
      const limit = limitOf(params, 24);
      const deskHits = deskHitsFromTasks(
        deps.listTasks(),
        query,
        deps.needsInputIds?.(),
      );
      const acp = await overlayAcp(() =>
        deps.searchAcp
          ? deps.searchAcp({ query, headless, limit })
          : Promise.resolve(null),
      );
      return buildSessionSearchView({ deskHits, acp, headless });
    }
    case "sessions.list": {
      const headless = headlessOf(params);
      const limit = limitOf(params, 40);
      const deskHits = rosterHitsFromTasks(
        deps.listTasks(),
        deps.needsInputIds?.(),
      ).slice(0, limit);
      const acp = await overlayAcp(() =>
        deps.listAcp
          ? deps.listAcp({ headless, limit })
          : Promise.resolve(null),
      );
      return buildSessionSearchView({
        deskHits,
        acp,
        headless: headless || SESSION_HEADLESS_DEFAULT,
      });
    }
    case "sessions.foreignList": {
      const cwd =
        typeof params.cwd === "string" && params.cwd.trim()
          ? params.cwd.trim()
          : null;
      if (deps.scanForeign) return deps.scanForeign({ cwd });
      return scanForeignSessionsFromHome({ cwd });
    }
    default:
      throw new Error(`unknown session roster method: ${method}`);
  }
}
