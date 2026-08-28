/**
 * Audit drawer (trust Phase A2).
 * Lists real audit rows only — never invents decisions (fail-closed empty/error).
 * Task workspace: filter by thread taskIds (all turns). Settings: global list (no filter).
 *
 * Honesty:
 * - Clears rows on every fetch start / filter change (no cross-task flash).
 * - On close: bump generation + clear settled result so reopen never paints stale/empty
 *   as current before the open-triggered refetch settles.
 * - In-flight responses are sequenced; only the latest generation may apply.
 * - Load effect keys on set-stable filterKey string (sorted ids; not array identity).
 * - Until a fetch for the open filter settles, show loading — never “no decisions yet”.
 * - Malformed / all-invalid list payloads surface as error, not empty success.
 * - Soft-skipped invalid rows are reported separately from pagination hasMore
 *   (never “older entries not loaded” for discarded untrustworthy rows).
 * - Surfaces gateway provenance markers _unknownDecision / _corruptDetail.
 * - Surfaces detail.decision/reason for needs_approval policy mediation (mapped to info).
 * - hasMore / truncated trail is always visible when the page is incomplete.
 * - Empty and hasMore never render together.
 * - Non-empty taskIds that filter to blanks never widen to the global list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import type { AuditEntry } from "@grokdesk/shared";
import {
  audit,
  listPermissionGrants,
  revokePermissionGrant,
  type ListAuditParams,
  type ListAuditResult,
  type PermissionGrantDto,
} from "@/lib/api";
import { useT } from "@/i18n";
import { humanizeError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Default page size — matches gateway list default; not the full trail. */
export const AUDIT_DRAWER_PAGE_LIMIT = 100;

/**
 * Sentinel task id used when taskIds was non-empty but every id was blank/invalid
 * and no fallback taskId exists. Queries this id (empty result) instead of the
 * unfiltered global list — fail-closed scope honesty.
 */
export const AUDIT_INVALID_SCOPE_SENTINEL = "__audit_invalid_task_filter__";

export type AuditDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Single-task filter. Prefer `taskIds` for chat threads with follow-ups.
   * When both are set, `taskIds` wins (if it yields any valid id).
   */
  taskId?: string | null;
  /**
   * Thread-wide filter: all turn task ids in the open chat.
   * Empty / omitted with no taskId → global list (Settings).
   * Non-empty with all blanks never widens to global (see normalizeAuditTaskIds).
   */
  taskIds?: string[] | null;
  /** Optional label shown in the title (task summary / chat title). */
  taskLabel?: string;
  /**
   * Controlled entries for tests / preloaded lists.
   * When provided (including `[]`), skips auto-fetch — only shows rows you pass.
   */
  entries?: AuditEntry[];
  /** Controlled hasMore signal (tests / preloaded). Ignored when auto-fetching. */
  hasMore?: boolean;
  /** Controlled total (tests / preloaded). Ignored when auto-fetching. */
  total?: number;
  /** Controlled soft-dropped invalid row count (tests). Ignored when auto-fetching. */
  droppedInvalid?: number;
  /** Controlled remembered grants (tests). When omitted, auto-fetch. */
  grants?: PermissionGrantDto[];
  onRevokeGrant?: (grant: PermissionGrantDto) => void;
};

// ── pure helpers (exported for unit tests) ──────────────────────────────────

/** Newest-first; id DESC on createdAt ties (matches gateway ORDER BY). */
export function sortNewestFirst(entries: AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (tb !== ta) return tb - ta;
    return b.id.localeCompare(a.id);
  });
}

export function decisionBadgeVariant(
  decision: AuditEntry["decision"],
): "default" | "secondary" | "destructive" | "outline" {
  if (decision === "deny" || decision === "reject") return "destructive";
  if (decision === "allow" || decision === "approve") return "default";
  return "outline";
}

function truncatePreview(s: string): string {
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/**
 * Reserved provenance keys — gateway strips writer-controlled copies and only
 * re-attaches after decision remapping. Client re-strips + re-validates so a
 * spoofed IPC row cannot invent integrity chrome.
 */
export const AUDIT_PROVENANCE_KEYS = [
  "_unknownDecision",
  "_corruptDetail",
] as const;

/** Drop spoofable provenance keys from detail (writer or untrusted IPC). */
export function stripSpoofedProvenance(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...detail };
  for (const k of AUDIT_PROVENANCE_KEYS) {
    delete out[k];
  }
  return out;
}

