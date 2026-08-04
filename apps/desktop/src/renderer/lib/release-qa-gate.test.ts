/**
 * Phase 5 deterministic release/QA fallback gate.
 *
 * When full Electron visual-qa hangs (firstWindow / gateway / teardown /
 * profile), this suite still fails on product regressions for the surfaces
 * named in the simplified-experience plan Phase 5 exit criteria:
 *   - console/asset/overflow harness exists (visual-qa.spec)
 *   - Home primary desk state
 *   - missing artifact graceful UI
 *   - intent chip select/clear wiring
 *   - work graph rendering
 *   - command palette ordering (daily before admin; setup demoted)
 *
 * Limitations (documented): does not launch Electron, does not capture
 * screenshots, does not exercise a signed-in local profile, and does not
 * observe live network asset 5xx. Prefer `pnpm visual-qa` when the environment
 * can open Electron.
 *
 *   pnpm --filter @grokdesk/desktop release-qa
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  orderedAdminActions,
  orderedDailyActions,
  shouldShowRunSetupInPalette,
} from "./command-palette-policy";
import { planHomeLanding } from "./home-landing-policy";
import type { WorkBoardSnapshot } from "./concurrent-work-board";
import {
  artifactAvailabilityFromLoad,
  isArtifactMissingError,
} from "./artifact-availability";
import { projectWorkGraph, WORK_GRAPH_STAGES } from "./work-graph";
import {
  clearComposerIntent,
  selectComposerIntent,
  emptyComposerModeState,
} from "./composer-intents";
import {
  motionClassesFor,
  motionDurationMs,
  shouldAnimateMotion,
} from "./motion-system";

const rendererRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const desktopRoot = path.join(rendererRoot, "../..");
const repoRoot = path.join(desktopRoot, "../..");

function readRenderer(rel: string): string {
  return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
}

function emptyBoard(partial: Partial<WorkBoardSnapshot> = {}): WorkBoardSnapshot {
  return {
    items: [],
    needsYouCount: 0,
    workingCount: 0,
    failedCount: 0,
    headline: "",
    ...partial,
  };
}

describe("release-qa-gate (deterministic fallback)", () => {
  it("README references existing local media and stable release asset names", () => {
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const localImages = [...readme.matchAll(/<img\s+[^>]*src="([^"]+)"/g)]
      .map((match) => match[1]!)
      .filter((source) => !/^https?:\/\//.test(source));
    expect(localImages.length).toBeGreaterThanOrEqual(7);
    for (const source of localImages) {
      expect(fs.existsSync(path.join(repoRoot, source)), source).toBe(true);
    }

    const staging = fs.readFileSync(
      path.join(repoRoot, "scripts/stage-free-release-assets.mjs"),
      "utf8",
    );
    for (const asset of [
      "GrokDesk-mac-arm64.dmg",
      "GrokDesk-mac-x64.dmg",
      "GrokDesk-win-x64.exe",
    ]) {
      expect(readme).toContain(asset);
      expect(staging).toContain(asset);
    }
    expect(readme).toContain("SHA256SUMS.txt");
  });

  it("package.json exposes visual-qa and release-qa scripts", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["visual-qa"]).toMatch(/visual-qa\.spec/);
    expect(pkg.scripts?.["release-qa"]).toMatch(/release-qa-gate|vitest/);
    expect(
      fs.existsSync(path.join(desktopRoot, "e2e/visual-qa.spec.ts")),
    ).toBe(true);
  });

  it("visual-qa.spec gates console errors, asset 5xx, overflow, home, intents, palette", () => {
    const spec = fs.readFileSync(
      path.join(desktopRoot, "e2e/visual-qa.spec.ts"),
      "utf8",
    );
    expect(spec).toMatch(/consoleErrors/);
    expect(spec).toMatch(/failedAssets|grokdesk-asset/);
    expect(spec).toMatch(/measureHorizontalOverflow|overflow/);
    expect(spec).toMatch(/01-home-desktop|home-desktop/);
    expect(spec).toMatch(/intent-chip|composer-intent/);
    expect(spec).toMatch(/command-palette|Meta\+k|Control\+k/);
    expect(spec).toMatch(/work-graph|data-work-graph/);
    expect(spec).toMatch(/soft-skip|skipReason|test\.skip/i);
  });

  it("Home primary desk: calm signed-in landing caps recommended actions", () => {
    const healthy = planHomeLanding({
      workBoard: emptyBoard(),
      resume: { type: "none" },
      recipes: [],
      discovery: [],
      recentDeliverables: [],
      staleTasks: [],
      hasNeedsYouNotice: false,
      hasRunningNotice: false,
    });
    expect(healthy.maxRecommendedActions).toBe(3);
    expect(healthy.showLiveWork).toBe(false);
    const home = readRenderer("components/views/home-view.tsx");
    expect(home).toMatch(/data-testid=\"home-desk\"/);
    expect(home).toMatch(/readinessBlocked/);
  });

  it("missing artifact is graceful (availability helpers + UI)", () => {
    expect(isArtifactMissingError("ENOENT: no such file")).toBe(true);
    expect(isArtifactMissingError("fetch failed: 500")).toBe(true);
    expect(
      artifactAvailabilityFromLoad({
        ok: false,
        errorMessage: "File not found",
      }),
    ).toBe("missing");
    const artifacts = readRenderer("components/views/artifacts-view.tsx");
    expect(artifacts).toMatch(/artifact-unavailable/);
    expect(artifacts).toMatch(/MOTION_SURFACE_CLASSES\.artifactReveal|motion-artifact-reveal/);
    // Task completion reveal uses the same motion surface on deliverables.
    const digest = readRenderer("components/deliverables-digest.tsx");
    expect(digest).toMatch(/MOTION_SURFACE_CLASSES\.artifactReveal|motion-artifact-reveal/);
  });

  it("intent chip select/clear is pure and wired", () => {
    const current = {
      effort: "normal" as const,
      rolePackId: null as string | null,
      planFirst: false,
    };
    const selected = selectComposerIntent(
      emptyComposerModeState(),
      "brief",
      current,
    );
    expect(selected.state.intentId).toBe("brief");
    const cleared = clearComposerIntent(selected.state, {
      effort: selected.setEffort ?? current.effort,
      rolePackId: selected.setRolePackId ?? current.rolePackId,
      planFirst: selected.setPlanFirst ?? current.planFirst,
    });
    expect(cleared.state.intentId).toBeNull();
    const home = readRenderer("components/views/home-view.tsx");
    expect(home).toMatch(/intent-chip-brief|intent-chip-\$\{/);
    expect(home).toMatch(/clearIntentMode|clearComposerIntent/);
    expect(home).toMatch(/intentChipMotionClass/);
  });

  it("work graph projects stages and rail renders markers", () => {
    expect(WORK_GRAPH_STAGES.length).toBeGreaterThanOrEqual(5);
    const view = projectWorkGraph({
      events: [],
      task: { status: "running", createdAt: "2026-07-31T00:00:00.000Z" },
    });
    expect(view.productState).toBeTruthy();
    expect(view.stagesReached).toBeDefined();
    const rail = readRenderer("components/conversation/work-graph-rail.tsx");
    expect(rail).toMatch(/data-work-graph/);
    expect(rail).toMatch(/data-work-graph-stages/);
    expect(rail).toMatch(/motion-work-graph|workGraphStageMotionClass/);
  });

  it("command palette ranks daily before admin and demotes setup when healthy", () => {
    expect(shouldShowRunSetupInPalette({ readinessBlocked: false })).toBe(
      false,
    );
    expect(shouldShowRunSetupInPalette({ readinessBlocked: true })).toBe(true);
    const daily = orderedDailyActions({
      signedIn: true,
      hasInbox: true,
      hasShortcuts: true,
    });
    expect(daily[0]).toBe("new_task");
    const adminHealthy = orderedAdminActions({
      readinessBlocked: false,
      hasUsage: true,
      hasBilling: true,
      hasDocs: true,
      hasSetup: true,
      hasSettings: true,
    });
    expect(adminHealthy).not.toContain("run_setup");
    const adminBlocked = orderedAdminActions({
      readinessBlocked: true,
      hasUsage: true,
      hasBilling: true,
      hasDocs: true,
      hasSetup: true,
      hasSettings: true,
    });
    expect(adminBlocked).toContain("run_setup");
    const palette = readRenderer("components/command-palette.tsx");
    expect(palette.indexOf('data-palette-section="daily"')).toBeLessThan(
      palette.indexOf('data-palette-section="admin"'),
    );
  });

  it("motion language is centralized and reduced-motion disables nonessential", () => {
    expect(shouldAnimateMotion(true, "navigation")).toBe(false);
    expect(motionDurationMs("palette", true)).toBe(0);
    expect(motionClassesFor("artifactReveal", true)).not.toMatch(
      /animate-fade-in/,
    );
    const css = readRenderer("styles/globals.css");
    expect(css).toMatch(/--motion-duration-fast/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("Autopilot confirmation uses i18n keys without bare English fallbacks", () => {
    const en = JSON.parse(
      fs.readFileSync(
        path.join(rendererRoot, "i18n/locales/en.json"),
        "utf8",
      ),
    ) as { onboarding?: { policyAutopilotDesc?: string } };
    expect(en.onboarding?.policyAutopilotDesc?.length).toBeGreaterThan(10);
    const app = readRenderer("App.tsx");
    expect(app).toMatch(/onboarding\.policyAutopilotDesc/);
    expect(app).not.toMatch(
      /Autopilot can delete and overwrite inside allowed folders/,
    );
  });
});
