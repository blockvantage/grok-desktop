/**
 * Audit drawer (trust Phase A2).
 * Lists real audit rows only — never invents decisions (fail-closed empty).
 * Task workspace: filter by taskId. Settings: global list (no taskId).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import type { AuditEntry } from "@grokdesk/shared";
import { audit } from "@/lib/api";
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

export type AuditDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, list is filtered to this task. Omit for global recent decisions. */
  taskId?: string | null;
  /** Optional label shown in the title (task summary / chat title). */
  taskLabel?: string;
  /**
   * Controlled entries for tests / preloaded lists.
   * When provided (including `[]`), skips auto-fetch — only shows rows you pass.
   */
  entries?: AuditEntry[];
};

function sortNewestFirst(entries: AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (tb !== ta) return tb - ta;
    return b.id.localeCompare(a.id);
  });
}

function decisionBadgeVariant(
  decision: AuditEntry["decision"],
): "default" | "secondary" | "destructive" | "outline" {
  if (decision === "deny" || decision === "reject") return "destructive";
  if (decision === "allow" || decision === "approve") return "default";
  return "outline";
}

/** Compact, non-secret detail line for operators (API already redacts secrets). */
function detailPreview(detail: Record<string, unknown>): string | null {
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

export function AuditDrawer(props: AuditDrawerProps) {
  const t = useT();
  const controlled = props.entries !== undefined;
  const [loaded, setLoaded] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (controlled) return;
    setLoading(true);
    setError(null);
    try {
      const params: { taskId?: string; limit: number } = { limit: 100 };
      if (props.taskId) params.taskId = props.taskId;
      const page = await audit.list(params);
      // Fail-closed: only real rows from the API.
      setLoaded(Array.isArray(page.entries) ? page.entries : []);
      setTotal(typeof page.total === "number" ? page.total : 0);
      setHasMore(Boolean(page.hasMore));
    } catch (e) {
      setLoaded([]);
      setTotal(0);
      setHasMore(false);
      setError(humanizeError(e, t));
    } finally {
      setLoading(false);
    }
  }, [controlled, props.taskId, t]);

  useEffect(() => {
    if (!props.open || controlled) return;
    void load();
  }, [props.open, controlled, load]);

  const rows = useMemo(() => {
    if (controlled) return sortNewestFirst(props.entries ?? []);
    // API already returns newest-first; re-sort for stable id ties.
    return sortNewestFirst(loaded);
  }, [controlled, props.entries, loaded]);

  const title = props.taskLabel
    ? t("audit.titleTask", { label: props.taskLabel })
    : t("audit.title");
  const subtitle = props.taskId
    ? t("audit.subtitle")
    : t("audit.subtitleGlobal");

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-white/10 bg-background p-0 sm:max-w-md"
        data-testid="audit-drawer"
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
            {loading && rows.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Spinner size="sm" />
                {t("audit.loading")}
              </div>
            ) : null}

            {error ? (
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

            {rows.map((entry) => (
              <AuditRow key={entry.id} entry={entry} showTask={!props.taskId} />
            ))}

            {!controlled && hasMore ? (
              <p
                className="px-2 py-2 text-2xs text-muted-foreground"
                data-testid="audit-has-more"
              >
                {t("audit.hasMore", {
                  shown: rows.length,
                  total: total || rows.length,
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
  const { entry, showTask } = props;
  const preview = detailPreview(entry.detail);
  return (
    <article
      className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
      data-testid="audit-entry"
      data-audit-id={entry.id}
      data-audit-action={entry.action}
      data-audit-decision={entry.decision}
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
      </div>
      {preview ? (
        <p className="mt-1 truncate text-2xs text-muted-foreground" title={preview}>
          {preview}
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

/** @internal exported for narrow unit tests if needed */
export { sortNewestFirst, detailPreview, decisionBadgeVariant };
