# Polish Review — Round 4 (2026-07-28)

Fresh audit of the current renderer (post "feat: update many things", 8f6f7df) against
DESIGN.md. Method: five parallel deep-read passes — design-system enforcement (DS),
primary chat path (CHAT), secondary surfaces (SURF), accessibility (A11Y),
performance/motion (PERF) — plus an i18n locale-parity script pass (I18N). Every
finding cites real `file:line`; the sharpest claims (DS-1 compile check, A11Y contrast
math, PERF doc-drift checks) were verified mechanically. Prior rounds
(IMPROVEMENTS.md, UI_IMPROVEMENTS.md, SLASH_IMPROVEMENTS.md, POLISH-PLAN.md,
EXPERIENCE_IMPROVEMENTS.md) are all landed; nothing shipped is re-proposed.
Paths are relative to `apps/desktop/src/renderer/` unless noted.

Mark items `DONE` or `SKIPPED (reason)` in place — the next review pass diffs this file.

**Verdict:** the foundation genuinely holds — zero raw Tailwind palette utilities
renderer-wide, owned primitives, real reduced-motion discipline, push-first data
flow, best-in-class approval focus management. What this round finds is *drift and
enforcement gaps*: a class of literally-broken Tailwind opacity utilities, a border/
fill/shadow ladder that exists but is bypassed more often than used, ~58 sub-AA
muted-text instances, a batch of 39 never-translated strings in all six locales,
screen-reader blindness at the two moments that matter most (autocomplete, approvals),
and a root-state architecture where every push and keystroke re-renders the whole app.

Totals: **6 Critical · 23 High · 34 Medium · 20 Polish**.

Severity: **Critical** = broken behavior or WCAG-A blocker · **High** = visibly
cheap/confusing on a primary path or WCAG-AA failure · **Medium** = felt
inconsistency / quality / AAA · **Polish** = last-mile.

---

## Critical

