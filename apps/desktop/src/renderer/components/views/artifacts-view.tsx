import {
  AlertCircle,
  Copy,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Presentation,
  Search,
  Share2,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  artifactKindId,
  artifactKindLabel,
  fileExt,
  formatDateTime,
  relativeTime,
  shortPath,
} from "@/lib/format";
import {
  isAudioPath,
  isImagePath,
  isVideoPath,
  readAsset,
  assetDisplaySrc,
  revealPath,
  rpc,
} from "@/lib/api";
import { videoDisplaySrc } from "@/lib/media-src";
import { cn } from "@/lib/utils";
import type { Artifact, Task } from "@grokdesk/shared";
import { useT } from "@/i18n";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/ui/markdown-lazy";
import { MediaLightbox } from "@/components/media-lightbox";
import { useToast } from "@/components/ui/toast";
import {
  artifactAvailabilityFromLoad,
  artifactParentPath,
  isArtifactMissingError,
  type ArtifactAvailability,
} from "@/lib/artifact-availability";
import { MOTION_SURFACE_CLASSES } from "@/lib/motion-system";

const MEDIA_FETCH_TIMEOUT_MS = 30_000;
const MEDIA_FETCH_MAX_BYTES = 100 * 1024 * 1024;

function iconFor(path: string | null, title: string) {
  const ext = fileExt(path || title);
  if (["xlsx", "xls", "csv"].includes(ext)) return FileSpreadsheet;
  if (["pptx", "ppt"].includes(ext)) return Presentation;
  if (["mp4", "m4v", "webm", "mov", "ogv"].includes(ext)) return Film;
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return Music;
  if (["png", "jpg", "jpeg", "svg", "gif", "webp"].includes(ext))
    return ImageIcon;
  if (["py", "ts", "tsx", "js", "json", "sql"].includes(ext)) return FileCode2;
  return FileText;
}

function isTextPreviewable(path: string | null | undefined): boolean {
  if (!path) return false;
  const ext = fileExt(path);
  return [
    "md",
    "txt",
    "markdown",
    "json",
    "ts",
    "tsx",
    "js",
    "py",
    "csv",
  ].includes(ext);
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

async function blobFromSrc(src: string): Promise<Blob> {
  const res = await fetch(src, {
    signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(len) && len > MEDIA_FETCH_MAX_BYTES) {
    throw new Error("file too large to materialize");
  }
  const blob = await res.blob();
  if (blob.size > MEDIA_FETCH_MAX_BYTES) {
    throw new Error("file too large to materialize");
  }
  return blob;
}

function ArtifactThumb({
  path,
  onAvailability,
}: {
  path: string;
  onAvailability?: (a: ArtifactAvailability) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setMissing(false);
    void readAsset(path)
      .then((a) => {
        if (!cancelled) {
          setSrc(assetDisplaySrc(a));
          onAvailability?.("available");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          const av = artifactAvailabilityFromLoad({
            ok: false,
            errorMessage: msg,
          });
          setMissing(av === "missing");
          onAvailability?.(av);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, onAvailability]);
  if (missing) {
    return (
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-warning/40 bg-warning/10 text-warning"
        data-testid="artifact-thumb-unavailable"
        aria-hidden
      >
        <AlertCircle className="h-4 w-4" />
      </div>
    );
  }
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      className="h-10 w-10 shrink-0 rounded-md border border-border/60 object-cover"
      onError={() => {
        setSrc(null);
        setMissing(true);
        onAvailability?.("missing");
      }}
    />
  );
}

function ArtifactUnavailableState(props: {
  path?: string | null;
  onRevealParent?: () => void;
  onRemove?: () => void;
  onOpenTask?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "rounded-lg border border-warning/35 bg-warning/5",
        MOTION_SURFACE_CLASSES.artifactReveal,
        props.compact ? "px-3 py-2" : "p-4",
      )}
      data-testid="artifact-unavailable"
      role="status"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {t("artifacts.unavailable")}
          </p>
          {!props.compact ? (
            <p className="text-xs text-muted-foreground">
              {t("artifacts.unavailableHint")}
            </p>
          ) : null}
          {props.path ? (
            <p
              className="truncate font-mono text-2xs text-muted-foreground"
              title={props.path}
            >
              {shortPath(props.path)}
            </p>
          ) : null}
        </div>
      </div>
      {(props.onRevealParent || props.onRemove || props.onOpenTask) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {props.onRevealParent ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 text-xs"
              onClick={props.onRevealParent}
              data-testid="artifact-reveal-parent"
            >
              <FolderOpen className="mr-1 h-3.5 w-3.5" />
              {t("artifacts.revealParent")}
            </Button>
          ) : null}
          {props.onOpenTask ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={props.onOpenTask}
              data-testid="artifact-open-task"
            >
              {t("artifacts.openTask")}
            </Button>
          ) : null}
          {props.onRemove ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              onClick={props.onRemove}
              data-testid="artifact-remove-from-list"
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t("artifacts.removeFromList")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ArtifactMediaPreview({
  path,
  onAvailability,
}: {
  path: string;
  onAvailability?: (a: ArtifactAvailability) => void;
}) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const video = isVideoPath(path);
  const audio = isAudioPath(path);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setErr(null);
    setMissing(false);
    void readAsset(path)
      .then((a) => {
        if (!cancelled) {
          setSrc(assetDisplaySrc(a));
          onAvailability?.("available");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e instanceof Error ? e.message : t("artifacts.couldNotLoadPreview");
          const av = artifactAvailabilityFromLoad({
            ok: false,
            errorMessage: msg,
          });
          setMissing(av === "missing");
          setErr(msg);
          onAvailability?.(av);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, t, onAvailability]);

  if (missing || (err && isArtifactMissingError(err))) {
    return <ArtifactUnavailableState path={path} compact />;
  }
  if (err) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="artifact-load-error">
        {t("artifacts.couldNotLoadPreview")}
      </p>
    );
  }
  if (!src) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("artifacts.loadingPreview")}
      </p>
    );
  }
  if (audio) {
    return (
      <audio src={src} controls preload="metadata" className="w-full" />
    );
  }
  if (video) {
    return (
      <>
        <video
          src={videoDisplaySrc(src)}
          controls
          playsInline
          preload="metadata"
          className="max-h-[min(50vh,420px)] w-full cursor-zoom-in rounded-lg bg-black object-contain"
          onDoubleClick={() => setLightboxOpen(true)}
        />
        <MediaLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src={src}
          path={path}
          video
        />
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="block w-full cursor-zoom-in"
      >
        <img
          src={src}
          alt=""
          className="max-h-[min(50vh,420px)] w-full rounded-lg border border-border/60 object-contain"
        />
      </button>
      <MediaLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        src={src}
        path={path}
      />
    </>
  );
}

