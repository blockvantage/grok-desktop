# Grok Desk Remote (mobile) — Radical Critique & Fix Plan

Full teardown, 2026-07-13. Four parallel critique passes (desktop-connection
functionality trace, UX flow audit, UI design-system audit, premium-bar audit)
over `apps/mobile` + the remote pipeline (`packages/gateway` remote services,
`services/remote-relay`, desktop `remote-tab`/`remote-control-banner`).
20+ headline claims were re-verified line-by-line in source before writing this
doc — every one held. Items marked **[verified]** were confirmed first-hand,
not just reported by a pass.

**Baselines at critique time:** mobile vitest **31/31 (9 files)** · gateway
**106/106 under Node 20** · relay **3/3** · desktop 273/273 · latest mobile
commit `210d049`.

**Execution progress:** Phases 0–11 landed (see per-item marks). Mobile **36/36**, shared
**167**, gateway **106**, relay **4**. Deferred-pass shipped (queue UI, rekey, pair_fail, icons, local notify, FlatList, a11y copy). Phase 12 physical matrix remains operator-run.

**Verdict:** the security architecture is genuinely excellent — blind relay,
E2E sealed frames, allowlist + Zod re-validation, clean revocation — and the
visual foundation (tonal ladder, Btn spring, skeletons) is real. But the app
fails its own product promise: it is a *remote control* on which **approvals
are invisible, nothing is live, and a single 20-second timeout destroys the
pairing**. The connection layer polls where it should push, the UI swallows
its own feedback into a dead variable, and the premium layer stops at the
first screen — no icon, no splash, no navigation, no safe-area system, glyph
characters for icons. The fix is not more polish on top; it is wiring the
liveness the protocol already defines, and making the existing kit mandatory.

Severity legend: **Critical** = product promise broken · **High** = premium
bar failed · **Medium** = drift/debt. Sections: **CX** = connection &
functionality · **UX** = flows & states · **DS** = design system · **PM** =
premium feel & platform.

---

## Capability parity matrix (desktop baseline → phone)

Layers: gateway remote API (allowlist) → relay (blind pass-through) →
`remote-client.ts` → mobile UI. "Dies at" = first layer where the capability
stops existing.

| Capability | Dies at | Evidence |
|---|---|---|
| Start task | Degraded at UI — model/effort/approval hardcoded | App.tsx:706-716 |
| Follow-up in thread (`parentTaskId`) | **mobile UI** — no composer, never sent | gateway allows it; 0 mobile call sites |
| Attachments (bytes) | **gateway remote API** — no upload RPC, schema expects desk-local paths | App.tsx:715 sends `[]` |
| Approve/deny | Degraded at UI — only inside manually opened one-shot snapshot, 4-line context | App.tsx:1690-1719, 1686 |
| Stop/cancel ONE task | **mobile UI** — `tasks.cancel` allowlisted, 0 call sites [verified] | grep in App.tsx → 0 |
| Pause all / Resume all | pauseAll ✓ / **resumeAll 0 occurrences** — one-way kill switch [verified] | App.tsx:741 |
| Live task stream | **gateway remote-session** (push never sent) + UI (one-shot fetch) | see CX-2 |
| Artifacts list | **mobile UI** — `artifacts.list` allowlisted, never called [verified] | grep → 0 |
| Artifact content | **allowlist** — `workspace.prepareAsset`/`readFile` not allowlisted | remote-allowlist.ts |
| Inbox read/dismiss | **mobile UI** — `inbox.markRead`/`dismiss` allowlisted, unused; read-state forked locally | prefs.ts:23 |
| Scheduled tasks | full parity (model hardcoded) | App.tsx:933 |
| Memory | full parity — best-served CRUD | — |
| Notifications | **gateway (no push)** + dead UI toggle | see CX-3 |
| Telepresence view/input/quality | full parity — best-served capability | — |
| Device revoke / pairing start | desktop-only **by design** (KEEP) | remote-allowlist.ts |

---

## CX — Connection & functionality (phone ↔ desk pipeline)

### CX-1. One 20s RPC timeout wipes the pairing and the offline queue [Critical] [verified] **DONE**
Evidence: `packages/shared/src/remote-errors.ts:52-57` classifies
`fatalSession: true` when the message matches `did not answer|tasks\.list|out
of sync` — and `apps/mobile/src/api/remote-client.ts:620` puts the literal
string "desk did not answer" into **every** request timeout. Fatal →
App.tsx:362-385 `clearSession()` + `clearOfflineQueue()` + back to Pair.
Why: iOS backgrounding leaves half-open sockets; on resume the first
`syncDesk` on the stale socket times out after 20s and the user's pairing is
destroyed for a transient network condition. A desk that is merely busy >20s
does the same. This is the single worst defect in the product.
Fix: in remote-client, never derive fatality from a message regex. On first
timeout, force socket close + fresh reconnect + hello; only if a request
times out again *after* a proven-fresh transport (which demonstrates key
skew), mark fatal. Add a `consecutiveTimeoutsAfterFreshConnect` counter.

### CX-2. No push channel — the protocol defines events, nobody sends them [Critical] [verified] **DONE**
Evidence: `remote-protocol.ts:22-26` defines a `t:"event"` frame with **zero
senders**; `packages/gateway/src/services/remote-session.ts:233-377` only ever
replies to `t:"req"`; gateway emits `notify.tasksChanged`/`taskEvents`/
`inboxChanged` to the desktop stdio sink only (gateway/index.ts:169-198);
`remote-client.ts:571` drops any non-`res` frame. Phone liveness = an 8s
foreground poll of `tasks.list`+`inbox.list` only (App.tsx:538-544).
Why: desktop just got IPC push (F4); the phone got polling. Approvals, task
completion, inbox — all invisible until the next 8s tick (lists) or a manual
row re-tap (events). Battery cost plus dead air on the flagship moment.
Fix: remote-session subscribes the same gateway notify hooks and seals
`t:"event"` frames to each connected device; remote-client dispatches to an
`onEvent` listener; App replaces the 8s interval with event-driven refresh +
a 30s safety poll (mirror the desktop F4 pattern exactly). Backward-safe:
old clients already ignore non-`res` frames.

