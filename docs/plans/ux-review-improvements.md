# UX Review — Implementation Plan

Derived from the 5-surface UX review (onboarding, composer, workspace, navigation, feedback).
Guiding principle: **most changes reduce on-screen signal, not add it.** Surface hidden power; consolidate noise.

i18n note: `createTranslator` falls back to English, so new copy is added to `en.json` only; other locales inherit until translated.

## Wave A — Onboarding & first-run truth
- **A1** Ship the approval-mode scene (already fully translated, never rendered). Order becomes
  `welcome → intent → workspace → policy → account → ready`. Wire `onApprovalMode`. Show `Approval · {mode}` on the Ready summary.
- **A2** Fix self-contradicting folder copy ("the only thing Grok needs" above a Skip button; orange ⚠ on skip).
- **A3** Name demo mode on the account step instead of revealing it only after onboarding.
- **A4** Update `lib/onboarding.test.ts` scene assertion + add a smoke test for the new scene.

## Wave B — Composer discoverability + model surface
- **B1** Dismissible one-line hint under the composer: `Type / for commands · @ to add files`. Persists dismissal.
- **B2** Surface the current model + effort as an inline, clickable label by the "Run options" gear (no more unlabeled gear).

## Wave C — Shortcuts reference
- **C1** A shortcuts help sheet on `?` / `⌘/`, also reachable from the command palette. Central list of the hidden shortcuts (`⌘1–6`, `⌘⇧C`, `⌘⇧P`, `/`, `@`, etc.).

## Wave D — Workspace status consolidation + approval action bar
- **D1** One authoritative agent-status signal in the header: **Working / Waiting on you / Blocked**; make "Waiting on you" unmistakable (today the pill is static gray).
- **D2** A single persistent approval action bar that carries the Approve/Reject buttons with it, replacing the sticky "Jump to approval" pointer + separate inline card.

## Wave E — Copy & consistency polish
- **E1** Soften gateway-dead copy toward "reconnecting automatically".
- **E2** Route Settings/tool errors through `humanizeError()` (stop leaking raw `err.message`).
- **E3** Empty states teach (Artifacts: "outputs from your tasks", etc.).
- **E4** Terminology pass — standardize Run vs Start, Chat vs Task where user-facing.

## Verification
- `pnpm --filter @grokdesk/desktop typecheck` after each wave.
- Targeted vitest for touched areas (onboarding, workspace, home).
- Final full `typecheck` + relevant `test` run.

## Status — DONE (branch `ux/review-improvements`)
All waves implemented. `typecheck` clean; full desktop suite **1316/1316** green.

- **A1** ✅ Approval scene shipped (`policy` between workspace/account); wired `onApprovalMode`; `Approval · {mode}` on Ready. Was fully-translated dead code.
- **A2** ✅ Folder copy no longer contradicts the Skip button; Ready shows "private Grok Desk workspace" instead of a false ⚠.
- **A3** ✅ Demo mode named on the account step ("explore in demo mode — limited models and paused schedules").
- **A4** ✅ `onboarding.test.ts` scene list updated.
- **B1** ✅ Composer hint now teaches `/ commands · @ files` (reused existing ambient line — no new widget).
- **B2** ✅ Run-options gear shows current `model · effort` instead of a bare icon.
- **C1** ✅ `ShortcutsHelp` dialog on `?` / `⌘/` + command-palette entry; new `show_shortcuts` intent (tested).
- **D1** ✅ `StatusPill emphasis` — workspace header renders Waiting-on-you / Blocked loud (ring + solid tint); lists stay calm.
- **D2** ✅ Top approval strip now **carries** Approve/Reject (shared `runApprove`/`runReject` with the inline card) — no more "jump to find the buttons".
- **E1** ✅ Gateway-dead copy clarified (names the local engine, reassures chats/files are safe).
- **E2** ✅ Settings/tool errors routed through `humanizeError()` (8 sites) — no more raw `err.message`.
- **E3** ✅ Artifacts empty state explains what an artifact is.
- **E4** ✅ Verified: "Run vs Start" was a dead key (no live inconsistency); Chat/Task duality is intentional — no risky rename.

