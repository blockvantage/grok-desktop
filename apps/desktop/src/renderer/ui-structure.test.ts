import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rendererRoot = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return fs.readFileSync(path.join(rendererRoot, rel), "utf8");
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(rendererRoot, rel));
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  // Sorted: readdirSync order is filesystem-dependent (e.g. not alphabetical
  // on ext4), and the exemptHits assertions below are order-sensitive
  // toEqual checks — an unsorted walk would make them flaky across OSes.
  // Uses a strict code-unit compare (not localeCompare): locale-aware ICU
  // collation can ignore punctuation like hyphens in some locales/runtimes,
  // which would reintroduce cross-environment nondeterminism.
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

// path.relative() returns OS-native separators — backslashes on Windows.
// Every allowlist below (DOT_GLOW_EXEMPT, MUTED_DOT_GLOW_EXEMPT) is keyed by
// forward-slash strings, and messages should read the same on every OS, so
// normalize once at every call site instead of matching path.sep per-set.
function relPosix(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

describe("renderer visual structure (design system)", () => {
  it("does not call retired gateway licensing or disk-manifest RPCs", () => {
    const settings = read("components/views/settings-view.tsx");
    expect(settings).not.toContain('"license.status"');
    expect(settings).not.toContain('"updates.manifest"');
  });

  it("has design tokens", () => {
    const css = read("styles/globals.css");
    expect(css).toMatch(/--primary:/);
    expect(css).toMatch(/--radius:/);
    expect(css).toMatch(/--sidebar:/);
    expect(css).toMatch(/--hairline-quiet:/);
    expect(css).toMatch(/--hairline-strong:/);
    expect(css).toMatch(/background-color:\s*hsl\(var\(--background\)\)/);
  });

  it("ships shell + tab views", () => {
    expect(exists("components/shell/app-sidebar.tsx")).toBe(true);
    expect(exists("components/shell/app-topbar.tsx")).toBe(true);
    for (const v of [
      "home-view",
      "tasks-view",
      "task-workspace-view",
      "scheduled-view",
      "artifacts-view",
      "memory-view",
      "settings-view",
    ]) {
      expect(exists(`components/views/${v}.tsx`)).toBe(true);
    }
  });

  it("App composes shell and views", () => {
    const app = read("App.tsx");
    expect(app).toMatch(/AppSidebar/);
    expect(app).toMatch(/HomeView/);
    expect(app).toMatch(/TasksView/);
    expect(app).toMatch(/TaskWorkspaceView/);
    expect(app).toMatch(/ScheduledView/);
    expect(app).toMatch(/ArtifactsView/);
    expect(app).toMatch(/MemoryView/);
    expect(app).toMatch(/SettingsView/);
    expect(app).toMatch(
      /<TaskWorkspaceView\s+key=\{selectedChat\?\.id\s*\?\?\s*workspaceTask\.id\}/,
    );
    expect(app).not.toMatch(/—/);
  });

  it("sidebar footer mounts the always-visible contribute / support menu", () => {
    const sidebar = read("components/shell/app-sidebar.tsx");
    expect(exists("components/shell/support-contribute-menu.tsx")).toBe(true);
    expect(exists("lib/contribute.ts")).toBe(true);
    expect(sidebar).toMatch(/SupportContributeMenu/);
    expect(sidebar).toMatch(/collapsed=\{collapsed\}/);
  });

  it("App shell surfaces security update banner and restart dialog (open-source, no product-key gate)", () => {
    const app = read("App.tsx");
    expect(exists("components/security-update-banner.tsx")).toBe(true);
    expect(exists("components/update-restart-dialog.tsx")).toBe(true);
    expect(exists("hooks/use-update-status.ts")).toBe(true);
    expect(app).toMatch(/useUpdateStatus/);
    expect(app).toMatch(/SecurityUpdateBanner/);
    expect(app).toMatch(/shouldShowSecurityUpdateBanner/);
    expect(app).toMatch(/UpdateRestartDialog/);
    expect(app).toMatch(/shouldShowUpdateRestartDialog/);
    // Open-source: product-key activation gate is removed from the shell.
    expect(app).not.toMatch(/entitlement-activation-gate/);
    expect(app).not.toMatch(/LicenseActivationScreen/);
    const bannerIdx = app.indexOf("<SecurityUpdateBanner");
    const dialogIdx = app.indexOf("<UpdateRestartDialog");
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(dialogIdx).toBeGreaterThan(-1);
  });

  it("preload does not expose product-license activation IPC (free Desk)", () => {
    const preload = read("../preload/index.ts");
    expect(preload).not.toMatch(/activateFromClipboard/);
    expect(preload).not.toMatch(/activateFromFile/);
    expect(preload).not.toMatch(/productKey/);
    expect(preload).not.toMatch(/ENTITLEMENT_MAIN_IPC/);
  });

  it("App shell has no license readiness or product-key imports", () => {
    const app = read("App.tsx");
    expect(app).not.toMatch(/useEntitlement|LicenseReadOnlyBanner|open-license/);
    expect(app).not.toMatch(/licenseActive|licenseExpired|licenseReadOnly/);
    expect(exists("components/license-activation-screen.tsx")).toBe(false);
    expect(exists("components/license-read-only-banner.tsx")).toBe(false);
    expect(exists("components/views/settings/license-tab.tsx")).toBe(false);
  });

  it("ships expanded shadcn ui kit", () => {
    for (const file of [
      "dropdown-menu.tsx",
      "tabs.tsx",
      "table.tsx",
      "switch.tsx",
      "alert-dialog.tsx",
      "collapsible.tsx",
      "breadcrumb.tsx",
      "card.tsx",
      "button.tsx",
    ]) {
      expect(exists(`components/ui/${file}`)).toBe(true);
    }
  });

  it("task stream collapses tokens", () => {
    const stream = read("components/task-stream.tsx");
    expect(stream).toMatch(/collapseEventsToBlocks/);
    expect(stream).not.toMatch(/JSON\.stringify\(e\.payload\)/);
  });

  it("task workspace is answer-first (deliverables over event counts)", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    const parts = read("components/views/task-workspace-parts.tsx");
    expect(ws).toMatch(/What Grok made|workspace\.deliverables|Deliverables/);
    expect(ws).toMatch(/extractResultSummary/);
    expect(ws).toMatch(/workspace\.readFile/);
    // Conversation-only stream (density toggles for tools/work-log removed)
    expect(ws).toMatch(/density:\s*StreamDensity\s*=\s*"chat"|StreamDensity = "chat"/);
    expect(ws).not.toMatch(/setDensity/);
    // No longer lead with raw event tallies as the hero metric
    expect(ws).not.toMatch(/label="Events"/);
    // Deliverables are artifacts only — listFiles may exist for @-mentions on
    // the project root, but must not merge inventory into deliverables.
    expect(`${ws}\n${parts}`).toMatch(/source: "artifact"/);
    expect(ws).toMatch(/deliverablesEmpty|deliverablesLive/);
    expect(ws).toMatch(/ComposerAttachments|Paperclip|pickFiles/);
    expect(ws).toMatch(/FileMentionMenu|extractMentionQuery/);
  });

  it("home composer wires attach, drop, paste, and mentions", () => {
    const home = read("components/views/home-view.tsx");
    expect(home).toMatch(/ComposerAttachments|Paperclip|pickFiles/);
    expect(home).toMatch(/FileMentionMenu|extractMentionQuery/);
    expect(home).toMatch(/onDrop|onPaste/);
    expect(home).toMatch(/keepAudio|onAudioAttached|level/);
  });

  it("ships agent browser globe and pane", () => {
    expect(exists("components/browser-globe.tsx")).toBe(true);
    expect(exists("components/browser-pane-slot.tsx")).toBe(true);
    expect(exists("components/conversation/worker-strip.tsx")).toBe(true);
    expect(exists("lib/browser-ui.ts")).toBe(true);
    expect(exists("lib/subagent-hud.ts")).toBe(true);
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/BrowserGlobe/);
    expect(ws).toMatch(/BrowserPaneSlot/);
    expect(ws).not.toMatch(/SubagentHudControl/);
    expect(ws).toMatch(/reduceBrowserUi/);
    // Globe capability state attribute (E2E asserts this on mounted control)
    const globe = read("components/browser-globe.tsx");
    expect(globe).toMatch(/data-browser-state/);
  });

  it("renders the canonical calm conversation with per-turn workers", () => {
    for (const file of [
      "conversation-turn.tsx",
      "live-work-card.tsx",
      "worker-strip.tsx",
      "work-details.tsx",
    ]) {
      expect(exists(`components/conversation/${file}`)).toBe(true);
    }
    const ws = read("components/views/task-workspace-view.tsx");
    const stream = read("components/task-stream.tsx");
    expect(ws).toMatch(/projectConversation/);
    expect(ws).toMatch(/conversation=\{conversation\}/);
    expect(stream).toMatch(/ConversationTurn/);
    expect(stream).toMatch(/data-canonical-conversation/);
    expect(stream).toMatch(/shouldVirtualizeConversation/);
    expect(stream).toMatch(/ConversationTimelineRail/);
    expect(stream).not.toMatch(/<ThinkingTrail/);
    expect(stream).not.toMatch(/conversation\.queued\.map/);
    expect(stream).not.toMatch(/data-queued-turns/);
    const turn = read("components/conversation/conversation-turn.tsx");
    expect(turn).toMatch(/data-turn-response-slot/);
    expect(turn).not.toMatch(/approval-arrive border-warning/);
    const approvalBannerStart = ws.indexOf("{pendingApprovalTarget && (");
    const approvalBannerEnd = ws.indexOf(
      "{/* The conversation is the hero",
      approvalBannerStart,
    );
    const approvalBanner = ws.slice(approvalBannerStart, approvalBannerEnd);
    expect(approvalBanner).toMatch(/data-approval-jump/);
    expect(approvalBanner).not.toMatch(/runApprove|runReject|<Button/);
  });

  it("fetches and projects the same full workspace thread", () => {
    const app = read("App.tsx");
    const workspace = read("components/views/task-workspace-view.tsx");
    expect(app).toMatch(/const workspaceThreadTasks\s*=\s*useMemo/);
    expect(app).toMatch(
      /\{\s*events,\s*eventsByTask,\s*loading:\s*eventsLoading/,
    );
    expect(app).toMatch(/turns:\s*workspaceThreadTasks/);
    expect(app).toMatch(/eventsByTask=\{eventsByTask\}/);
    expect(app).toMatch(/threadTasks=\{workspaceThreadTasks\}/);
    expect(workspace).toMatch(/eventsByTask:\s*Record<string, TaskEvent\[\]>/);
    expect(workspace).toMatch(/eventsByTask:\s*props\.eventsByTask/);
    expect(workspace).not.toMatch(/eventsByTask\[event\.taskId\]/);
  });

  it("shows the canonical loader before projecting existing cold turns", () => {
    const stream = read("components/task-stream.tsx");
    expect(stream).toMatch(
      /conversation\s*&&\s*density\s*!==\s*"log"\)\s*\{\s*if\s*\(eventsLoading\)/,
    );
  });

  it("ships conversation loading path (no false empty flash while events fetch)", () => {
    expect(exists("components/conversation-loading.tsx")).toBe(true);
    expect(exists("hooks/use-chat-events.ts")).toBe(true);
    expect(exists("lib/chat-events-cache.ts")).toBe(true);
    const loader = read("components/conversation-loading.tsx");
    expect(loader).toMatch(/data-conversation-loading/);
    expect(loader).toMatch(/conversation-loading-skeleton/);
    expect(loader).not.toMatch(/conversation-loading-sheen|animate-pulse/);
    expect(loader).not.toMatch(/conversation-loading-(?:orbit|glow|mark)/);
    const hook = read("hooks/use-chat-events.ts");
    expect(hook).toMatch(/loading:\s*boolean/);
    expect(hook).toMatch(/touchChatCache|createMultiChatEventsCache/);
    expect(hook).not.toMatch(/normalizeEventOwner/);
    const stream = read("components/task-stream.tsx");
    expect(stream).toMatch(/eventsLoading/);
    expect(stream).toMatch(/ConversationLoading/);
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/eventsLoading/);
  });

  it("ships account state machine and durable queue store", () => {
    expect(exists("lib/account-state.ts")).toBe(true);
    expect(exists("lib/message-queue-store.ts")).toBe(true);
    const account = read("lib/account-state.ts");
    expect(account).toMatch(/signed_out/);
    expect(account).toMatch(/reauth_required/);
    expect(account).toMatch(/phaseFromAuthStatus/);
    const queueStore = read("lib/message-queue-store.ts");
    expect(queueStore).toMatch(/localStorage|STORAGE_KEY/);
  });

  it("queue UI can edit attachmentPaths via product path", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    const row = read("components/conversation/queued-message-row.tsx");
    const outbox = read("components/conversation/conversation-outbox.tsx");
    expect(row).toMatch(/data-queue-add-attachment/);
    expect(row).toMatch(/data-queue-attachment/);
    expect(row).toMatch(/onEdit\(item\.id,\s*\{\s*attachmentPaths/);
    expect(row).toMatch(/onPickFiles\(\)/);
    // Task 16: rows render via ConversationOutbox extract.
    expect(ws + outbox).toMatch(/onEdit=\{editQueued\}|onEdit=\{props\.onEdit\}/);
    expect(ws).toMatch(/onPickFiles=\{pickFiles\}/);
    expect(outbox).toMatch(/QueuedMessageRow/);
  });

  it("Task 13: queue lifecycle + offline composer feedback use pure planners", () => {
    const row = read("components/conversation/queued-message-row.tsx");
    const ws = read("components/views/task-workspace-view.tsx");
    const pure = read("lib/queue-row-presentation.ts");
    expect(pure).toMatch(/planQueueLifecycleStatus/);
    expect(pure).toMatch(/planComposerOfflineAction/);
    expect(pure).toMatch(/planEnqueueRejectionFeedback/);
    expect(row).toMatch(/planQueueLifecycleStatus/);
    expect(row).toMatch(/queueRemoveShort|queueRemove/);
    // Task 16: offline action lives on ConversationStatus extract.
    const status = read("components/conversation/conversation-status.tsx");
    expect(status + ws).toMatch(/planComposerOfflineAction/);
    expect(ws).toMatch(/planEnqueueRejectionFeedback/);
    expect(ws + status).toMatch(
      /composer-delivery-feedback|data-composer-enqueue-error/,
    );
    expect(ws).toMatch(/engineReady/);
    expect(ws).toMatch(/ConversationOutbox|ConversationComposer|ConversationStatus/);
    expect(ws).toMatch(/ComposerRunOptions/);
    expect(ws).toMatch(/next-reply-will-use/);
    expect(read("components/views/home-view.tsx")).toMatch(/ComposerRunOptions/);
  });

  it("only uses real Tailwind opacity steps (multiples of 5) in slash modifiers", () => {
    const offenders: string[] = [];
    for (const file of walkSourceFiles(rendererRoot)) {
      const src = fs.readFileSync(file, "utf8");
      // Tailwind 3 only ships slash-opacity steps in multiples of 5; anything
      // else compiles to NO CSS — use bracketed `/[0.NN]` instead. The
      // `(?<![\w-])` lookbehind skips tailwindcss-animate fraction utilities
      // like `slide-in-from-left-1/2` (ui/dialog.tsx, ui/alert-dialog.tsx); the
      // `(?![\d\]])` lookahead skips the bracketed arbitrary-alpha fix form.
      // (Tailwind 3.3's `text-sm/6` line-height shorthand would also
      // false-positive here — use `leading-*` instead.)
      for (const m of src.matchAll(
        /(?<![\w-])(?:bg|text|border|ring|from|to|via)-[a-zA-Z][\w-]*\/(\d{1,3})(?![\d\]])/g,
      )) {
        const n = Number(m[1]);
        if (n % 5 !== 0 || n > 100)
          offenders.push(`${relPosix(rendererRoot, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses text-destructive-text for destructive foreground text", () => {
    // `.dot-status` (styles/globals.css:419-426) has no text content —
    // `text-*` there only feeds `box-shadow: 0 0 8px currentColor`, a glow
    // that must match the dot's own `bg-destructive` fill, not a
    // contrast-checked foreground. These two sites pair a literal
    // `bg-destructive text-destructive` for that reason and are exempted
    // by file AND per-line pairing, not by pattern alone — dropping the
    // per-line check (e.g. "simplifying" to a whole-file test) would let
    // the exemption silently swallow real destructive text added anywhere
    // else in one of these two files.
    const DOT_GLOW_EXEMPT = new Set([
      "components/browser-pane-slot.tsx",
      "lib/status-styles.ts",
    ]);
    const offenders: string[] = [];
    const exemptHits: string[] = [];
    for (const file of walkSourceFiles(rendererRoot)) {
      const rel = relPosix(rendererRoot, file);
      const src = fs.readFileSync(file, "utf8");
      // Match per line (not per whole-file source) so the dot-pairing check
      // below only exempts an occurrence that actually sits on a
      // `bg-destructive text-destructive` line — it can't swallow unrelated
      // real destructive text elsewhere in an exempt file.
      for (const line of src.split("\n")) {
        // Bare `text-destructive` only hits 4.0-4.45:1 contrast on the app's
        // dark surfaces (fails WCAG AA for body text). `--destructive-text`
        // (7.55:1) is the token for destructive foreground text — use the
        // `text-destructive-text` utility, not the raw class or either
        // arbitrary escape hatch: `text-[hsl(var(--destructive-text))]`
        // (redundant with the real utility) or `text-[hsl(var(--destructive))]`
        // (the low-contrast color itself, smuggled in unbracketed by name).
        // The `(?![-\w])` lookahead skips `text-destructive-foreground` and
        // `text-destructive-text` itself.
        for (const m of line.matchAll(
          /text-destructive(?![-\w])|text-\[hsl\(var\(--destructive-text\)\)\]|text-\[hsl\(var\(--destructive\)\)\]/g,
        )) {
          if (DOT_GLOW_EXEMPT.has(rel) && /bg-destructive text-destructive/.test(line)) {
            exemptHits.push(`${rel}: ${line.trim()}`);
            continue;
          }
          offenders.push(`${rel}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // Named, not counted: a third dot-pairing site (or a second one added to
    // an already-exempt file) or a stale/removed allowlist entry fails with
    // the offending site's own path and line, not "expected 3 to be 2".
    expect(exemptHits).toEqual([
      'components/browser-pane-slot.tsx: ? "bg-destructive text-destructive"',
      'lib/status-styles.ts: status === "failed" && "bg-destructive text-destructive",',
    ]);
  });

  it("never dims muted-foreground below AA (alpha < 85 banned)", () => {
    // `--muted-foreground` itself is tuned to 7.33:1 on dark surfaces (AA for
    // body text). Slash-opacity utilities multiply that contrast down —
    // alpha-composited over --background, `/70` lands around 4.1:1 and `/50`
    // around 2.6:1, both under the 4.5:1 AA floor. Hierarchy (a caption vs.
    // a label) has to come from size/weight, not from dimming an
    // already-muted token further. `/85` and up stay legal (H-8); this bans
    // every dimmer step, decimal or bracketed (including `%`) alike.
    //
    // `.dot-status` (styles/globals.css:419-426) has no text content —
    // `text-*` there only feeds `box-shadow: 0 0 8px currentColor`, a glow
    // that must match the dot's own `bg-muted-foreground` fill, not a
    // contrast-checked foreground (same principle as the destructive-text
    // dot exemption above). These four sites pair a literal
    // `bg-muted-foreground/NN text-muted-foreground/NN` for that reason and
    // are exempted by file AND per-line pairing, not by pattern alone —
    // dropping the per-line check (e.g. "simplifying" to a whole-file test)
    // would let the exemption silently swallow real dimmed muted text added
    // anywhere else in one of these four files.
    const MUTED_DOT_GLOW_EXEMPT = new Set([
      "components/browser-pane-slot.tsx",
      "components/desktop-control-hud.tsx",
      "components/views/settings/account-tab.tsx",
      "lib/status-styles.ts",
    ]);
    const offenders: string[] = [];
    const exemptHits: string[] = [];
    for (const file of walkSourceFiles(rendererRoot)) {
      const rel = relPosix(rendererRoot, file);
      const src = fs.readFileSync(file, "utf8");
      // Match per line (not per whole-file source) so the dot-pairing check
      // below only exempts an occurrence that actually sits on a
      // `bg-muted-foreground/NN text-muted-foreground/NN` line — it can't
      // swallow unrelated real dimmed text elsewhere in an exempt file.
      for (const line of src.split("\n")) {
        const isExemptLine =
          MUTED_DOT_GLOW_EXEMPT.has(rel) &&
          /bg-muted-foreground\/\d+ text-muted-foreground\/\d+/.test(line);
        // Plain step form: text-muted-foreground/70
        for (const m of line.matchAll(/text-muted-foreground\/(\d{1,3})(?!\d)/g)) {
          if (Number(m[1]) >= 85) continue;
          if (isExemptLine) {
            exemptHits.push(`${rel}: ${line.trim()}`);
            continue;
          }
          offenders.push(`${rel}: ${m[0]}`);
        }
        // Bracketed arbitrary form: text-muted-foreground/[0.55] or /[55%]
        for (const m of line.matchAll(
          /text-muted-foreground\/\[(\d*\.?\d+)(%?)\]/g,
        )) {
          const alpha = m[2] === "%" ? Number(m[1]) / 100 : Number(m[1]);
          if (alpha >= 0.85) continue;
          if (isExemptLine) {
            exemptHits.push(`${rel}: ${line.trim()}`);
            continue;
          }
          offenders.push(`${rel}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // Named, not counted: a fifth dot-pairing site (or a second one added to
    // an already-exempt file) or a stale/removed allowlist entry fails with
    // the offending site's own path and line, not "expected 4 to be N".
    expect(exemptHits).toEqual([
      'components/browser-pane-slot.tsx: : "bg-muted-foreground/50 text-muted-foreground/50",',
      'components/desktop-control-hud.tsx: ? "dot-status bg-muted-foreground/70 text-muted-foreground/70"',
      'components/views/settings/account-tab.tsx: : "dot-status h-1.5 w-1.5 bg-muted-foreground/50 text-muted-foreground/50"',
      'lib/status-styles.ts: status === "cancelled" && "bg-muted-foreground/50 text-muted-foreground/50",',
    ]);
  });
});

describe("Wave I/T parity structure", () => {
  it("ships readiness checklist, protection chip, degraded label components", () => {
    expect(exists("components/readiness-checklist.tsx")).toBe(true);
    expect(exists("components/protection-chip.tsx")).toBe(true);
    expect(exists("components/degraded-mode-label.tsx")).toBe(true);
    expect(exists("lib/readiness-ui.ts")).toBe(true);
    expect(exists("lib/protection-chip.ts")).toBe(true);
    expect(exists("lib/approval-card-ui.ts")).toBe(true);
    expect(exists("lib/degraded-mode-ui.ts")).toBe(true);
    expect(exists("lib/conversation-noun.ts")).toBe(true);
  });

  it("phase-1 truth: signed-in projection, missing-artifact helpers, visual QA harness", () => {
    expect(exists("lib/account-signed-in.ts")).toBe(true);
    expect(exists("lib/artifact-availability.ts")).toBe(true);
    expect(exists("lib/readiness-layout.ts")).toBe(true);
    const readiness = read("components/readiness-checklist.tsx");
    expect(readiness).toMatch(/min-w-0/);
    expect(readiness).toMatch(/flex-wrap/);
    expect(readiness).toMatch(/readiness-collapsed-ctas|readiness-cta-/);
    const artifacts = read("components/views/artifacts-view.tsx");
    expect(artifacts).toMatch(/artifact-unavailable|ArtifactUnavailableState/);
    expect(artifacts).toMatch(/removeFromList|unavailableBadge/);
    const app = read("App.tsx");
    expect(app).toMatch(/isAccountSignedIn|readinessSignInFlags|shellReadinessInput/);
    expect(app).toMatch(/effectiveAuth/);
    // Visual QA command exists (package script + e2e spec)
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rendererRoot, "../../package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["visual-qa"]).toMatch(/visual-qa/);
    expect(
      fs.existsSync(path.join(rendererRoot, "../../e2e/visual-qa.spec.ts")),
    ).toBe(true);
  });

  it("phase-2 desk: healthy Home hides setup primary, caps recommended actions, demotes palette admin", () => {
    expect(exists("lib/home-landing-policy.ts")).toBe(true);
    expect(exists("lib/command-palette-policy.ts")).toBe(true);
    expect(exists("lib/view-search-policy.ts")).toBe(true);
    expect(exists("lib/sidebar-chat-sections.ts")).toBe(true);
    expect(exists("lib/home-recent-tasks.ts")).toBe(true);

    const home = read("components/views/home-view.tsx");
    expect(home).toMatch(/data-testid=\"home-desk\"/);
    expect(home).toMatch(/landing\.showSmartStarts/);
    expect(home).toMatch(/maxRecommendedActions/);
    expect(home).toMatch(/isReadinessBlocked/);
    // Setup/readiness is not always painted — only when blocked.
    expect(home).toMatch(/readinessBlocked\s*\?/);
    // Recommended actions capped at 3 via policy + slice.
    expect(home).toMatch(/slice\(0,\s*landing\.maxRecommendedActions\)|maxRecommendedActions/);

    const landing = read("lib/home-landing-policy.ts");
    expect(landing).toMatch(/maxRecommendedActions\s*=\s*3/);
    expect(landing).toMatch(/showSmartStarts/);

    const palette = read("components/command-palette.tsx");
    expect(palette).toMatch(/shouldShowRunSetupInPalette/);
    expect(palette).toMatch(/orderedDailyActions|orderedAdminActions/);
    expect(palette).toMatch(/data-palette-section=\"daily\"/);
    expect(palette).toMatch(/data-palette-section=\"admin\"/);
    expect(palette).toMatch(/data-palette-demoted/);
    expect(palette).toMatch(/readinessBlocked/);
    // Settings demoted out of primary nav into admin
    expect(palette).toMatch(/PALETTE_PRIMARY_NAV_IDS|open_settings/);
    expect(palette).toMatch(/data-palette-action=\"open_settings\"/);

    const app = read("App.tsx");
    expect(app).toMatch(/readinessBlocked=\{/);
    expect(app).toMatch(/hideLocalSearch/);
    expect(app).toMatch(/shouldShowTopbarSearch/);

    const sidebar = read("components/shell/app-sidebar.tsx");
    expect(sidebar).toMatch(/partitionSidebarChats/);
    expect(sidebar).toMatch(/sidebar-needs-review|needsReview/);
    expect(sidebar).toMatch(/data-needs-input/);
    expect(app).toMatch(/projectWaitingOnYou/);
    expect(app).toMatch(/needsYouItemsFromWaiting/);
    expect(app).toMatch(/waitingOnYou\.inboxBadge/);
    const queueRow = read("components/conversation/queued-message-row.tsx");
    expect(queueRow).toMatch(/sendNowSupported/);
    expect(queueRow).toMatch(/queueSendNowUnavailable/);

    const artifacts = read("components/views/artifacts-view.tsx");
    expect(artifacts).toMatch(/hideLocalSearch/);
    // Topbar owns search; local field gated (no competing always-on Input).
    expect(artifacts).toMatch(/!props\.hideLocalSearch/);
    expect(artifacts).toMatch(/data-testid="artifacts-local-search"/);
    // App prefers policy over a hard-coded second field.
    expect(app).toMatch(/shouldShowViewLocalSearch/);
    expect(app).toMatch(/hideLocalSearch=\{!shouldShowViewLocalSearch/);

    const tasks = read("components/views/tasks-view.tsx");
    expect(tasks).toMatch(/\"failed\"/);
    expect(tasks).toMatch(/tasks\.failed/);
    // Tasks: filter via topbar query only — no view-local search Input/callback.
    expect(tasks).toMatch(/search: string/);
    expect(tasks).not.toMatch(/\bonSearch\b/);
    expect(tasks).not.toMatch(/from \"@\/components\/ui\/input\"/);
    expect(tasks).not.toMatch(/data-testid=.*search/);
  });

  it("phase-2 desk: home policy, sidebar needs-review, palette ranking, single artifacts search", () => {
    expect(exists("lib/home-landing-policy.ts")).toBe(true);
    expect(exists("lib/home-recent-tasks.ts")).toBe(true);
    expect(exists("lib/sidebar-chat-sections.ts")).toBe(true);
    expect(exists("lib/command-palette-policy.ts")).toBe(true);
    expect(exists("lib/view-search-policy.ts")).toBe(true);

    const home = read("components/views/home-view.tsx");
    expect(home).toMatch(/planHomeLanding/);
    expect(home).toMatch(/recentTasksForHomeDesk/);
    expect(home).toMatch(/landing\.showSmartStarts/);
    expect(home).toMatch(/maxRecommendedActions/);
    // Readiness only when blocked — not always-on admin surface
    expect(home).toMatch(/readinessBlocked/);
    expect(home).toMatch(/ReadinessChecklist/);

  });

  it("phase-3: intent chips, expand-on-send, memory suggestions review", () => {
    expect(exists("lib/composer-intents.ts")).toBe(true);
    expect(exists("lib/memory-suggestions.ts")).toBe(true);

    const intents = read("lib/composer-intents.ts");
    expect(intents).toMatch(/COMPOSER_INTENT_CATALOG/);
    expect(intents).toMatch(/expandIntentGoal|expandComposerGoal/);
    expect(intents).toMatch(/brief/);
    expect(intents).toMatch(/research/);
    expect(intents).toMatch(/schedule/);
    expect(intents).toMatch(/summarize/);

    const home = read("components/views/home-view.tsx");
    expect(home).toMatch(/composer-intent-chips|home-workflow-intents/);
    expect(home).toMatch(/home-research-deeply/);
    expect(home).toMatch(/\/deep-research /);
    expect(home).toMatch(/home-create-image/);
    expect(home).toMatch(/home-create-video/);
    expect(home).toMatch(/MediaStudioControls/);
    expect(home).toMatch(/\/image /);
    expect(home).toMatch(/\/video /);

    expect(exists("components/media-studio-controls.tsx")).toBe(true);
    expect(intents).toMatch(/id: "video"/);
    expect(home).toMatch(/intent-chip-/);
    expect(home).toMatch(/onComposerIntent|composerIntentId/);
    expect(exists("components/views/memory-view.tsx")).toBe(true);
    const memoryView = read("components/views/memory-view.tsx");
    expect(memoryView).toMatch(/weekly-recap-card/);
    expect(read("components/conversation/conversation-turn.tsx")).toMatch(
      /remember-answer/,
    );
    expect(home).toMatch(/clearComposerIntent|selectComposerIntent/);

    const create = read("lib/create-task-optimistic.ts");
    expect(create).toMatch(/expandComposerGoal|intentId/);
    expect(create).toMatch(/weaveMediaStudioGoal|weaveFollowUpComposerGoal/);

    const workspace = read("components/views/task-workspace-view.tsx");
    expect(workspace).toMatch(/weaveFollowUpComposerGoal/);
    expect(workspace).toMatch(/media-studio-controls|MediaStudioControls/);

    const memory = read("components/views/memory-view.tsx");
    expect(memory).toMatch(/memory-suggestions/);
    expect(memory).toMatch(/onApproveSuggestion/);
    expect(memory).toMatch(/onDismissSuggestion/);

    const appPhase3 = read("App.tsx");
    expect(appPhase3).toMatch(/createSuggestionFromTakeaways|onRememberText/);
    expect(appPhase3).toMatch(/approveMemorySuggestion/);
    expect(appPhase3).toMatch(/weeklyRecap|buildWeeklyRecap/);
    expect(appPhase3).toMatch(/memory\.upsert/);
    expect(appPhase3).toMatch(/composerIntentId|setComposerIntentId/);
    expect(appPhase3).toMatch(/mediaStudio/);
    expect(appPhase3).toMatch(/sessions\.search|searchConversations/);
    expect(appPhase3).toMatch(/resetToAuto|onResetChatTitle/);

    const sidebar34 = read("components/shell/app-sidebar.tsx");
    expect(sidebar34).toMatch(/lastTurnSummary|chat-row-summary/);
    expect(sidebar34).toMatch(/resetToAuto|onResetTitle|nav\.resetTitle/);
    expect(sidebar34).toMatch(/data-roster-activity/);

    const palette34 = read("components/command-palette.tsx");
    expect(palette34).toMatch(/sessions\.search|searchConversations/);
    expect(palette34).toMatch(/stillIndexing|session-search-indexing/);
    expect(palette34).toMatch(/data-palette-section=\"conversations\"/);

    const home34 = read("components/views/home-view.tsx");
    expect(home34).toMatch(/home-foreign-sessions/);
    expect(home34).toMatch(/sessions\.foreignList/);
    expect(home34).toMatch(/foreignContinuePrompt/);
  });

  it("phase-2 continued: palette ranking, artifacts single search, app wiring", () => {
    const sidebar = read("components/shell/app-sidebar.tsx");
    expect(sidebar).toMatch(/partitionSidebarChats|sidebar-needs-review/);
    expect(sidebar).toMatch(/needsReview/);

    const palette = read("components/command-palette.tsx");
    expect(palette).toMatch(/shouldShowRunSetupInPalette/);
    expect(palette).toMatch(/data-palette-section=\"daily\"/);
    expect(palette).toMatch(/data-palette-section=\"admin\"/);
    expect(palette).toMatch(/data-palette-demoted/);
    // Daily group appears before admin in source order
    expect(palette.indexOf('data-palette-section="daily"')).toBeLessThan(
      palette.indexOf('data-palette-section="admin"'),
    );
    expect(palette.indexOf('data-palette-section="conversations"')).toBeLessThan(
      palette.indexOf('data-palette-section="admin"'),
    );
    expect(palette.indexOf('data-palette-section="stop"')).toBeLessThan(
      palette.indexOf('data-palette-section="admin"'),
    );
    expect(palette.indexOf('data-palette-section="recent"')).toBeLessThan(
      palette.indexOf('data-palette-section="admin"'),
    );
    // Admin visually demoted + setup gated
    expect(palette).toMatch(/adminGroupClass|adminItemClass|opacity-90/);
    expect(palette).toMatch(/showSetup/);

    const policy = read("lib/command-palette-policy.ts");
    expect(policy).toMatch(/shouldShowRunSetupInPalette/);
    expect(policy).toMatch(/orderedAdminActions/);
    // Primary nav list is home…memory only — "settings" string must not appear as an array entry.
    expect(policy).toMatch(
      /PALETTE_PRIMARY_NAV_IDS\s*=\s*\[[^\]]*"memory"[^\]]*\]/s,
    );
    expect(policy).not.toMatch(
      /PALETTE_PRIMARY_NAV_IDS\s*=\s*\[[^\]]*"settings"[^\]]*\]/s,
    );

    const artifacts = read("components/views/artifacts-view.tsx");
    expect(artifacts).toMatch(/hideLocalSearch/);
    expect(artifacts).toMatch(/!props\.hideLocalSearch/);
    expect(artifacts).toMatch(/data-testid="artifacts-local-search"/);
    // Type filters may remain; only one text search owner when hideLocalSearch.
    expect(artifacts).toMatch(/data-testid="artifacts-search-row"/);

    const app = read("App.tsx");
    expect(app).toMatch(/hideLocalSearch/);
    expect(app).toMatch(/shouldShowViewLocalSearch/);
    expect(app).toMatch(/hideLocalSearch=\{!shouldShowViewLocalSearch/);
    expect(app).toMatch(/readinessBlocked=\{/);
    expect(app).toMatch(/shouldShowTopbarSearch/);
    // Tasks list consumes topbar search; no onSearch dual field callback.
    expect(app).toMatch(/search=\{taskSearch \|\| search\}/);
    expect(app).not.toMatch(
      /<TasksView[\s\S]{0,400}onSearch=\{/,
    );
  });

  it("workspace wires protection chip and approval what/where/why", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/ProtectionChip/);
    expect(ws).toMatch(/protectionFromEvents|projectProtectionChip/);
    expect(ws).toMatch(/DegradedModeLabel/);
    const stream = read("components/task-stream.tsx");
    expect(stream).toMatch(/approval-what|approvalCard\.what|data-testid=\"approval-card\"/);
    expect(stream).toMatch(/approval-where|approvalCard\.where/);
    expect(stream).toMatch(/approval-why|approvalCard\.why/);
    // Stream approval summary is a landmark region for AT navigation.
    expect(stream).toMatch(/data-testid=\"approval-card\"[\s\S]{0,200}role=\"region\"/);
  });

  it("settings expose inherit user Grok toggle with risk dialog", () => {
    const prefs = read("components/views/settings/preferences-tab.tsx");
    expect(prefs).toMatch(/inheritUserGrok|inherit-user-grok/);
    expect(prefs).toMatch(/inheritUserGrokRisk|risk-dialog/);
  });

  it("ships T5 folder trust prompt + settings list", () => {
    expect(exists("components/folder-trust-prompt.tsx")).toBe(true);
    expect(exists("lib/folder-trust-ui.ts")).toBe(true);
    const prefs = read("components/views/settings/preferences-tab.tsx");
    expect(prefs).toMatch(/trustedFolders|trusted-folders/);
    const app = read("App.tsx");
    expect(app).toMatch(/FolderTrustPrompt/);
    expect(app).toMatch(/shouldShowFolderTrustPrompt|trustFolder/);
  });

  it("ships C1/C2/C4 coworker surfaces bound to real projectors", () => {
    expect(exists("lib/goal-progress.ts")).toBe(true);
    expect(exists("lib/review-changes.ts")).toBe(true);
    expect(exists("lib/helpers-hud.ts")).toBe(true);
    expect(exists("components/review-changes-strip.tsx")).toBe(true);
    const strip = read("components/review-changes-strip.tsx");
    expect(strip).toMatch(/onKeepFile/);
    expect(strip).toMatch(/onUndoFile/);
    expect(strip).toMatch(/review-changes-keep/);
    expect(strip).toMatch(/review-changes-undo/);
    expect(strip).toMatch(/reviewFileBasename|data-review-filename/);
    expect(strip).toMatch(/reviewChanges\.accept/);
    expect(strip).toMatch(/needsUserAttention/);
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/projectGoalProgress|goal-progress-line/);
    expect(ws).toMatch(/projectReviewChanges|ReviewChangesStrip/);
    expect(ws).toMatch(/onKeepFile|applyReviewFileAction/);
    expect(ws).toMatch(/onOpenFile|reviewChanges.reveal/);
    expect(ws).toMatch(/review-changes-near-result|workspace-sticky-composer/);
    expect(ws).toMatch(/projectHelpersHud|helpers-hud/);
    expect(exists("components/conversation/worker-strip.tsx")).toBe(true);
  });

  it("Task 14: only running status dots animate; review strip calm by default", () => {
    const styles = read("lib/status-styles.ts");
    expect(styles).toMatch(/status === "running"/);
    expect(styles).toMatch(/dot-live/);
    expect(styles).toMatch(/status === "queued"/);
    expect(styles).not.toMatch(
      /\(status === "running" \|\| status === "queued"\)\s*&&/,
    );
    const globals = read("styles/globals.css");
    expect(globals).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(globals).toMatch(/\.approval-arrive/);
    expect(globals).not.toMatch(/breathe-amber/);
    expect(exists("lib/review-file-display.ts")).toBe(true);
    const display = read("lib/review-file-display.ts");
    expect(display).toMatch(/statusDotMayAnimate/);
    expect(display).toMatch(/reviewFileBasename/);
  });

  it("Home needs-you uses deepLink binder (I10)", () => {
    expect(exists("lib/needs-you-open.ts")).toBe(true);
    const home = read("components/views/home-view.tsx");
    expect(home).toMatch(/needsYouOpenTarget/);
    expect(home).toMatch(/approvalId/);
    expect(home).toMatch(/needs-you-open/);
  });

  it("notice priority ranks entitlement/runtime/readiness", () => {
    const np = read("lib/notice-priority.ts");
    expect(np).toMatch(/entitlement/);
    expect(np).toMatch(/runtime/);
    expect(np).toMatch(/readiness/);
    expect(np).toMatch(/selectNotices/);
  });

  it("phase-5: centralized motion language, lazy previews, release-qa gate", () => {
    expect(exists("lib/motion-system.ts")).toBe(true);
    const motion = read("lib/motion-system.ts");
    expect(motion).toMatch(/MOTION_DURATION_MS|MOTION_SURFACE_CLASSES/);
    expect(motion).toMatch(/prefersReducedMotion|shouldAnimateMotion/);
    expect(motion).toMatch(/intentChipMotionClass|workGraphStageMotionClass/);

    const css = read("styles/globals.css");
    expect(css).toMatch(/--motion-duration-fast/);
    expect(css).toMatch(/--motion-ease-premium/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);

    const home = read("components/views/home-view.tsx");
    expect(home).toMatch(/intentChipMotionClass/);
    const graph = read("components/conversation/work-graph-rail.tsx");
    expect(graph).toMatch(/workGraphStageMotionClass|motion-work-graph/);
    const palette = read("components/command-palette.tsx");
    expect(palette).toMatch(/MOTION_SURFACE_CLASSES|motion-palette|animate-palette-in/);
    const app = read("App.tsx");
    expect(app).toMatch(/withViewTransition/);
    expect(app).toMatch(/MOTION_SURFACE_CLASSES\.navigation|vt-content motion-nav/);
    expect(app).not.toMatch(/import\s*\(\s*["']@\/lib\/api["']\s*\)/);
    expect(app).toMatch(/taskInterject/);
    const digest = read("components/deliverables-digest.tsx");
    expect(digest).toMatch(/MOTION_SURFACE_CLASSES\.artifactReveal|motion-artifact-reveal/);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(rendererRoot, "../../package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["visual-qa"]).toMatch(/visual-qa/);
    expect(pkg.scripts?.["release-qa"]).toMatch(/release-qa-gate|vitest/);
  });
});

/** I23 golden-path structural: real create → approve → message → export entry points. */
describe("I23 golden-path structural", () => {
  it("create path uses real form helpers and optimistic create", () => {
    expect(exists("lib/create-task-form.ts")).toBe(true);
    expect(exists("lib/create-task-optimistic.ts")).toBe(true);
    const app = read("App.tsx");
    // Product path: App createTask → tasks.create; Home composer onRun/onGoal.
    expect(app).toMatch(/async function createTask/);
    expect(app).toMatch(/"tasks\.create"/);
    expect(app).toMatch(/onRun=\{/);
    const home = read("components/views/home-view.tsx");
    expect(home).toMatch(/onGoal/);
  });

  it("approval resolve path exists on workspace", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/runApprove|onApprove|approval/);
    expect(ws).toMatch(/runReject|onReject/);
  });

  it("export chat path is wired", () => {
    const ws = read("components/views/task-workspace-view.tsx");
    expect(ws).toMatch(/exportChatMarkdown|onExport/);
  });

  it("stream projector drives approval cards from real events", () => {
    const sv = read("lib/stream-view.ts");
    expect(sv).toMatch(/projectApprovalCard/);
    expect(sv).toMatch(/approval_required/);
  });
});