### C-1 (DS) Non-scale opacity modifiers compile to NO CSS — 10 sites, 9 files — **DONE**
Tailwind 3's opacity scale is multiples of 5; `/12` and `/92` emit nothing
(verified by compiling against the project's own config).
- `components/ui/button.tsx:15` `hover:bg-destructive/92` → **destructive buttons have no hover state at all**.
- `components/ui/tabs.tsx:33` `data-[state=active]:bg-primary/12` → **active tab loses its ice tint**.
- `bg-primary/12` icon chips render transparent: `license-activation-screen.tsx:111`,
  `task-stream.tsx:1573`, `deliverables-digest.tsx:64`, `runtime-install-step.tsx:60`,
  `onboarding-wizard.tsx:716`, `views/settings/license-tab.tsx:44`, `views/artifacts-view.tsx:585`.
- `onboarding-wizard.tsx:230` `bg-white/12` → inactive progress dot invisible.
**Fix:** `bg-primary/[0.12]`, `hover:bg-destructive/[0.92]` (or snap to `/10`,`/90`);
add a lint rule banning non-multiple-of-5 slash modifiers.

### C-2 (A11Y) Composer autocomplete menus invisible to screen readers (WCAG 4.1.2 A)
`components/slash-command-menu.tsx:81,96-97` and `components/file-mention-menu.tsx:97,121-122`
render `role="listbox"`/`option`, but the driving textareas
(`views/home-view.tsx:1048-1103`, `views/task-workspace-view.tsx:2828`) have no
`role="combobox"`, `aria-expanded`, `aria-controls`, or `aria-activedescendant`
(zero hits repo-wide) and options have no ids. Arrow keys move `activeIndex` while
DOM focus stays in the textarea — SR users hear nothing. file-mention-menu structure
is also invalid (`li` without role wrapping a `button[role=option]`).
**Fix:** combobox pattern on the textarea, `id`s + `aria-activedescendant` on options;
put `role="option"` on the `li` directly.

### C-3 (A11Y) 6 of 7 Switches have no accessible name (WCAG 4.1.2 A) — **DONE**
`components/desktop-task-toggle.tsx:83`, `views/settings/permissions-tab.tsx:98`,
`views/scheduled-view.tsx:283`, `views/settings/tools-tab.tsx:309,316,726`.
SR output is "switch, off" with no context — on security-relevant toggles.
**Fix:** `aria-label` or `id`+`htmlFor`; add an `aria-labelledby` contract to
`SettingsRow` (`views/settings/settings-row.tsx:41-70`).

### C-4 (SURF) Schedules can never be deleted or edited — **DONE** (delete shipped; edit deferred, needs schedule.update)
`views/scheduled-view.tsx:284-289` — SC-15 removed the row menu (it had one redundant
item); rows now offer only the enable Switch. No delete/edit/rename anywhere.
A mistyped cron lives forever; the table only grows.
**Fix:** restore a row overflow menu with Edit + Delete (AlertDialog confirm, matching
the chat-delete idiom at `shell/app-sidebar.tsx:880-917`).

### C-5 (PERF) Monolithic root state — every push and every composer keystroke re-renders the whole app
`App.tsx` (~200-740): tasks, artifacts, schedules, memories, inbox, usage, **and the
Home composer's `goal` text** all live in App; children get dozens of inline arrows so
`React.memo` is structurally impossible. Memo counts: task-workspace-view 0,
task-stream 0, home-view 0.
**Fix:** move composer text into HomeView; split App state into context slices
(tasks / side-data / selection); memo the five big children with stable callbacks.

### C-6 (PERF) Default conversation path unvirtualized + 1 s elapsed tick re-renders every turn
`components/task-stream.tsx:260` (`useElapsedSeconds` at TaskStream root, ticks 1 s
while live), `:491` (`conversation.turns.map`, no virtualizer — the legacy
`density="log"` path *does* virtualize at threshold 40),
`conversation/conversation-turn.tsx:96` (no `memo`). Every turn's full tree
(approval region, artifacts fold, workers, WorkDetails) reconciles every second for
the entire run.
**Fix:** move the elapsed tick into the leaf that displays it; `memo(ConversationTurn)`
with stable turn identities from the projector; virtualize turns above ~40.

---

## High

### H-1 (DS) Hairline ladder not enforced: 70 raw `border-white/*` vs 35 `border-hairline*`
10 distinct opacities in the wild (0.03→0.20) across 20 files — worst:
`views/home-view.tsx` ×15, `task-stream.tsx` ×8, `views/task-workspace-view.tsx` ×6,
`shell/app-sidebar.tsx` ×6. Off-ladder examples: `views/tasks-view.tsx:157-158,216`,
`home-view.tsx:1417` (`border-white/20`).
**Fix:** codemod 0.05→`hairline-quiet`, 0.06–0.08→`hairline`, 0.1–0.12→`hairline-strong`;
lint-ban `border-white/`.

### H-2 (DS) tailwind.config.js token mapping incomplete → 30+ arbitrary-value bypasses — **PARTIAL** (config mapping shipped; call-site codemod pending — session 2)
`--surface-0..3`, `--destructive-text`, `--primary-hover`, `--scroll-thumb` are in
globals.css but unmapped. Result: `bg-[hsl(var(--surface-3))]` ×15,
`text-[hsl(var(--destructive-text))]` ×14 (`ui/alert.tsx:13`,
`conversation/conversation-turn.tsx:433`), `ui/button.tsx:13` primary-hover.
**Fix:** map them in the config; codemod call sites.

### H-3 (DS) Brand-alias layer is dead code in both directions
`tailwind.config.js:50-59` (`midnight/navy/ink/panel/ice/electric/frost/approval/danger`)
has **zero** TSX usages; `globals.css:18-33` hex block is never referenced by the
working HSL tokens; six vars (`--color-cloud/white/slate/mist/border/disabled`) are
referenced nowhere.
**Fix:** derive semantic tokens from the brand layer or delete the aliases + dead vars.

### H-4 (DS) Brand hex and shipped HSL tokens have drifted
`--color-success #67d9b5` vs `--success: 161 55% 55%` (globals.css:30 vs :78);
`--color-approval #f2b96b` vs `--warning: 35 84% 62%` (:31 vs :80); `--foreground`
94% vs frost 92% (:24 vs :41). In-app status colors no longer match DESIGN.md's
canonical table or the landing site.
**Fix:** single source of truth; update DESIGN.md if the darker values are intentional.

### H-5 (A11Y) Approval requests are never announced (WCAG 4.1.3 AA)
Approval surfaces are static regions that mount async mid-stream:
`task-stream.tsx:1090-1100`, `conversation/conversation-turn.tsx:409-427`,
`review-changes-strip.tsx:23-31`, `folder-trust-prompt.tsx:18-26`. Visual affordance
is `breathe-amber` — color/motion only. NoticeSlot's live region doesn't carry
approvals; OS notifications fire only on finish.
**Fix:** sr-only assertive status on approval mount ("Grok needs approval: {summary}"),
or route approvals through NoticeSlot.

### H-6 (A11Y) Streamed output and completion have no live exposure (4.1.3 AA)
Streaming answer is plain Markdown in a `stream-caret` div (`task-stream.tsx:1034-1036`,
`conversation-turn.tsx:567-569`); completion cue is `.sweep-once` — visual only.
**Fix:** `role="log"` + `aria-live="polite"` on the message list, or minimal sr-only
"responding / response complete" statuses.

### H-7 (A11Y) `--destructive` used as text: 4.00–4.45:1 at 11–14 px (1.4.3 AA) — **DONE**
31 `text-destructive` foreground uses vs 19 of the compliant `--destructive-text`
(7.55:1) built for exactly this. Instances: `App.tsx:1570`,
`security-update-banner.tsx:83,106,123`, `task-stream.tsx:1155`,
`conversation/queued-message-row.tsx:116,138`, `command-palette.tsx:234`.
**Fix:** mechanical swap to destructive-text for all text-on-dark; map it in the
Tailwind config (see H-2).

### H-8 (A11Y) `text-muted-foreground/NN` ladder falls below AA — 58 instances — **DONE**
Blended over #050d1f: `/70` → 4.11:1 (33 uses), `/60` → 3.30:1 (14), `/50` → 2.66:1 (8),
`/40` → 2.11:1 (3); all at 11–12 px. Representative: `task-stream.tsx:1296,1336,1580`,
`command-palette.tsx:112,266`, `slash-command-menu.tsx:86,123`,
`shell/app-sidebar.tsx:368`, `queued-message-row.tsx:66`, `views/artifacts-view.tsx:707`.
The base token is 7.33:1 — already "muted".
**Fix:** floor at plain `text-muted-foreground`; hierarchy via size/weight;
lint-ban `text-muted-foreground/<85`.

### H-9 (A11Y) Placeholders 2.35–4.11:1, including the primary composer (1.4.3 AA) — **DONE**
`views/home-view.tsx:1063` `placeholder:text-muted-foreground/45` = 2.35:1 — and it's
the composer's only accessible name (no `aria-label`). `command-palette.tsx:100` `/50`;
defaults in `ui/input.tsx:12` / `ui/textarea.tsx:12` `/70` = 4.11:1.
**Fix:** defaults → full token; composer ≥ `/85` + explicit `aria-label`.

### H-10 (I18N) 39 newer strings ship in English in ALL six non-English locales — **DONE**
Locale parity is perfect (1,417 keys × 7 files) but one post-LANG-pass batch was never
translated — verified identical to en.json in de/es/fr/ja/pt/zh: `conversation.*`
(empty/export/open/new/resume/count*), `settings.inheritUserGrok*` (5 keys incl. the
security-risk dialog), `dictation.noMic/busy/entitlementReadOnly`,
`workspace.undoUnavailable/summarizeUnavailable`, `home.planFirstToggle`,
`connector.aws-kb.name`, ~39 total per locale.
**Fix:** translate the batch; add a CI check that flags long identical-to-en values.

### H-11 (SURF) Licensing/update surface hardcodes English via the `labels`-prop escape hatch — **DONE**
`license-activation-screen.tsx:67-85` (rendered label-less at `App.tsx:1423-1444` —
the first screen new users see), `security-update-banner.tsx:30-39` (`App.tsx:1630-1643`),
`update-restart-dialog.tsx:33-42` (`App.tsx:2233-2247`), `runtime-install-step.tsx:29-37`.
No production call site ever passes `labels`.
**Fix:** components call `useT()` directly; keep the prop as a test-only override.

### H-12 (SURF) Artifacts type filter broken in every non-English locale — **DONE** (hardening shipped; original premise overstated — filter was not user-broken)
`views/artifacts-view.tsx:338-341` substring-matches the *localized* kind label against
hardcoded English chip values ("markdown"/"excel"/"python", :543-551) → zero rows in
de/ja/zh, silently.
**Fix:** filter on a locale-independent kind id (same discriminant `artifactKindLabel` uses).

### H-13 (SURF) Memory save has no failure path and ambiguous success
`views/memory-view.tsx:168-181` — `.then(clear).finally(...)` with no `.catch`: failed
save = hung-looking form, no toast either way.
**Fix:** catch → destructive toast (match `showConnectorError`,
`views/settings-view.tsx:162-168`); success toast + collapse form.

### H-14 (SURF) Artifacts detail pane vanishes below `md` with no fallback
`views/artifacts-view.tsx:633` — the aside is `hidden … md:flex`; on narrow windows
selection appears broken and preview/download/share are unreachable.
**Fix:** below `md`, present detail as a Sheet (idiom already exists in `inbox-panel.tsx`).

### H-15 (SURF) Banner stack bypasses its own priority system — up to six strips can stack
`App.tsx:1528-1663` — NoticeSlot caps at 3, but RemoteControlBanner (:1628),
SecurityUpdateBanner (:1629-1644), and the demo-mode strip (:1646-1663) render outside
it unconditionally; relative priority is render order, not declared.
**Fix:** register them as `NoticeItem`s in `buildShellNotices` with bespoke renderers.

### H-16 (CHAT) Escape in the follow-up composer stops the live run with no IME guard — **DONE** (stale finding — already fixed pre-session in d80450e; verified no-op)
`views/task-workspace-view.tsx:2802-2806` — fires before `isComposing` is consulted
(only passed to `composerKeyAction` at :2814). A ja/zh user discarding an IME
composition kills the run.
**Fix:** bail when `e.nativeEvent.isComposing`; consider "press Esc again to stop".

### H-17 (CHAT) "Jump to latest" chip floats on top of the composer
`views/task-workspace-view.tsx:2121-2130` — `absolute bottom-4` in the chat column
(`relative` at :1598-1600) whose bottom is the composer; offset ignores composer height.
**Fix:** wrap the ScrollArea in its own `relative` container and anchor the chip there.

### H-18 (CHAT) Native `window.confirm` on the primary path (and shell)
`views/task-workspace-view.tsx:1727` (browser fallback), `:2087-2093` (turn undo —
also concatenates a raw file list, dangling `\n\n` when empty); plus sign-out at
`App.tsx:1132,1135` (SURF). Stock OS alerts in a themed app at trust-critical moments.
**Fix:** owned AlertDialog everywhere; file list as a list; omit empty section.

### H-19 (PERF) Same event array re-projected 3–5× per change, with per-event `JSON.stringify`
`activityStoreFromEvents` ×2 (`task-stream.tsx` + `views/task-workspace-view.tsx:464`),
`collapseEventsToBlocks` ×2 (+ `:550-552`), `projectGoalProgress` (:482),
`projectReviewChanges` (:495). Stringify: `lib/events-to-activity.ts:201` (sliced),
`:232` (**unbounded**), `hooks/use-chat-events.ts:45` (both payloads per event),
`:268-272` (render-path rebuild, result discarded).
**Fix:** project once in the hook/context; seq/version equality; lazy detail
serialization on expand.

### H-20 (PERF) Chat column animates layout properties on the browser-split
`views/task-workspace-view.tsx:~1601` — `transition-[flex-basis,width,max-width,padding]`
while the Electron BrowserView re-syncs bounds and the drag handler dispatches
synthetic resize. Direct DESIGN.md motion-rule violation on the heaviest surface.
**Fix:** snap layout, cover with opacity/transform crossfade.

### H-21 (PERF) 8 s `taskContextUsage` poll never stops
`views/task-workspace-view.tsx:528-548` — polls terminal tasks forever, including
hidden windows.
**Fix:** fetch once when terminal; pause on `visibilityState === "hidden"`
(pattern exists in `hooks/use-inbox.ts`).

### H-22 (PERF) Artifact thumbnails decode full-size assets into 40 px tiles, unvirtualized
`views/artifacts-view.tsx:112-135` (`readAsset` whole file, no `loading="lazy"`/
`decoding="async"`), `:571` (no windowing/cap). 100 image artifacts = 100 full-res
decodes in memory.
**Fix:** downscale via `createImageBitmap` (or thumbnail endpoint); lazy attrs;
virtualize (react-virtual already a dep).

### H-23 (PERF) Unthrottled resize listener drives state in the 3,187-line workspace
`views/task-workspace-view.tsx:1153-1157` — raw `setViewportWidth` per resize event,
compounded by the synthetic resize dispatch from split-drag.
**Fix:** rAF-throttle; store a discrete breakpoint (as `views/tasks-view.tsx:64-68` does).

---

## Medium

### M-1 (DS) globals.css breaks its own hairline rule
Surface ladder hardcodes 0.045/0.06/0.07/0.09 (`globals.css:326,333,344,354`);
typeset/code chrome adds 0.055/0.07/0.10 (:933,:994,:1037,:1074,:1083); the
`--hairline-*` vars (:98-100) are never consumed inside globals.css.
**Fix:** snap to `hsl(var(--hairline*))`.

### M-2 (DS) Sibling float primitives disagree on border tone
popover/dropdown/select/dialog/sheet use `border-hairline-strong`; `ui/hover-card.tsx:18`
and `ui/tooltip.tsx:18` use raw `border-white/10`. **Fix:** align.

### M-3 (DS) Switch thumb is pure `#fff`
`ui/switch.tsx:23` — violates Principle 1; brightest pixel in the app.
**Fix:** `hsl(var(--foreground))` (#d7e6ff).

### M-4 (DS) Pure-black washes invert the tonal ladder (17 `bg-black*` sites)
Panels: `views/task-workspace-view.tsx:2947` (`bg-black/15` rail),
`views/home-view.tsx:1589` (`bg-black/20`), `browser-pane-slot.tsx:126`,
`error-boundary.tsx:29`, `ui/mermaid-block.tsx:55`, `deliverables-digest.tsx:81`.
Letterboxing: `media-lightbox.tsx:277`, `views/artifacts-view.tsx:187`,
`views/task-workspace-view.tsx:3140`, `deliverables-digest.tsx:93`. Scrims use three
strengths (/50, /60, /95).
**Fix:** panels → navy-stack tokens; one scrim token (e.g. `bg-midnight/70`);
letterboxing black is acceptable, tokenize it.

### M-5 (DS) Shadow tokens exist but ~34 arbitrary `shadow-[…]` duplicate them
`tailwind.config.js:155-162` defines 6 tokens; 4 uses in TSX. All 9 float/surface
primitives hand-inline the recipes. **Fix:** add `shadow-float/modal/card` recipes,
adopt in primitives.

### M-6 (DS) Code-block chrome type below the 11 px floor
`globals.css:1088` `.code-block-lang` 10.5px; `:1099` 11px raw; `pre` 12.75px (:1115).
**Fix:** snap to 2xs/xs scale.

### M-7 (DS) Dead CSS in globals.css
Marquee hover-roll system :553-581 (only `.chat-row` survives), `.panel-brand`
:752-760 (zero usages), `.first-launch` declared twice (:673-676, :818-821).
**Fix:** delete/merge. (Note: fixing A11Y P-19 may *revive* the marquee instead — decide once.)

### M-8 (A11Y) Code-comment syntax color 4.28:1 — **DONE**
`globals.css:1133-1136` `.hljs-comment` at 12.75px. **Fix:** lift lightness to ~54%.

### M-9 (A11Y) Composers suppress the focus ring; replacement glow-delta is sub-3:1
`views/home-view.tsx:1063`, `views/task-workspace-view.tsx:2828` `focus-visible:ring-0`;
only indicator is `.glow-ring:focus-within` alpha 0.32→0.5 (globals.css:362-377);
also `role-pack-picker.tsx:84`.
**Fix:** make focus-within jump to a solid 2px `hsl(var(--ring))` line.

### M-10 (A11Y) Nested interactive controls inside `role="button"` task rows
`views/tasks-view.tsx:217-232` row contains expand button (:235) and menu trigger
(:284) — invalid ARIA. **Fix:** sibling-buttons pattern (as
`shell/app-sidebar.tsx:730-803` already does).

### M-11 (A11Y) No `<main>` landmark; heading hierarchy skips
Content pane is a bare `.vt-content` div; settings jumps h1→h3
(`views/settings/settings-row.tsx:22`); most views have no h1; onboarding has six.
**Fix:** `<main>` wrapper; PageHeader→h1; SettingsSection→h2.

### M-12 (A11Y) JS smooth-scroll ignores reduced motion
`task-stream.tsx:718,729`, `views/task-workspace-view.tsx:1244`,
`lib/approval-action.ts:59` — auto-follow means near-continuous animated scroll.
**Fix:** shared `scrollBehavior()` helper (pattern in `lib/view-transition.ts:16-18`).

### M-13 (A11Y) Thinking-shimmer text dips to ~2.96:1; gradient persists under reduced motion — **DONE**
`globals.css:466-479`, applied `task-stream.tsx:1317`. **Fix:** trough alpha ≥0.8;
static color fallback under reduced motion.

### M-14 (CHAT) Hardcoded English mid-transcript — **DONE**
`task-stream.tsx:1168-1169` ("finished"/"started"), `:884,:930` (`tool: "Result"`),
`context-meter.tsx:27,49` (title + "Long conversation — summarize so far?").
**Fix:** locale keys (fold into H-10's batch).

### M-15 (CHAT) Live-activity terminology inconsistent between surfaces
`conversation/live-work-card.tsx:42-47` raw-capitalizes tool names while
`task-stream.tsx:1385-1431` humanizes + translates the same tools.
**Fix:** shared `humanizeTool` helper.

### M-16 (CHAT) Voice send shows a fake 600 ms "sending" burst
`views/home-view.tsx:1246-1252`, `views/task-workspace-view.tsx:2417-2422` —
timer-driven, decoupled from the real send. **Fix:** tie to the send promise.

### M-17 (CHAT) Effort select silently remaps stored `"max"` to `"heavy"`
`views/home-view.tsx:1385-1391` — UI misreports persisted state.
**Fix:** show Max as an aliased option or migrate once with a visible toast.

### M-18 (CHAT) Clipboard failure is a silent no-op on the most-used action
`task-stream.tsx:1602-1615`, `conversation-turn.tsx:592-594` — no feedback when
clipboard is blocked; `media-lightbox.tsx:119-127` already does it right.
**Fix:** reuse the lightbox pattern.

### M-19 (CHAT) Unknown dictation errors render raw
`views/task-workspace-view.tsx:2881-2887` — engine/OS error text printed verbatim.
**Fix:** generic localized `dictation.failed`; log the detail.

### M-20 (CHAT) Home "Stop" kills the task with zero post-click feedback
`views/home-view.tsx:752-763`. **Fix:** at minimum a "Task stopped" toast; ideally
CHAT-5-style undo window.

### M-21 (SURF) Sidebar usage strings hardcoded while a key exists — **DONE**
`shell/app-sidebar.tsx:462-464,508,531,563-564` — `settings.usagePercent` already
exists and `usage-meter.tsx:70` uses it. **Fix:** reuse + add `usageReset` key.

### M-22 (SURF) Wrong toast after copying artifact content — **DONE**
`views/artifacts-view.tsx:461-468` — copies content, toast says "copied path".
**Fix:** `media.copiedContent` key.

### M-23 (SURF) Three "New chat" entry points, three behaviors
⌘N (`App.tsx:867-875`) and TasksView (:1879-1886) clear attachments + focus composer;
sidebar (:1493-1500) does neither → stale attachments can ride into a new task.
**Fix:** one `startNewChat()`.

### M-24 (SURF) Memory: "profile" kind unfilterable; kind badges untranslated
`views/memory-view.tsx:211` (`KIND_VALUES.slice(0, 5)`), `:257` (raw enum + CSS
capitalize). **Fix:** drop the slice; `t("memory.kind.*")` label table.

### M-25 (SURF) Scheduled view: model frozen at mount; presets don't re-localize; late folder error
`views/scheduled-view.tsx:50` (state seeded from possibly-empty `props.models`),
`:46` (`getCronPresets()` ignores `t` despite dep), `:143-147` (folder requirement
only surfaces after Create fails).
**Fix:** derive model with fallback expression; `getCronPresets(t)`; inline
disabled-state hint.

### M-26 (SURF) Page-header pattern: three competing implementations plus an unused canonical one
`components/page-header.tsx` imported by nothing; tasks-view (:131-135),
memory/scheduled, and settings (:335) each hand-roll different tracking/subtitle
scales. **Fix:** adopt PageHeader everywhere or delete it and codify one pattern.

### M-27 (SURF) Dead/orphaned shell code
Unreachable booting skeleton `App.tsx:1700-1715` (early return at :1386-1403);
`LicenseReadOnlyBanner` imported (:92) never rendered; `runtime-install-step.tsx`
unhosted; dead `query`/`noChatsMatch` `shell/app-sidebar.tsx:159,405-409`; six unused
props on `shell/app-topbar.tsx` (passed at `App.tsx:1678-1679`, ignored).
**Fix:** delete or wire deliberately.

### M-28 (PERF) `breathe-amber` animates box-shadow — infinite paint loop on the approval strip
`globals.css:405-416`, applied `conversation-turn.tsx:418`, `home-view.tsx:669,842`,
workspace strip. **Fix:** static glow on a pseudo-element, animate its opacity.

### M-29 (PERF) Live-turn animation/timer stack runs while the window is hidden
JS: `WorkingIndicator` 2.6 s rotation (`task-stream.tsx:1260-1264`), 1 s ticks
(`hooks/use-elapsed.ts:22` → TaskStream root + `home-view.tsx:497` re-rendering all
of HomeView), `settings/remote-tab.tsx:277`. 7 renderer `setInterval` sites; only
`use-inbox.ts` is visibility-aware.
**Fix:** shared visibility gate for all renderer timers.

### M-30 (PERF) `content-visibility: auto` guardrail claimed in POLISH-PLAN 4.6, never shipped
Zero occurrences renderer-wide. Cheapest mitigation for C-6 until virtualization lands.
**Fix:** `content-visibility:auto; contain-intrinsic-size:auto 200px` on turn articles —
or land C-6 and update the doc.

### M-31 (PERF) Mermaid re-initializes and re-renders per streaming chunk
`ui/mermaid-block.tsx` — `initialize` + `render` in an effect keyed on `code`;
incomplete fences re-parse/throw repeatedly. **Fix:** debounce ~300 ms, render on
stable/closed fence, hoist `initialize`.

### M-32 (PERF) Home draft written to localStorage synchronously on every keystroke
`views/home-view.tsx:555-567` — comment says "debounced"; there is no debounce.
**Fix:** 500 ms debounce or write on blur/nav-away.

### M-33 (PERF) Tasks list unwindowed; counts recomputed 3× per render
`views/tasks-view.tsx:209` (`filtered.map` + expanded sub-rows), `:105-114`.
**Fix:** virtualize above ~60 rows; memoize counts.

### M-34 (PERF/DOC) POLISH-PLAN.md describes a polling architecture that no longer exists
Adaptive 1.5 s/4 s poll and self-stopping 500 ms events poll were replaced by gateway
push + 30 s safety nets (better!), but the doc still claims them, and claims 4.6 items
that never shipped. **Fix:** refresh the doc so contributors don't optimize against a
fictional baseline.

---

## Polish

### P-1 (DS) `.kbd` recipe duplicated inline — `shell/app-sidebar.tsx:243`, `ui/icon-tooltip.tsx:48`. Use `className="kbd"`.
### P-2 (DS) Call sites re-override primitive borders back to raw values — `shell/app-sidebar.tsx:540,813,897`, `task-stream.tsx:1593`, `views/home-view.tsx:1356`. Delete the overrides.
### P-3 (DS) `ui/table.tsx` header/footer still on stock `--border` while rows use hairline-quiet. Align.
### P-4 (DS) `views/memory-view.tsx:329` `text-3xl` stat leaks display size into product chrome (DESIGN.md reserves 3xl/4xl for onboarding/heroes). Use 2xl.
### P-5 (DS) `update-restart-dialog.tsx:135-137` hand-rolls the modal surface (raw scrim, border, shadow) instead of composing the owned Dialog recipe — it *does* implement focus-trap correctly (see Strengths); tokenize the surface.
### P-6 (CHAT) `conversation/worker-strip.tsx:64-72` cancelled workers get the destructive dot — read as errors. Neutral dot for cancelled.
### P-7 (CHAT) `deliverables-digest.tsx:117-119` bare `Loader2` for inline media while the stream uses PROG-2 skeletons. Use the shimmer skeleton.
### P-8 (CHAT) `en.json:537` "{n} more files" has no singular — "1 more files" (`deliverables-digest.tsx:175`, `lib/stream-view.ts:714`). Add `moreFilesOne`. — **DONE**
### P-9 (CHAT) `conversation/queued-message-row.tsx:93` blur commits a queued-message edit — stray click silently rewrites it. Blur = cancel; commit on Enter/explicit save (CHAT-6 contract).
### P-10 (CHAT) `/briefing` result delivered as a transient toast (`views/home-view.tsx:478-482`) — requested content evaporates. Dismissible inline surface.
### P-11 (CHAT) Dictation tooltip computed differently in the two composers (`views/task-workspace-view.tsx:2592-2596` vs `views/home-view.tsx:1256-1261`); DictationButton's own `defaultTitle` already gets it right — stop passing `title`.
### P-12 (SURF) Onboarding ready-check shows a Check icon for warnings, tinted amber only (`onboarding-wizard.tsx:768-786`) — color-alone violation; `readiness-checklist.tsx:47-51` does it right. Swap to AlertCircle.
### P-13 (SURF) Command palette icon collisions (`command-palette.tsx:182,191`): Usage/Billing both reuse Settings; Docs reuses Memory's BookMarked. Gauge / CreditCard / BookOpen.
### P-14 (SURF) Artifacts empty state has no CTA (`views/artifacts-view.tsx:563-568`); Scheduled aside shows cron strings, not computed next-run times. Add "Start a task" CTA; compute next occurrences.
### P-15 (SURF) Approval-mode persistence failure swallowed (`App.tsx:2095-2099`) — a safety setting failing silently. Toast + revert the Switch.
### P-16 (A11Y) Sidebar title marquee is hover-only (`globals.css:567-571`; `shell/app-sidebar.tsx:736-738`) — no focus trigger, no `title` fallback. Add `:focus-within` + `title`.
### P-17 (A11Y) Attach button named by `title` only (`views/task-workspace-view.tsx:2598-2603`) while the other 17 icon buttons use `aria-label`. Align.
### P-18 (PERF) Full-window grain uses `mix-blend-mode: overlay` on a fixed layer (`globals.css:154-164`) — re-blends every frame. Pre-baked noise at low plain opacity.
### P-19 (PERF) 12 `backdrop-blur` sites, several over animating content (workspace composer bar ~:2135, sticky header `tasks-view.tsx:177`, `.surface` `globals.css:338`). Finish the 4.6 audit.
### P-20 (PERF) Duplicate `buildChats(tasks)` in App (`App.tsx:739` + `:748`); global shortcut effect re-registers on every tasks mutation (`:850-945`). Consolidate.

---

## Systemic patterns

1. **Enforcement gap, not design gap.** The ladders exist (hairline, shadow tokens,
   destructive-text, semantic status) and are bypassed more often than used:
   70 raw `border-white/*` vs 35 hairline uses; 104 `bg-white/<alpha>` fills at 11
   distinct alphas (no fill ladder exists — add fill-quiet/fill/fill-strong);
   ~34 arbitrary shadows vs 4 token uses; 31 `text-destructive` vs 19 destructive-text.
   One codemod + four lint rules closes the entire class.
2. **i18n leaks concentrate in shell/lifecycle chrome and the newest strings.**
   Views are well-covered; the leaks are the labels-prop components (H-11), sidebar
   footer (M-21), transcript chrome (M-14), enum badges (M-24) — plus the untranslated
   batch (H-10). Convention fix: components own `useT()`; props are test overrides.
3. **No shared mutation-feedback contract.** Exemplary optimistic create/rollback next
   to silent failures (H-13, P-15, M-18) and lying progress (M-16). Adopt "every
   mutation resolves to visible success or visible failure" as a helper.
4. **Timers ignore visibility.** 7 `setInterval` sites, 1 visibility-aware; H-21's
   poll never terminates. One `useVisiblePolling` hook fixes all.
5. **SR coverage is broad except at the two peak moments** — autocomplete (C-2) and
   approvals/streaming (H-5/H-6). 31 live regions exist; none covers the core loop.
6. **Doc drift** (M-34): keep POLISH-PLAN/EXPERIENCE docs in sync when architecture
   changes, or future optimization targets a fictional baseline.

## Genuinely well done (keep these; use as templates)

- **The chromatic ban holds 100%**: zero raw Tailwind palette utilities, zero
  arbitrary hex, zero `text-white`, zero arbitrary px font sizes renderer-wide.
- **Primitives are owned**: float surfaces on surface-3 with inset-hairline + ambient
  recipe; one spinner, one toast surface, one status-dot recipe; electric focus rings.
- **Motion discipline**: global reduced-motion kill-switch + JS gates in
  view-transition/AnimatedNumber/first-launch; opacity-only 160 ms content transition.
- **Approval lifecycle** (`views/task-workspace-view.tsx:972-1031`,
  `lib/approval-action.ts`): busy locks through the async round-trip, focus restore,
  assertive error region, plan-card autofocus — best-in-class.
- **MediaLightbox**: every action has busy + failure states, bounded fetches, graceful
  share degradation, persisted volume — the standard other actions should meet.
- **Push-first data flow**: gateway notify + 30 s safety nets, self-terminating events
  interval, LRU event cache; `use-inbox.ts` is the visibility-aware template.
- **Focus craft**: hand-rolled update dialog implements full modal semantics; roving
  tabindex radiogroup in onboarding; 83 aria-labels; zero keyboard-dead clickable divs.
- **Locale parity**: 1,417 keys × 7 locales, zero missing/extra keys.

## Execution order

1. **Broken-behavior fixes (hours):** C-1 opacity classes · C-4 schedule delete/edit ·
   H-12 artifacts filter · H-16 Escape IME guard · C-3 switch names · M-22 wrong toast.
2. **Mechanical sweeps (a day each):** contrast (H-7 + H-8 + H-9 + M-8 + M-13) ·
   hairline/fill/shadow codemod + lint (H-1, H-2, M-1, M-2, M-5, P-2) ·
   i18n batch (H-10 + H-11 + M-14 + M-21 + M-24).
3. **Core-loop a11y (1–2 days):** C-2 combobox · H-5 approval announcements ·
   H-6 streaming log region · M-9 composer focus ring.
4. **Perf architecture (the big rock):** C-5 state slices + memo · C-6 tick scoping +
   turn virtualization · H-19 single projection pass · H-21/M-29 visibility gates ·
   H-22 thumbnails.
5. **Consistency pass:** H-15 banner unification · H-18 confirm dialogs · M-23
   startNewChat · M-26 PageHeader · M-27 dead code · M-34 doc refresh · Polish items.

---

## Session 1 close-out notes (2026-07-28)

Branch `polish/session-1`, commits `18c1187..4470700`. Gates at close: desktop typecheck clean, desktop 234 files / 1459 tests, gateway 164 files / 758 tests + build, shared untouched since Task 4 (verified then: 56/356 + build).

**Deferred — needs a human:** visual spot-check was not performed (destructive button hover, active tab tint, schedule delete flow, artifacts filter in German, muted-text readability, thinking-shimmer and hljs-comment contrast in situ).

**Known caveats shipped with the scan guards:**
- Contrast scans cover `text-destructive` bare usage and `text-muted-foreground/NN` alpha; side doors remain unscanned (`text-foreground/NN`, `opacity-*` on text containers).
- If a third named-allowlist scan is added, extract a shared `scanRendererLines` helper in `ui-structure.test.ts`.
- `locales-parity.test.ts` forward parity overlaps `i18n.test.ts` "covers all English keys"; the hand-maintained `proseKeys` list there is largely subsumed by the staleness guard — consolidation candidate.

**i18n leftovers (guard-green, ≤15 chars or names):** `settings.remote.*`, `approvalCard.*`, `connector.*` descriptions still English. fr/de use `{pct}%` without the typographically-preferred space before % (matches `settings.usagePercent`, diverges from `meter.contextTitle`). A locale-change test pinning `format.ts` label thunks is future work.
- Commit `53e1349`'s subject understates its content: it also rewired `lib/goal-progress.ts` through the module translator (signature change + regex escaping). Noted for future bisects.

**Behavioral follow-ups deliberately out of scope this session:**
- Artifacts: honor the `truncated` flag on file reads (toast/badge) and stop silently substituting title fallbacks (`artifacts-view.tsx:470-472`, `media-lightbox.tsx:170-171`).
- Remote allowlist: add a definition-site comment explaining `schedule.delete` denial; mobile can create but not delete schedules.
- `mutation-receipts.ts` still uses stale `schedules.*` names.
- `App.tsx` mixed `.catch` vs `onError` handling — unify.
- Dead exported `ActivityRow` in `task-workspace-parts.tsx:274`.
- Test ergonomics: extract `makeDeps()` in `side-data-dispatch.test.ts`.
- Cosmetic comment/naming touch-ups when files are next edited: reword the ×4 "labels prop stays a test-only override" comments (no current callers), one-liner at `app-sidebar.tsx:463` explaining the deliberate `settings.usagePercent` vs `sidebar.usagePercent` split, convert `context-meter.tsx` to `useT()`.

**Next sessions (per plan):** 2 — design-token codemod (incl. H-2 call sites); 3 — screen-reader parity; 4 — perf architecture; 5 — consistency pass.