## Post-review hardening (Codex adversarial review of the branch diff)

An independent Codex review of the whole diff surfaced 5 real defects (all a11y/logic — none in the i18n work).
All fixed and verified:

- **Escape double-handling** (`App.tsx` / `app-shortcuts.ts`): with the shortcuts dialog open, Escape both closed
  it (Radix) and resolved to `workspace_to_list`, navigating away underneath. Added `shortcutsOpen` to the resolver
  context + a `close_shortcuts` intent; an open dialog now owns the keyboard (Escape/toggle close it, everything else
  is swallowed). +2 regression tests.
- **Approval double-submit window** (`task-workspace-view.tsx`): the busy lock cleared on RPC-resolve, before the async
  `approval_resolved` event cleared the bar — re-enabling both surfaces for the same target. Runners now hold the lock
  through success and release only on failure.
- **Silent action-bar failures** (`task-workspace-view.tsx`): the action bar called `runApprove`/`runReject` directly,
  so a rejected `tasks.approve` (e.g. gateway down) threw an unhandled rejection with no user feedback. Now caught and
  surfaced via `humanizeError` toast; runners rethrow so the inline card's existing `runApprovalAction` announce path
  still works.
- **Misleading `role="alertdialog"`** on the non-modal approval bar (no focus containment) → `role="group"` with an
  accessible name.
- **SceneApproval radiogroup** (`onboarding-wizard.tsx`): custom radios lacked roving tabindex + arrow keys → added both
  (WAI-ARIA radiogroup pattern).

`typecheck` clean; full desktop suite **1318/1318** green.

## i18n — fully translated (no placeholders)

The 19 new keys (`shortcuts.*`, `command.shortcuts`, `onboarding.launchReadyFolderManaged`) and the 7 reworded keys
(`home.composerHint`, `artifacts.noArtifactsDesc`, `status.gateway*`, onboarding copy) are now **natively translated**
in all 6 non-English locales (de/es/fr/ja/pt/zh) — done via a 6-locale translate → adversarial native-QA workflow, not
English placeholders. Key parity holds (1316 keys/locale). The new user-facing shortcut/onboarding strings are locked into
the `proseKeys` regression guard in `i18n/i18n.test.ts` so they can't silently revert to English. `typecheck` clean;
full desktop suite **1316/1316** green.

## Second-opinion hardening (Grok adversarial review of the branch diff)

An independent **Grok** review (via a `grok:grok-review` multi-agent workflow — a11y / React-correctness / i18n lenses
plus a general backstop, each finding then verified against the real code) ran after the Codex pass. It confirmed 2
distinct defects (deduped from 3 raised; 0 rejected) — both minor, neither in the substantive UX logic. Both fixed:

- **`proseKeys` clone-guard omitted `shortcuts.groupGeneral`** (`i18n/i18n.test.ts`): the three sibling section headings
  (`groupNav`/`groupChat`/`groupComposer`) were locked against English-clone regressions but the fourth heading was left
  out. Added it. Safe for all locales — the Latin clone branch is gated on `space && length>20` so es `"General"` (a
  legit cognate) still passes, while ja `全般` / zh `通用` are now guarded against a future `"General"` clone. (This
  reverses an earlier deliberate exclusion that was based on a misread of the guard's gating.)
- **Approval busy-lock not released on the success path** (`task-workspace-view.tsx`): the Codex-round runners hold the
  lock through success (to block double-submit until the async `approval_resolved` event lands) but only call
  `endApprovalBusy` in `.catch()`, so resolved-approval keys accumulated in the `approving` map for the life of a
  conversation. Not restored to `.finally()` (that reopens the double-submit window); instead added a provably-safe
  self-heal effect that clears the map when nothing is pending (`pendingApprovalKey === null`) — can never drop a live
  lock (no pending approval ⟹ nothing actionable) and keeps the key through the resolve window. The dropped-`approval_resolved`
  edge is left as-is: it desyncs the whole event-driven UI, not just this button, so special-casing it here would be
  inconsistent.

`typecheck` clean; full desktop suite **1318/1318** green.
