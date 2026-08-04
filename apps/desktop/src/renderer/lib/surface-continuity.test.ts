import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_SHELL_LITERALS,
  COMPOSE_SURFACE_VT_CLASS,
  CONTENT_SURFACE_VT_CLASS,
  cssHasContentSurfaceTransition,
  cssHonorsReducedMotion,
  findBareUserFacingLiterals,
  PREMIUM_EASE_CLASS,
  SHELL_I18N_SURFACE_FILES,
} from "./surface-continuity";

const rendererRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(rel: string): string {
  return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
}

describe("surface-continuity helpers", () => {
  it("exports stable VT class names used by the shell", () => {
    expect(CONTENT_SURFACE_VT_CLASS).toBe("vt-content");
    expect(COMPOSE_SURFACE_VT_CLASS).toBe("vt-compose");
    expect(PREMIUM_EASE_CLASS).toBe("ease-premium");
    expect(SHELL_I18N_SURFACE_FILES.length).toBeGreaterThan(8);
    expect(ALLOWED_SHELL_LITERALS.has("Markdown")).toBe(true);
  });

  it("findBareUserFacingLiterals finds prose, ignores t() and keys", () => {
    const src = `
      const x = t("nav.seeAll");
      return (
        <div title="Command palette">
          <span>Go to</span>
          <button>{t("nav.home")}</button>
          {flag || "Deliverable"}
          {name ?? "Preview"}
        </div>
      );
    `;
    const hits = findBareUserFacingLiterals(src);
    expect(hits).toContain("Go to");
    expect(hits).toContain("Command palette");
    expect(hits).toContain("Deliverable");
    expect(hits).toContain("Preview");
    expect(hits).not.toContain("nav.seeAll");
    expect(hits).not.toContain("nav.home");
  });

  it("findBareUserFacingLiterals ignores comments and imports", () => {
    const src = `
      import { x } from "./path";
      // Go to the store
      /* Deliverable preview */
      const ok = true;
    `;
    expect(findBareUserFacingLiterals(src)).toEqual([]);
  });

  it("allows documented technical tokens", () => {
    const src = `<SelectItem value="markdown">Markdown</SelectItem>`;
    expect(findBareUserFacingLiterals(src)).toEqual([]);
  });

  it("cssHonorsReducedMotion requires reduced-motion gates", () => {
    expect(cssHonorsReducedMotion("color: red")).toBe(false);
    expect(
      cssHonorsReducedMotion(
        "@media (prefers-reduced-motion: reduce) { animation-duration: 0.01ms !important; }",
      ),
    ).toBe(true);
  });
});

describe("shipped surface continuity (structural)", () => {
  it("App marks the content column with vt-content", () => {
    const app = read("App.tsx");
    expect(app).toContain(CONTENT_SURFACE_VT_CLASS);
    expect(app).toContain("withViewTransition");
  });

  it("globals.css honors reduced-motion and content/compose transitions", () => {
    const css = read("styles/globals.css");
    expect(cssHonorsReducedMotion(css)).toBe(true);
    expect(cssHasContentSurfaceTransition(css)).toBe(true);
    expect(css).toMatch(/ease-premium|content-surface|compose-surface/);
  });

  it("browser split layout keeps chat column transition classes when open", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/browser-split-open|data-browser-open/);
    expect(ws).toMatch(/ease-premium/);
    expect(ws).toMatch(/BrowserPaneSlot/);
    expect(ws).toMatch(/chatSplitPct|DEFAULT_CHAT_SPLIT_PCT/);
  });

  it("shell surface files have zero bare user-facing English literals", () => {
    const offenders: string[] = [];
    for (const rel of SHELL_I18N_SURFACE_FILES) {
      const full = path.join(rendererRoot, rel);
      if (!fs.existsSync(full)) {
        offenders.push(`missing file: ${rel}`);
        continue;
      }
      const hits = findBareUserFacingLiterals(read(rel));
      for (const h of hits) offenders.push(`${rel}: ${JSON.stringify(h)}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
