/**
 * Inline artifact media + turn-end deliverables digest (ASSET-3).
 * Shared by the legacy stream and conversation turns.
 */
import { useEffect, useState } from "react";
import { Film, FileText, ImageIcon, Loader2, Music } from "lucide-react";
import { MediaLightbox } from "@/components/media-lightbox";
import {
  readAsset,
  assetDisplaySrc,
  isAudioPath,
  isImagePath,
  isVideoPath,
} from "@/lib/api";
import { videoDisplaySrc } from "@/lib/media-src";
import { useT } from "@/i18n";
import { isArtifactMissingError } from "@/lib/artifact-availability";
import { MOTION_SURFACE_CLASSES } from "@/lib/motion-system";
import { cn } from "@/lib/utils";

export function ArtifactMedia({
  path,
  title,
  onOpenFile,
  baseDir,
}: {
  path: string;
  title: string;
  onOpenFile?: (path: string) => void;
  baseDir?: string | null;
}) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const video = isVideoPath(path);
  const audio = isAudioPath(path);
  const MediaIcon = audio ? Music : video ? Film : ImageIcon;

  useEffect(() => {
    let cancelled = false;
    void readAsset(path, { root: baseDir })
      .then((a) => {
        if (!cancelled) setSrc(assetDisplaySrc(a));
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setFailed(true);
          const msg =
            e instanceof Error ? e.message : t("stream.couldNotPreview");
          setErrMsg(
            isArtifactMissingError(msg)
              ? t("stream.fileUnavailable")
              : t("stream.couldNotPreview"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, baseDir, t]);

  if (failed) {
    const missing = isArtifactMissingError(errMsg) ||
      errMsg === t("stream.fileUnavailable");
    return (
      <button
        type="button"
        onClick={() => onOpenFile?.(path)}
        className="chat-msg-in flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5 text-left transition-colors hover:border-primary/30"
        data-testid="artifact-media-unavailable"
        data-availability={missing ? "missing" : "error"}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <MediaIcon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground/90">
            {title}
          </div>
          <div className="truncate text-2xs text-muted-foreground">
            {missing
              ? t("stream.fileUnavailableHint")
              : errMsg || t("stream.couldNotPreviewHint")}
          </div>
        </div>
      </button>
    );
  }

  return (
    <figure className="chat-msg-in min-w-0 flex-1">
      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/20">
        {src ? (
          audio ? (
            <div className="px-3 py-4">
              <audio src={src} controls preload="metadata" className="w-full" />
            </div>
          ) : video ? (
            <video
              src={videoDisplaySrc(src)}
              controls
              playsInline
              preload="metadata"
              className="max-h-[440px] w-full cursor-zoom-in bg-black object-contain"
              onDoubleClick={() => setLightboxOpen(true)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="block w-full cursor-zoom-in transition-opacity hover:opacity-95"
            >
              <img
                src={src}
                alt={title}
                className="max-h-[440px] w-full object-contain"
                onError={() => {
                  // Bytes decoded but aren't a renderable image (corrupt/
                  // truncated/unsupported codec) — fall back to the file card
                  // instead of a broken-image glyph in the transcript.
                  setFailed(true);
                  setErrMsg(t("stream.couldNotPreview"));
                }}
              />
            </button>
          )
        ) : (
          <div className="flex h-44 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
      </div>
      <figcaption className="mt-1.5 flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
        <MediaIcon className="h-3 w-3 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{title}</span>
      </figcaption>
      {!audio ? (
        <MediaLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src={src}
          path={path}
          title={title}
          video={video}
          audio={audio}
        />
      ) : null}
    </figure>
  );
}

/** Turn-end digest: optional media hero + "N more files" + open rail. */
export function DeliverablesDigestCard({
  media,
  moreCount,
  onOpenFile,
  onOpenDeliverables,
  baseDir,
}: {
  media: { id: string; title: string; path?: string | null } | null;
  moreCount: number;
  onOpenFile?: (path: string) => void;
  onOpenDeliverables?: () => void;
  baseDir?: string | null;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "chat-msg-in min-w-0 flex-1 space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5",
        MOTION_SURFACE_CLASSES.artifactReveal,
      )}
      data-deliverables-digest
    >
      {media?.path &&
      (isImagePath(media.path) ||
        isVideoPath(media.path) ||
        isAudioPath(media.path)) ? (
        <ArtifactMedia
          path={media.path}
          title={media.title}
          onOpenFile={onOpenFile}
          baseDir={baseDir}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-1">
        {moreCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t(moreCount === 1 ? "stream.moreFilesOne" : "stream.moreFiles", {
              n: moreCount,
            })}
          </span>
        ) : null}
        {onOpenDeliverables ? (
          <button
            type="button"
            onClick={onOpenDeliverables}
            className="rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 text-2xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            {t("stream.openDeliverables")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Compact non-media file chip (list mode fallback). */
export function ArtifactFileChip({
  title,
  path,
  onOpenFile,
}: {
  title: string;
  path?: string | null;
  onOpenFile?: (path: string) => void;
}) {
  const content = (
    <>
      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{title}</span>
    </>
  );
  if (path && onOpenFile) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-foreground/90 transition-colors hover:bg-muted/50"
        onClick={() => onOpenFile(path)}
      >
        {content}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-foreground/90">
      {content}
    </span>
  );
}