/**
 * Policy mediation state preserved in detail when the audit decision column is
 * remapped (needs_approval → info). Honest UI surfaces this only when the
 * authoritative column is `info` — detail.decision alone cannot invent a
 * parked-approval story over allow/deny.
 */
export function policyMediationDecision(
  detail: Record<string, unknown> | null | undefined,
  columnDecision?: AuditEntry["decision"] | null,
): string | null {
  // Fail-closed: mediation chrome requires remapped info column.
  if (columnDecision !== "info") return null;
  if (!detail || typeof detail !== "object") return null;
  const d = detail.decision;
  if (typeof d !== "string" || !d.trim()) return null;
  // Known mediation states written by the runner / browser host.
  if (d === "needs_approval") return d;
  return null;
}

/** Compact, non-secret detail line for operators (API already redacts secrets). */
export function detailPreview(
  detail: Record<string, unknown>,
  columnDecision?: AuditEntry["decision"] | null,
): string | null {
  // Parked-for-approval: prefer reason (and mediation decision) over tool name
  // so rows do not look like generic info notes. Requires info column.
  const mediation = policyMediationDecision(detail, columnDecision);
  if (mediation) {
    if (typeof detail.reason === "string" && detail.reason.trim()) {
      return truncatePreview(detail.reason.trim());
    }
    return truncatePreview(mediation);
  }
  const prefer = [
    "command",
    "tool",
    "path",
    "summary",
    "reason",
    "message",
    "decision",
  ] as const;
  for (const key of prefer) {
    const v = detail[key];
    if (typeof v === "string" && v.trim()) {
      return truncatePreview(v.trim());
    }
  }
  return null;
}

/**
 * Derive AuditDrawer taskIds for a task workspace (thread-wide or current turn).
 *
 * - Non-empty threadTasks → sorted unique turn ids (set-stable for filterKey)
 * - Empty / missing thread → [currentTaskId] only (never [] / global)
 *
 * Pure helper so workspace chrome cannot regress to always-[task.id] or
 * accidental global scope without a failing unit test.
 */
export function deriveAuditTaskIds(
  threadTasks: ReadonlyArray<{ id: string }> | null | undefined,
  currentTaskId: string,
): string[] {
  if (threadTasks && threadTasks.length > 0) {
    return normalizeAuditTaskIds(
      threadTasks.map((t) => t.id),
      currentTaskId,
    );
  }
  if (typeof currentTaskId === "string" && currentTaskId) {
    return [currentTaskId];
  }
  // Fail-closed: never widen to global from missing current id.
  return [AUDIT_INVALID_SCOPE_SENTINEL];
}

/**
 * Production hook used by TaskWorkspaceView / WorkspaceAuditDrawer.
 * Content-keyed (set-stable sort) so parent re-renders or order-only
 * threadTasks reshuffles do not thrash AuditDrawer filter identity / re-fetch.
 *
 * - Non-empty thread → all turn ids (sorted unique)
 * - Empty / missing thread → [currentTaskId] only (never [] / global)
 */
export function useWorkspaceAuditTaskIds(
  threadTasks: ReadonlyArray<{ id: string }> | null | undefined,
  currentTaskId: string,
): string[] {
  const threadTaskIdsKey =
    threadTasks && threadTasks.length > 0
      ? deriveAuditTaskIds(threadTasks, currentTaskId).join("\0")
      : "";
  return useMemo(
    () => deriveAuditTaskIds(threadTasks, currentTaskId),
    // threadTaskIdsKey captures set membership; currentTaskId covers empty-thread fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content-stable membership key
    [threadTaskIdsKey, currentTaskId],
  );
}

/**
 * Production workspace audit host: derives thread-wide taskIds and renders the drawer.
 * TaskWorkspaceView composes this so open→list scope cannot drift from derive/hook rules.
 */
