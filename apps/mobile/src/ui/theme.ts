/**
 * Grok Desk Remote — phone visual system.
 * Deep Navy + Ice (desktop / landing brand parity).
 * Dark product chrome: midnight/navy surfaces, scarce ice accent.
 * Elevation via lighter navy surfaces (never black drop shadows on cards).
 */
export const colors = {
  /** Midnight canvas — matches desktop Electron backgroundColor */
  bg: "#050e21",
  /** Navy elevated cards / sheets */
  bgElevated: "#07142c",
  /** Ink mid surface (inputs, secondary buttons) */
  bgSoft: "#0b1736",
  /** Panel high / pressed */
  bgHover: "#10213f",
  border: "rgba(215,230,255,0.08)",
  borderStrong: "rgba(215,230,255,0.14)",
  /** Frost / cloud-leaning primary text */
  text: "#d7e6ff",
  /** Mist secondary */
  textSecondary: "#8794a8",
  /** ~AA meta labels on navy surfaces */
  textMuted: "#7a879c",
  /** Decorative only (chevrons/dots) — not for readable text. */
  textFaint: "#5f6d84",
  /**
   * Ice brand primary (scarce): CTAs, active nav, live/selected.
   * #9fddff — matches landing --color-ice
   */
  accent: "#9fddff",
  accentDim: "#6bb8e8",
  accentSoft: "rgba(159,221,255,0.14)",
  /** Midnight ink on ice solid fills */
  accentText: "#050e21",
  accentBorder: "rgba(159,221,255,0.4)",
  accentBorderSoft: "rgba(159,221,255,0.22)",
  accentStrong: "rgba(159,221,255,0.55)",
  /** Electric — activity / focus / processing (optional use) */
  electric: "#4c8bff",
  electricSoft: "rgba(76,139,255,0.14)",
  /** Success / online */
  online: "#67d9b5",
  onlineSoft: "rgba(103,217,181,0.14)",
  okBorder: "rgba(103,217,181,0.35)",
  /** Approval / waiting-for-yes (not success) */
  warn: "#f2b96b",
  warnSoft: "rgba(242,185,107,0.14)",
  warnBorder: "rgba(242,185,107,0.28)",
  danger: "#f47c88",
  dangerSoft: "rgba(244,124,136,0.14)",
  dangerBorder: "rgba(244,124,136,0.35)",
  /** Deeper than midnight for camera / PiP wells */
  deskBlack: "#030a18",
  tabBar: "rgba(5,14,33,0.94)",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
} as const;

// re-export convenience for callers that destructure loosely
export type SpaceKey = keyof typeof space;

export const radius = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const type = {
  hero: { fontSize: 30, fontWeight: "700" as const, letterSpacing: -0.8 },
  title: { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.4 },
  section: { fontSize: 17, fontWeight: "600" as const, letterSpacing: -0.25 },
  body: { fontSize: 16, fontWeight: "400" as const },
  /** 15 matches btn text — kills the old fontSize:15 override (DS-8). */
  label: { fontSize: 15, fontWeight: "600" as const, letterSpacing: 0.05 },
  caption: { fontSize: 13, fontWeight: "500" as const },
  micro: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.3 },
  /** Icon/glyph ramp (DS-8 / PM-5). */
  glyphSm: { fontSize: 16, fontWeight: "600" as const },
  glyphMd: { fontSize: 20, fontWeight: "600" as const },
  glyphLg: { fontSize: 28, fontWeight: "700" as const },
};

/**
 * Floating-only shadows (PiP/sheets). Cards use tonal elevation (bgElevated),
 * never black drop shadows (DS-3).
 */
export const shadow = {
  float: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  /** @deprecated use shadow.float — kept as alias so PiP styles keep compiling */
  pip: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
};
