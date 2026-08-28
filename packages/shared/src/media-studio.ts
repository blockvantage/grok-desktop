/**
 * Media studio options aligned with Grok video/image tools (Phase 3.2).
 * Locale-free agent constraints; UI adds copy. Call-count limits stay upstream.
 */

export const MEDIA_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const;

export type MediaAspectRatio = (typeof MEDIA_ASPECT_RATIOS)[number];

export const MEDIA_DURATION_MIN = 1;
export const MEDIA_DURATION_MAX = 15;
/** Default clip length when the user has not picked one (Grok video-gen default). */
export const MEDIA_DURATION_DEFAULT = 6;

export const MEDIA_PRESET_VOICES = ["ara", "eve", "leo", "rex"] as const;
export type MediaPresetVoice = (typeof MEDIA_PRESET_VOICES)[number];

export type MediaStudioKind = "image" | "video";

export type MediaStudioOptions = {
  kind: MediaStudioKind;
  aspectRatio?: string | null;
  durationSec?: number | null;
  voice?: string | null;
  /** Still image path for image_to_video (single-image input). */
  stillImagePath?: string | null;
};

export function isMediaAspectRatio(value: unknown): value is MediaAspectRatio {
  return (
    typeof value === "string" &&
    (MEDIA_ASPECT_RATIOS as readonly string[]).includes(value)
  );
}

export function isMediaPresetVoice(value: unknown): value is MediaPresetVoice {
  return (
    typeof value === "string" &&
    (MEDIA_PRESET_VOICES as readonly string[]).includes(value)
  );
}

export function clampMediaDuration(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MEDIA_DURATION_DEFAULT;
  return Math.min(
    MEDIA_DURATION_MAX,
    Math.max(MEDIA_DURATION_MIN, Math.round(n)),
  );
}

const IMAGE_PATH = /\.(jpe?g|png|webp|gif)$/i;

export function stillImagePathFromAttachments(
  attachments:
    | ReadonlyArray<{
        path?: string | null;
        sourcePath?: string | null;
        stagedPath?: string | null;
        name?: string | null;
      }>
    | null
    | undefined,
): string | null {
  if (!attachments) return null;
  for (const item of attachments) {
    const candidates = [item.path, item.stagedPath, item.sourcePath, item.name];
    for (const raw of candidates) {
      const p = typeof raw === "string" ? raw.trim() : "";
      if (p && IMAGE_PATH.test(p)) return p;
    }
  }
  return null;
}

export function mediaKindFromTokens(
  ...tokens: Array<string | null | undefined>
): MediaStudioKind | null {
  for (const token of tokens) {
    if (typeof token !== "string") continue;
    const id = token.trim().toLowerCase().replace(/^\//, "");
    if (id === "video") return "video";
    if (id === "image") return "image";
  }
  return null;
}

/**
 * Append video/image constraints the agent tools understand.
 * Always reminds Desk to land files in workspace images/ or videos/ (Artifacts harvest).
 */
export function weaveMediaStudioGoal(
  base: string,
  opts: MediaStudioOptions | null | undefined,
): string {
  const goal = base.trim();
  if (!opts || !goal) return goal;
  const lines: string[] = [];
  if (opts.kind === "video") {
    const duration = clampMediaDuration(opts.durationSec ?? MEDIA_DURATION_DEFAULT);
    lines.push(`Duration: ${duration} seconds (allowed ${MEDIA_DURATION_MIN}–${MEDIA_DURATION_MAX}).`);
    if (isMediaAspectRatio(opts.aspectRatio)) {
      lines.push(`Aspect ratio: ${opts.aspectRatio}.`);
    }
    if (isMediaPresetVoice(opts.voice)) {
      lines.push(`Use preset voice "${opts.voice}" for any speech.`);
    }
    if (opts.stillImagePath?.trim()) {
      lines.push(
        `Animate this still image as a single-image video: ${opts.stillImagePath.trim()}.`,
      );
    }
    lines.push(
      "Save the mp4 under the workspace videos/ folder so Desk can keep it in Artifacts.",
    );
  } else {
    if (isMediaAspectRatio(opts.aspectRatio)) {
      lines.push(`Aspect ratio: ${opts.aspectRatio}.`);
    }
    lines.push(
      "Save the image under the workspace images/ folder so Desk can keep it in Artifacts.",
    );
  }
  return `${goal}\n\n${lines.join(" ")}`;
}