export function WorkspaceAuditDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadTasks?: ReadonlyArray<{ id: string }> | null;
  taskId: string;
  taskLabel?: string;
}) {
  const taskIds = useWorkspaceAuditTaskIds(props.threadTasks, props.taskId);
  return (
    <AuditDrawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      taskIds={taskIds}
      taskLabel={props.taskLabel}
    />
  );
}

/**
 * Normalize filter ids: taskIds wins when it yields valid ids; then single taskId;
 * empty = global. Dedupes, drops blanks, returns set-stable sorted order.
 *
 * Fail-closed: a non-empty taskIds array that filters to nothing never returns
 * global []. Falls through to taskId when present; otherwise uses a sentinel
 * scope id so the drawer does not silently load machine-wide decisions.
 */
export function normalizeAuditTaskIds(
  taskIds?: string[] | null,
  taskId?: string | null,
): string[] {
  const sortIds = (ids: string[]) =>
    [...ids].sort((a, b) => a.localeCompare(b));

  if (Array.isArray(taskIds) && taskIds.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of taskIds) {
      if (typeof id !== "string" || !id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    if (out.length > 0) return sortIds(out);
    // All blank/invalid — do not widen to global; try taskId fallback next.
  }
  if (typeof taskId === "string" && taskId) return [taskId];
  // Explicit non-empty taskIds that yielded nothing and no taskId → sentinel.
  if (Array.isArray(taskIds) && taskIds.length > 0) {
    return [AUDIT_INVALID_SCOPE_SENTINEL];
  }
  return [];
}

/** Set-stable key for filter identity (order-independent membership). */
export function auditFilterKey(taskIds: string[]): string {
  if (taskIds.length === 0) return "";
  return [...taskIds].sort((a, b) => a.localeCompare(b)).join("\0");
}

/**
 * Gateway provenance markers attached by listAuditEntries after remapping.
 *
 * Fail-closed honesty:
 * - `_unknownDecision` copy says “shown as info” — only surface when the
 *   authoritative column is `info`. allow/deny + spoofed marker must not claim
 *   the row was remapped.
 * - `_corruptDetail` is detail-structure integrity (orthogonal to decision).
 *   Still only present after strip/re-attach in normalizeEntryDetail.
 */
export function entryIntegrity(
  detail: Record<string, unknown> | null | undefined,
  columnDecision?: AuditEntry["decision"] | null,
): {
  unknownDecision: string | null;
  corruptDetail: boolean;
} {
  if (!detail || typeof detail !== "object") {
    return { unknownDecision: null, corruptDetail: false };
  }
  const corruptDetail = detail._corruptDetail === true;
  // Unknown-decision note claims remapping → info; require that column.
  if (columnDecision !== "info") {
    return { unknownDecision: null, corruptDetail };
  }
  const rawUnknown = detail._unknownDecision;
  const unknownDecision =
    typeof rawUnknown === "string" && rawUnknown.length > 0 ? rawUnknown : null;
  return { unknownDecision, corruptDetail };
}

/**
 * Normalize detail for a parsed row. Missing/null → clean empty object.
 * Non-object (string/number/array) → empty detail with integrity marker so we
 * never present integrity loss as a clean empty detail bag.
 *
 * Object detail: strip spoofable provenance keys, then re-attach:
 * - `_unknownDecision` only when decision column is `info` (gateway remap;
 *   never over allow/deny — that would contradict the primary badge).
 * - `_corruptDetail` when claimed and either column is `info`, or the object is
 *   structural-only `{_corruptDetail:true}` (idempotent double-normalize after
 *   a non-object parse). Spoofed corrupt + other fields on allow/deny is dropped.
 */
export function normalizeEntryDetail(
  detail: unknown,
  columnDecision?: AuditEntry["decision"] | null,
): Record<string, unknown> {
  if (detail === undefined || detail === null) return {};
  if (typeof detail === "object" && !Array.isArray(detail)) {
    const raw = detail as Record<string, unknown>;
    const claimedUnknown =
      typeof raw._unknownDecision === "string" && raw._unknownDecision.length > 0
        ? raw._unknownDecision
        : null;
    const claimedCorrupt = raw._corruptDetail === true;
    // Structural-only bag from a prior non-object normalize (or gateway parse).
    const structuralCorruptOnly =
      claimedCorrupt &&
      Object.keys(raw).every(
        (k) => k === "_corruptDetail" || k === "_unknownDecision",
      ) &&
      !claimedUnknown;
    const out = stripSpoofedProvenance(raw);
    // Fail-closed: unknown-decision marker only with remapped info column.
    if (columnDecision === "info" && claimedUnknown) {
      out._unknownDecision = claimedUnknown;
    }
    if (
      claimedCorrupt &&
      (columnDecision === "info" || structuralCorruptOnly)
    ) {
      out._corruptDetail = true;
    }
    return out;
  }
  // Client-observed structural corruption (not a writer key spoof).
  return { _corruptDetail: true };
}

export type ParsedAuditListPage =
  | {
      ok: true;
      entries: AuditEntry[];
      total: number;
      /** Pagination incompleteness only (not soft-dropped invalid rows). */
      hasMore: boolean;
      /** Rows discarded client-side for invalid shape/decision (not older pages). */
      droppedInvalid: number;
    }
  | { ok: false; reason: "malformed" };

/**
 * Fail-closed page parse:
 * - non-array entries → malformed (error), never empty-success
 * - non-empty payload where every row fails validation → malformed (not empty trail)
 * - soft-skips individual invalid rows when some remain valid; droppedInvalid
 *   counts those skips (hasMore is NOT set for drops alone)
 * - non-object detail → {_corruptDetail: true}, not a silent {}
 */
export function parseAuditListPage(page: unknown): ParsedAuditListPage {
  if (!page || typeof page !== "object") {
    return { ok: false, reason: "malformed" };
  }
  const p = page as Record<string, unknown>;
  if (!Array.isArray(p.entries)) {
    return { ok: false, reason: "malformed" };
  }
  const rawCount = p.entries.length;
  const entries: AuditEntry[] = [];
  for (const raw of p.entries) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.action !== "string") continue;
    if (typeof e.decision !== "string") continue;
    if (typeof e.createdAt !== "string") continue;
    const decision = e.decision as AuditEntry["decision"];
    if (!isAuditDecision(decision)) continue;
    entries.push({
      id: e.id,
      taskId: typeof e.taskId === "string" ? e.taskId : null,
      action: e.action,
      // Pass decision so spoofed provenance is stripped unless column is info.
      detail: normalizeEntryDetail(e.detail, decision),
      decision,
      createdAt: e.createdAt,
    });
  }
  // Fail-closed: a non-empty garbage page is not “no decisions yet”.
  if (rawCount > 0 && entries.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const reportedTotal =
    typeof p.total === "number" && Number.isFinite(p.total) ? p.total : rawCount;
  const droppedInvalid = rawCount - entries.length;
  // Pagination incompleteness only — soft-skips are reported via droppedInvalid.
  // Server may set hasMore, or total may exceed the raw page length.
  const hasMore = Boolean(p.hasMore) || reportedTotal > rawCount;
  // Total: server total when present; do not invent pages from client drops.
  // Still reflect that dropped rows existed in this page (shown < total honesty).
  const total = Math.max(reportedTotal, entries.length + droppedInvalid);
  return { ok: true, entries, total, hasMore, droppedInvalid };
}

