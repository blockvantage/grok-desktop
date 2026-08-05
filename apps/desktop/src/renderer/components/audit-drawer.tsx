/**
 * Audit drawer (trust Phase A2).
 * Lists real audit rows only — never invents decisions (fail-closed empty/error).
 * Task workspace: filter by thread taskIds (all turns). Settings: global list (no filter).
 *
 * Honesty:
 * - Clears rows on every fetch start / filter change (no cross-task flash).
 * - In-flight responses are sequenced; only the latest generation may apply.
 * - Malformed list payloads surface as error, not “no decisions yet”.
 * - Surfaces gateway provenance markers _unknownDecision / _corruptDetail.
 * - hasMore / truncated trail is always visible when the page is incomplete.
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

export type ParsedAuditListPage =
  | { ok: true; entries: AuditEntry[]; total: number; hasMore: boolean }
  | { ok: false; reason: "malformed" };

/**
 * Fail-closed page parse: non-array entries → malformed (error), never empty-success.
 * Soft-skips individual non-object rows rather than inventing fields.
 */
export function parseAuditListPage(page: unknown): ParsedAuditListPage {
  if (!page || typeof page !== "object") {
    return { ok: false, reason: "malformed" };
  }
  const p = page as Record<string, unknown>;
  if (!Array.isArray(p.entries)) {
    return { ok: false, reason: "malformed" };
  }
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
      taskId: typeof e.taskId === "string" ? e.taskId : e.taskId === null ? null : null,
      action: e.action,
      detail:
        e.detail && typeof e.detail === "object" && !Array.isArray(e.detail)
          ? (e.detail as Record<string, unknown>)
          : {},
      decision,
      createdAt: e.createdAt,
    });
  }
  const total = typeof p.total === "number" && Number.isFinite(p.total) ? p.total : entries.length;
  const hasMore = Boolean(p.hasMore);
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
 * Never invents rows; malformed page shape fails closed.
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

// ── component ───────────────────────────────────────────────────────────────

export function AuditDrawer(props: AuditDrawerProps) {
  const t = useT();
  const controlled = props.entries !== undefined;
  const [loaded, setLoaded] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGen = useRef(0);

  const filterIds = useMemo(
    () => normalizeAuditTaskIds(props.taskIds, props.taskId),
    [props.taskIds, props.taskId],
  );
  const filterKey = useMemo(() => auditFilterKey(filterIds), [filterIds]);

  const clearRows = useCallback(() => {
    setLoaded([]);
    setTotal(0);
    setHasMore(false);
  }, []);

  const load = useCallback(async () => {
    if (controlled) return;
    const gen = ++loadGen.current;
    // Fail-closed honesty: never keep another filter's rows while refetching.
    clearRows();
    setLoading(true);
    setError(null);
    try {
      const result = await loadAuditListPages(audit.list, {
        taskIds: filterIds,
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
        return;
      }
      setLoaded(result.entries);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setError(null);
    } catch (e) {
      if (!shouldApplyAuditResult(gen, loadGen.current)) return;
      clearRows();
      setError(humanizeError(e, t));
    } finally {
      if (shouldApplyAuditResult(gen, loadGen.current)) {
        setLoading(false);
      }
    }
  }, [controlled, filterIds, clearRows, t]);

  // Reload when opened or when the task filter identity changes.
  useEffect(() => {
    if (!props.open || controlled) return;
    void load();
    // filterKey intentionally drives invalidation on task/thread change.
  }, [props.open, controlled, filterKey, load]);

  // When filter changes while open, bump generation so any in-flight apply is dropped.
  // load() already increments gen; this effect only ensures a closed→open path is covered
  // by the open+filterKey dependency above. On unmount, invalidate pending applies.
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
                disabled={loading}
                data-testid="audit-refresh"
              >
                {t("audit.refresh")}
              </Button>
            </div>
          ) : null}
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-2 p-3" data-testid="audit-list">
            {loading ? (
              <div
                className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
                data-testid="audit-loading"
              >
                <Spinner size="sm" />
                {t("audit.loading")}
              </div>
            ) : null}

            {!loading && error ? (
              <p
                className="px-2 py-3 text-xs text-destructive-text"
                data-testid="audit-error"
                role="alert"
              >
                {error || t("audit.loadFailed")}
              </p>
            ) : null}

            {!loading && !error && rows.length === 0 ? (
              <div data-audit-empty="true">
                <EmptyState
                  icon={<ScrollText className="h-5 w-5" strokeWidth={1.75} />}
                  title={t("audit.emptyTitle")}
                  description={t("audit.emptyDesc")}
                  className="py-12"
                />
              </div>
            ) : null}

            {!loading &&
              rows.map((entry) => (
                <AuditRow key={entry.id} entry={entry} showTask={showTask} />
              ))}

            {!loading && !error && displayHasMore ? (
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
          <span className="truncate font-mono opacity-80" title={entry.taskId}>
            {entry.taskId}
          </span>
        ) : null}
      </div>
    </article>
  );
}
