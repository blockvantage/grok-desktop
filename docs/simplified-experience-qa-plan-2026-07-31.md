# Grok Desk simplified experience QA report

Date: 2026-07-31

This report focuses on a simpler Desk experience with the strongest Grok workflows embedded by default. It does not pursue one-for-one Grok Build parity.

## Scope

I checked the local Electron app visually with the existing signed-in profile, reviewed the task/sync implementation, and compared the current product shape against the goal of "users should not need to wire anything up."

Evidence captured:

- `apps/desktop/test-results/manual-visual-qa/01-initial-desktop.png`
- `apps/desktop/test-results/manual-visual-qa/02-min-window.png`
- `apps/desktop/test-results/manual-visual-qa/03-tasks.png`
- `apps/desktop/test-results/manual-visual-qa/03-artifacts.png`
- `apps/desktop/test-results/manual-visual-qa/03-memory.png`
- `apps/desktop/test-results/manual-visual-qa/03-settings.png`
- `apps/desktop/test-results/manual-visual-qa/04-composer-draft.png`
- `apps/desktop/test-results/manual-visual-qa/05-existing-chat.png`
- `apps/desktop/test-results/manual-visual-qa/06-slash-menu.png`
- `apps/desktop/test-results/manual-visual-qa/07-command-palette.png`
- `apps/desktop/test-results/manual-visual-qa/visual-qa.json`

Validation commands run:

- `pnpm --filter @grokdesk/desktop build`
- `pnpm --filter @grokdesk/desktop test -- src/renderer/hooks/use-workspace-queue.test.tsx src/renderer/lib/message-queue-store.test.ts src/renderer/lib/conversation-projector.test.ts`
- `pnpm --filter @grokdesk/provider-grok test -- src/acp-session.test.ts`
- `pnpm --filter @grokdesk/gateway test -- src/p0/run-attempts.test.ts src/services/task-create-acceptance.test.ts src/services/mutation-single-flight.test.ts`

## Executive summary

Grok Desk has solid underlying task durability: created tasks are accepted before execution, run attempts have leases/heartbeats, and the follow-up queue survives reloads. The main gap is not raw capability. The app exposes too much machinery and sometimes contradicts itself about state.

The highest impact simplification work is:

1. Make Home truthful and quiet: signed-in users should not see setup/sign-in friction.
2. Treat artifacts as a first-class health surface: completed work must not show broken output cards.
3. Replace visible command plumbing with intent-driven embedded workflows.
4. Make "background workers/subagents" understandable as a compact work graph, not an internal event stream.
5. Add visual QA as a repeatable gate with zero console errors and responsive screenshots.

## Findings

### P0 - Home readiness is stale against account state

Settings shows a connected SuperGrok account and usage, but Home still shows a "Before you can run" checklist with Sign-in warning and the bottom-left shell shows Sign in. This is a trust issue because the app says two incompatible things in the same session.

Likely areas:

- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/lib/readiness-ui.ts`
- `apps/desktop/src/renderer/components/readiness-checklist.tsx`
- `apps/desktop/src/renderer/components/views/home-view.tsx`
- `apps/desktop/src/renderer/components/shell/app-sidebar.tsx`

Acceptance criteria:

- A connected SuperGrok account never renders sign-in as a blocking Home action.
- Readiness derives from one canonical account snapshot, not a stale or partial auth object.
- Home can show a subtle account/usage chip, but setup is hidden unless something is actually blocking Run.

### P0 - Completed artifacts can render as broken outputs

The artifact and chat views show completed work with "File not found" previews. The visual QA trace captured three failing asset loads:

- `grokdesk-asset://local/2ejzf1yYef_4lZyZhmpgnEWa` returned 500
- `grokdesk-asset://local/wiC8UmpLNxsfzIQLt_HSB0i_` returned 500
- `grokdesk-asset://local/4bdxr0M6pF3U5qFkD88OmoTI` returned 500

This makes successful tasks look unreliable. The app should distinguish "file is gone" from "task succeeded" and offer recovery or cleanup.

Likely areas:

