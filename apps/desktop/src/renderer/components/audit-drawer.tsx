/**
 * Audit drawer (trust Phase A2).
 * Lists real audit rows only — never invents decisions (fail-closed empty/error).
 * Task workspace: filter by thread taskIds (all turns). Settings: global list (no filter).
 *
 * Honesty:
 * - Clears rows on every fetch start / filter change (no cross-task flash).
 * - In-flight responses are sequenced; only the latest generation may apply.
 * - Load effect keys on stable filterKey string (not taskIds array identity).
 * - Until a fetch for the open filter settles, show loading — never “no decisions yet”.
 * - Malformed / all-invalid list payloads surface as error, not empty success.
 * - Surfaces gateway provenance markers _unknownDecision / _corruptDetail.
 * - hasMore / truncated trail is always visible when the page is incomplete.
 * - Empty and hasMore never render together.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import type { AuditEntry } from "@grokdesk/shared";
import { audit, type ListAuditParams, type ListAuditResult } from "@/lib/api";
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

export type AuditDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Single-task filter. Prefer `taskIds` for chat threads with follow-ups.
   * When both are set, `taskIds` wins.
   */
  taskId?: string | null;
  /**
   * Thread-wide filter: all turn task ids in the open chat.
   * Empty / omitted with no taskId → global list (Settings).
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

/** Compact, non-secret detail line for operators (API already redacts secrets). */
export function detailPreview(detail: Record<string, unknown>): string | null {
  const prefer = ["command", "tool", "path", "summary", "reason", "message"] as const;
  for (const key of prefer) {
    const v = detail[key];
    if (typeof v === "string" && v.trim()) {
      const s = v.trim();
      return s.length > 120 ? `${s.slice(0, 117)}…` : s;
    }
  }
  return null;
}

/**
 * Normalize filter ids: taskIds wins; then single taskId; empty = global.
 * Dedupes and drops blanks so follow-up threads stay stable under re-render.
 */
