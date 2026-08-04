# Grok Desk product experience audit

Date: 2026-07-15  
Scope: current working tree, including uncommitted changes  
Method: source and state-flow review, production build, isolated first-run walkthrough, focused test/typecheck runs

## Executive summary

Grok Desk already has a coherent visual language and many of the right product pieces. The roughness is not primarily a styling problem. It comes from several product states being inferred from implementation details instead of modeled explicitly:

- a follow-up task and a subagent are both represented by `parentTaskId`;
- “never signed in” and “session expired” both become `needsReauth`;
- the in-app browser is preferred by prompt text, but not guaranteed by capability routing;
- the message queue exists only inside the mounted task component;
- account, engine, usage, gateway, browser, task, and worker status are displayed by separate surfaces with no shared status hierarchy.

The result is an app that can look polished while telling the user contradictory or incomplete stories. The most important improvement is to create truthful state models for account, conversation/run, worker activity, browser capability, and queued messages, then make every surface read from those models.

The recommended north star is:

> One conversation, one continuous activity timeline, one clear current state, and every side effect visible in the surface where it matters.

## What was verified

- The desktop production build completes successfully.
- Engine tests pass: 69/69.
- Gateway tests pass: 459/459.
- Desktop tests have one failing file: 485/486 tests pass. The i18n suite reports missing new media and sign-out keys outside English.
- Desktop typecheck currently fails at `apps/desktop/src/main/ipc-bridge.ts:185` because `method` is referenced outside its scope in the sign-out error path.
- An isolated fresh-profile walkthrough covered launch, onboarding, the signed-out Home surface, and Account settings.
- The renderer logs two CSP errors because `http://[::1]:*` and `ws://[::1]:*` are invalid source expressions.
- The current Electron E2E suite contains one smoke path for Settings, Tools, and License. It does not cover onboarding, sign-in, sign-out, task creation, queue behavior, subagents, or the in-app browser.
- A real authenticated Grok/browser run was not performed because the audit used an isolated profile and did not touch the user’s credentials. Browser correctness is therefore assessed from routing code, tests, and existing evidence.

## Immediate release blockers

### 1. The current sign-out changes do not typecheck

`method` is declared inside the `try` block in `ipc-bridge.ts`, then read in `catch`. This prevents a clean typecheck and means the in-progress cache-clearing path cannot ship as written.

Fix first:

- move request parsing outside the `try`, or retain an `isSignOutRequest` flag in outer scope;
- add an integration test that covers successful logout, CLI logout failure, local wipe failure, usage-cache clearing, and the next `auth.status` result;
- run desktop typecheck and the complete workspace test suite before further UX work.

### 2. Fresh signed-out state is shown as an expired session

The isolated walkthrough explicitly chose “Continue without signing in.” Home then immediately displayed “Sign in again to keep working with SuperGrok.”

Cause: `getGrokAuthStatus()` currently sets `needsReauth = !signedIn`, so a user who has never authenticated is indistinguishable from a user whose session expired.

Required model:

```text
checking
signed_out          — no prior/usable session; neutral sign-in invitation
signing_in          — OAuth started; waiting for completion
signed_in           — usable credential and account identity
reauth_required     — a previously usable session became invalid
signing_out
error               — probe failed; not equivalent to signed out
```

Network reachability and engine readiness must be separate fields, not additional interpretations of auth.

### 3. Boot is blocked by account probing

The initial app effect waits for `auth.status` inside the same `Promise.all` that gates first render. `auth.status` may execute `grok models` with a 20-second timeout. During the isolated walkthrough, the real CLI probe kept the app on its launch splash long enough to exceed the 30-second interaction wait; replacing the probe with an immediate executable allowed the app to load normally.

The shell and onboarding should render from local settings immediately. Account verification should run in the background and update the account state when ready. A slow or broken CLI must never hold the entire app behind a brand splash.

### 4. Desktop test and localization coverage are red

The English catalog added media and sign-out strings that are missing from other locales. Until translations exist, use explicit English fallback behavior or add the keys to every locale so the coverage invariant remains true.

## Findings and recommendations

## A. Conversation, task progress, and subagents

### Current problem: conversation turns and agents are conflated