function ArtifactTextPreview({
  path,
  onAvailability,
}: {
  path: string;
  onAvailability?: (a: ArtifactAvailability) => void;
}) {
  const t = useT();
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const md = fileExt(path) === "md" || fileExt(path) === "markdown";

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setErr(null);
    setMissing(false);
    void rpc<{ content: string }>("workspace.readFile", {
      path,
      maxChars: 40_000,
    })
      .then((r) => {
        if (!cancelled) {
          setContent(r.content);
          onAvailability?.("available");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e instanceof Error ? e.message : t("artifacts.couldNotLoadFile");
          const av = artifactAvailabilityFromLoad({
            ok: false,
            errorMessage: msg,
          });
          setMissing(av === "missing");
          setErr(msg);
          onAvailability?.(av);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, t, onAvailability]);

  if (missing || (err && isArtifactMissingError(err))) {
    return <ArtifactUnavailableState path={path} compact />;
  }
  if (err)
    return (
      <p className="text-sm text-muted-foreground" data-testid="artifact-load-error">
        {t("artifacts.couldNotLoadFile")}
      </p>
    );
  if (content == null)
    return (
      <p className="text-sm text-muted-foreground">
        {t("artifacts.loadingPreview")}
      </p>
    );
  if (md) {
    return (
      <div className="max-h-[min(50vh,420px)] overflow-auto rounded-lg border border-border/60 bg-background/40 p-3 text-left text-sm">
        <Markdown baseDir={null}>{content}</Markdown>
      </div>
    );
  }
  return (
    <pre className="max-h-[min(50vh,420px)] overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/40 p-3 text-2xs leading-relaxed text-foreground/85">
      {content}
    </pre>
  );
}

function ActionButton(props: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 gap-1.5 text-xs"
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props.label}
    >
      {props.icon}
      <span className="hidden sm:inline">{props.label}</span>
    </Button>
  );
}

