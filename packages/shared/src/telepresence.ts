/**
 * Telepresence pure helpers: quality presets + phone viewport → image coords.
 * Browser/RN-safe (no node builtins).
 */

export type TelepresenceQuality = "auto" | "smooth" | "crisp";

export type TelepresenceEncodeConstraints = {
  /** Target max long edge of captured frame (px) */
  maxLongEdge: number;
  /** Target frames per second for the capture loop */
  fps: number;
  /** JPEG quality 1–100 when encoding screenshots */
  jpegQuality: number;
  /** Soft bitrate hint (kbps) for clients/logs */
  bitrateKbps: number;
};

const PRESETS: Record<TelepresenceQuality, TelepresenceEncodeConstraints> = {
  smooth: {
    maxLongEdge: 960,
    fps: 8,
    jpegQuality: 55,
    bitrateKbps: 400,
  },
  auto: {
    maxLongEdge: 1280,
    fps: 12,
    jpegQuality: 70,
    bitrateKbps: 900,
  },
  crisp: {
    maxLongEdge: 1600,
    fps: 15,
    jpegQuality: 85,
    bitrateKbps: 1800,
  },
};

export function isTelepresenceQuality(v: string): v is TelepresenceQuality {
  return v === "auto" || v === "smooth" || v === "crisp";
}

export function qualityConstraints(
  quality: TelepresenceQuality,
): TelepresenceEncodeConstraints {
  return { ...PRESETS[quality] };
}

/** Two presets must differ so quality UI is meaningful. */
export function qualityDiffers(
  a: TelepresenceQuality,
  b: TelepresenceQuality,
): boolean {
  const ca = qualityConstraints(a);
  const cb = qualityConstraints(b);
  return (
    ca.maxLongEdge !== cb.maxLongEdge ||
    ca.fps !== cb.fps ||
    ca.jpegQuality !== cb.jpegQuality
  );
}

export type LetterboxRect = {
  /** Content area origin inside the view (px) */
  contentX: number;
  contentY: number;
  contentW: number;
  contentH: number;
};

/**
 * Fit image into view preserving aspect ratio (letterbox/pillarbox).
 */
export function fitImageInView(
  viewW: number,
  viewH: number,
  imageW: number,
  imageH: number,
): LetterboxRect {
  if (viewW <= 0 || viewH <= 0 || imageW <= 0 || imageH <= 0) {
    return { contentX: 0, contentY: 0, contentW: 0, contentH: 0 };
  }
  const scale = Math.min(viewW / imageW, viewH / imageH);
  const contentW = imageW * scale;
  const contentH = imageH * scale;
  return {
    contentX: (viewW - contentW) / 2,
    contentY: (viewH - contentH) / 2,
    contentW,
    contentH,
  };
}

/**
 * Map a touch point in the phone view to screenshot image coordinates.
 * Returns null if the point is outside the letterboxed content (black bars).
 */
export function phoneViewToImageCoords(
  viewX: number,
  viewY: number,
  viewW: number,
  viewH: number,
  imageW: number,
  imageH: number,
): { x: number; y: number } | null {
  const box = fitImageInView(viewW, viewH, imageW, imageH);
  if (box.contentW <= 0 || box.contentH <= 0) return null;
  const lx = viewX - box.contentX;
  const ly = viewY - box.contentY;
  if (lx < 0 || ly < 0 || lx > box.contentW || ly > box.contentH) {
    return null;
  }
  const x = Math.round((lx / box.contentW) * imageW);
  const y = Math.round((ly / box.contentH) * imageH);
  return {
    x: Math.min(imageW - 1, Math.max(0, x)),
    y: Math.min(imageH - 1, Math.max(0, y)),
  };
}

export type TelepresenceInputKind =
  | "tap"
  | "drag"
  | "scroll"
  | "key"
  | "type";

export type TelepresenceInputEvent = {
  kind: TelepresenceInputKind;
  /** Normalized 0–1 within content (preferred) or absolute view px with viewW/H */
  nx?: number;
  ny?: number;
  viewX?: number;
  viewY?: number;
  viewW?: number;
  viewH?: number;
  /** Drag end */
  nx2?: number;
  ny2?: number;
  viewX2?: number;
  viewY2?: number;
  /** Scroll deltas */
  dx?: number;
  dy?: number;
  /** Keyboard */
  key?: string;
  text?: string;
  button?: "left" | "right" | "middle";
};

export type TelepresenceConsent = "pending" | "granted" | "denied" | "expired";

export type TelepresenceSessionState = {
  active: boolean;
  deviceId: string | null;
  /** Stable session id for ownership / revoke (principal + session). */
  sessionId: string | null;
  quality: TelepresenceQuality;
  displayId: string | null;
  imageW: number;
  imageH: number;
  startedAt: string | null;
  /** Absolute ISO expiry; stream auto-stops when past. */
  expiresAt: string | null;
  /** Desktop consent for remote view/control. */
  consent: TelepresenceConsent;
  /** Last capture/input error for desk UI (null when healthy). */
  lastError: string | null;
  /** Frames successfully handed to the sink (not merely captured). */
  framesSent: number;
  /** Frames dropped before delivery (backpressure / size / sink missing). */
  framesDropped: number;
  lastDropReason: string | null;
};

export function emptyTelepresenceState(): TelepresenceSessionState {
  return {
    active: false,
    deviceId: null,
    sessionId: null,
    quality: "auto",
    displayId: null,
    imageW: 0,
    imageH: 0,
    startedAt: null,
    expiresAt: null,
    consent: "pending",
    lastError: null,
    framesSent: 0,
    framesDropped: 0,
    lastDropReason: null,
  };
}

/** Default telepresence session TTL (30 minutes). */
export const DEFAULT_TELEPRESENCE_TTL_MS = 30 * 60 * 1000;

/** Channel for sealed media frames (JPEG base64 payload inside E2E frame). */
export function teleChannel(machineId: string, deviceId: string): string {
  return `tele:${machineId}:${deviceId}`;
}

export type TeleFramePlain = {
  v: 1;
  kind: "frame";
  seq: number;
  mime: "image/jpeg" | "image/png";
  /** base64 (standard) image bytes */
  dataB64: string;
  width: number;
  height: number;
  displayId?: string;
  ts: number;
};
