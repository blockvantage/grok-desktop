/**
 * Real ReadinessChecklist at min-window content widths.
 * Drives the shipped component (not a reimplementation of layout helpers).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ReadinessChecklist } from "./readiness-checklist";
import {
  projectDesktopReadiness,
  readinessInputFromAppState,
} from "@/lib/readiness-ui";
import {
  APP_MIN_WINDOW_WIDTH,
  HOME_MIN_CONTENT_WIDTH_BUDGET,
  readinessLayoutMode,
} from "@/lib/readiness-layout";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

/** Multi-blocker input (signed-out + runtime + workspace; free app has no license). */
function multiBlockerItems() {
  return projectDesktopReadiness(
    readinessInputFromAppState({
      runtimeReady: false,
      signedIn: false,
      neverSignedIn: true,
      signInRequired: true,
      workspaceSelected: false,
    }),
  ).items;
}

function render(contentWidth: number) {
  return renderToStaticMarkup(
    createElement(ReadinessChecklist, {
      items: multiBlockerItems(),
      contentWidth,
      onAction: () => {},
    }),
  );
}

describe("ReadinessChecklist min-width layout (shipped component)", () => {
  it("documents app min window and content budget", () => {
    expect(APP_MIN_WINDOW_WIDTH).toBe(960);
    // Expanded sidebar + pad — stack mode at this budget.
    expect(HOME_MIN_CONTENT_WIDTH_BUDGET).toBe(960 - 256 - 64);
  });

  it("at min-window content budget: stack mode so CTAs never clip", () => {
    const width = HOME_MIN_CONTENT_WIDTH_BUDGET;
    expect(readinessLayoutMode(width)).toBe("stack");
    const html = render(width);
    expect(html).toContain('data-testid="readiness-checklist"');
    expect(html).toContain('data-layout-mode="stack"');
    expect(html).toContain('data-cta-fits="true"');
    expect(html).toContain(`data-content-width="${width}"`);
    // Free app multi-blocker: runtime + sign_in + workspace (no license)
    expect(html).not.toContain('data-testid="readiness-item-license"');
    expect(html).toContain('data-testid="readiness-item-sign_in"');
    expect(html).toContain('data-testid="readiness-item-runtime"');
    expect(html).not.toContain('data-testid="readiness-cta-license"');
    // Wrap-safe classes on the real checklist root
    expect(html).toMatch(/min-w-0/);
    expect(html).toMatch(/max-w-full/);
    expect(html).toMatch(/flex-col/);
    expect(html).toMatch(/overflow-x-hidden/);
  });

  it("at narrow stack width: stack mode and full-width primary CTAs", () => {
    const width = 400;
    expect(readinessLayoutMode(width)).toBe("stack");
    const html = render(width);
    expect(html).toContain('data-layout-mode="stack"');
    expect(html).toContain('data-cta-fits="true"');
    // Stack renders CTAs for blocked rows — never product-license
    expect(html).not.toContain('data-testid="readiness-cta-license"');
    expect(html).toContain('data-testid="readiness-cta-sign_in"');
    expect(html).toContain('data-testid="readiness-cta-runtime"');
    expect(html).toContain('data-testid="readiness-cta-workspace"');
    // Stack path uses column layout class
    expect(html).toMatch(/flex-col/);
  });

  it("returns null when nothing is blocked", () => {
    const items = projectDesktopReadiness(
      readinessInputFromAppState({
        runtimeReady: true,
        signedIn: true,
        workspaceSelected: true,
      }),
    ).items;
    const html = renderToStaticMarkup(
      createElement(ReadinessChecklist, { items, contentWidth: 872 }),
    );
    expect(html).toBe("");
  });
});
