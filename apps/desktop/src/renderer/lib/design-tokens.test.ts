import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rendererRoot = path.dirname(fileURLToPath(import.meta.url));
const componentsRoot = path.join(rendererRoot, "..");

const FORBIDDEN_PALETTE =
  /\b(text|bg|border|from|via|to)-(rose|amber|sky|violet|orange|zinc|emerald|red|green)-[0-9]/;

/** Arbitrary micro/chrome pixel font sizes — product UI must use the type scale. */
const ARBITRARY_PX_TYPE = /text-\[[0-9]+(\.[0-9]+)?px\]/;

/** Arbitrary rem display sizes — use 3xl/4xl tokens instead. */
const ARBITRARY_REM_TYPE = /text-\[[0-9]+(\.[0-9]+)?rem\]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      walk(p, out);
      continue;
    }
    if (!/\.(tsx|ts)$/.test(name)) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    out.push(p);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(componentsRoot, file);
}

describe("design token discipline", () => {
  it("globals define hairline ladder and VT content paint", () => {
    const css = fs.readFileSync(
      path.join(componentsRoot, "styles/globals.css"),
      "utf8",
    );
    expect(css).toMatch(/--hairline-quiet:/);
    expect(css).toMatch(/--hairline:/);
    expect(css).toMatch(/--hairline-strong:/);
    expect(css).toMatch(/\.vt-content\s*\{[^}]*background-color:\s*hsl\(var\(--background\)\)/s);
    // Content VT duration is tokenized (Phase 5 motion language).
    expect(css).toMatch(
      /content-surface[\s\S]*?animation-duration:\s*var\(--motion-duration-content\)|animation-duration:\s*160ms/,
    );
    expect(css).toMatch(/--motion-duration-content:\s*160ms/);
  });

  it("globals ship Deep Navy + Ice brand tokens and ice primary", () => {
    const css = fs.readFileSync(
      path.join(componentsRoot, "styles/globals.css"),
      "utf8",
    );
    // Explicit brand hex aliases (landing parity)
    expect(css).toMatch(/--color-midnight:\s*#050e21/);
    expect(css).toMatch(/--color-navy:\s*#07142c/);
    expect(css).toMatch(/--color-ink:\s*#0b1736/);
    expect(css).toMatch(/--color-panel:\s*#10213f/);
    expect(css).toMatch(/--color-ice:\s*#9fddff/);
    expect(css).toMatch(/--color-electric:\s*#4c8bff/);
    expect(css).toMatch(/--color-frost:\s*#d7e6ff/);
    expect(css).toMatch(/--color-success:\s*#67d9b5/);
    expect(css).toMatch(/--color-approval:\s*#f2b96b/);
    expect(css).toMatch(/--color-danger:\s*#f47c88/);
    // Primary maps to ice HSL; not warm sand 34 32%
    expect(css).toMatch(/--primary:\s*201\s+100%\s+81%/);
    expect(css).toMatch(/--primary-foreground:\s*221\s+74%\s+7%/);
    expect(css).toMatch(/--ring:\s*219\s+100%\s+65%/);
    expect(css).not.toMatch(/--primary:\s*34\s+32%/);
    expect(css).not.toMatch(/--primary-hover:\s*34\s+32%/);
    expect(css).not.toMatch(/#0e0e10/);
  });

  it("Electron window background uses midnight (no charcoal flash)", () => {
    const main = fs.readFileSync(
      path.join(componentsRoot, "../main/index.ts"),
      "utf8",
    );
    expect(main).toMatch(/backgroundColor:\s*"#050e21"/);
    expect(main).not.toMatch(/#0e0e10/);
  });

  it("tailwind exposes hairline colors, brand aliases, and display type steps", () => {
    const cfg = fs.readFileSync(
      path.join(componentsRoot, "../../tailwind.config.js"),
      "utf8",
    );
    expect(cfg).toMatch(/hairline:/);
    expect(cfg).toMatch(/"3xl"/);
    expect(cfg).toMatch(/"4xl"/);
    expect(cfg).toMatch(/midnight:/);
    expect(cfg).toMatch(/ice:/);
    expect(cfg).toMatch(/electric:/);
    // Ice primary glow, not warm sand rgba
    expect(cfg).toMatch(/primary-glow.*159,\s*221,\s*255/);
    expect(cfg).not.toMatch(/rgba\(160,\s*120,\s*55/);
  });

  it("chrome surfaces purge warm sand avatar glow and use ice/electric selection", () => {
    const stream = fs.readFileSync(
      path.join(componentsRoot, "components/task-stream.tsx"),
      "utf8",
    );
    expect(stream).not.toMatch(/rgba\(180,\s*130,\s*60/);
    expect(stream).toMatch(/rgba\(159,\s*221,\s*255/);

    const css = fs.readFileSync(
      path.join(componentsRoot, "styles/globals.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.nav-item-active\s*\{[^}]*background:\s*hsl\(var\(--primary\)/s,
    );

    const button = fs.readFileSync(
      path.join(componentsRoot, "components/ui/button.tsx"),
      "utf8",
    );
    expect(button).toMatch(/focus-visible:ring-ring/);
    expect(button).toMatch(/rgba\(159,\s*221,\s*255/);
  });

  it("high-visibility gates use Deep Navy + Ice (no warm sand leftovers)", () => {
    const empty = fs.readFileSync(
      path.join(componentsRoot, "components/empty-state.tsx"),
      "utf8",
    );
    // Free Desk: product-license activation UI is removed.
    expect(
      fs.existsSync(
        path.join(componentsRoot, "components/license-activation-screen.tsx"),
      ),
    ).toBe(false);
    const onboarding = fs.readFileSync(
      path.join(componentsRoot, "components/onboarding-wizard.tsx"),
      "utf8",
    );
    const pageHeader = fs.readFileSync(
      path.join(componentsRoot, "components/page-header.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(
      path.join(componentsRoot, "styles/globals.css"),
      "utf8",
    );

    // Empty state: ice icon well + soft ice hover glow
    expect(empty).toMatch(/border-primary\/25/);
    expect(empty).toMatch(/rgba\(159,\s*221,\s*255/);
    expect(empty).not.toMatch(/34\s+32%/);

    // Onboarding: midnight footer, success completed rows, ice selected cards
    expect(onboarding).toMatch(/--sidebar/);
    expect(onboarding).toMatch(/text-success/);
    expect(onboarding).toMatch(/border-primary\/45|bg-primary\/\[0\.1\]/);
    expect(onboarding).not.toMatch(/bg-black\/20/);

    // Page header ice accent rule
    expect(pageHeader).toMatch(/from-primary\/55/);

    // First-launch stage uses token orbs, not warm sand hsl(34…)
    expect(css).toMatch(/\.first-launch-orb-a/);
    expect(css).toMatch(/hsl\(var\(--primary\)/);
    expect(css).not.toMatch(/first-launch-orb-a[\s\S]*hsl\(34/s);
  });

  it("renderer product code does not use raw Tailwind palette colors", () => {
    const hits: string[] = [];
    for (const file of walk(componentsRoot)) {
      const src = fs.readFileSync(file, "utf8");
      if (FORBIDDEN_PALETTE.test(src)) hits.push(rel(file));
    }
    expect(hits).toEqual([]);
  });

  it("renderer product code does not use arbitrary text-[Npx] chrome sizes", () => {
    const hits: string[] = [];
    for (const file of walk(componentsRoot)) {
      const src = fs.readFileSync(file, "utf8");
      if (ARBITRARY_PX_TYPE.test(src)) hits.push(rel(file));
    }
    expect(hits).toEqual([]);
  });

  it("renderer product code does not use arbitrary text-[Nrem] display sizes", () => {
    const hits: string[] = [];
    for (const file of walk(componentsRoot)) {
      const src = fs.readFileSync(file, "utf8");
      if (ARBITRARY_REM_TYPE.test(src)) hits.push(rel(file));
    }
    expect(hits).toEqual([]);
  });

  it("Artifacts uses list + in-app detail (no type rail, no open-on-click)", () => {
    const src = fs.readFileSync(
      path.join(componentsRoot, "components/views/artifacts-view.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /hasArtifacts\s*=\s*(props\.artifacts\.length\s*>\s*0|visibleArtifacts\.length\s*>\s*0)/,
    );
    expect(src).toMatch(/showFilters\s*=\s*hasArtifacts/);
    expect(src).toMatch(/data-testid="artifacts-search-row"/);
    // Phase 2: single search — local Input only when hideLocalSearch is false.
    expect(src).toMatch(/hideLocalSearch/);
    expect(src).toMatch(/!props\.hideLocalSearch/);
    expect(src).toMatch(/data-testid="artifacts-local-search"/);
    expect(src).toMatch(/data-testid="artifact-list-row"/);
    expect(src).toMatch(/data-testid="artifacts-detail-panel"/);
    // Select row sets selection; reveal/download/copy live in the detail panel.
    expect(src).toMatch(/setSelectedId/);
    expect(src).toMatch(/onReveal|revealPath/);
    expect(src).toMatch(/media\.download/);
    expect(src).toMatch(/media\.copy/);
    expect(src).not.toMatch(/data-testid="artifacts-type-rail"/);
    expect(src).not.toMatch(/sm:grid-cols-2 xl:grid-cols-3/);
  });

  it("sidebar Sign-in is outline (demoted) when unsigned", () => {
    const src = fs.readFileSync(
      path.join(componentsRoot, "components/shell/app-sidebar.tsx"),
      "utf8",
    );
    expect(src).toMatch(/data-testid="sidebar-sign-in"/);
    // Both collapsed and expanded unsigned CTAs use outline, not default primary.
    const signInBlocks = src.split('data-testid="sidebar-sign-in"');
    expect(signInBlocks.length).toBeGreaterThan(1);
    expect(src).toMatch(
      /variant="outline"[\s\S]{0,120}data-testid="sidebar-sign-in"/,
    );
  });

  it("Preferences uses single-column stack (no uneven 2-col grid)", () => {
    const src = fs.readFileSync(
      path.join(
        componentsRoot,
        "components/views/settings/preferences-tab.tsx",
      ),
      "utf8",
    );
    expect(src).toMatch(/max-w-2xl/);
    expect(src).not.toMatch(/md:grid-cols-2/);
    expect(src).toMatch(/data-testid="preferences-tab"/);
  });

  it("shell chrome uses 8pt sizes", () => {
    const sidebar = fs.readFileSync(
      path.join(componentsRoot, "components/shell/app-sidebar.tsx"),
      "utf8",
    );
    const topbar = fs.readFileSync(
      path.join(componentsRoot, "components/shell/app-topbar.tsx"),
      "utf8",
    );
    expect(sidebar).toMatch(/collapsed \? "w-16" : "w-64"/);
    expect(topbar).toMatch(/\bh-14\b/);
  });
});
