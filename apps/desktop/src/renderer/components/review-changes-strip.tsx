/**
 * File-level Review changes strip (Task 14).
 * Filename first; path on demand; calm (non-breathing) for completed review.
 * Needs-user entrance only when explicitly requested; no perpetual blinking.
 */
import { useState } from "react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import type { ReviewChangesView } from "@/lib/review-changes";
import { reviewFileBasename } from "@/lib/review-file-display";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, FileDiff } from "lucide-react";

export function ReviewChangesStrip(props: {
  view: ReviewChangesView;
  onOpenFile?: (path: string) => void;
  /** Accept/keep this file change (remove from strip). */
  onKeepFile?: (path: string) => void;
  /** Undo this file change (callback to workspace undo path). */
  onUndoFile?: (path: string) => void;
  onDismiss?: () => void;
  className?: string;
  /**
   * Paths known missing/vanished. Open/revert disabled; row marked unavailable.
   * Rows are never dropped silently.
   */
  unavailablePaths?: ReadonlySet<string> | readonly string[];
  /**
   * When true, a one-shot entrance is allowed (real needs-user). Default false:
   * completed/reviewable changes stay calm.
   */
  needsUserAttention?: boolean;
}) {
  const t = useT();
  const { view } = props;
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>(
    {},
  );
  const unavailable = toSet(props.unavailablePaths);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-muted/30 px-3 py-2",
        // One entrance only for true needs-user — never ambient on completed review.
        props.needsUserAttention &&
          "approval-arrive border-warning/35 bg-warning/[0.08] motion-reduce:animate-none",
        props.className,
      )}
      role="region"
      aria-label={t("reviewChanges.title")}
      data-testid="review-changes-strip"
      data-review-calm={props.needsUserAttention ? "false" : "true"}
    >
      <div
        className={cn(
          "mb-1.5 flex items-center gap-2 text-xs font-medium",
          props.needsUserAttention ? "text-warning" : "text-foreground/90",
        )}
      >
        <FileDiff className="h-3.5 w-3.5" aria-hidden />
        {t("reviewChanges.title")}
        <span
          className={cn(
            "font-normal",
            props.needsUserAttention
              ? "text-warning/75"
              : "text-muted-foreground",
          )}
        >
          {t("reviewChanges.count", { count: view.files.length })}
        </span>
        {props.onDismiss ? (
          <button
            type="button"
            className="ml-auto text-2xs text-muted-foreground hover:text-foreground"
            onClick={props.onDismiss}
            data-testid="review-changes-dismiss"
          >
            {t("reviewChanges.dismiss")}
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        {view.files.slice(0, 8).map((f) => {
          const name = reviewFileBasename(f.path);
          const missing = unavailable.has(f.path);
          const showPath = expandedPaths[f.path] === true;
          return (
            <li
              key={f.path}
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
              data-review-path={f.path}
              data-review-available={missing ? "false" : "true"}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center text-muted-foreground hover:text-foreground"
                    aria-expanded={showPath}
                    aria-label={
                      showPath
                        ? t("reviewChanges.hidePath")
                        : t("reviewChanges.showPath")
                    }
                    data-testid="review-changes-toggle-path"
                    data-path={f.path}
                    onClick={() =>
                      setExpandedPaths((prev) => ({
                        ...prev,
                        [f.path]: !prev[f.path],
                      }))
                    }
                  >
                    {showPath ? (
                      <ChevronDown className="h-3 w-3" aria-hidden />
                    ) : (
                      <ChevronRight className="h-3 w-3" aria-hidden />
                    )}
                  </button>
                  <span
                    className="min-w-0 truncate font-medium text-foreground/90"
                    title={f.path}
                    data-review-filename
                  >
                    {name}
                  </span>
                  {missing ? (
                    <span
                      className="shrink-0 text-2xs text-destructive-text"
                      data-review-unavailable
                    >
                      {t("reviewChanges.unavailable")}
                    </span>
                  ) : null}
                </div>
                {showPath ? (
                  <p
                    className="mt-0.5 truncate font-mono text-2xs text-muted-foreground"
                    title={f.path}
                    data-review-full-path={f.path}
                  >
                    {f.path}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {props.onKeepFile ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2"
                    onClick={() => props.onKeepFile?.(f.path)}
                    data-testid="review-changes-keep"
                    data-path={f.path}
                    disabled={false}
                  >
                    {t("reviewChanges.accept")}
                  </Button>
                ) : null}
                {props.onUndoFile ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    onClick={() => props.onUndoFile?.(f.path)}
                    data-testid="review-changes-undo"
                    data-path={f.path}
                    disabled={missing}
                    title={
                      missing
                        ? t("reviewChanges.unavailable")
                        : t("reviewChanges.revert")
                    }
                  >
                    {t("reviewChanges.revert")}
                  </Button>
                ) : null}
                {props.onOpenFile ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => props.onOpenFile?.(f.path)}
                    data-testid="review-changes-open"
                    data-path={f.path}
                    disabled={missing}
                    title={
                      missing
                        ? t("reviewChanges.unavailable")
                        : t("reviewChanges.reveal")
                    }
                  >
                    {t("reviewChanges.reveal")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function toSet(
  raw: ReadonlySet<string> | readonly string[] | undefined,
): Set<string> {
  if (!raw) return new Set();
  if (raw instanceof Set) return raw;
  return new Set(raw);
}