The chat model uses `parentTaskId` to chain normal follow-up turns. The subagent HUD’s `isLikelySubagent()` also defines every non-root task with `parentTaskId` as a subagent, including done, failed, and cancelled follow-ups. The engine event normalizer has no subagent-created, subagent-progress, subagent-message, or subagent-finished event.

Consequences:

- a normal follow-up can appear as an “agent”;
- the active agent count is not grounded in actual Grok delegation;
- the HUD cannot show who delegated work, what the worker owns, or how results return;
- focusing a “worker” is effectively focusing another task/turn, not a true worker stream;
- concurrent activity is combined per task/turn rather than rendered as one causally ordered timeline.

### Recommended data model

Keep these concepts separate:

```text
Conversation
  id
  ordered user/assistant turns

Run
  id
  conversationId
  initiatedByMessageId
  status
  startedAt / completedAt

Worker
  id
  runId
  parentWorkerId
  label
  objective
  status
  currentActivity

ActivityEvent
  runId
  workerId (main worker included)
  kind
  phase
  timestamp
  receipt/result
```

Do not derive `Worker` from `parentTaskId`. Introduce normalized engine events such as `worker_started`, `worker_activity`, `worker_message`, `worker_completed`, and `worker_failed`. If the CLI cannot provide these yet, hide the agent HUD rather than infer false agents.

### Rethink the task stream as an activity timeline

The current branch forces stream density to `chat` and removes the tools/work-log toggles. Removing raw log noise is a good direction, but it also removes the user’s route to understanding what the agent is doing.

Use one default conversational timeline with progressive disclosure:

- user and final assistant messages remain full-width conversation blocks;
- live work appears as a single “Working” block with the current meaningful action;
- completed work folds into phases such as “Reviewed 12 files,” “Compared 4 sources,” or “Updated 3 files”;
- selecting a phase expands tool receipts and worker contributions inline;
- approvals and questions remain in timeline order rather than becoming detached banners;
- worker results merge back into the parent phase and retain a link to the worker detail.

Avoid exposing raw tool names such as `browser_open` as the primary language. Translate them into present-tense actions and concrete objects. The raw receipt should remain available in an expanded technical view.

### Task header

The header should answer, at a glance:

1. What conversation is this?
2. Is Grok working, waiting on me, done, or blocked?
3. What is open beside the conversation?
4. What can I do now?

Recommended order:

```text
Back | title + state | workers | browser | files panel | pause/stop | more
```

“Show side panel” should be a first-class `PanelRightOpen/Close` icon in this row, as requested. It is currently buried in the overflow menu even though it changes the primary layout. Keep export, remember, image, help, and other secondary commands in overflow.

Use an immediate derived title from the user’s goal, then replace it with the generated title when available. Showing “New chat” throughout an active run weakens orientation when several tasks are running.

## B. In-app browser

### Current architecture is close, but priority is advisory rather than guaranteed

The app has the right basic components: an isolated Electron browser service, a loopback host, a `desk-browser` MCP server, a globe control, auto-open logic, and a chat/browser split.

The current working tree also contains an important fix: it resolves an absolute Node interpreter for `desk-browser` and forces Electron-as-Node when required. The comments describe the existing failure mode accurately: when MCP registration fails, Grok falls back to Chrome/Google.

However, the product still depends on four best-effort links:

1. the control plane starts;
2. the MCP process registers successfully;
3. the engine discovers and chooses `browser.*`;
4. the renderer receives a normalized `browser_*` event and opens the pane.

Prompt text saying “always use desk-browser” is not a reliability boundary.

### Make browser capability explicit

At gateway startup and before every run, establish a capability record:

```text
browser: unavailable | ready | degraded
reason: host_missing | mcp_spawn_failed | tools_not_discovered | healthy
tools: browser.open, browser.click, ...
```

Then:

- do not advertise or enable Chrome/headless browser connectors as an automatic fallback when `desk-browser` is expected;
- if the in-app browser is unavailable, tell the user before the run or at the first browse attempt;
- allow external/headless Chrome only after an explicit user choice such as “Use external browser for this task”;
- record which browser provider executed every browse receipt;
- surface a small degraded state on the globe rather than silently doing work elsewhere.