function isAuditDecision(d: string): d is AuditEntry["decision"] {
  return (
    d === "allow" ||
    d === "deny" ||
    d === "approve" ||
    d === "reject" ||
    d === "info"
  );
}

export type LoadAuditListResult =
  | {
      ok: true;
      entries: AuditEntry[];
      total: number;
      hasMore: boolean;
      droppedInvalid: number;
    }
  | { ok: false; reason: "malformed" | "error"; error?: unknown };

export type AuditListFn = (params: ListAuditParams) => Promise<ListAuditResult>;

/**
 * Load audit rows for global, single-task, or multi-task (thread) filters.
 * Multi-task: parallel per-task pages, merge newest-first, cap to limit.
 * Never invents rows; any malformed page or thrown list fails the whole load.
 */
export async function loadAuditListPages(
  listFn: AuditListFn,
  options: {
    taskIds?: string[];
    taskId?: string | null;
    limit?: number;
  } = {},
): Promise<LoadAuditListResult> {
  const limit = options.limit ?? AUDIT_DRAWER_PAGE_LIMIT;
  const ids = normalizeAuditTaskIds(options.taskIds, options.taskId);

  try {
    if (ids.length === 0) {
      const page = await listFn({ limit });
      return parseAuditListPage(page);
    }

    if (ids.length === 1) {
      const page = await listFn({ taskId: ids[0], limit });
      return parseAuditListPage(page);
    }

    // Thread-wide: one page per turn taskId, then merge (honest: real rows only).
    // Any single throw → outer catch (reason: error). Any malformed page → fail whole.
    const pages = await Promise.all(
      ids.map((id) => listFn({ taskId: id, limit })),
    );
    const parsed = pages.map((p) => parseAuditListPage(p));
    if (parsed.some((p) => !p.ok)) {
      return { ok: false, reason: "malformed" };
    }
    const okPages = parsed as Array<
      Extract<ParsedAuditListPage, { ok: true }>
    >;
    const byId = new Map<string, AuditEntry>();
    for (const page of okPages) {
      for (const entry of page.entries) {
        byId.set(entry.id, entry);
      }
    }
    const merged = sortNewestFirst([...byId.values()]);
    const total = okPages.reduce((sum, p) => sum + p.total, 0);
    const anyHasMore = okPages.some((p) => p.hasMore);
    const droppedInvalid = okPages.reduce(
      (sum, p) => sum + p.droppedInvalid,
      0,
    );
    const capped = merged.slice(0, limit);
    // Pagination / client-cap only. Do NOT treat soft-dropped invalids as
    // “older entries not loaded” (that would lie about incompleteness reason).
    // Page-level hasMore already covers reportedTotal > raw page length.
    const hasMore = anyHasMore || merged.length > limit;
    return { ok: true, entries: capped, total, hasMore, droppedInvalid };
  } catch (error) {
    return { ok: false, reason: "error", error };
  }
}

