import { describe, it, expect } from "vitest";
import {
  APP_MIN_WINDOW_WIDTH,
  HOME_MIN_CONTENT_WIDTH_BUDGET,
  readinessCtaFitsMinWidth,
  readinessLayoutMode,
} from "./readiness-layout";

describe("readiness min-width layout", () => {
  it("documents 960 app min and content budget for expanded sidebar", () => {
    expect(APP_MIN_WINDOW_WIDTH).toBe(960);
    // Expanded sidebar + pad leaves ~640px; must still fit stacked CTAs.
    expect(HOME_MIN_CONTENT_WIDTH_BUDGET).toBeGreaterThanOrEqual(600);
    expect(HOME_MIN_CONTENT_WIDTH_BUDGET).toBeLessThan(720);
  });

  it("primary CTA fits at min content budget via wrap/stack", () => {
    // Long CTA like "Sign in to SuperGrok" ~ 160px; label ~ 200px
    expect(
      readinessCtaFitsMinWidth({
        contentWidth: HOME_MIN_CONTENT_WIDTH_BUDGET,
        labelWidth: 220,
        ctaWidth: 168,
      }),
    ).toBe(true);
  });

  it("stack mode at min-window budget; inline only when wide", () => {
    expect(readinessLayoutMode(400)).toBe("stack");
    expect(readinessLayoutMode(HOME_MIN_CONTENT_WIDTH_BUDGET)).toBe("stack");
    expect(readinessLayoutMode(800)).toBe("inline");
  });

  it("rejects only when CTA itself exceeds content width", () => {
    expect(
      readinessCtaFitsMinWidth({
        contentWidth: 100,
        labelWidth: 40,
        ctaWidth: 120,
      }),
    ).toBe(false);
  });
});
