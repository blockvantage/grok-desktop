# Premium Polish Plan — Grok Desk

## Implementation status (2026-07-10)

All four phases implemented on `feat/grok-desk`. Typecheck, production build, and
the 26-test suite pass. Runtime visual confirmation still needs a launch (`pnpm dev`) —
the build gates can't exercise the actual window chrome, transitions, or notifications.

**Shipped**
- P1: frameless `hiddenInset` chrome, `#050e21` midnight backgroundColor (no launch flash),
  `show:false`+`ready-to-show`, drag regions on sidebar/topbar/home strip;
  home-shaped boot skeleton; hand-rolled toast stack replacing the banner.
- P2: motion tokens (`ease-premium`/`spring`), native View Transitions on every nav +
  create/back path, compose↔result shared-element morph, gliding nav indicator,
  radar-ping live dot, compose focus-glow, card lift, count-up stats.
- P3: real `cmdk` ⌘K palette (nav / recents / stop-running / sign-in); incremental
  `afterSeq` event fetch (no more full refetch every 500ms); completion light-sweep,
  breathing approval strip, background completion notification.
- P4: removed dead Bell/Help/Filters, topbar ⌘K trigger + Settings; icon semantics
  (Tasks→ListChecks, Memory→BookMarked, Sparkles reserved for the agent); file-preview
  skeleton; sidebar scroll fade mask; `text-wrap:balance` + SF Pro Display on headings;
  dropped `background-attachment:fixed`.

**Follow-up pass (now implemented)**
- Work-log stick-to-bottom + "Jump to latest" pill (reads the Radix viewport via
  `[data-radix-scroll-area-viewport]`; only auto-follows while live and near bottom).
- Approve/Reject button morph into a progress state.
- Optimistic task creation: Run jumps straight into a placeholder workspace and
  reconciles with the real task; rolls back to the composer (goal intact) on failure.
- Polling churn cut without a full push: adaptive main poll (1.5s live / 4s idle) and
  the 500ms events poll self-stops once a task is terminal.
- macOS sidebar vibrancy (`vibrancy: 'sidebar'`) with a transparent app-root + translucent
  rail + opaque content column; falls back to the solid canvas when unsupported.

**Still deferred**
- True gateway IPC push (would need the stdio gateway to emit event notifications; the
  adaptive poll covers the churn concern for now).

---


Goal: make the app feel premium in motion, not just in stills. Butter-soft interactions,
native macOS chrome, and continuity between every state change ("connected dots").

## Audit verdict