/** Whether an in-flight response may still update UI (generation token). */
export function shouldApplyAuditResult(
  requestGen: number,
  currentGen: number,
): boolean {
  return requestGen === currentGen;
}

/**
 * Pure view-phase resolver (fail-closed honesty).
 * - Pending open/filter with no settled result → loading (not empty).
 * - Empty only when settled success with 0 rows and no truncation / drop signal.
 * - hasMore never coexists with empty.
 * - Soft-dropped rows surface as showDropped (not pagination copy).
 */
export function resolveAuditDrawerView(state: {
  controlled: boolean;
  open: boolean;
  loading: boolean;
  /** filterKey the current loaded/error result belongs to; null = none yet */
  resultFilterKey: string | null;
  filterKey: string;
  error: string | null;
  rowCount: number;
  hasMore: boolean;
  total: number;
  droppedInvalid?: number;
}): {
  showLoading: boolean;
  showError: boolean;
  showEmpty: boolean;
  showRows: boolean;
  showHasMore: boolean;
  showDropped: boolean;
} {
  const dropped = Math.max(0, state.droppedInvalid ?? 0);

  if (!state.open) {
    return {
      showLoading: false,
      showError: false,
      showEmpty: false,
      showRows: false,
      showHasMore: false,
      showDropped: false,
    };
  }

  if (state.controlled) {
    const truncatedEmpty =
      state.rowCount === 0 && (state.hasMore || state.total > 0);
    const showEmpty =
      state.rowCount === 0 &&
      !state.hasMore &&
      state.total <= 0 &&
      dropped === 0;
    const showHasMore =
      (state.hasMore && state.rowCount > 0) || truncatedEmpty;
    return {
      showLoading: false,
      showError: false,
      showEmpty,
      showRows: state.rowCount > 0,
      showHasMore,
      showDropped: dropped > 0 && state.rowCount > 0,
    };
  }

  const resultMatches = state.resultFilterKey === state.filterKey;
  const pending = state.loading || !resultMatches;
  if (pending) {
    return {
      showLoading: true,
      showError: false,
      showEmpty: false,
      showRows: false,
      showHasMore: false,
      showDropped: false,
    };
  }

  if (state.error) {
    return {
      showLoading: false,
      showError: true,
      showEmpty: false,
      showRows: false,
      showHasMore: false,
      showDropped: false,
    };
  }

  if (state.rowCount === 0) {
    // Truncated/incomplete with 0 shown → hasMore honesty, not empty success.
    if (state.hasMore || state.total > 0) {
      return {
        showLoading: false,
        showError: false,
        showEmpty: false,
        showRows: false,
        showHasMore: true,
        showDropped: false,
      };
    }
    return {
      showLoading: false,
      showError: false,
      showEmpty: true,
      showRows: false,
      showHasMore: false,
      showDropped: false,
    };
  }

  return {
    showLoading: false,
    showError: false,
    showEmpty: false,
    showRows: true,
    showHasMore: state.hasMore,
    showDropped: dropped > 0,
  };
}

