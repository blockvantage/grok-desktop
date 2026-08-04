/**
 * Capture a first-frame dataURL poster from a video src (module-level cache).
 * Used by rail DeliverableRow thumbs; Wave 4 hero cards reuse this hook.
 */
import { useEffect, useState } from "react";
import { videoDisplaySrc } from "@/lib/media-src";

const posterCache = new Map<string, string>();

/**
 * @param src Display source for the video (protocol URL or data URL).
 * @returns Cached JPEG dataURL of the first frame, or null while loading / on failure.
 */
export function useVideoPoster(src: string | null | undefined): string | null {
  const [poster, setPoster] = useState<string | null>(() =>
    src ? (posterCache.get(src) ?? null) : null,
  );

  useEffect(() => {
    if (!src) {
      setPoster(null);
      return;
    }
    const cached = posterCache.get(src);
    if (cached) {
      setPoster(cached);
      return;
    }

    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    // Detached element — seek once loaded, draw to canvas.
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };

    const capture = () => {
      if (cancelled) return;
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        posterCache.set(src, dataUrl);
        if (!cancelled) setPoster(dataUrl);
      } catch {
        /* tainted canvas or codec failure — keep icon fallback */
      } finally {
        cleanup();
      }
    };

    const onLoaded = () => {
      try {
        // Seek slightly past 0 so the first frame is painted.
        if (video.currentTime < 0.001) {
          video.currentTime = 0.001;
        } else {
          capture();
        }
      } catch {
        capture();
      }
    };

    video.addEventListener("seeked", capture, { once: true });
    video.addEventListener("loadeddata", onLoaded, { once: true });
    video.addEventListener(
      "error",
      () => {
        cleanup();
      },
      { once: true },
    );
    video.src = videoDisplaySrc(src);

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [src]);

  return poster;
}