- `apps/desktop/src/main/asset-protocol.ts`
- `apps/desktop/src/main/ipc-bridge.ts`
- `apps/desktop/src/renderer/components/views/artifacts-view.tsx`
- `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- `packages/gateway/src/services/artifacts.ts`
- `packages/gateway/src/services/declared-artifacts.ts`

Acceptance criteria:

- Missing local artifact paths do not render generic broken media or raw 500 copy.
- Artifact list marks missing files explicitly and offers "Locate", "Remove from list", and "Open containing folder" when parent exists.
- Task completion summaries do not claim "saved file" when the referenced file is unavailable.
- Visual QA has zero `grokdesk-asset://local` 500s for the seeded profile, or intentional missing assets are represented by graceful UI states.

### P0 - Minimum window layout clips primary controls

At the app minimum window size, Home clips the readiness CTA on the right edge. This means the documented minimum viewport is not actually supported.

Likely areas:

- `apps/desktop/src/renderer/components/views/home-view.tsx`
- `apps/desktop/src/renderer/components/readiness-checklist.tsx`
- shell layout in `apps/desktop/src/renderer/App.tsx`

Acceptance criteria:

- No horizontal clipping at `960x640`.
- Readiness rows wrap actions or collapse into a single primary CTA.
- Playwright screenshot test covers desktop and minimum-window Home.

### P1 - The default surface feels like an admin console

Home currently presents a sidebar with many old chats, Inbox count, workspace state, readiness, cards, composer controls, and smart starts. Visual QA counted 70+ buttons on most top-level screens. The capability is useful, but the first screen asks users to parse too much.

Direction:

- Default Home should be "one composer plus current work".
- Move setup, logs, billing, docs, raw settings, and history management behind secondary surfaces.
- Keep Chats/Tasks as power navigation, but do not make historical failed tasks compete with the primary creation flow.

Acceptance criteria:

- New or returning signed-in user sees a single primary action area and at most three recommended next actions.
- Failed historical work is grouped under "Needs review" instead of interleaved with successful/recent chats.
- Top-level action count on Home is materially reduced.

### P1 - Command palette mixes everyday actions with setup/admin actions

The command palette is useful, but it surfaces "Run setup again", billing/docs/support-style actions, navigation, and recent tasks in one list. For a simplified app, setup should not be a normal daily action once the profile is healthy.

Likely area:

- `apps/desktop/src/renderer/components/command-palette.tsx`

Acceptance criteria:

- Palette ranks current work, new task, search, and stop/cancel first.
- Setup appears only when readiness is blocked or from Settings.
- Admin actions are grouped below daily actions and visually demoted.

### P1 - Slash commands are useful but too developer-facing as the primary capability surface

The slash menu is one of the strongest parts of the app: `/brief`, `/research`, `/organize`, and `/image` are understandable and fast. But slash syntax should be a power-user shortcut, not the only way users discover embedded power.

Direction:

- Keep slash commands.
- Promote the same capabilities as plain-language intent chips: Brief, Research, Create Image, Organize Files, Schedule Work, Summarize Project.
- Use the chosen intent to set effort, role pack, plan-first, model, workspace, and follow-up behavior automatically.

Likely areas:

- `apps/desktop/src/renderer/lib/composer-input.ts`
- `apps/desktop/src/renderer/lib/smart-starts.ts`
- `apps/desktop/src/renderer/lib/role-packs.ts`
- `apps/desktop/src/renderer/components/views/home-view.tsx`

Acceptance criteria:

- Every slash template has a matching non-slash intent entry.
- Intent selection visibly changes the composer mode without dumping a long prompt into the text box.
- The generated task still persists a clear expanded goal for audit/debugging.

### P1 - Memory is too manual for an embedded-power product

The Memory view empty state says "No memories yet" and emphasizes manual add. A simplified Desk should learn from completed tasks and offer reviewable takeaways automatically.

Current supporting code already exists:

- `apps/desktop/src/renderer/lib/takeaways-memory.ts`
- `apps/desktop/src/renderer/App.tsx`

Direction:

- Auto-draft memories from completed work and recurring user preferences.
- Show a small review queue instead of a blank manual database.
- Let users approve, edit, or dismiss suggestions.

Acceptance criteria:

- After a completed task with usable takeaways, Memory shows reviewable suggestions.
- Suggestions never auto-save sensitive content without an explicit setting.
- Home can use approved memory to personalize starter actions.