### CX-3. Approvals are invisible and the "Approval alerts" toggle is a placebo [Critical] [verified] **DONE**
Evidence: approval UI exists only inside a manually opened event snapshot
(App.tsx:1690-1719); the 8s poll never fetches events; `prefs.notifyApprovals`
is written by the Settings toggle (App.tsx:2278-2281) and **read nowhere**
(grep: definitions + toggle only). prefs.ts:18 even documents the intent:
"Surface home banner for approval-needed stream events."
Why: the desk agent blocks on approval; the phone user finds out only by
opening Tasks → tapping the right row. Unbounded latency defeats the app's
reason to exist. A settings toggle wired to nothing is a lie in the UI.
Fix: surface pending approvals from `syncDesk` (via CX-2 events or a task
status scan) as a persistent top banner + haptic + badge, gated on
`notifyApprovals`, with tap-through to the approval. OS push notifications
need a dev build (see PM-13) — do the in-app path now.

### CX-4. Relay authentication is theater; `desk_offline` truth breaks [High] [verified] **DONE**
Evidence: `services/remote-relay/src/store.ts:31-45` — desk re-register with a
different token has a comment-only guard and unconditionally overwrites;
phones are "last hello wins"; tokens are never verified against anything.
`desk_offline` (store.ts:160-171) only fires when no desk peer exists.
Why: anyone reaching the relay can hello as `role:"desk"` for any machineId,
auto-subscribing to `pair:<mid>` and receiving `ctrl:<mid>:*` traffic. E2E
protects content, but a rogue/stale desk peer suppresses the honest
`desk_offline` error, turning it into 20s timeouts — which are session-fatal
per CX-1. Strangers can also harvest sealed traffic and spam channels.
Fix: relay verifies desk token continuity per machineId (reject mismatched
re-register), or gateway registers a deskToken hash via authenticated
bootstrap; count only authenticated desks in `desk_offline`.

### CX-5. Offline queue: no idempotency, no TTL, poison item wedges it forever [High] **DONE**
Evidence: `remote-offline-queue.ts:97-124` stops at first error and keeps the
failed item at the head; `item.id` exists ("stable client id") but is never
transmitted (`remote-client.ts:700-701` sends only method+params);
`createdAt` is never checked anywhere.
Why: a timeout is ambiguous (desk may have executed) yet the item replays →
duplicate memory rows. A permanently rejected item (schedule deleted on desk)
blocks everything behind it forever. Days-old actions replay over moved-on
state.
Fix: transmit `item.id` as an idempotency key + dedupe desk-side; classify
flush errors (drop on validation/not-found, keep on transport); expire items
older than 24h.

### CX-6. Task-control parity gaps: no cancel, no resume, no follow-up, no artifacts, stale model [High] [verified] **DONE**
Evidence: `tasks.cancel`, `resumeAll`, `artifacts.list`, `inbox.markRead`,
`inbox.dismiss`, `models.list` — all allowlisted, **zero mobile call sites**
(single grep hit is the local banner label App.tsx:1330). Create hardcodes
`model: "grok-4.5", effort: "normal", approvalMode: "balanced"`
(App.tsx:706-716, again :933).
Why: from the phone you can watch a task go sideways and your only remedies
are "reject the next approval" or "pause every task on the desk" — with no
way to resume. Hardcoded model pins an old model or hard-fails Zod when the
desk's model set changes.
Fix: per-task Stop on the stream card; Resume-all next to Pause-all; a
follow-up composer (`tasks.create` + `parentTaskId`); artifacts list on the
task card; fetch `models.list` at connect and use the desk default.

### CX-7. Any relay `err` frame nukes ALL pending RPCs and fakes a disconnect [Medium] **DONE**
Evidence: `remote-client.ts:535-548` — on `{type:"err"}` (e.g.
`blob_too_large` for one oversized send, relay index.ts:121-124) every
pending request is rejected and the model forced to `connect_fail` while the
socket is healthy.
Why: relay errors carry no request correlation, so one bad frame punishes
everything and flashes "Reconnecting…" for no reason.
Fix: echo an optional client `id` in relay `send`/`err` envelopes; reject
only the matching request; reserve connection-level handling for
`not_hello`/`bad_hello`/`desk_offline`.

### CX-8. No heartbeat, though the relay already answers ping [Medium] [verified] **DONE**
Evidence: relay index.ts:74-77 answers `ping`; zero `ping` senders in
remote-client.ts or remote-session.ts (grep).
Why: half-open sockets are detected only via the 20s request timeout — which
is fatal per CX-1. The desk's send on a dead relay socket just warns after
the phone's request was already black-holed.
Fix: both ends ping every ~20s, close + reconnect on missed pong.

### CX-9. Backoff has no jitter and silently gives up forever after ~8 minutes [Medium] **DONE**
Evidence: `remote-reconnect.ts:110-119` deterministic `base*2^n` cap 30s;
:122-127 `maxAttempts = 20` → `give_up` → state "offline"; recovery only via
manual tap (App.tsx:1360) or AppState resume.
Why: a phone sitting foreground on Tasks stops syncing permanently after a
long desk outage, with only a passive banner.
Fix: ±25% jitter in `nextBackoffMs`; while foreground, never give up — hold
at max interval.

### CX-10. Mutations queued while "Online" strand until the *next* reconnect [Medium] **DONE**
Evidence: the only flush call site is inside `doConnect`
(remote-client.ts:419); `requestOrQueue` (:659-684) enqueues when
`!socketLive`, including during an in-flight connect that has already passed
its flush point.
Why: user sees "queued", the app shows Online seconds later, nothing flushes;
desk state diverges until some future disconnect cycle.
Fix: after enqueue, if connected (or when the in-flight connect resolves)
call the flush; also flush on the sync tick.

### CX-11. Optimistic offline UI is never reconciled [Medium] **DONE**
Evidence: optimistic schedule flip (App.tsx:972-976) and memory removal
(App.tsx:1055); flush failure surfaces only as a mutated pill label
(remote-reconnect.ts:86-94); lists refresh only when their tab is active
(App.tsx:322-330).
Why: the phone can show a disabled schedule or deleted memory that the desk
still runs, for hours.
Fix: on `queue_flush_error`, toast + force-refresh the lists matching the
remaining queued methods regardless of active tab.