// ── component ───────────────────────────────────────────────────────────────

export function AuditDrawer(props: AuditDrawerProps) {
  const t = useT();
  // Keep load() identity stable: useT() can return a new function each render
  // outside I18nProvider (tests / edge). An unstable `t` in load deps would
  // re-fire the open effect forever (setState → re-render → new t → new load).
  const tRef = useRef(t);
  tRef.current = t;
  const controlled = props.entries !== undefined;
  const [loaded, setLoaded] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [droppedInvalid, setDroppedInvalid] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<PermissionGrantDto[]>([]);
  /** filterKey for which loaded/error state is authoritative (null = never settled). */
  const [resultFilterKey, setResultFilterKey] = useState<string | null>(null);
  const loadGen = useRef(0);

  // Recompute every render from props content — do NOT memo on props.taskIds
  // array identity (parents often pass a fresh map() array). filterKey string
  // equality is what drives effects. normalize sorts → set-stable membership.
  const filterIds = normalizeAuditTaskIds(props.taskIds, props.taskId);
  const filterKey = auditFilterKey(filterIds);
  const filterIdsRef = useRef(filterIds);
  filterIdsRef.current = filterIds;

  const clearRows = useCallback(() => {
    setLoaded([]);
    setTotal(0);
    setHasMore(false);
    setDroppedInvalid(0);
  }, []);

  const clearSettled = useCallback(() => {
    clearRows();
    setError(null);
    setResultFilterKey(null);
    setLoading(false);
  }, [clearRows]);

  const load = useCallback(async () => {
    if (controlled) return;
    const gen = ++loadGen.current;
    const ids = filterIdsRef.current;
    const keyForRequest = auditFilterKey(ids);
    const translate = tRef.current;
    // Fail-closed honesty: never keep another filter's rows while refetching.
    clearRows();
    setLoading(true);
    setError(null);
    // Invalidate settled result so UI shows loading, not empty/stale, for this key.
    setResultFilterKey(null);
    try {
      const result = await loadAuditListPages(audit.list, {
        taskIds: ids,
        limit: AUDIT_DRAWER_PAGE_LIMIT,
      });
      if (!shouldApplyAuditResult(gen, loadGen.current)) return;
      if (!result.ok) {
        clearRows();
        if (result.reason === "malformed") {
          setError(translate("audit.malformed"));
        } else {
          setError(humanizeError(result.error, translate));
        }
        setResultFilterKey(keyForRequest);
        return;
      }
      setLoaded(result.entries);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setDroppedInvalid(result.droppedInvalid);
      setError(null);
      setResultFilterKey(keyForRequest);
    } catch (e) {
      if (!shouldApplyAuditResult(gen, loadGen.current)) return;
      clearRows();
      setError(humanizeError(e, translate));
      setResultFilterKey(keyForRequest);
    } finally {
      if (shouldApplyAuditResult(gen, loadGen.current)) {
        setLoading(false);
      }
    }
  }, [controlled, clearRows]);

  // Open → load. Close → bump gen + clear settled so reopen never paints stale
  // empty/rows for one frame before effect refetch (loading-until-settle contract).
  useEffect(() => {
    if (!props.open) {
      loadGen.current += 1;
      clearSettled();
      return;
    }
    if (controlled) return;
    void load();
  }, [props.open, controlled, filterKey, load, clearSettled]);

  // On unmount, invalidate pending applies.
  useEffect(() => {
    return () => {
      loadGen.current += 1;
    };
  }, []);

  const rows = useMemo(() => {
    if (controlled) return sortNewestFirst(props.entries ?? []);
    return sortNewestFirst(loaded);
  }, [controlled, props.entries, loaded]);

  const grantRows = props.grants ?? grants;

  useEffect(() => {
    if (!props.open || props.grants !== undefined || controlled) return;
    let cancelled = false;
    void listPermissionGrants()
      .then((list) => {
        if (!cancelled) setGrants(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setGrants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.grants, controlled]);

  const displayHasMore = controlled ? Boolean(props.hasMore) : hasMore;
  const displayTotal = controlled
    ? typeof props.total === "number"
      ? props.total
      : rows.length
    : total;
  const displayDropped = controlled
    ? Math.max(0, props.droppedInvalid ?? 0)
    : droppedInvalid;

  const view = resolveAuditDrawerView({
    controlled,
    open: props.open,
    loading,
    resultFilterKey,
    filterKey,
    error,
    rowCount: rows.length,
    hasMore: displayHasMore,
    total: displayTotal,
    droppedInvalid: displayDropped,
  });

  const title = props.taskLabel
    ? t("audit.titleTask", { label: props.taskLabel })
    : t("audit.title");
  const subtitle =
    filterIds.length === 0
      ? t("audit.subtitleGlobal")
      : filterIds.length > 1
        ? t("audit.subtitleThread")
        : t("audit.subtitle");

  // Multi-task or global: show task id on each row for attribution.
  // Sentinel-only scope is treated as single-task (no global attribution).
  const showTask = filterIds.length !== 1;

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-white/10 bg-background p-0 sm:max-w-md"
        data-testid="audit-drawer"
        data-audit-filter={filterKey || "global"}
        data-audit-task-count={String(filterIds.length)}
      >
        <SheetHeader className="space-y-1 border-b border-white/[0.06] px-5 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-md">
            <ScrollText className="h-4 w-4 text-primary" strokeWidth={1.75} />
            {title}
          </SheetTitle>
          <SheetDescription className="text-sm">{subtitle}</SheetDescription>
          {!controlled ? (
            <div className="pt-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => void load()}
                disabled={view.showLoading}
                data-testid="audit-refresh"
              >
                {t("audit.refresh")}
              </Button>
            </div>
          ) : null}
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-2 p-3" data-testid="audit-list">
            {grantRows.length > 0 ? (
              <div className="mb-2 space-y-1.5" data-testid="audit-grants">
                <p className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("audit.grantsTitle")}
                </p>
                {grantRows.map((g) => (
                  <div
                    key={`${g.scopeRoot}:${g.toolPattern}:${g.decision}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5 text-xs"
                    data-testid="audit-grant-row"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono">{g.toolPattern}</p>
                      <p className="truncate text-2xs text-muted-foreground">
                        {g.decision === "deny"
                          ? t("audit.grantDeny")
                          : t("audit.grantAllow")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      data-testid="audit-grant-revoke"
                      onClick={() => {
                        if (props.onRevokeGrant) {
                          props.onRevokeGrant(g);
                          return;
                        }
                        void revokePermissionGrant(g.scopeRoot, g.toolPattern)
                          .then(() =>
                            setGrants((prev) =>
                              prev.filter(
                                (x) =>
                                  !(
                                    x.scopeRoot === g.scopeRoot &&
                                    x.toolPattern === g.toolPattern
                                  ),
                              ),
                            ),
                          )
                          .catch(() => {
                            /* keep row; next refresh is honest */
                          });
                      }}
                    >
                      {t("audit.revokeGrant")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {view.showLoading ? (
              <div
                className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
                data-testid="audit-loading"
              >
                <Spinner size="sm" />
                {t("audit.loading")}
              </div>
            ) : null}

            {view.showError ? (
              <p
                className="px-2 py-3 text-xs text-destructive-text"
                data-testid="audit-error"
                role="alert"
              >
                {error || t("audit.loadFailed")}
              </p>
            ) : null}

            {view.showEmpty ? (
              <div data-audit-empty="true">
                <EmptyState
                  icon={<ScrollText className="h-5 w-5" strokeWidth={1.75} />}
                  title={t("audit.emptyTitle")}
                  description={t("audit.emptyDesc")}
                  className="py-12"
                />
              </div>
            ) : null}

            {view.showRows
              ? rows.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} showTask={showTask} />
                ))
              : null}

            {view.showHasMore ? (
              <p
                className="px-2 py-2 text-2xs text-muted-foreground"
                data-testid="audit-has-more"
              >
                {t("audit.hasMore", {
                  shown: rows.length,
                  total: displayTotal || rows.length,
                })}
              </p>
            ) : null}

            {view.showDropped ? (
              <p
                className="px-2 py-2 text-2xs text-muted-foreground"
                data-testid="audit-dropped-invalid"
              >
                {t("audit.droppedInvalid", { count: displayDropped })}
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function AuditRow(props: { entry: AuditEntry; showTask: boolean }) {
  const t = useT();
  const { entry, showTask } = props;
  // Re-normalize even for controlled/preloaded rows so spoofed provenance keys
  // cannot invent integrity chrome without an info decision column.
  const detail = normalizeEntryDetail(entry.detail, entry.decision);
  // Fail-closed: mediation + unknown-decision chrome require decision === "info".
  const preview = detailPreview(detail, entry.decision);
  const integrity = entryIntegrity(detail, entry.decision);
  const mediation = policyMediationDecision(detail, entry.decision);
  return (
    <article
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
      data-testid="audit-entry"
      data-audit-id={entry.id}
      data-audit-action={entry.action}
      data-audit-decision={entry.decision}
      data-audit-mediation={mediation ?? undefined}
      data-audit-task={entry.taskId ?? undefined}
      data-audit-unknown-decision={
        integrity.unknownDecision ? integrity.unknownDecision : undefined
      }
      data-audit-corrupt-detail={integrity.corruptDetail ? "true" : undefined}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
          title={entry.action}
        >
          {entry.action}
        </span>
        <Badge
          variant={decisionBadgeVariant(entry.decision)}
          className="shrink-0 capitalize"
          data-testid="audit-decision-badge"
        >
          {entry.decision}
        </Badge>
        {mediation ? (
          <Badge
            variant="secondary"
            className="shrink-0 text-2xs capitalize"
            data-testid="audit-mediation-badge"
            title={
              typeof detail.reason === "string"
                ? detail.reason
                : t("audit.needsApproval")
            }
          >
            {mediation === "needs_approval"
              ? t("audit.needsApprovalShort")
              : mediation}
          </Badge>
        ) : null}
        {integrity.unknownDecision ? (
          <Badge
            variant="secondary"
            className="shrink-0 text-2xs"
            data-testid="audit-unknown-decision"
            title={t("audit.unknownDecision", {
              value: integrity.unknownDecision,
            })}
          >
            {t("audit.unknownDecisionShort")}
          </Badge>
        ) : null}
        {integrity.corruptDetail ? (
          <Badge
            variant="secondary"
            className="shrink-0 text-2xs"
            data-testid="audit-corrupt-detail"
            title={t("audit.corruptDetail")}
          >
            {t("audit.corruptDetailShort")}
          </Badge>
        ) : null}
      </div>
      {preview ? (
        <p className="mt-1 truncate text-2xs text-muted-foreground" title={preview}>
          {preview}
        </p>
      ) : null}
      {mediation === "needs_approval" ? (
        <p
          className="mt-1 text-2xs text-muted-foreground"
          data-testid="audit-needs-approval-note"
        >
          {t("audit.needsApproval")}
        </p>
      ) : null}
      {integrity.unknownDecision ? (
        <p
          className="mt-1 text-2xs text-muted-foreground"
          data-testid="audit-unknown-decision-note"
        >
          {t("audit.unknownDecision", { value: integrity.unknownDecision })}
        </p>
      ) : null}
      {integrity.corruptDetail ? (
        <p
          className="mt-1 text-2xs text-muted-foreground"
          data-testid="audit-corrupt-detail-note"
        >
          {t("audit.corruptDetail")}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <time dateTime={entry.createdAt}>{relativeTime(entry.createdAt)}</time>
        {showTask && entry.taskId ? (
          <span
            className="truncate font-mono opacity-80"
            title={entry.taskId}
            data-testid="audit-entry-task"
          >
            {entry.taskId}
          </span>
        ) : null}
      </div>
    </article>
  );
}