export function normalizeAuditTaskIds(
  taskIds?: string[] | null,
  taskId?: string | null,
): string[] {
  if (Array.isArray(taskIds) && taskIds.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of taskIds) {
      if (typeof id !== "string" || !id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }
  if (typeof taskId === "string" && taskId) return [taskId];
  return [];
}

/** Stable key for filter identity (generation invalidation). */
export function auditFilterKey(taskIds: string[]): string {
  return taskIds.length === 0 ? "" : taskIds.join("\0");
}

/**
 * Gateway provenance markers attached by listAuditEntries.
 * Writers cannot spoof these; only the list path re-attaches them.
 */
export function entryIntegrity(detail: Record<string, unknown> | null | undefined): {
  unknownDecision: string | null;
  corruptDetail: boolean;
} {
  if (!detail || typeof detail !== "object") {
    return { unknownDecision: null, corruptDetail: false };
  }
  const rawUnknown = detail._unknownDecision;
  const unknownDecision =
    typeof rawUnknown === "string" && rawUnknown.length > 0 ? rawUnknown : null;
  const corruptDetail = detail._corruptDetail === true;
  return { unknownDecision, corruptDetail };
}

/**
 * Normalize detail for a parsed row. Missing/null → clean empty object.
 * Non-object (string/number/array) → empty detail with integrity marker so we
 * never present integrity loss as a clean empty detail bag.
 */
export function normalizeEntryDetail(detail: unknown): Record<string, unknown> {
  if (detail === undefined || detail === null) return {};
  if (typeof detail === "object" && !Array.isArray(detail)) {
    return detail as Record<string, unknown>;
  }
  return { _corruptDetail: true };
}

export type ParsedAuditListPage =
  | { ok: true; entries: AuditEntry[]; total: number; hasMore: boolean }
  | { ok: false; reason: "malformed" };

/**
 * Fail-closed page parse:
 * - non-array entries → malformed (error), never empty-success
 * - non-empty payload where every row fails validation → malformed (not empty trail)
 * - soft-skips individual invalid rows when some remain valid; hasMore reflects drops
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
      detail: normalizeEntryDetail(e.detail),
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
  const dropped = rawCount - entries.length;
  // Honesty: dropped rows / total > shown mean the trail is incomplete.
  const hasMore =
    Boolean(p.hasMore) || dropped > 0 || reportedTotal > entries.length;
  const total = Math.max(reportedTotal, entries.length + dropped);
  return { ok: true, entries, total, hasMore };
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
  | { ok: true; entries: AuditEntry[]; total: number; hasMore: boolean }
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
    const capped = merged.slice(0, limit);
    // Honest truncation: more in memory, more beyond any page, or total > shown.
    const hasMore =
      anyHasMore || merged.length > limit || total > capped.length;
    return { ok: true, entries: capped, total, hasMore };
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
 * - Empty only when settled success with 0 rows and no truncation signal.
 * - hasMore never coexists with empty.
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
}): {
  showLoading: boolean;
  showError: boolean;
  showEmpty: boolean;
  showRows: boolean;
  showHasMore: boolean;
} {
  if (!state.open) {
    return {
      showLoading: false,
      showError: false,
      showEmpty: false,
      showRows: false,
      showHasMore: false,
    };
  }

  if (state.controlled) {
    const showEmpty = state.rowCount === 0 && !state.hasMore && state.total <= 0;
    const showHasMore = state.hasMore && state.rowCount > 0;
    // Controlled 0 rows + hasMore/total: honesty banner only (not “no decisions”).
    const truncatedEmpty =
      state.rowCount === 0 && (state.hasMore || state.total > 0);
    return {
      showLoading: false,
      showError: false,
      showEmpty,
      showRows: state.rowCount > 0,
      showHasMore: showHasMore || truncatedEmpty,
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
    };
  }

  if (state.error) {
    return {
      showLoading: false,
      showError: true,
      showEmpty: false,
      showRows: false,
      showHasMore: false,
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
      };
    }
    return {
      showLoading: false,
      showError: false,
      showEmpty: true,
      showRows: false,
      showHasMore: false,
    };
  }

  return {
    showLoading: false,
    showError: false,
    showEmpty: false,
    showRows: true,
    showHasMore: state.hasMore,
  };
}

// ── component ───────────────────────────────────────────────────────────────

export function AuditDrawer(props: AuditDrawerProps) {
  const t = useT();
  const controlled = props.entries !== undefined;
  const [loaded, setLoaded] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** filterKey for which loaded/error state is authoritative (null = never settled). */
  const [resultFilterKey, setResultFilterKey] = useState<string | null>(null);
  const loadGen = useRef(0);

  // Recompute every render from props content — do NOT memo on props.taskIds
  // array identity (parents often pass a fresh map() array). filterKey string
  // equality is what drives effects.
  const filterIds = normalizeAuditTaskIds(props.taskIds, props.taskId);
  const filterKey = auditFilterKey(filterIds);
  const filterIdsRef = useRef(filterIds);
  filterIdsRef.current = filterIds;

  const clearRows = useCallback(() => {
    setLoaded([]);
    setTotal(0);
    setHasMore(false);
  }, []);

  const load = useCallback(async () => {
    if (controlled) return;
    const gen = ++loadGen.current;
    const ids = filterIdsRef.current;
    const keyForRequest = auditFilterKey(ids);
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
          setError(t("audit.malformed"));
        } else {
          setError(humanizeError(result.error, t));
        }
        setResultFilterKey(keyForRequest);
        return;
      }
      setLoaded(result.entries);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setError(null);
      setResultFilterKey(keyForRequest);
    } catch (e) {
      if (!shouldApplyAuditResult(gen, loadGen.current)) return;
      clearRows();
      setError(humanizeError(e, t));
      setResultFilterKey(keyForRequest);
    } finally {
      if (shouldApplyAuditResult(gen, loadGen.current)) {
        setLoading(false);
      }
    }
  }, [controlled, clearRows, t]);

  // Reload when opened or when the task filter *content* changes.
  // Depends on filterKey (stable string) + load (stable: no filterIds identity).
  useEffect(() => {
    if (!props.open || controlled) return;
    void load();
  }, [props.open, controlled, filterKey, load]);

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

  const displayHasMore = controlled ? Boolean(props.hasMore) : hasMore;
  const displayTotal = controlled
    ? typeof props.total === "number"
      ? props.total
      : rows.length
    : total;

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
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function AuditRow(props: { entry: AuditEntry; showTask: boolean }) {
  const t = useT();
  const { entry, showTask } = props;
  const preview = detailPreview(entry.detail);
  const integrity = entryIntegrity(entry.detail);
  return (
    <article
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
      data-testid="audit-entry"
      data-audit-id={entry.id}
      data-audit-action={entry.action}
      data-audit-decision={entry.decision}
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