export function ArtifactsView(props: {
  artifacts: Artifact[];
  tasks: Task[];
  initialSearch?: string;
  /**
   * When true, do not render a view-local search field — the shell topbar owns
   * search (Phase 2: one clear search behavior). Filters still show.
   */
  hideLocalSearch?: boolean;
  /** Optional: open the source task when an artifact is unavailable. */
  onOpenTask?: (taskId: string) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [search, setSearch] = useState(props.initialSearch ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(
    props.artifacts[0]?.id ?? null,
  );
  const [typeFilter, setTypeFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [assetSrc, setAssetSrc] = useState<string | null>(null);
  /** Local dismiss list  -  no gateway delete API; hide missing rows until restart. */
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [availabilityById, setAvailabilityById] = useState<
    Record<string, ArtifactAvailability>
  >({});

  useEffect(() => {
    if (props.initialSearch !== undefined) setSearch(props.initialSearch);
  }, [props.initialSearch]);

  // Keep selection valid when the list changes.
  useEffect(() => {
    if (
      selectedId &&
      !props.artifacts.some((a) => a.id === selectedId) &&
      props.artifacts[0]
    ) {
      setSelectedId(props.artifacts[0].id);
    } else if (!selectedId && props.artifacts[0]) {
      setSelectedId(props.artifacts[0].id);
    }
  }, [props.artifacts, selectedId]);

  const visibleArtifacts = useMemo(
    () => props.artifacts.filter((a) => !hiddenIds.has(a.id)),
    [props.artifacts, hiddenIds],
  );

  const filtered = useMemo(() => {
    return visibleArtifacts.filter((a) => {
      if (
        search &&
        !a.title.toLowerCase().includes(search.toLowerCase()) &&
        !(a.path ?? "").toLowerCase().includes(search.toLowerCase())
      ) {
        return false;
      }
      if (typeFilter !== "all") {
        if (artifactKindId(a.path, a.title) !== typeFilter) return false;
      }
      return true;
    });
  }, [visibleArtifacts, search, typeFilter]);

  const selected =
    filtered.find((a) => a.id === selectedId) ?? filtered[0] ?? null;
  const task = selected
    ? props.tasks.find((x) => x.id === selected.taskId)
    : null;
  const selectedAvailability = selected
    ? availabilityById[selected.id]
    : undefined;
  const selectedMissing = selectedAvailability === "missing";

  const markAvailability = useCallback(
    (id: string, av: ArtifactAvailability) => {
      setAvailabilityById((prev) =>
        prev[id] === av ? prev : { ...prev, [id]: av },
      );
    },
    [],
  );

  // Prefetch display src for the selected file (actions + media).
  useEffect(() => {
    let cancelled = false;
    setAssetSrc(null);
    if (!selected?.path || !selected.id) return;
    const id = selected.id;
    void readAsset(selected.path)
      .then((a) => {
        if (!cancelled) {
          setAssetSrc(assetDisplaySrc(a));
          markAvailability(id, "available");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAssetSrc(null);
          const msg = e instanceof Error ? e.message : String(e);
          markAvailability(
            id,
            artifactAvailabilityFromLoad({ ok: false, errorMessage: msg }),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.path, selected?.id, markAvailability]);

  const hasArtifacts = visibleArtifacts.length > 0;
  const showFilters = hasArtifacts;
  const fileName = selected?.path
    ? basename(selected.path)
    : selected?.title || "file";

  const withBusy = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusy(key);
      try {
        await fn();
      } catch (e) {
        toast({
          description:
            e instanceof Error ? e.message : t("media.actionFailed"),
          variant: "destructive",
        });
      } finally {
        setBusy(null);
      }
    },
    [toast, t],
  );

  const onReveal = () => {
    if (!selected?.path?.trim()) return;
    void withBusy("reveal", async () => {
      const res = await revealPath(selected.path!);
      if (!res.ok) {
        throw new Error(res.error || t("workspace.openInFinderFailed"));
      }
    });
  };

  const onRevealParent = () => {
    if (!selected?.path?.trim()) return;
    const parent = artifactParentPath(selected.path);
    const target = parent || selected.path;
    void withBusy("reveal-parent", async () => {
      const res = await revealPath(target!);
      if (!res.ok) {
        throw new Error(res.error || t("workspace.openInFinderFailed"));
      }
    });
  };

  const onRemoveFromList = () => {
    if (!selected) return;
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(selected.id);
      return next;
    });
    setSelectedId(null);
  };

  const onDownload = () => {
    const path = selected?.path;
    if (!path) return;
    void withBusy("download", async () => {
      let blob: Blob;
      if (assetSrc) {
        blob = await blobFromSrc(assetSrc);
      } else if (isTextPreviewable(path)) {
        const r = await rpc<{ content: string }>("workspace.readFile", {
          path,
          maxChars: 2_000_000,
        });
        blob = new Blob([r.content], { type: "text/plain;charset=utf-8" });
      } else {
        const a = await readAsset(path);
        blob = await blobFromSrc(assetDisplaySrc(a));
      }
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = fileName.includes(".") ? fileName : `${fileName}.bin`;
      el.rel = "noopener";
      document.body.appendChild(el);
      el.click();
      el.remove();
      URL.revokeObjectURL(url);
      toast({ description: t("media.downloaded") });
    });
  };

  const onCopy = () => {
    if (!selected) return;
    void withBusy("copy", async () => {
      // Media: prefer image clipboard when possible.
      if (
        selected.path &&
        isImagePath(selected.path) &&
        !isVideoPath(selected.path) &&
        assetSrc
      ) {
        try {
          const blob = await blobFromSrc(assetSrc);
          const type = blob.type || "image/png";
          if (
            typeof ClipboardItem !== "undefined" &&
            navigator.clipboard?.write
          ) {
            await navigator.clipboard.write([
              new ClipboardItem({ [type]: blob }),
            ]);
            toast({ description: t("media.copiedImage") });
            return;
          }
        } catch {
          /* fall through */
        }
      }
      // Text: copy content; otherwise path.
      if (selected.path && isTextPreviewable(selected.path)) {
        try {
          const r = await rpc<{ content: string }>("workspace.readFile", {
            path: selected.path,
            maxChars: 200_000,
          });
          await navigator.clipboard.writeText(r.content);
          toast({ description: t("media.copiedContent") });
          return;
        } catch {
          /* fall through to path */
        }
      }
      const text = selected.path?.trim() || selected.title;
      await navigator.clipboard.writeText(text);
      toast({ description: t("media.copiedPath") });
    });
  };

  const onShare = () => {
    const path = selected?.path;
    if (!path || !selected) return;
    void withBusy("share", async () => {
      const canShare = typeof navigator.share === "function";
      if (canShare && assetSrc) {
        try {
          const blob = await blobFromSrc(assetSrc);
          const file = new File(
            [blob],
            fileName.includes(".") ? fileName : `${fileName}.bin`,
            { type: blob.type || "application/octet-stream" },
          );
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: selected.title });
            return;
          }
          await navigator.share({
            title: selected.title,
            text: path,
          });
          return;
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(path);
      toast({ description: t("media.shareCopied") });
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="artifacts-view">
      <div className="border-b border-border/70 px-6 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("artifacts.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("artifacts.subtitle")}
        </p>
        {showFilters ? (
          <div
            className="mt-4 flex flex-wrap items-center gap-2"
            data-testid="artifacts-search-row"
          >
            {!props.hideLocalSearch ? (
              <div className="relative min-w-[200px] max-w-md flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("artifacts.search")}
                  className="h-9 w-full pl-8"
                  data-testid="artifacts-local-search"
                />
              </div>
            ) : null}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue placeholder={t("artifacts.allTypes")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("artifacts.allTypes")}</SelectItem>
                <SelectItem value="media">
                  {t("artifacts.filterMedia")}
                </SelectItem>
                <SelectItem value="markdown">
                  {t("artifacts.filterDocuments")}
                </SelectItem>
                <SelectItem value="excel">
                  {t("artifacts.filterSheets")}
                </SelectItem>
                <SelectItem value="python">
                  {t("artifacts.filterCode")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* List  -  select only; actions live in the detail panel */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-border/70">
          <ScrollArea className="flex-1">
            <div className="p-3 sm:p-4">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-5 w-5" />}
                  title={t("artifacts.noArtifactsTitle")}
                  description={t("artifacts.noArtifactsDesc")}
                />
              ) : (
                <ul className="space-y-0.5">
                  {filtered.map((a) => {
                    const Icon = iconFor(a.path, a.title);
                    const active = selected?.id === a.id;
                    const rowMissing = availabilityById[a.id] === "missing";
                    const showThumb =
                      a.path &&
                      isImagePath(a.path) &&
                      !isVideoPath(a.path) &&
                      !rowMissing;
                    const cardTask = props.tasks.find((x) => x.id === a.taskId);
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(a.id)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                            active
                              ? "bg-primary/[0.12] ring-1 ring-primary/35"
                              : "hover:bg-muted/30",
                            rowMissing && "opacity-90",
                          )}
                          data-testid="artifact-list-row"
                          data-availability={availabilityById[a.id] ?? "unknown"}
                          aria-selected={active}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden">
                            {rowMissing ? (
                              <div
                                className="flex h-10 w-10 items-center justify-center rounded-md border border-warning/40 bg-warning/10 text-warning"
                                aria-hidden
                              >
                                <AlertCircle className="h-4 w-4" />
                              </div>
                            ) : showThumb ? (
                              <ArtifactThumb
                                path={a.path!}
                                onAvailability={(av) =>
                                  markAvailability(a.id, av)
                                }
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground">
                                <Icon className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-sm font-medium">
                                {a.title}
                              </span>
                              {rowMissing ? (
                                <Badge
                                  variant="secondary"
                                  className="shrink-0 border-warning/30 bg-warning/10 text-2xs text-warning"
                                  data-testid="artifact-unavailable-badge"
                                >
                                  {t("artifacts.unavailableBadge")}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="mt-0.5 truncate text-2xs text-muted-foreground">
                              {rowMissing
                                ? t("artifacts.missingSummary")
                                : artifactKindLabel(a.path, a.title)}
                              <span aria-hidden> · </span>
                              {relativeTime(a.createdAt)}
                            </div>
                            {cardTask ? (
                              <div className="mt-1 truncate text-2xs text-muted-foreground">
                                {cardTask.goal.slice(0, 40)}
                                {cardTask.goal.length > 40 ? "…" : ""}
                              </div>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {hasArtifacts ? (
                <p className="mt-4 px-1 text-xs text-muted-foreground">
                  {t("artifacts.count", { count: filtered.length })}
                </p>
              ) : null}
            </div>
          </ScrollArea>
        </div>

        {/* Detail  -  in-app preview + actions */}
        <aside
          className="hidden w-[min(100%,420px)] shrink-0 flex-col bg-muted/10 md:flex"
          data-testid="artifacts-detail-panel"
        >
          {selected ? (
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-4 p-4">
                <div>
                  <div className="text-base font-medium leading-snug">
                    {selected.title}
                  </div>
                  <div className="mt-1 text-2xs text-muted-foreground">
                    {artifactKindLabel(selected.path, selected.title)}
                    <span aria-hidden> · </span>
                    {relativeTime(selected.createdAt)}
                  </div>
                  {selected.path ? (
                    <div
                      className="mt-1 truncate font-mono text-2xs text-muted-foreground"
                      title={selected.path}
                    >
                      {shortPath(selected.path)}
                    </div>
                  ) : null}
                </div>

                {selected.path && !selectedMissing ? (
                  <div className="flex flex-wrap gap-1.5">
                    <ActionButton
                      label={t("media.download")}
                      icon={<Download className="h-3.5 w-3.5" />}
                      disabled={busy === "download"}
                      onClick={onDownload}
                    />
                    <ActionButton
                      label={t("media.copy")}
                      icon={<Copy className="h-3.5 w-3.5" />}
                      disabled={busy === "copy"}
                      onClick={onCopy}
                    />
                    <ActionButton
                      label={t("media.share")}
                      icon={<Share2 className="h-3.5 w-3.5" />}
                      disabled={busy === "share"}
                      onClick={onShare}
                    />
                    <ActionButton
                      label={t("artifacts.reveal")}
                      icon={<FolderOpen className="h-3.5 w-3.5" />}
                      disabled={busy === "reveal"}
                      onClick={onReveal}
                    />
                  </div>
                ) : null}

                <Separator />

                <div>
                  <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("artifacts.preview")}
                  </div>
                  {selectedMissing && selected.path ? (
                    <ArtifactUnavailableState
                      path={selected.path}
                      onRevealParent={onRevealParent}
                      onRemove={onRemoveFromList}
                      onOpenTask={
                        task && props.onOpenTask
                          ? () => props.onOpenTask?.(task.id)
                          : undefined
                      }
                    />
                  ) : selected.path &&
                    (isImagePath(selected.path) ||
                      isVideoPath(selected.path) ||
                      isAudioPath(selected.path)) ? (
                    <ArtifactMediaPreview
                      path={selected.path}
                      onAvailability={(av) =>
                        markAvailability(selected.id, av)
                      }
                    />
                  ) : selected.path && isTextPreviewable(selected.path) ? (
                    <ArtifactTextPreview
                      path={selected.path}
                      onAvailability={(av) =>
                        markAvailability(selected.id, av)
                      }
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("artifacts.openFullFidelity")}
                    </p>
                  )}
                </div>

                <p className="text-2xs text-muted-foreground">
                  {formatDateTime(selected.createdAt)}
                </p>

                {task ? (
                  <>
                    <Separator />
                    <div>
                      <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t("artifacts.sourceTask")}
                      </div>
                      <Badge
                        variant="secondary"
                        className="max-w-full whitespace-normal font-normal"
                      >
                        {task.goal}
                      </Badge>
                    </div>
                  </>
                ) : null}
              </div>
            </ScrollArea>
          ) : (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title={t("artifacts.selectToPreview")}
              className="py-10 sm:py-12"
            />
          )}
        </aside>
      </div>
    </div>
  );
}