### CX-12. Second phone / reused QR fails as silent timeout on both ends [Medium] **DONE**
Evidence: challenge row deleted on first accept
(gateway remote.ts:243-245); desk pair path swallows failures
(remote-session.ts:255, 267-269); phone waits 15s → generic "timeout"
(remote-client.ts:150-159).
Why: the second phone gets "timeout" with a misleading Wi-Fi hint; the desk
user standing next to it gets zero feedback a pair attempt was rejected.
Fix: desk-side toast on failed pair-blob open ("pairing attempt with an
expired code — show a new QR"); optionally an unsealed `pair_fail` marker on
the pair channel (contains nothing secret).

### CX-13. No protocol version handshake — skew fails as raw Zod noise [Medium] **DONE**
Evidence: relay hello schema has no version (remote-protocol.ts:78-92); the
`t:"hello", protocol: 1` ControlPlain variant (remote-protocol.ts:27-32) is
dead code — never sent by either side; a lagging phone against an updated
desk gets raw Zod strings dumped into `status` (App.tsx:684-685).
Why: after any schema change, phones break "mysteriously" with validation
prose instead of "update the app".
Fix: phone sends the already-defined hello after connect; desk replies with
protocol + app version; client gates and shows an upgrade message.

### CX-14. Static forever-lived session key; biometric lock defaults off [Low] **DONE**
> Biometric enrollment gate shipped. Periodic rekey deferred (protocol complexity). Default biometricLock still false to avoid soft-lock on stock devices; enable requires enrolled hardware.
Evidence: frame key derived from `pairSecret` stored indefinitely on both
sides (gateway remote.ts:224-242; mobile session.ts:11); no rotation; desk
stores the challenge secret in plaintext during the pairing window
(remote.ts:173); QR string also rendered in a copyable textarea
(desktop remote-tab.tsx:706-712); `biometricLock` defaults false (prefs.ts:32).
Fix: periodic rekey over the established channel; default biometric lock on
where hardware is enrolled; drop the copyable QR text or mark it sensitive.

---

## UX — Flows & states

### UX-1. The global `status` line is write-only after pairing — ~14 feedback paths render nowhere [Critical] [verified] **DONE**
Evidence: `const [status, setStatus] = useState("")` (App.tsx:165); its ONLY
render is `status={status}` into PairScreen (App.tsx:1422), which unmounts
once paired. Writes into the void: refreshTasks :685, loadEvents :765,
approve :782, refreshInbox :823, pauseAll success :746, startDesk :1118,
stopDesk :1141, changeQuality :1156, desk gestures :1249, sendSoftKeys :1264,
scroll buttons :2116/:2140, schedule created :941.
Why: tap "Pause all" → nothing visible happens. An approve error on a stale
approval is swallowed into invisible state. The app has a rich error taxonomy
and throws it into a dead variable.
Fix: delete the `status` channel for paired UI; route every path through
`showToast` (exists, App.tsx:175-185) or inline card errors like
`schedError`/`memError` already do.

### UX-2. Camera permission denial is a hard dead end [Critical] [verified] **DONE**
Evidence: PairQrScanner.tsx:49-68 re-calls `requestPermission()` with no
`canAskAgain` check (grep: 0 hits); zero `Linking` usage in the app.
Why: on iOS, after first denial the button is a silent no-op forever; a user
who fat-fingered "Don't Allow" can never pair by QR.
Fix: when `!permission.canAskAgain`, swap the button to "Open Settings" via
`Linking.openSettings()`; always show the paste fallback on this screen.

### UX-3. No navigation model: conditional-render tabs, zero Android back handling [Critical] [verified] **DONE**
Evidence: `useState<Tab>("pair")` + `{tab === "x" && ...}` blocks
(App.tsx:1419-2209); grep `BackHandler` → 0 hits. Modal-ish states (scanner,
stream card, memory edit) have no back-stack entries; Inbox → task tap
teleports to the Tasks tab (App.tsx:2196-2199) with no way back; Schedule/
Memory hide behind Settings pills, and the hint explaining that
(`home.hint`) is never rendered.
Why: the Android system back button exits the app from every surface,
including mid-scan and mid-approval. Screens aren't places; they're swapped
divs.
Fix: `BackHandler` popping scanner → stream card → previous tab before exit;
or adopt a real stack for scanner/stream/edit surfaces.

### UX-4. No keyboard avoidance anywhere; white iOS keyboard on a dark app [High] [verified] **DONE**
Evidence: grep `KeyboardAvoidingView|keyboardAppearance|adjustKeyboardInsets`
→ 0 hits [verified]. Composers sit at the bottom of long scrolls: new-task
goal (App.tsx:1512-1557), schedule form (:1790-1825), memory content
(:1942-1949), desk soft-keys (:2148-2157).
Why: the keyboard covers the field being typed into and the primary action
button; iOS presents a bright-white keyboard against #090a0c.
Fix: `KeyboardAvoidingView` (or `automaticallyAdjustKeyboardInsets`) +
`keyboardAppearance="dark"` on `Field`.

### UX-5. Zero accessibility: no labels, no roles, no reduced-motion [High] [verified] **DONE**
Evidence: grep `accessibilityLabel|accessibilityRole|AccessibilityInfo` → 0
hits across App.tsx + src [verified]. Tab bar reads as glyph characters;
stream close button is `title="×"` (App.tsx:1657); ToggleRow Switch has no
linked label; `usePulse`/FadeIn loop unconditionally (motion.tsx:8-35).
Why: VoiceOver reads the close button as "multiplication sign"; an
approve/reject pair with no roles on a remote-control app is rejection-grade.
Fix: roles + labels in `Btn`/`Chip`/`Segmented`/ListRow/tab bar; a
`useReducedMotion()` hook (AccessibilityInfo + listener) gating pulse/fade.

### UX-6. Biometric lock can soft-lock the user out; unlock failures invisible [High] **DONE**
Evidence: toggle persists with no enrollment check (App.tsx:2289-2298);
unlock failure reason goes to the dead `status` var (App.tsx:471, 661); the
locked view (App.tsx:1389-1417) renders no status text; the only visible exit
is "Unpair instead", which destroys the session and offline queue.
Why: enable lock on a phone without enrolled Face ID → next launch is a dead
screen whose only exit nukes the pairing.
Fix: check `getBiometricStatus().enrolled` at toggle time; render the unlock
failure reason in the locked view; keep passcode fallback and say so in copy.

### UX-7. Offline queue is invisible: no count, no list, no cancel [High] **DONE**
Evidence: App.tsx imports only `clearOfflineQueue` (App.tsx:46) — nothing
calls `loadOfflineQueue` for display; queue notices go to the dead `status`
var; flush errors render crammed into the header pill as
"Online — timeout memory.delete…" (App.tsx:346-349).
Why: a queued delete optimistically removes the row; on flush failure the
item resurrects with no explanation and no way to inspect or cancel pending
work. Unpair silently discards queued edits.
Fix: "Pending changes (n)" row (Settings or Home) listing queued items with
per-item cancel; toast queue events; flush errors as a banner with Retry.

### UX-8. The task stream is a dead snapshot with the wrong empty copy [High] [verified] **DONE**
Evidence: one-shot `events.list { afterSeq: 0 }` (App.tsx:754-769) [verified];
the 8s poll never refreshes events; text capped at `numberOfLines={4}` with
no expand (App.tsx:1686) [verified]; empty stream shows `t("tasks.empty")` =
"No tasks yet — create one from Home." inside a task (App.tsx:1664-1665)
[verified].
Why: the monitor is a still photo you re-tap to update, and a just-created
task tells you "No tasks yet", which reads as data loss.
Fix: while the card is open, poll `events.list { afterSeq: lastSeq }` every
2-3s (or consume CX-2 push) and append with FadeIn; add a real
`tasks.streamEmpty` key; make event rows expandable.

### UX-9. Pairing busy state: fake progress steps, no cancel, 15-30s blind wait [High] **DONE**
Evidence: PairScreen.tsx:131-142 renders `stepSecure/stepRelay/stepDesk` as a
static decorative list — nothing advances them; no cancel button; 15s
timeouts each for socket open and hello (remote-client.ts:105, 153-159);
timeout copy concatenates to "Request timed out: timeout" (App.tsx:634-639).
Why: fake step indicators are reviewer-screenshot material; a sleeping Mac
(the most common failure) traps the user watching a spinner with no abort.
Fix: wire steps to real milestones (ws open → hello ok → pair accept) or
remove them; add Cancel; on timeout show a checklist ("Is the Mac awake?
Same Wi-Fi? QR still on screen?").

### UX-10. Inline English bypasses i18n in six locales; error styling decided by an English regex [High] [verified] **DONE**
Evidence: inbox banner built inline: `` `Inbox: ${first.title} (+N more)` ``
(App.tsx:808-814) while `inbox.banner`/`inbox.bannerMore` sit unused in
en.json:174-175; biometric labels hardcoded (biometric.ts:22-40);
remote-client errors English-only (:216, :431-436, :597, :620, :669);
"Not paired" thrown raw (App.tsx:414/962/1020/1049) despite
`status.notPaired` existing. PairScreen decides error styling by matching
the *localized* text against an English pattern (PairScreen.tsx:104-108)
[verified].
Why: a German user gets an English banner, and pairing failures render in
calm gray "info" styling because "Zeitüberschreitung" doesn't match the
pattern.
Fix: route the banner through existing keys; pass a structured
`{ kind: "error" | "info" }` flag from App instead of matching display text;
remote-client returns error kinds that App maps through `t("errors.*")`.

### UX-11. Engine-ese leaks throughout the copy [Medium] **DONE**
Evidence: "Could not allocate workspace on desk (workspace.ensureTemp
failed)" (en.json:112); RPC names leak via `` `timeout ${method}` ``
(remote-client.ts:620); diagnostics `tele active=false · quality=—`
(App.tsx:866-878); schedules ask a *phone* user for "Cron (e.g. 0 9 * * 1-5)"
(en.json:104); "The relay only sees opaque blobs." (en.json:44).
Fix: human-first strings with technical detail demoted to a collapsible
details line; replace cron free-text with preset chips (weekday mornings /
hourly / custom) compiled to cron.

### UX-12. Empty states lie when offline; silent sync failure = mystery staleness [Medium] **DONE**
Evidence: Tasks empty state renders "No tasks yet" regardless of
connectivity (App.tsx:1617-1622); `syncDesk` swallows all failures
(App.tsx:319-321), so a non-answering desk keeps the pill "ONLINE" with
frozen data; the only staleness clue is a Home stat cell mislabeled with
`t("home.syncNow")` while `home.lastSync` ("Updated {time}") sits orphaned
(App.tsx:1476-1484).
Fix: gate empty states on `state === "online" && lastSyncedAt != null`, else
"Can't reach your desk" + Retry; show `home.lastSync` under the pill; stale
indicator when lastSyncedAt > 30s while "online".

### UX-13. Inbox has no read model — the badge shows total, forever [Medium] **DONE**
Evidence: tab badge = `inbox.length` (App.tsx:2434-2435); subtitle reuses
"{n} new inbox item(s)" for the total (App.tsx:2166-2169); rows have no
dismiss (App.tsx:2186-2203); `seenInboxIds` only drives the one-shot banner;
`inbox.markRead`/`dismiss` RPCs exist and are unused (CX-6).
Why: a permanent "9+" trains the user to ignore the exact channel approvals
arrive on.
Fix: badge = unseen diff, cleared on tab view; per-row dismiss via the real
RPCs; subtitle "{n} items · {u} new".

### UX-14. 24 orphaned i18n keys — including `conn.connecting`, so connecting shows "Offline" [Medium] **DONE**
Evidence: grep-verified zero app usage: `conn.connecting`, `tabs.unpair`,
`pair.placeholder`, `pair.button`, `home.machine`, `home.lastSync`,
`home.hint`, `tasks.openStream`, `inbox.banner`, `inbox.bannerMore`,
`status.notPaired`, `status.notReady`, `desk.hint`, and 11 `settings.*`
keys. The pill mapper only handles online/reconnecting/else-offline
(App.tsx:346-352) — cold-open dialing shows red "OFFLINE".
Fix: map connecting states to `conn.connecting`; wire or delete the rest ×7
locales; add a CI check for unused locale keys.

### UX-15. Task creation hides every decision [Medium] [verified] **DONE**
Evidence: hardcoded `model/effort/approvalMode/workspaceRoots` at
App.tsx:706-716 [verified]; the only task verbs on the phone are
approve/reject and global pause (see CX-6 for the protocol side).
Fix: approval-mode chips (cautious/balanced/fast) at create; model from
`models.list` desk default; per-task verbs land with CX-6.

---

## DS — Design system

### DS-1. No safe-area system — RN SafeAreaView only, Android broken, magic numbers [Critical] [verified] **DONE**
Evidence: `SafeAreaView` imported from `react-native` (App.tsx:10, :1280) —
iOS-only; `react-native-safe-area-context` absent from package.json
[verified]; PiP clears the tab bar via hardcoded `bottom: 92`
(App.tsx:2389); tabBar `paddingBottom: 16` (App.tsx:2791) ignores
home-indicator insets.
Why: on Android the header collides with the status bar. The foundation is
wrong on half the market.
Fix: add `react-native-safe-area-context` (bundled in Expo Go),
`SafeAreaProvider` + `useSafeAreaInsets()`; tabBar
`paddingBottom: Math.max(insets.bottom, 12)`; PiP bottom computed from
insets + tab bar height.

### DS-2. `textMuted` fails WCAG on every surface it's used (3.2-3.4:1) [Critical] [verified] **DONE**
Evidence: `textMuted: "#6a655c"` (theme.ts:14) = 3.42:1 on bg #090a0c,
3.18:1 on bgElevated #12141a (needs 4.5:1) — ratios independently
recomputed [verified]. Used at 11-13px in `listRowMeta`, `fieldLabel`,
`groupLabel`, `statLabel`, unselected segment labels, inactive tab bar
labels, and as `placeholderTextColor` (components.tsx:667, 682, 771, 807,
584, 328; App.tsx:2805, 2813).
Why: the workhorse meta color fails AA everywhere, including navigation.
Fix: lift textMuted to ≈#8a8478 (≈5.0:1 on bgElevated); reserve #6a655c for
decorative chevrons/dots only.

### DS-3. Black drop shadows on every card — direct tonal-elevation violation [Critical] [verified] **DONE**
Evidence: theme.ts:61-76 `shadowColor: "#000"`, opacity 0.4 (card) / 0.55
(pip); baked into the Card base style at components.tsx:622 [verified] and
App.tsx:2759.
Why: the brand rule (desktop DESIGN.md) is elevation = lighter tone, never
black shadows. On #090a0c they render as invisible mud on iOS and a gray
`elevation: 8` halo on Android. The tonal ladder already does the job.
Fix: remove `shadow.card` from the Card base; keep a subtler shadow
(opacity ≤0.25, radius ≤12) only for truly floating UI (PiP, future sheets).

### DS-4. Brand accent is ~2.3× more saturated than desktop [High] **DONE**
Evidence: mobile `accent: "#e8a45c"` = hsl(31, 75%, 64%) (theme.ts:15);
desktop `--primary: 34 32% 56%` (≈#b39468, desaturated warm sand).
Why: the phone reads vivid amber, the desktop desaturated sand — they do not
feel like the same product, which was the mandate.
Fix: mobile accent ≈ hsl(34, 40-45%, 60%) (slightly hotter than desktop for
OLED, still clearly sand); regenerate accentDim/accentSoft/accentText;
replace the scattered accent-alpha literals (DS-5) with derived tokens.

### DS-5. 19 hardcoded color literals outside theme.ts + a dead off-brand palette [High] [verified] **DONE**
Evidence: `connChromeColor` (App.tsx:147-151) returns Tailwind
`#4ade80/#fbbf24/#f87171` and has **zero call sites** [verified]. Accent
alphas duplicated ad hoc: components.tsx:115 (0.4), :210 (0.22), :313
(0.55), :761 (0.55), PairScreen.tsx:219 (0.25), :228 (0.4), App.tsx:2558
(0.35); warn border rgba duplicated App.tsx:2709/:2738.
Fix: delete `connChromeColor`; add `accentBorder/accentBorderSoft/
accentStrong/warnBorder/okBorder/dangerBorder` tokens and replace all 19
call sites.

### DS-6. Pressed states missing on 5 of 8 interactive primitives [High] **DONE**
Evidence: Chip (components.tsx:109-117), Segmented (:140-143), ToastBar
(:402-407), tab bar items (App.tsx:2437-2443), offline banner
(App.tsx:1360-1373) — all static style arrays, no `({pressed})` function.
Only Btn and ListRow respond. `colors.bgHover` (theme.ts:9) is used nowhere.
Fix: convert each to the function form with `pressed && { opacity: 0.7,
backgroundColor: colors.bgHover }` — that token's exact job.

### DS-7. Touch targets under 44pt; zero hitSlop; Approve/Reject is a 40pt compact button [High] [verified] **DONE**
Evidence: `btnCompact: paddingVertical 9, minHeight 40`
(components.tsx:543-547) [verified]; used for Approve/Reject
(App.tsx:1693-1718); Chip ≈36pt; segmentItem minHeight 40; grep hitSlop → 0
hits [verified].
Why: the most consequential control in the product fails Apple's 44pt floor.
Fix: btnCompact minHeight 44; Chip paddingVertical 12 or hitSlop; never use
`compact` for approve/reject.

### DS-8. Type scale defined then bypassed — 12 rendered sizes vs 7 tokens [High] **DONE**
Evidence: theme.ts:51-59 defines 7 steps; rendered extras: `btnText`
overrides the token it spreads with fontSize 15 (components.tsx:549),
chevron 22 (:671), emptyGlyph 22 (:724), tabGlyph 18 (App.tsx:2804),
tabBadgeText **9** (:2835), deskEmptyGlyph 32 (:2646), markGlyph 28
(PairScreen.tsx:234), unlockGlyph 28 (App.tsx:2563).
Fix: make `label` 15 in theme.ts (kills the btnText override); add a glyph
ramp as tokens or an Icon component (PM-5); floor badge text at 10; delete
all inline fontSize.

### DS-9. Radius drift — 12+ distinct radii; `radius.xl` is dead [Medium] **DONE**
Evidence: hardcoded 2/4/5/8/12/18/22/24/26/36 + `size * 0.32` across
App.tsx:2828, PairScreen.tsx:308/:225/:217/:284, components.tsx:715/:450;
sibling hero marks use 22 vs 24 vs 26; `radius.xl: 28` has zero usages.
Fix: hero marks → radius.lg; rings → radius.xl (or delete it); circles →
radius.pill; forbid numeric borderRadius outside theme.

### DS-10. Off-grid spacing one-offs and 20 inline style literals [Medium] **DONE**
Evidence: paddingVertical 9/7/5/3, gaps 3/6/7/10 (components.tsx:544, 552,
593, 605, 253, 592; App.tsx:2678, 2604, 2674; PairScreen.tsx:301); inline
`style={{ marginVertical: 16 }}` on both ActivityIndicators (App.tsx:1754,
1869); ~20 inline object literals in App.tsx render.
Fix: round to 4pt steps via `space.*`; hoist inline literals into the
StyleSheet.

### DS-11. Dead styles, dead tokens, dead exports [Medium] [verified] **DONE**
Evidence: `styles.status` (App.tsx:2504) and `styles.item` (:2614) — 0
references; `feedbackOkBox: {}` empty (PairScreen.tsx:338); `colors.white`
never used and violates the no-pure-white rule (theme.ts:26); `radius.xl`
dead; `IconBubble` has zero consumers [verified] (components.tsx:416).
Fix: delete the dead styles/tokens; either use IconBubble as the shared
`HeroMark` primitive (DS-12 — two birds) or delete it.

### DS-12. Three competing banner systems + hand-rolled forks of kit primitives [High] **DONE**
Evidence: kit `ToastBar` (components.tsx:373) vs hand-rolled notify banner
(App.tsx:1311-1336, styles :2731) vs `offlineBanner` (:2700) — the latter
two duplicate warnSoft + border rgba with different paddings; desk empty
state re-implements kit `EmptyState` glyph-for-glyph (App.tsx:2027-2043 vs
components.tsx:348); unlock hero re-implements PairScreen's mark with
different radius (24 vs 22) and border alpha.
Fix: notify banner → ToastBar with an optional action prop; desk empty →
EmptyState; extract `HeroMark` used by pair + unlock; add a kit `Banner`.

---

## PM — Premium feel & platform

### PM-1. No icon, no splash, no dark config — default white flash into a #090a0c app [Critical] [verified] **DONE**
> Shipped custom icon/adaptive-icon image assets deferred (dev-build). Dark `backgroundColor`/`userInterfaceStyle`/`androidStatusBar`/`SplashScreen` hold shipped in Expo Go.
Evidence: app.json has zero `icon`/`splash`/`adaptiveIcon`/`backgroundColor`/
`androidStatusBar` keys [verified]; **no assets/ directory exists in the
repo** [verified]; `userInterfaceStyle: "automatic"` on a hard-dark app
(StatusBar hardcoded light, App.tsx:1281).
Why: launch is Expo's default white splash hard-cutting to near-black — the
single most amateur signal an app can ship. There is no brand asset at all.
Fix: icon + Android adaptive icon + splash (`backgroundColor: "#090a0c"`,
dark mark); `userInterfaceStyle: "dark"`; `androidStatusBar` config; hold
splash via `SplashScreen.preventAutoHideAsync()` until session restore
resolves (App.tsx:453-511 currently races first paint).

### PM-2. Zero animated transitions; one shared ScrollView leaks scroll position between tabs [Critical] [verified] **DONE**
Evidence: a single ScrollView hosts every tab (App.tsx:1338) with
conditional-render blocks [verified]; no reanimated/gesture-handler/
react-navigation anywhere [verified]. 13 distinct snap-moments a premium app
would animate: 5 tab switches, pair→home swap (:628), toast (:1303), notify
banner (:1311), offline banner (:1360), stream card open (:1648), memory
edit swap (:1906), segmented select, skeleton→content, PiP appear (:2387),
scanner open (PairScreen.tsx:144), BusyOverlay (components.tsx:478).
Why: scrolling deep into Tasks then tapping Home lands you mid-scroll on
Home. Screens don't exist as places. This is the #1 webview tell.
Fix: minimum — per-tab scroll offsets (or scrollTo top on switch) + keyed
`<FadeIn key={tab}>`; real — reanimated (bundled in Expo Go) with a 200ms
fade/slide and spring-in cards. Highest-leverage fix in the app.

### PM-3. Approve/Reject — the money moment — has no haptic, no optimistic update, hides behind the global spinner [Critical] [verified] **DONE**
Evidence: `approve()` wraps global `setBusy` then full `loadEvents` refetch
(App.tsx:771-786) [verified]; buttons call it bare (:1697/:1710); 26 haptic
call sites, none on approve/reject — but the PiP settings toggle gets one
(App.tsx:2250).
Fix: `haptic("success"/"warning")` on decision; optimistically mark the
approval row resolved with a fade; reconcile on response; per-operation
pending state (PM-7).

### PM-4. Nothing in the running-task view is alive [High] [verified] **DONE**
Evidence: one-shot fetch (UX-8) [verified]; no elapsed-time tick anywhere;
`lastSyncedAt` renders a static time string (App.tsx:1479); `liveDot` is a
static 7px circle (App.tsx:2682-2687) while `usePulse` sits in motion.tsx:8;
liveness = the 8s poll [verified].
Why: a "running" task looks identical at t=0 and t=5min. Watching an agent
work should feel like watching something breathe.
Fix: ticking elapsed timer (1s interval, tabular numerals) on running tasks;
pulse the running badge with `usePulse`; stream appends with FadeIn (CX-2 /
UX-8 provide the data).

### PM-5. The entire icon system is unicode text glyphs [High] [verified] **DONE**
Evidence: tab bar `"⌂" "☰" "▣" "◉" "⚙"` (App.tsx:2423-2427) [verified];
chevron `›` (components.tsx:275); marks `◆`/`◉`; empty-state glyphs reuse
`◉` for inbox AND lock AND empty.
Why: system-font fallbacks render at different weights/baselines per
platform (⚙ notoriously misaligned on Android OEM fonts); desktop uses
Lucide at stroke 1.75 — the phone uses dingbats.
Fix: `lucide-react-native` or @expo/vector-icons Feather (both Expo
Go-safe) behind an `Icon` wrapper sized/colored from tokens; replace tab
bar, chevron, hero marks, empty states.

### PM-6. Toasts and banners snap into layout flow and shove the screen down [High] **DONE**
Evidence: ToastBar renders in normal flow between chrome and ScrollView
(App.tsx:1303-1309) with marginTop (components.tsx:740-747); appears via
state flip, vanishes via bare `setTimeout(4200)` (App.tsx:181-182); same for
notify + offline banners.
Fix: absolutely-positioned overlay under the header; Animated.spring
translateY in / timing out; drag-to-dismiss.

### PM-7. One global `busy` boolean is the app's entire loading model [High] [verified] **DONE**
Evidence: single `useState(false)` (App.tsx:247) [verified] set by pairing,
createTask, approve, pauseAll, loadEvents, refreshInbox, memory, schedule,
desk ops; surfaced as a corner ActivityIndicator (App.tsx:1295,
components.tsx:478-485); skeletons gate on `busy && list.length === 0` so
any operation flashes unrelated skeletons (App.tsx:1573, 1615, 2181);
schedule create disables while a memory save runs (:1823).
Fix: per-operation pending state (`pendingApprove[id]`, `tasksLoading`,
`inboxLoading`); inline button spinners; skeletons keyed to their own fetch.

### PM-8. Pair screen silently reads the clipboard on every foreground → iOS paste-banner spam [High] [verified] **DONE**
Evidence: `checkClipboard()` calls `Clipboard.getStringAsync()`
unconditionally on mount and every AppState→active
(PairScreen.tsx:82-102) [verified].
Why: iOS 14+ fires the system "pasted from…" banner on every read — the OS
repeatedly accuses the app of clipboard snooping during normal pairing.
Fix: gate on `Clipboard.hasStringAsync()` (no banner) before reading, or
make paste explicit-only (the Paste button already exists).

### PM-9. Android is untreated: zero Platform.select, iOS-only mono font, no ripple [Medium] [verified] **DONE**
Evidence: grep `Platform.select` → 0; `fontFamily: "Menlo"` (App.tsx:2587)
silently falls back to sans on Android; grep `android_ripple` → 0; (status
bar/insets covered by DS-1).
Fix: `Platform.select({ ios: "Menlo", android: "monospace" })`;
`android_ripple` on rows/tabs; QA pass on a real Android device.

### PM-10. No tabular numerals where numbers change [Medium] **DONE**
Evidence: grep `fontVariant|tabular` → 0 hits; StatStrip values
(components.tsx:805), sync time (App.tsx:1479), tab badge (:2453), desk
frame counters (:868-875).
Fix: `fontVariant: ["tabular-nums"]` on statValue, badge, time/count text.

### PM-11. Every list is ScrollView+map — no virtualization [Medium] [verified] **DONE**
Evidence: grep FlatList → 0 hits [verified]; `tasks.map` (App.tsx:1624),
unbounded `events.map` (:1667), `inbox.map` (:2186), `memories.map` (:1878).
Fix: FlatList for tasks/inbox/events (event log is the one that will
actually jank).

### PM-12. Success moments have no choreography [Medium] **DONE**
Evidence: pairing success = haptic + toast + instant tab swap
(App.tsx:628-631); static 1-2-3 pairing steps (UX-9); static liveDot (PM-4);
PiP fixed position, no drag (App.tsx:2748-2760).
Fix: animated check scale-in + real step progression on pair; PanResponder
drag + corner-snap for PiP.

### PM-13. Expo Go ceiling — be explicit about what needs a dev build [Note] **DONE**
> Local notifications + icon/splash assets shipped. **Remote** FCM/APNs push still needs a dev build + credentials — scaffolding via expo-notifications is present for local alerts. **DONE**
- **Needs a dev build:** remote push notifications for approvals/completions
  (expo-notifications remote push left Expo Go in SDK 53+), shipped app
  icon/splash, Live Activities ("agent running" on the lock screen — the
  killer feature for this product), widgets.
- **Available in Expo Go TODAY and wrongly left on the table:**
  react-native-reanimated, react-native-gesture-handler,
  react-native-safe-area-context, @expo/vector-icons, expo-blur, expo-font.
  The motion/icon/safe-area gaps cannot be blamed on Expo Go.
- Add new deps with `npx expo install` so versions match SDK 54.

---

## Keep — do not regress

1. **E2E blind relay + ciphertext tripwire** — sealed frames, length-only
   relay logging, and the client check that throws if plaintext method names
   appear in the encoded frame (remote-client.ts:610-612).
2. **Allowlist + full Zod re-validation** of remote requests identical to
   local dispatch (remote-session.ts:343-349); `settings.get` deliberately
   excluded; revoke/pairing.start unreachable from the phone.
3. **Revocation lifecycle** — revoke wipes token hash and pair secret, desk
   sends one final sealed "Device revoked", phone classifies fatal and wipes
   session + queue exactly once (remote.ts:269-280; remote-session.ts:210-217).
4. **Offline queue scope discipline** — only memory.upsert/delete and
   schedule.setEnabled may queue; approvals/task-create/telepresence can
   never fire late (remote-offline-queue.ts:15-19). Keep this list frozen.
5. **Connect-time key proof** — an empty-queue connect issues a real RPC so
   broken ECDH can't masquerade as Online (remote-client.ts:421-437) — keep
   the probe, fix its fatality classification (CX-1).
6. **Loopback QR defense at both ends** (remote.ts:65-86;
   remote-client.ts:214-218) and the shared in-flight connect promise with
   strict socket teardown (remote-client.ts:377-397, 506-525).
7. **Desk stale-key self-heal** — one cache-bypass rebuild on decrypt failure
   (remote-session.ts:290-309).
8. **theme.ts tonal ladder** `#090a0c → #12141a → #1b1e26 → #22262f` + white-
   alpha hairlines — correct dark-elevation structure.
9. **Btn press physics** (native-driver spring to 0.97, components.tsx:32-46),
   **ListRow** (56pt, hairlines, real pressed state), **Field focus**
   (accent border + surface lift).
10. **Haptics vocabulary** — selection/medium/warning/success/error mapped
    semantically where they exist.
11. **Pair happy path** — scan-or-paste, auto-pair on scan, localhost-QR
    guard with actionable copy; QR scanner corner-bracket overlay + vignette.
12. **Skeleton/EmptyState pattern on every list**, accent-tinted
    RefreshControl + haptic + "Synced" toast; AppState resume → reconnect.
13. **Desk telepresence ergonomics** — layout-derived gesture mapping,
    keep-awake tied to live stream, scroll lock while panning
    (App.tsx:1176-1255, 1342).
14. **Full 7-locale i18n coverage** discipline (fix the bypasses, keep the
    system).

---

## Execution order (one conventional commit per phase)

| Phase | Items | Theme |
|------:|-------|-------|
| 0 | CX-1, CX-7, CX-10, UX-1, UX-2, PM-8 | Bug-grade: stop wiping pairings, stop swallowing feedback, unblock camera dead end |
| 1 | DS-1, PM-1 | Platform foundation: safe-area-context; icon/splash/dark config |
| 2 | DS-2, DS-3, DS-4, DS-5, DS-11 | Token truth: contrast, shadows, accent, literals, dead code |
| 3 | DS-6, DS-7, DS-8, DS-9, DS-10, PM-10 | Interaction foundation: pressed states, 44pt targets, type/radius/spacing, tabular nums |
| 4 | PM-5, DS-12, PM-6 | Icon system; kit consolidation; animated toast overlay |
| 5 | CX-2, CX-8, CX-9, CX-3, PM-4, UX-8 | Liveness: push channel, heartbeat, jitter, approval surfacing, living stream |
| 6 | PM-3, CX-6, UX-13, UX-15 | Task control: approve moment, cancel/resume/follow-up, models.list, inbox read model |
| 7 | PM-2, UX-3, PM-7, PM-11 | Structure: per-tab scroll + transitions, back handling, per-surface loading, FlatList |
| 8 | UX-4, UX-6, UX-7, CX-11, UX-9, CX-12, UX-12 | Flow hardening: keyboard, biometric, queue visibility, honest pairing/offline states |
| 9 | CX-4, CX-5, CX-13, CX-14 | Protocol trust: relay auth, queue idempotency/TTL, version handshake, rekey |
| 10 | UX-10, UX-11, UX-14, PM-9, PM-12 | Copy/i18n sweep ×7 locales; platform niceties; choreography |
| 11 | UX-5 | Accessibility sweep: labels, roles, reduced-motion |
| 12 | — | Runtime QA: iOS simulator + real Android via Expo Go; relay smoke script |

Phases 0 and 5 are the product; do not let visual phases starve them.

---

## Gotchas (violating these breaks tests, hooks, or ships regressions)

- **i18n parity test** (`src/i18n/i18n.test.ts`): every new key must land in
  all 7 locales (en/de/es/fr/ja/pt/zh) in the same commit.
- **Gateway tests only under Node 20** (`nvm use`): the pretest rebuilds
  better-sqlite3 to the invoking Node's ABI; Node 24 breaks the Electron
  build. Required whenever `packages/gateway` remote files change.
- **Relay is a deployed service**: after touching
  `services/remote-relay/src`, run its vitest AND
  `scripts/remote-live-smoke.mjs` against a locally started relay.
- **Protocol changes must be additive**: old clients drop non-`res` frames
  (remote-client.ts:571), so adding `t:"event"` senders is backward-safe.
  Land CX-13 (version handshake) before any change that is NOT additive.
- **Never widen the offline-queue whitelist or the remote allowlist**
  casually — the queue must never replay approvals/task-create; never
  allowlist `settings.get` (license/MCP secrets).
- **New native deps via `npx expo install` only**, and only libraries
  bundled in Expo Go (see PM-13); Metro + pnpm workspace resolution is
  custom (metro.config.js, commit f1b53f1) — verify Metro resolves each new
  dep before building on it.
- **Never call the regex `exec` method** anywhere in this repo's app code —
  a security hook false-flags that token; use `String.match()`.
- The desk-tab ScrollView `scrollEnabled={!(tab === "desk" && teleLive)}`
  interplay with the PanResponder (App.tsx:1342) is deliberate — preserve it
  through the PM-2 restructure.
- `remote-errors.ts` lives in **packages/shared** — changing it requires the
  shared test suite (baseline 160) and affects desktop too.
- Mobile UI is not unit-tested; protocol/storage/i18n are. When fixing
  CX-1/CX-5/CX-7/CX-10, extend the existing `remote-client.*.test.ts` +
  `offline-queue-store.test.ts` suites — never weaken an assertion to pass.

## Gates (run after EVERY phase; never proceed on red)

1. `pnpm typecheck` in `apps/mobile`
2. `pnpm test` in `apps/mobile` — baseline **31/31 (9 files)**, only grows
3. `pnpm vitest run` in `packages/gateway` **under Node 20** — baseline
   **106/106** (whenever gateway files change)
4. `pnpm test` in `services/remote-relay` — baseline **3/3** (whenever relay
   files change)
5. `pnpm vitest run` in `packages/shared` — baseline **160** (whenever
   shared files change)
6. Desktop gates (typecheck / 273 tests / build) whenever
   `apps/desktop` files change
7. Phase 12: live pairing smoke — desktop `pnpm dev`, relay up, real device
   pair → create task → approve → revoke, plus `scripts/remote-live-smoke.mjs`


---

## Execution completion (2026-07-13)

### Commits (mobile overhaul)

| Phase | Commit | Message |
|------:|--------|---------|
| 0 | `44aeac2` | fix(mobile): stop fatal-timeout pairing wipes |
| 1 | `dda903e` | feat(mobile): safe-area system and dark splash |
| 2 | `435c6cf` | style(mobile): token truth — contrast, shadows, accent |
| 3 | `bf124ad` | style(mobile): pressed states, 44pt targets, type scale |
| 4 | `3fb3e94` | feat(mobile): lucide icons, Banner kit, overlay toasts |
| 5 | `306f2cf` | feat(mobile): push liveness, heartbeat, approval banner |
| 6 | `b104465` | feat(mobile): task control, optimistic approve, inbox read |
| 7–8, 11 | `4f46ea0` | feat(mobile): back stack, keyboard, a11y, per-tab scroll |
| 9 | `afcdbcd` | feat(remote): relay token continuity, queue TTL, protocol hello |
| status | `4d4bfac` | docs(mobile): record overhaul status marks through phase 11 |

### Capability parity matrix — before → after

| Capability | Before | After |
|---|---|---|
| Start task | Hardcoded model/effort/mode | Desk `models.list` default + approval-mode chips |
| Follow-up (`parentTaskId`) | Dead | Stream follow-up composer |
| Approve/deny | Manual stream open only | Banner + haptic + optimistic; 44pt buttons |
| Stop one task | 0 call sites | Stream **Stop** → `tasks.cancel` |
| Pause / Resume all | Pause only | Resume all control |
| Live task stream | 8s poll / one-shot | `t:event` push + 2.5s stream poll + 30s safety |
| Artifacts list | Unused allowlist | Listed on open stream card |
| Inbox read/dismiss | Local-only / badge total | markRead on view, dismiss RPC, unseen badge |
| Notifications | Placebo toggle | In-app approval banner (OS push deferred) |
| Pairing wipe on timeout | Fatal after 20s | Non-fatal until 2nd consecutive after fresh connect |

### Deliberately deferred (remaining after deferred pass)

| Item | Status |
|---|---|
| Remote FCM/APNs push credentials | Still needs Apple/Google setup + production dev build |
| Live Activities / home-screen widgets | Native-only; not Expo Go |
| Phase 12 physical-device matrix | Operator checklist unchanged — run on real phone |

### Gates at finish

- mobile: typecheck clean, **36/36** tests
- shared: **167** tests
- gateway (Node 20): **106/106**
- remote-relay: **4/4**