The static foundation is genuinely strong and should not be rebuilt: tonal surface ladder,
Deep Navy + Ice brand (scarce ice primary on midnight/navy chrome), hairline borders,
grain overlay, visible focus rings, reduced-motion support, kbd hints. What breaks the
premium illusion is everything that *moves* (or doesn't):

1. **Stock window chrome.** Default `BrowserWindow` — no `titleBarStyle: 'hiddenInset'`,
   no `backgroundColor` (white flash on launch), no `show:false`/`ready-to-show`, no
   vibrancy. The `.titlebar-drag` classes exist in CSS but nothing uses them.
2. **No motion system.** One keyframe (`fade-in`) total. View switches are hard
   unmount/mount swaps. The nav active-indicator teleports instead of sliding. Stream
   blocks pop in without stagger. No shared-element continuity anywhere.
3. **Polling-driven data churn.** Tasks/auth/side data every 1.5s; events refetched
   *in full* (`afterSeq: 0`) every 500ms. Re-render storms, GC churn, and no
   stick-to-bottom behavior in the work log.
4. **Layout-shifting notices.** The banner Alert pushes the whole page down when it
   appears; `rounded-none border-x-0` looks bolted on.
5. **Dead ends.** Bell, Help, and topbar "…" buttons do nothing meaningful; TasksView
   "Filters" button does nothing; ⌘K focuses an input found by
   `input[placeholder*="Search"]` and silently no-ops on Home.
6. **Icon semantics.** `MemoryStick` (a RAM stick) for Memory; `Sparkles` used for the
   logo, Tasks nav, model select, *and* Grok's chat blocks — the brand mark is diluted.
7. **Unrewarding key moments.** Task completion, approval, and first-artifact are the
   emotional peaks of an agent app; today they're plain text swaps.
8. **Perf smells.** `background-attachment: fixed` on body (disables composited fast
   scroll paths in Chromium), several stacked `backdrop-filter` layers, grain overlay at
   `z-50` (ties with Radix portals).

---

## Phase 1 — Native shell & first impression (high impact, low risk)

**1.1 Mac-native frameless chrome** (`src/main/index.ts`)
- `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 14, y: 18 }`
- `backgroundColor: '#050e21'` (midnight / matches brand canvas) — kills the white launch flash
- `show: false` + reveal on `ready-to-show`
- Optional: `vibrancy: 'sidebar'` + `visualEffectState: 'active'`, and make the
  sidebar background semi-transparent so the desktop bleeds through like Raycast/Linear.
- Renderer: apply `.titlebar-drag` to sidebar header + topbar; `.titlebar-no-drag` on
  interactive children. Pad sidebar header right of the traffic lights.

**1.2 Boot sequence**
- Sidebar and topbar render instantly (chrome never skeletons).
- Content area: layout-matched skeletons that crossfade into real content — one
  choreographed reveal, no pop.

**1.3 Replace the banner with toasts**
- Bottom-right toast stack (hand-rolled ~60 lines or `sonner`), spring entrance,
  hover-to-pause, no layout shift. Keep destructive errors also inline at their source
  (e.g., under the compose box for "Describe a goal first").

## Phase 2 — Motion system ("butter")

**2.1 Motion tokens** (tailwind.config.js + globals.css)
- Durations: 120 (hover), 180 (press/small), 240 (panel), 400 (view) ms.
- Two curves: `ease-premium` (already defined, use it *everywhere* instead of default),
  and a soft-spring approximation `cubic-bezier(0.34, 1.3, 0.64, 1)` for entrances.
- Rule: animate only `transform`/`opacity`. Honor `prefers-reduced-motion` (already wired).

**2.2 View transitions (the flagship "connected dots" move)**
- Electron 33 = Chromium 130 → the **View Transitions API is available natively**.
  Wrap `setNav`/surface changes in `document.startViewTransition()`.
- Default: 200ms crossfade + 8px vertical drift between views.
- Shared-element morphs via `view-transition-name`:
  - task row (sidebar or list) → workspace `<h1>` title
  - compose card on Home → result strip in workspace after Run
  - status pill persists across list ↔ workspace
- Nav active indicator: animate the pill sliding between items (FLIP on the
  `::before` bar or a single absolutely-positioned indicator that translates).
- Zero new dependencies; pure CSS + one wrapper function.

**2.3 List & stream choreography**
- Stream blocks: staggered entrance (`animation-delay: min(i, 8) * 30ms`) on initial
  load; single new events slide up 4px + fade.
- Deliverables: animate in when a file appears (scale 0.98 → 1 + fade).
- Stat numbers ("Files", counts in rail): animated count-up with `tabular-nums`.
- Work log: auto-follow with stick-to-bottom; show a "Jump to latest ↓" pill when the
  user scrolls up (never fight their scroll).

**2.4 Micro-interactions**
- Buttons: keep `active:scale-[0.985]`, add distinct hover (subtle brightness) vs press
  timing (fast in, springy out).
- Smart-start cards: `hover:-translate-y-0.5` lift with the existing shadow deepening.
- Compose box: `glow-ring` intensifies on textarea focus (animate the ring alpha),
  breathes very subtly while a task is starting.
- Checkmarks: SVG stroke-draw animation when a step finishes or a task completes.
- Running status: replace bare `animate-pulse` dot with a soft radar ping
  (scaling ring at low opacity) — reads as "alive", not "blinking".

## Phase 3 — Connected dots (flow continuity)

**3.1 Real command palette (⌘K)** — the premium anchor for a keyboard-first agent app
- Add `cmdk` (only new dependency in the plan). Actions: new task, navigate, search
  tasks/memories/artifacts/schedules, stop task, sign in, open workspace folder.
- Replaces the brittle placeholder-query focus hack; works on every view including Home.
- Style with the existing `surface-float` ladder.

**3.2 Optimistic task creation**
- On Run: transition to the workspace *immediately* with the goal as title in a
  "Starting…" state; reconcile with the RPC response. The compose→workspace morph
  (2.2) makes this feel instant and continuous instead of spinner → jump.

**3.3 Live data without churn**
- Preferred: push task/event updates from the gateway over IPC (event stream), drop
  the 1.5s/500ms intervals.
- Minimum: incremental event fetch (`afterSeq: lastSeq`) + append-merge; local 30s
  ticker for relative timestamps so they don't depend on polling.
- Memoize block collapse; stable keys already exist.

**3.4 Designed peak moments**
- **Completion:** check-draw in the stream, one-time ice/success glow sweep across the result
  strip, sidebar dot approval-amber→success with a soft ping, auto-select first deliverable with
  preview fade-in, native notification + dock bounce when unfocused (main process
  `notifications.ts` already exists — wire it).
- **Approval:** the pending strip breathes (slow amber glow), Approve morphs
  button → progress → check before the strip collapses away.
- **First artifact:** "Grok wrote `file`" stream event visually hands off to the
  deliverables list (same view-transition-name).

## Phase 4 — Dead ends, semantics, and detail polish

- **4.1** Remove or wire Bell / Help / topbar "…" / TasksView "Filters". A dead button
  is the fastest way to feel cheap. (Bell could become a real activity popover later;
  for now, remove.)
- **4.2** Icons: Memory nav → `BookMarked` or `Brain`; Tasks nav → `ListChecks`;
  reserve `Sparkles` exclusively for Grok-the-agent (stream blocks + logo).
- **4.3** State coverage: skeleton for file preview (not "Loading…" text), skeletons for
  tasks list, keep existing EmptyState treatment.
- **4.4** Typography detail: SF Pro Display explicitly for ≥20px text, `text-wrap:
  balance` on headings (utility exists, barely used), tabular-nums audit on all counters.
- **4.5** Scroll polish: fade masks (`mask-image`) at top/bottom of sidebar recents and
  work log so lists don't clip harshly.
- **4.6** Performance guardrails:
  - Move body background gradients off `background-attachment: fixed` onto a
    `position: fixed` pseudo-element layer (keeps composited scrolling fast).
  - Audit `backdrop-filter` count per frame; drop it where the surface is opaque anyway.
  - Lower grain overlay z-index below portal layers; verify it never sits over dialogs.
  - `content-visibility: auto` on long work logs.

## Sequencing & effort

| Phase | Items | Effort | Risk |
| --- | --- | --- | --- |
| 1 | native chrome, boot, toasts | ~1 day | low |
| 2 | motion tokens, view transitions, choreography | ~1–2 days | low-med |
| 3 | ⌘K palette, optimistic create, push data, peak moments | ~2–3 days | med |
| 4 | dead ends, icons, states, perf | ~1 day | low |

Dependencies added: `cmdk` (Phase 3), optionally `sonner` (Phase 1). Everything else is
CSS + the platform (View Transitions API), consistent with DESIGN.md's "CSS only" rule.

## Verification

- Record before/after GIFs of: launch, nav switching, task create → complete, approval.
- Test with `prefers-reduced-motion: reduce` — every animation must degrade to opacity.
- Scroll a 500-event work log at 120Hz; watch for dropped frames with DevTools FPS meter.
- Keyboard-only pass: ⌘K, ⌘N, tab order, focus rings on every interactive element.