OAuth sign-in is a separate security context and should continue in the system browser unless a dedicated trusted auth window is implemented. “Always use the in-app browser” should apply to agent work, not account authentication.

### Browser UI issues to finish

- The state model includes `pinned`, but the current UI has no pin action.
- “Keep closed” is component state and is lost when the workspace unmounts; persist it by conversation ID.
- The pane should auto-open from the capability/tool execution event, not only from parsing the conversation stream.
- The globe needs states for unavailable, starting, active, blocked, and error—not only active/open.
- Keep chat width stable during rapid browser activity. Never repeatedly open/close the split as tools fire.
- Add one true Electron E2E: fake engine emits `browser.open`, the native pane appears, the URL/status updates, close remains sticky, and no external browser call occurs.

The existing evidence file explicitly says full browser MCP effect coverage is not yet claimed. Treat the current interpreter fix as promising but unverified until that E2E passes in both dev and packaged builds.

## C. Queued messages

### Current behavior

The queue supports add, remove, retry, FIFO auto-drain, and “send now.” It does not support edit or reorder. It is local React state inside `TaskWorkspaceView` and is therefore lost when that component unmounts. Queue items have only `pending` and `failed`; retry and send-now do not claim an item with a `sending` state, so multiple send paths can race.

### Required queue behavior

- Edit text and attachments inline.
- Save with Enter; cancel with Escape; send immediately with Cmd/Ctrl+Enter.
- Show `pending`, `sending`, and `failed` states.
- Disable duplicate actions while an item is sending.
- Persist by conversation root so navigation, task replacement, and app restart do not lose intent.
- Keep queued messages when the current run fails or the gateway restarts.
- Allow reorder after edit is stable; drag-and-drop is useful but lower priority than correctness.
- Provide a short Undo after removal or successful send.
- Make the queue count visible next to the composer without permanently expanding every row.

Recommended ownership: a durable queue service/store keyed by `conversationId`, not a hook owned by the currently selected task. Sending a queued message should create the next run atomically and retain an operation receipt so the UI can reconcile after a crash.

## D. Sign-in, sign-out, and account status

### Sign-in needs a real flow, not a toast plus polling loop

`signIn()` starts OAuth, displays a toast, then polls every two seconds for up to three minutes. The loop has no shared in-progress state, cancellation, deduplication, or visible progress surface. Multiple clicks can start multiple loops.

Recommended flow:

```text
Start sign-in
  → Opening secure browser
  → Waiting for SuperGrok
  → Verifying account
  → Connected as <name>
```

Keep this state in one account controller. Onboarding, sidebar, Settings, task recovery, and the reauth banner should all invoke the same controller. Show Cancel, Retry, and “I finished signing in” when appropriate. Disable duplicate sign-in actions while a flow is active.

### Sign-out has product-wide consequences that are not explained

The new sign-out path runs `grok logout` and deletes `~/.grok/auth.json`. That is the Grok Build CLI’s shared session, not a Desk-only cookie. A plain “Sign out” menu item does not communicate that the CLI on this Mac is also affected.

Define and communicate the semantics:

- preferred label if the shared session must be removed: “Sign out of SuperGrok on this Mac”;
- confirm when tasks are running and explain whether they will stop or finish;
- stop or settle active task processes before deleting shared credentials;
- clear usage, account identity, models that require auth, and reauth notices atomically;
- verify signed-out state without accepting a public model list as proof of login;
- on partial failure, show exactly what remains and a retry action;
- on next launch, remain signed out without a stale profile or warning banner.

If Desk can maintain its own token/session without breaking Grok Build, offer a narrower “Disconnect from Grok Desk” action and leave the CLI session untouched. Otherwise the broader wording and confirmation are essential.

### Stop polling auth every 30 seconds

The app’s safety loop calls `auth.status` every 30 seconds. Because that can spawn `grok models`, it is too expensive and can make account state flicker. Prefer:

- local auth-file watching;
- explicit refresh after sign-in/sign-out;
- refresh on app focus with a minimum interval;
- a slower health check only when a prior valid session exists.

## E. Onboarding and first value

### What works

