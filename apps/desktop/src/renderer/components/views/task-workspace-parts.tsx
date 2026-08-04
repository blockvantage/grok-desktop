/**
 * Presentational pieces extracted from task-workspace-view (Phase 6 residual).
 * Keeps the workspace shell thinner without changing behavior.
 */
import { useEffect, useMemo, useState } from "react";
import { Film, FileText, ImageIcon, Music } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Markdown } from "@/components/ui/markdown-lazy";
import { previewBodyAsMarkdown } from "@/lib/workspace-file-preview";
import { readAsset, assetDisplaySrc } from "@/lib/api";
import { useVideoPoster } from "@/hooks/use-video-poster";
import { artifactKindLabel, formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

export type WorkspaceDeliverable = {
  key: string;
  title: string;
  path: string | null;
  source: "artifact";
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  sizeBytes?: number;
};

/** Caption like "MP4 · 12 MB"; degrades when sizeBytes is missing. */
export function deliverableCaption(d: WorkspaceDeliverable): string {
  const kind = artifactKindLabel(d.path, d.title);
  const size = formatBytes(d.sizeBytes);
  return size ? `${kind} · ${size}` : kind;
}

export function FilePreviewBody({
  name,
  content,
  truncated,
  baseDir,
}: {
  name: string;
  content: string;
  truncated: boolean;
  baseDir: string | null;
}) {
  const t = useT();
  const markdown = useMemo(
    () => previewBodyAsMarkdown(name, content),
    [name, content],
  );

  return (
    <>
      <Markdown baseDir={baseDir}>{markdown}</Markdown>
      {truncated && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("workspace.previewTruncated")}
        </p>
      )}
    </>
  );
}

export function DensityButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors [&_svg]:pointer-events-auto",
            active
              ? "bg-white/[0.08] text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
              : "text-muted-foreground hover:text-foreground/80",
          )}
        >
          {icon}
          {/* Labels only on wide chat headers; icons + tooltips everywhere else */}
          <span className="hidden lg:inline">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function isHtmlDeliverable(path: string | undefined): boolean {
  if (!path) return false;
  return /\.html?$/i.test(path);
}

export function DeliverableRow({
  d,
  onOpen,
  onOpenInBrowser,
  root,
  hero = false,
}: {
  d: WorkspaceDeliverable;
  onOpen: (path: string) => void;
  /** One-click open HTML in the Desk agent browser (no model tools). */
  onOpenInBrowser?: (path: string) => void;
  root?: string | null;
  /** Full-width principal payoff card (image/video only). */
  hero?: boolean;
}) {
  const t = useT();
  const [thumb, setThumb] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const videoPoster = useVideoPoster(d.isVideo ? videoSrc : null);
  const canOpenBrowser =
    Boolean(onOpenInBrowser) && isHtmlDeliverable(d.path ?? undefined);
  const caption = deliverableCaption(d);
  const heroLabel = hero
    ? t("workspace.heroDeliverable", { title: d.title })
    : undefined;

  const [unavailable, setUnavailable] = useState(false);

  // Images get a real thumbnail — the payoff of a task shouldn't be a text row.
  useEffect(() => {
    if (!d.isImage || !d.path) return;
    let cancelled = false;
    setUnavailable(false);
    void readAsset(d.path, { root })
      .then((a) => {
        if (!cancelled) setThumb(assetDisplaySrc(a));
      })
      .catch(() => {
        if (!cancelled) {
          setThumb(null);
          setUnavailable(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [d.isImage, d.path, root]);

  // Videos: resolve asset URL, then capture a first-frame poster (useVideoPoster).
  useEffect(() => {
    if (!d.isVideo || !d.path) {
      setVideoSrc(null);
      return;
    }
    let cancelled = false;
    setUnavailable(false);
    void readAsset(d.path, { root })
      .then((a) => {
        if (!cancelled) setVideoSrc(assetDisplaySrc(a));
      })
      .catch(() => {
        if (!cancelled) {
          setVideoSrc(null);
          setUnavailable(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [d.isVideo, d.path, root]);

  // CH-11 + ASSET-1: image + video deliverables get full-width thumbs; hero always.
  // Missing files never render broken media or claim "Grok wrote this" as present.
  const fullThumb = d.isImage ? thumb : d.isVideo ? videoPoster : null;
  const statusCaption = unavailable
    ? t("workspace.deliverableUnavailable")
    : d.sizeBytes != null
      ? caption
      : d.source === "artifact"
        ? t("workspace.grokWroteThis")
        : t("workspace.inWorkspace");

  if ((fullThumb || hero) && !unavailable) {
    return (
      <button
        type="button"
        disabled={!d.path}
        onClick={() => d.path && onOpen(d.path)}
        aria-label={heroLabel}
        className={cn(
          "group w-full overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02] text-left transition-colors hover:border-primary/30",
          hero && "ring-1 ring-primary/15",
        )}
      >
        {fullThumb ? (
          <img
            src={fullThumb}
            alt=""
            className="aspect-video w-full object-cover"
            onError={() => setUnavailable(true)}
          />
        ) : (
          <span
            className={cn(
              "flex aspect-video w-full items-center justify-center",
              "bg-primary/10 text-primary",
            )}
            aria-hidden
          >
            {d.isVideo ? (
              <Film className="h-8 w-8" strokeWidth={1.5} />
            ) : (
              <ImageIcon className="h-8 w-8" strokeWidth={1.5} />
            )}
          </span>
        )}
        <span className="block space-y-0.5 px-2.5 py-1.5">
          <span className="block truncate text-sm text-foreground/85">
            {d.title}
          </span>
          <span className="block truncate text-2xs text-muted-foreground">
            {statusCaption}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      className="group flex w-full items-center gap-1 rounded-lg border border-transparent px-1 py-0.5 transition-colors hover:border-white/[0.06] hover:bg-white/[0.04]"
      data-availability={unavailable ? "missing" : "available"}
      data-testid={unavailable ? "deliverable-unavailable" : undefined}
    >
      <button
        type="button"
        disabled={!d.path}
        onClick={() => d.path && onOpen(d.path)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left disabled:opacity-60"
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.06]",
            unavailable
              ? "bg-warning/10 text-warning"
              : d.isImage || d.isVideo || d.isAudio
                ? "bg-primary/10 text-primary"
                : "bg-white/[0.03] text-muted-foreground",
          )}
        >
          {d.isImage ? (
            <ImageIcon className="h-4 w-4" strokeWidth={1.75} />
          ) : d.isVideo ? (
            <Film className="h-4 w-4" strokeWidth={1.75} />
          ) : d.isAudio ? (
            <Music className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <FileText className="h-4 w-4" strokeWidth={1.75} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground/85">
            {d.title}
          </span>
          <span className="block truncate text-2xs text-muted-foreground">
            {statusCaption}
          </span>
        </span>
      </button>
      {canOpenBrowser && d.path ? (
        <button
          type="button"
          className="mr-1 shrink-0 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-2xs font-medium text-primary transition-colors hover:bg-primary/20"
          title={t("workspace.openInBrowser")}
          aria-label={t("workspace.openInBrowser")}
          data-open-in-browser={d.path}
          onClick={(e) => {
            e.stopPropagation();
            onOpenInBrowser?.(d.path!);
          }}
        >
          {t("workspace.openInBrowserShort")}
        </button>
      ) : null}
    </div>
  );
}

export function ActivityRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export function WorkspaceSection({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {trailing}
      </div>
      {children}
    </div>
  );
}