### P1 - Background workers/subagents need a product-level representation

The event pipeline is conservative and truthful, which is good. However, users cannot easily understand whether Desk is researching, editing files, waiting for approval, retrying, or blocked unless they inspect the transcript closely.

Relevant areas:

- `apps/desktop/src/renderer/lib/activity-store.ts`
- `apps/desktop/src/renderer/lib/events-to-activity.ts`
- `apps/desktop/src/renderer/lib/conversation-projector.ts`
- `apps/desktop/src/renderer/components/task-stream.tsx`
- `packages/provider-grok/src/acp-session.ts`

Direction:

- Add a compact "Work graph" per task: Plan, Research, Edit, Review, Deliver.
- Map worker/subagent events into these stages without pretending more certainty than events provide.
- Keep raw transcript available, but make the default experience explain progress and handoffs.

Acceptance criteria:

- Running tasks show one stable stage indicator with current action and elapsed time.
- Approval/needs-you states are visually distinct from failures.
- Retried or recovered runs show one coherent task timeline, not duplicate confusing rows.

### P2 - Follow-up sync is durable but has one important idempotency gap

The workspace follow-up queue is strong: queued messages are conversation-scoped, leased, recovered, and normal follow-ups carry `clientMutationId`. Mid-run ACP interjection is weaker because it can mark a queued item delivered without the same explicit idempotency boundary as `tasks.followUp`.

Relevant areas:

- `apps/desktop/src/renderer/hooks/use-workspace-queue.ts`
- `packages/provider-grok/src/acp-session.ts`
- `packages/gateway/src/services/mutation-single-flight.ts`

Direction:

- Give interjections a client mutation id and provider/gateway dedupe record.
- Preserve queued item state until the provider acknowledges the exact id.
- Add a crash/reload test around queued interjection during active ACP turn.

Acceptance criteria:

- Replaying the same queued interjection after reload does not duplicate the user message.
- Dropping or timing out an interjection leaves the composer queue recoverable.
- Normal follow-up and mid-run interjection share one dedupe model.

### P2 - Motion and transitions need a coherent system

The app has view transitions and animations, but the visual pass did not show a single product motion language. Some surfaces animate, while state changes such as missing artifacts, readiness, and command surfaces feel abrupt or purely modal.

Relevant areas:

- `apps/desktop/src/renderer/lib/view-transition.ts`
- `apps/desktop/src/renderer/App.tsx`
- task/workspace view components

Direction:

- Define a small motion system: navigation crossfade, task state pulse, artifact reveal, command palette entrance, reduced-motion alternatives.
- Avoid decorative motion; use animation only to clarify state changes.

Acceptance criteria:

- Navigation, task creation, task completion, artifact reveal, and approval parking use consistent durations/easing.
- `prefers-reduced-motion` disables nonessential transitions.
- Screenshot/video QA verifies no overlapping text or clipped animated states.

### P2 - Visual QA is not yet a reliable gate

The app can be visually tested, but Playwright Electron launch needed `GROKDESK_NODE_PATH` set to a system Node. Without that, the gateway child used Electron-as-Node and hit a native `better-sqlite3` ABI mismatch in this local setup.

Likely area:

- `apps/desktop/src/main/gateway-process.ts`
- `apps/desktop/src/main/gateway-process.test.ts`

Acceptance criteria:

- A documented `pnpm` visual QA command launches the app with the right user data and gateway Node.
- The run captures desktop, minimum window, Home, active chat, artifacts, memory, settings, slash menu, and command palette.
- The gate fails on console errors, failed asset responses, and horizontal overflow.

### P3 - Bundle/chunk shape hints at slow first-render risk

The desktop build succeeds but reports large chunks and a warning that `apps/desktop/src/renderer/lib/api.ts` is both statically and dynamically imported. This is not the primary UX issue, but it can hurt perceived speed.

Acceptance criteria:

- Remove accidental static/dynamic import overlap for `lib/api.ts`.
- Lazy-load heavy markdown/mermaid/cytoscape paths only when previews need them.
- Add bundle-size tracking for the main renderer chunk.

## Recommended embedded capability set

Port or preserve only capabilities that make Desk feel powerful without setup:

1. Brief and summarize: project brief, launch brief, status brief, takeaways.
2. Research: web-backed research with citations/artifacts, hidden behind a Research intent.
3. Create media: image/video generation and edit flows with artifact previews and recovery.
4. Organize files: workspace scan, rename/move suggestions, review-before-apply.
5. Background work: scheduled tasks and resumable work, represented as current work rather than scheduler plumbing.
6. Memory: reviewable automatic takeaways, not a blank manual notebook.
7. Subagents/workers: internal orchestration visible only as a simple work graph.
8. Command shortcuts: slash commands and command palette remain, but as accelerators.

Avoid importing feature classes that increase setup burden or expose implementation detail:

- Provider/runtime selection for normal users.
- Setup-first onboarding loops once the account is healthy.
- Raw tool/plugin management on the primary surface.
- One-for-one Grok Build project scaffolding unless it directly maps to a Desk intent.

## Execution plan

### Phase 1 - Truth and reliability first

Owner: desktop shell + gateway/artifact boundary.

Tasks:

1. Unify readiness/auth state so Home, Sidebar, Settings, and Command Palette agree.
2. Add artifact existence validation and missing-artifact UI states.
3. Fix minimum-window overflow on Home and readiness rows.
4. Add a repeatable visual QA command and fail on console errors/asset 500s.

Suggested tests:

- Unit tests for readiness state using signed-in/engine-ready/workspace-ready combinations.
- Artifact view tests for existing, missing, and parent-folder-existing paths.
- Playwright visual QA at `1440x1000` and `960x640`.

Exit criteria:

- Logged-in profile shows no false sign-in/setup blockers.
- Existing seeded screenshots have no clipped CTAs and no generic broken artifact output.

### Phase 2 - Simplify daily surfaces

Owner: product shell + Home/Palette.

Tasks:

1. Redesign signed-in Home around one composer and one "current work" band.
2. Move old failed/history clutter into grouped secondary views.
3. Demote setup/admin actions in command palette.
4. Replace duplicate search fields with one contextual search behavior per view.

Suggested tests:

- UI structure tests for primary action count and hidden setup when ready.
- Screenshot tests for Home, Tasks, Artifacts, Settings.

Exit criteria:

- A signed-in user can understand the first screen in under a few seconds: ask, continue current work, or review needs-you.

### Phase 3 - Embed powerful workflows

Owner: composer, role packs, recipes, memory.

Tasks:

1. Promote slash command templates into non-slash intent chips.
2. Make intent selection set role pack, effort, model hints, workspace behavior, and plan-first automatically.
3. Add reviewable automatic Memory suggestions from completed task takeaways.
4. Show scheduled/background work as current work, not a separate mental model.

Suggested tests:

- Composer tests: intent chip and slash command expand to equivalent task payloads.
- Memory tests: task completion produces safe draft takeaways.
- End-to-end test: Research intent creates a task, surfaces work graph, saves artifact, suggests memory.

Exit criteria:

- Users can access Brief, Research, Image, Organize, Schedule, and Memory workflows without knowing slash syntax or configuring role packs.

### Phase 4 - Work graph, subagents, and sync polish

Owner: task stream + provider/gateway sync.

Tasks:

1. Map event/activity stream into stable Plan/Research/Edit/Review/Deliver stages.
2. Add interjection idempotency for mid-run ACP turns.
3. Make retry/recovery timelines read as one task, not duplicated rows.
4. Make approval states clearly different from failure states.

Suggested tests:

- Conversation projector tests for worker events, approvals, retries, and recovered attempts.
- Queue tests for duplicate mid-run interjection replay.
- Visual test for active task, approval parked, recovered task.

Exit criteria:

- Users can tell what the app is doing, what is blocked, and what was delivered without reading raw logs.

### Phase 5 - Motion, performance, and release gate

Owner: frontend platform.

Tasks:

1. Define motion tokens and state transition rules.
2. Apply consistent motion to navigation, task start, progress, artifact reveal, and command surfaces.
3. Respect reduced motion.
4. Clean bundle split warnings and lazy-load heavy preview libraries.
5. Add visual QA and bundle-size checks to CI or release smoke.

Exit criteria:

- The app feels calmer and faster, with no clipped text, no overlapping animated states, no unexplained setup friction, and no broken completed artifacts in the QA profile.