The full-window presentation is visually coherent, the progress model is understandable, and skipping account/folder setup is possible. The design feels intentional rather than like a settings form.

### What does not work

The flow has five scenes before the user can try the product, yet the optional choices do not resolve into a coherent guest experience:

- skipping a folder leads to a final row reading “Pick a workspace folder to continue” even though entry is enabled;
- skipping sign-in leads directly to a “Sign in again” warning;
- the seeded goal says “Look through this folder” when no folder was chosen;
- the account step says the user can explore first, but an unsigned production engine cannot complete normal Grok work;
- the intent choice currently seeds a generic role/starter but does not produce an immediate visible personalization payoff.

### Recommended activation flow

Make first launch two phases, with a third step only when needed:

1. **Connect SuperGrok** — recommended and honest about what works without it. “Explore without signing in” must enter a clearly labeled demo/read-only mode, not a broken working mode.
2. **Start the first task** — show the real composer with 3–4 concrete starter goals. The user should learn by doing.
3. **Choose project access when needed** — a private managed workspace is the default. Ask for a project folder just in time when the selected goal requires existing files.

Move role/intent personalization after the first successful result or infer it from the first goal. Asking “what kind of work?” before the user trusts the product increases setup cost without immediate proof.

Onboarding completion should be based on an activation event, not only a settings flag. Useful milestones are: account connected or explicit demo mode chosen; first run created; first meaningful assistant response or deliverable received.

## F. Sidebar account, usage, and connection

The signed-in sidebar footer currently shows avatar, name, and “SuperGrok,” with Settings, Refresh, and Sign out in a menu. Usage is separately fetched for Home and again inside Account settings. The sidebar receives no usage state.

### Recommended footer

Expanded sidebar:

```text
[avatar] Name                       chevron
         Connected · 42% used
         ━━━━━━━━━━━  reset Aug 2
```

Collapsed sidebar:

- avatar with a subtle usage ring;
- status dot only when attention is required;
- tooltip with account, connection, usage, and reset date.

Clicking the row opens the account menu. Clicking usage opens Account settings at usage detail. Keep Refresh inside the menu, but do not make it one of the main account facts.

Use one shared cached `UsageSnapshot` owned by the account controller. Home, sidebar, and Settings should not initiate independent requests or disagree. Show usage whenever valid data is available, not only at warning thresholds. Reserve warning color for genuinely elevated usage.

### Unify connection language

Today “SuperGrok,” “connected,” “online,” “engine ready,” `needsReauth`, gateway status, and browser status can all appear separately. Define a hierarchy:

1. account: signed out / connected / needs attention;
2. local engine: ready / starting / unavailable;
3. task: working / waiting / done / failed;
4. capabilities: browser/desktop/tool-specific state.

Only the highest actionable issue should become a banner. Routine healthy state belongs in the sidebar/account detail, not in multiple cards and labels.

## G. Additional issues found

### Shell and state ownership are too centralized

`App.tsx` is roughly 1,600 lines, `TaskWorkspaceView` roughly 1,870, `AppSidebar` roughly 860, and `OnboardingWizard` roughly 655. This is not only a maintainability concern: these components currently own overlapping auth, usage, navigation, queue, browser, task, and presentation state, which is why state is lost or interpreted differently between surfaces.

Extract controllers/stores around product concepts, not visual fragments:

- `AccountController`: auth state machine, usage, sign-in/out operations;
- `ConversationController`: selected conversation, runs, durable queued messages;
- `ActivityStore`: normalized run/worker events and derived timeline;
- `CapabilityRegistry`: browser, desktop, connectors, health and provider;
- `WorkspaceLayoutController`: browser/files panel state keyed by conversation.

Keep presentational components small and driven by these shared models.

### Blank/slow launch handling needs a timeout escape

Even after decoupling auth, the launch screen needs an escape route. If the gateway is not ready quickly, render the shell with a diagnostic recovery state rather than leaving only a logo and progress bar. Offer Retry, Open logs, and Copy diagnostics.

### CSP console errors

Fix the invalid IPv6 wildcard source expressions or generate valid dev-only origins. A production app should start with a clean renderer console; persistent CSP errors make real failures harder to spot.

### Bundle and responsiveness budget

