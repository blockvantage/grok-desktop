/**
 * Full-viewport image/video lightbox with download / copy / share / reveal actions.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Download,
  FolderOpen,
  Share2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { revealPath } from "@/lib/api";
import { videoDisplaySrc } from "@/lib/media-src";
import { useToast } from "@/components/ui/toast";

const VOLUME_KEY = "grokdesk.mediaVolume.v1";

function readStoredVolume(): { v: number; m: boolean } | null {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: unknown; m?: unknown };
    if (typeof parsed.v !== "number" || typeof parsed.m !== "boolean")
      return null;
    return { v: Math.min(1, Math.max(0, parsed.v)), m: parsed.m };
  } catch {
    return null;
  }
}

function writeStoredVolume(el: HTMLMediaElement): void {
  try {
    localStorage.setItem(
      VOLUME_KEY,
      JSON.stringify({ v: el.volume, m: el.muted }),
    );
  } catch {
    /* quota / private mode */
  }
}

function applyStoredVolume(el: HTMLMediaElement): void {
  const stored = readStoredVolume();
  if (!stored) return;
  el.volume = stored.v;
  el.muted = stored.m;
}

export type MediaLightboxProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display source (data URL or protocol URL). */
  src: string | null;
  /** Optional filesystem path for reveal / share metadata. */
  path?: string | null;
  title?: string;
  /** When true, render a video player instead of an image. */
  video?: boolean;
  /** When true, render an audio player instead of an image. */
  audio?: boolean;
};

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

/** Bound lightbox download/copy so a hung asset protocol cannot stall UI. */
const MEDIA_FETCH_TIMEOUT_MS = 30_000;
/** Soft cap (~100 MiB) for clipboard/download materialization. */
const MEDIA_FETCH_MAX_BYTES = 100 * 1024 * 1024;

async function blobFromSrc(src: string): Promise<Blob> {
  const res = await fetch(src, {
    signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(len) && len > MEDIA_FETCH_MAX_BYTES) {
    throw new Error("media too large to materialize");
  }
  const blob = await res.blob();
  if (blob.size > MEDIA_FETCH_MAX_BYTES) {
    throw new Error("media too large to materialize");
  }
  return blob;
}

export function MediaLightbox(props: MediaLightboxProps) {
  const t = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const name =
    props.title?.trim() ||
    (props.path ? basename(props.path) : t("media.untitled"));

  // Escape is handled by Dialog; also clear busy on close.
  useEffect(() => {
    if (!props.open) setBusy(null);
  }, [props.open]);

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

  const onDownload = () => {
    if (!props.src) return;
    void withBusy("download", async () => {
      const blob = await blobFromSrc(props.src!);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name.includes(".") ? name : `${name}.png`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ description: t("media.downloaded") });
    });
  };

  const onCopy = () => {
    if (!props.src) return;
    void withBusy("copy", async () => {
      // Prefer image clipboard when supported; fall back to path/text.
      try {
        const blob = await blobFromSrc(props.src!);
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
      const text = props.path?.trim() || props.src || name;
      await navigator.clipboard.writeText(text);
      toast({ description: t("media.copiedPath") });
    });
  };

  const onShare = () => {
    if (!props.src) return;
    void withBusy("share", async () => {
      const canShare = typeof navigator.share === "function";
      if (canShare) {
        try {
          const blob = await blobFromSrc(props.src!);
          const file = new File([blob], name.includes(".") ? name : `${name}.png`, {
            type: blob.type || "image/png",
          });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: name });
            return;
          }
          await navigator.share({
            title: name,
            text: props.path?.trim() || name,
          });
          return;
        } catch (e) {
          // User cancel is fine; other errors fall through to copy.
          if (e instanceof Error && e.name === "AbortError") return;
        }
      }
      // Fallback: copy path or URL so the user can paste elsewhere.
      const text = props.path?.trim() || props.src || name;
      await navigator.clipboard.writeText(text);
      toast({ description: t("media.shareCopied") });
    });
  };

  const onReveal = () => {
    if (!props.path?.trim()) return;
    void withBusy("reveal", async () => {
      const res = await revealPath(props.path!);
      if (!res.ok) {
        throw new Error(res.error || t("workspace.openInFinderFailed"));
      }
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(92vh,920px)] w-[min(96vw,1100px)] max-w-none translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden border-white/10 bg-black/95 p-0 shadow-2xl",
        )}
        // Radix DialogContent already includes a close button; we style our own toolbar.
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 pr-12">
          <DialogTitle className="min-w-0 truncate text-sm font-medium text-foreground/95">
            {name}
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-1">
            <ActionBtn
              label={t("media.download")}
              icon={<Download className="h-4 w-4" strokeWidth={1.75} />}
              disabled={!props.src || busy === "download"}
              onClick={onDownload}
            />
            <ActionBtn
              label={t("media.copy")}
              icon={<Copy className="h-4 w-4" strokeWidth={1.75} />}
              disabled={!props.src || busy === "copy"}
              onClick={onCopy}
            />
            <ActionBtn
              label={t("media.share")}
              icon={<Share2 className="h-4 w-4" strokeWidth={1.75} />}
              disabled={!props.src || busy === "share"}
              onClick={onShare}
            />
            {props.path?.trim() ? (
              <ActionBtn
                label={t("workspace.openInFinder")}
                icon={<FolderOpen className="h-4 w-4" strokeWidth={1.75} />}
                disabled={busy === "reveal"}
                onClick={onReveal}
              />
            ) : null}
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
          {props.src ? (
            props.audio ? (
              <audio
                src={props.src}
                controls
                preload="metadata"
                className="w-full max-w-xl"
                ref={(el) => {
                  if (el) applyStoredVolume(el);
                }}
                onVolumeChange={(e) => writeStoredVolume(e.currentTarget)}
              />
            ) : props.video ? (
              <video
                src={videoDisplaySrc(props.src)}
                controls
                playsInline
                preload="metadata"
                className="max-h-full max-w-full rounded-lg bg-black object-contain"
                ref={(el) => {
                  if (el) applyStoredVolume(el);
                }}
                onVolumeChange={(e) => writeStoredVolume(e.currentTarget)}
              />
            ) : (
              <img
                src={props.src}
                alt={name}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            )
          ) : (
            <p className="text-sm text-muted-foreground">{t("media.loading")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionBtn(props: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={props.label}
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{props.label}</TooltipContent>
    </Tooltip>
  );
}

/** Convenience: controlled lightbox state helper type for parents. */
export type LightboxTarget = {
  src: string;
  path?: string | null;
  title?: string;
  video?: boolean;
};