The production renderer currently emits an approximately 1.99 MB main JS chunk plus a roughly 724 KB markdown chunk. This is not the principal UX defect, but after state-flow work the app should establish budgets for first interactive render, conversation open, and long-stream update. Measure before optimizing.

### Settings account page is overloaded

The Account card mixes identity, setup restart, refresh, sign-in/out, usage, privacy, security explanation, account data controls, and billing. Keep the primary account state and actions compact; move the long privacy explanation to a dedicated Privacy/About section. The current large card makes basic account actions feel administrative.

## Recommended implementation order

### P0 — restore truthful, shippable state

1. Fix typecheck, i18n coverage, CSP errors, and the current sign-out cache path.
2. Introduce the explicit account state machine and separate fresh signed-out from reauth-required.
3. Decouple launch from CLI/account probing; add gateway recovery UI.
4. Define sign-out semantics for running tasks and the shared Grok CLI session.
5. Add auth/onboarding/sign-out E2E coverage.
6. Add a browser capability handshake and one dev + packaged in-app-browser E2E.

### P1 — rebuild the core working loop

1. Separate Conversation, Run, Worker, and ActivityEvent models.
2. Add real normalized worker lifecycle events; hide inferred subagents until truthful data exists.
3. Replace the current stream with the progressive activity timeline.
4. Move Files side-panel toggle into the task header and unify task controls.
5. Make queued messages editable, race-safe, and durable by conversation.
6. Rework onboarding around connect → first task → just-in-time folder access.

### P2 — make the whole shell feel connected

1. Put shared usage and account health in the sidebar footer.
2. Simplify Account settings and remove duplicated usage fetching.
3. Persist browser/files layout preferences per conversation.
4. Add performance budgets, long-thread E2E, keyboard/accessibility checks, and packaged smoke coverage on macOS and Windows.

## Acceptance criteria

- Fresh launch renders an actionable surface within 2 seconds even when auth probing is slow or fails.
- Choosing “continue without signing in” never produces reauth language. Demo/limited behavior is explicit.
- Sign-in has one visible, cancelable flow and cannot create duplicate polling loops.
- Sign-out produces a stable signed-out state on the next launch, clears prior usage, and explains its effect on the Grok CLI session.
- A browser task opens the in-app pane within one second of the first browser execution event. External Chrome never opens unless the user explicitly chooses it.
- Browser capability/provider is visible in receipts and testable in packaged builds.
- Every displayed subagent corresponds to a real worker lifecycle; normal follow-up turns never appear as agents.
- Worker activity updates in the timeline within 500 ms of a gateway event and remains understandable after completion.
- Queued messages can be edited and survive navigation, task replacement, gateway restart, and app restart.
- Files side-panel toggle is a header icon with correct pressed state and tooltip.
- Sidebar shows current usage from the same snapshot used by Settings; values never disagree across surfaces.
- Desktop typecheck, all unit tests, and the expanded Electron E2E suite pass.

## Code anchors

- App boot/auth/usage/navigation: `apps/desktop/src/renderer/App.tsx`
- Task workspace, browser split, queue surface: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Queue ownership and state: `apps/desktop/src/renderer/hooks/use-workspace-queue.ts`, `apps/desktop/src/renderer/lib/message-queue.ts`
- Chat aggregation: `apps/desktop/src/renderer/hooks/use-chat-events.ts`, `apps/desktop/src/renderer/lib/chats.ts`
- Subagent inference: `apps/desktop/src/renderer/lib/subagent-hud.ts`
- Engine event normalization: `packages/engine-grok/src/events.ts`
- Browser control-plane injection: `apps/desktop/src/main/gateway-process.ts`, `packages/gateway/src/services/desk-mcp-planes.ts`
- Browser MCP implementation: `apps/desktop/resources/browser-mcp-server.mjs`
- Auth truth and shared-session logout: `packages/engine-grok/src/auth-bridge.ts`
- Account settings and usage: `apps/desktop/src/renderer/components/views/settings/account-tab.tsx`
- Sidebar account footer: `apps/desktop/src/renderer/components/shell/app-sidebar.tsx`
- Existing Electron smoke coverage: `apps/desktop/e2e/smoke.spec.ts`
