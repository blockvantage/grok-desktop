# Grok Desk full-system audit and overhaul plan

**Audit date:** 2026-07-14  
**Repository:** `grok-desktop` on `main`  
**Audit focus:** task reliability, local command/tool execution, Grok connectivity, remote control, security, maintainability, and provider portability

## Executive verdict

Grok Desk has a credible product shell and several strong foundations: a typed IPC surface, SQLite persistence, a task/event model, encrypted remote control, a blind relay design, focused remote end-to-end tests, and a functioning connection to the installed Grok CLI. The checked-in test suite and build are healthy.

It is not yet safe to describe the current system as fully sandboxed, fully audited, remotely idempotent, crash durable, or provider independent.

The most important issue is architectural: the gateway evaluates a local policy model, but the real Grok adapter runs with `executesOwnTools = true`. Shell, filesystem, network, MCP, and other tool effects occur inside the Grok CLI, so the gateway mostly observes whatever the CLI happens to emit instead of mediating the operation before it happens. The CLI is also started without its sandbox, with provisional permission-rule translations that do not match current documented rule syntax. A user can therefore select a policy in the UI that the product cannot prove it enforced.

The recommended overhaul is a provider-neutral agent runtime with capability negotiation and one authoritative tool/policy boundary. Implement Grok first through its documented Agent Client Protocol (ACP), retain streaming headless mode only as an explicitly degraded compatibility adapter, and make the gateway depend on neutral runtime contracts rather than `@grokdesk/engine-grok`.

Before adding another provider, fix the P0 trust-boundary issues, task crash recovery, remote principal binding and replay/idempotency, secret storage, and Electron navigation restrictions. Portability built on top of the current execution boundary would reproduce the same risks in every adapter.

## Scope and method

This audit traced the renderer, Electron main process, gateway, Grok engine, shared schemas and policy, mobile client, relay, scheduler, SQLite schema, tests, documentation, and recent Git history. It also:

- verified the locally installed Grok CLI at version `0.2.101 (5bc4b5dfadcf)`;
- verified that `grok models` reports an authenticated grok.com session and currently exposes `grok-4.5` and `grok-composer-2.5-fast`;
- compared the adapter to the current official Grok Build CLI, ACP, sandbox, permission, settings, MCP, and custom-model documentation;
- ran typechecking, the complete repository test suite, the focused remote suite, the monorepo build, a production relay health request, and the repository's live remote smoke;
- ran `pnpm audit --prod`.

No paid model task was intentionally submitted during the audit. The production relay test used an isolated temporary gateway and fake engine; it paired, created a local temporary task through the production relay, and then hit a bug in the smoke harness when a notification interleaved with the next RPC response. The checked-in relay is not necessarily the deployed relay: `docs/remote-dev.md` says the production source of truth lives in the separate `grok-landing` repository, which was not in this workspace.

## Current architecture

```text
React renderer
  -> preload bridge / Electron IPC
  -> Electron main process
  -> JSON-lines Gateway child
  -> Gateway + SQLite
       -> TaskRunner
       -> GrokBuildEngine
       -> grok -p --output-format streaming-json

Mobile app
  -> WebSocket relay (ciphertext routing)
  -> RemoteSessionHost in Gateway
  -> the same Gateway IPC dispatcher

Current authority split:
  UI policy -> Gateway policy evaluator
  Actual Grok tool execution -> Grok CLI and inherited Grok configuration
```

The split authority is the root of several findings. The gateway cannot reliably approve, deny, audit, cancel, or classify operations that the provider runtime performs internally.

## Verification snapshot

| Check | Result | Notes |
|---|---:|---|
| `pnpm typecheck` | Pass | All workspace projects passed. |
| `pnpm test` | Pass | 671 tests across shared, license, relay, Grok engine, mobile, gateway, and desktop. |
| `pnpm test:remote` | Pass | 101 focused remote, crypto, relay, gateway E2E, telepresence, and mobile tests. |
| `pnpm build` | Pass | Shared, license, relay, engine, gateway, and desktop production build. |
| Production relay `/health` | Pass | HTTP 200 with `ok: true` at the time of audit. |
| Production relay pairing/RPC smoke | Partial pass | Health, desk connect, pairing, `tasks.list`, and `tasks.create` worked. Harness then mistook an interleaved event for its response because it filters only by channel, not response ID. |
| Installed Grok discovery/auth/models | Pass | CLI found and signed in; model listing worked. No paid inference used. |
| `pnpm audit --prod` | Fail | Two moderate transitive mobile advisories: `postcss <8.5.10` and `uuid <11.1.1`. |

Passing tests prove the paths covered by those tests; they do not prove policy mediation, replay resistance, crash recovery, production relay equivalence, or provider portability. Tests for those guarantees are currently missing.

## What is already solid

- Shared Zod schemas validate desktop and remote RPC input (`packages/shared/src/ipc.ts`).
- Remote content uses X25519, HKDF, and XChaCha20-Poly1305; the relay routes ciphertext rather than application plaintext (`packages/shared/src/remote-crypto.ts`).
- The remote allowlist excludes sensitive authentication, licensing, and full settings operations (`packages/shared/src/remote-allowlist.ts`).
- Device revocation, E2E pairing, telepresence, offline queue storage, reconnection, and forbidden-method behavior have meaningful tests.
- Electron uses context isolation and disables renderer Node integration.
- Tasks, events, artifacts, memory, schedules, and paired devices have persistent SQLite representations.
- The Grok adapter normalizes streaming output and the product has useful task, artifact, approval, scheduling, command palette, slash-menu, memory, and remote UI foundations.
- Current Grok Build offers a much better integration route than the adapter uses today: ACP, session continuation, explicit sandbox profiles, structured permission rules, MCP diagnostics, and custom model endpoints.

## Priority register

Severity definitions: **P0** blocks a defensible security/reliability claim; **P1** should land before wider release or provider expansion; **P2** improves operability, UX, and maintainability after the foundations are correct.

### P0 — trust and correctness blockers

| ID | Finding and evidence | Impact | Required fix and acceptance proof |
|---|---|---|---|
| SEC-01 | **Selected task policy is not the authoritative execution boundary.** `GrokBuildEngine` declares `executesOwnTools = true` (`packages/engine-grok/src/session.ts:62-68`), while gateway approval mediation is skipped for that path (`packages/gateway/src/services/runner.ts:529-531`, `:663`). `TaskService.create` also hard-codes network and shell to allowed (`packages/gateway/src/services/tasks.ts:74-75`). | A task can perform shell/filesystem/network/MCP effects without a gateway decision or complete audit record. UI policy can over-promise protection. | Make one component authoritative. Recommended: ACP adapter plus gateway-owned permission/tool broker; enable a documented sandbox profile and translate every policy capability exactly. Add adversarial tests proving denied shell, write-outside-root, web, MCP, and desktop actions never happen. Fail closed if the provider cannot supply the required control surface. |
| SEC-02 | **Connector secrets can be persisted and exposed in multiple trust domains.** Settings store `mcpServers` and credential-expanded values (`packages/gateway/src/services/settings.ts:180-213`); project config expands environment placeholders and writes `.grok/config.toml` (`packages/shared/src/mcp-config-write.ts:133-163`); `.gitignore` is only created when absent (`:126-129`). `settings.get` returns the structure to the renderer. | Tokens can sit in plaintext SQLite, enter a renderer process, remain in a user project, be picked up by backups, or be committed. | Add a main-process credential vault using Electron `safeStorage` or OS keychain. Store opaque secret references in SQLite. Redact all settings/audit/diagnostic responses. Generate ephemeral provider config outside the project with `0600` permissions and guaranteed cleanup. Migration must detect and offer to purge old literals and project files. Secret-canary tests must search DB, renderer payloads, logs, diagnostics, temp files, and Git-visible workspace files. |
| REMOTE-01 | **Remote authentication is not bound to the authorization context.** `RemoteSessionHost` derives `deviceId` from the authenticated channel, then rebuilds a plain IPC request and calls `gateway.handle(req)` without a principal (`packages/gateway/src/services/remote-session.ts:359-460`). Methods such as rekey and telepresence accept a client-supplied `deviceId`; key update trusts that ID (`packages/gateway/src/services/remote.ts:340-351`). | Paired device A can attempt operations on device B, including rekeying another device or claiming its telepresence identity. This is a confused-deputy boundary. | Introduce `RequestContext { transport, principalDeviceId, requestId }`. Remote handlers must use the principal and ignore/reject conflicting IDs. Separate remote application services from desktop IPC dispatch. Add two-device tests proving cross-device rekey, revoke, stream start/stop/input, and channel access fail. |
| REMOTE-02 | **Encrypted control frames have no replay defense and mutations are not idempotent.** `sealFrame` uses a nonce but the plaintext has no monotonically enforced counter/epoch (`packages/shared/src/remote-crypto.ts:115-131`). Mobile adds `clientMutationId` during queue flush (`apps/mobile/src/api/remote-client.ts:917`), but IPC schemas do not model it and the gateway has no deduplication store. | Captured valid ciphertext can be replayed to repeat task creation, deletion, memory mutation, or scheduling. Reconnect/retry can also duplicate work. | Remote protocol v2: session epoch plus per-direction sequence counter included as AEAD AAD, bounded replay window, and durable mutation receipts keyed by `(principal, clientMutationId, method)`. Add request IDs to mutation schemas rather than relying on unknown fields. Test same-frame replay, same-ID retry after reconnect/restart, reordered frames, and concurrent duplicate delivery. |
| SEC-03 | **Electron navigation and external URL handling are too permissive for an agent-rendered UI.** The window uses `sandbox: false`; any new-window URL is passed to `shell.openExternal` (`apps/desktop/src/main/index.ts:114`, `:122-123`); no main-window `will-navigate` guard was found; IPC handlers do not validate sender origin/window. | A malicious model link or compromised renderer can navigate or launch dangerous schemes, and a remote document loaded into the application window could inherit a powerful preload bridge. | Set renderer sandbox on if compatible; deny every navigation away from the packaged app origin; allow only explicit `https:`/`http:` external schemes; validate IPC sender frame and owning window for every privileged call; narrow the media permission handler by origin and requested media type. Add tests for `file:`, `javascript:`, `data:`, custom schemes, same-window navigation, popup navigation, and untrusted IPC senders. |
| TASK-01 | **Tasks are not durably leased or recovered after an unclean gateway exit.** Startup constructs the runner and starts new schedules but does not reconcile persisted `queued`, `running`, or `waiting_approval` rows (`packages/gateway/src/index.ts:250-287`). Normal shutdown cancels them (`:312-334`), but a crash cannot. New work starts via unobserved `void` calls (`:389-390`). | A crash or child restart can leave permanent phantom-running tasks or queued tasks that never resume. Users cannot trust task completion state. | Add durable run attempts/leases with heartbeat, owner instance ID, retry policy, and terminal reason. On startup, atomically recover expired leases: resume only provider sessions that support it; otherwise mark interrupted and expose retry. Pump durable queued work. Add kill -9/restart tests at queued, tool-running, approval, and completion-commit boundaries. |

### P1 — release and portability blockers

| ID | Finding and evidence | Impact | Required fix and acceptance proof |
|---|---|---|---|
| TASK-02 | **Follow-ups are new one-shot tasks, not continued provider sessions.** The UI creates a child task, while the engine always launches a fresh `grok -p`; no session ID/resume is stored. Current Grok Build supports sessions and ACP. | Follow-up turns can lose prior conversation and tool context even though the UI presents a continuous chat. Re-sending context would also waste tokens and risk truncation. | Add a durable conversation/turn model and provider session binding. Continue the provider session when compatible; otherwise build a deterministic bounded transcript. Store `providerSessionId`, context strategy, and model/provider per turn. Test restart, model change, branch, retry, and migration from existing parent-task chains. |
| TASK-03 | **Pause/cancel semantics do not match process behavior.** Pause is an in-memory boolean (`packages/gateway/src/services/tasks.ts:42`) and only affects future pumping/event handling. Grok cancellation sends SIGTERM and tests `child.killed` before SIGKILL (`packages/engine-grok/src/session.ts:83-85`); Node marks `killed` when a signal is sent, not when the process exits. | “Pause” may leave the CLI doing work and spending credits; a stuck child may survive cancellation; restart forgets pause. | Define pause as queue pause only, or implement provider-supported suspend. Cancellation must track an exit promise, send SIGTERM, then SIGKILL if still alive after deadline, and persist cancellation intent. Add a child that ignores SIGTERM and assert teardown, status, and no later events. |
| PORT-01 | **The engine abstraction is nominally generic but vendor-owned and incomplete.** Gateway imports `EngineAdapter` and normalized events from `@grokdesk/engine-grok` (`packages/gateway/src/services/runner.ts:5`); the interface exposes essentially `run`, `cancel`, and `executesOwnTools` (`packages/engine-grok/src/types.ts:53-58`). Models/auth/title/usage/STT and defaults are Grok-specific throughout (`packages/gateway/src/index.ts:703-708`; `packages/shared/src/ipc.ts:17`; `apps/desktop/src/renderer/App.tsx:143-161`). | Adding another model/provider requires edits across gateway, storage, settings, UI, task creation, scheduling, and auxiliary features. Capability differences cannot be represented safely. | Move neutral contracts into `packages/agent-runtime`; create a provider registry and capability descriptors for auth, models, sessions, streaming, permissions, tools, MCP, usage, title, STT, and artifacts. Tasks use `{ providerId, modelId }`, never a bare vendor model string. Contract-test at least a fake provider and Grok adapter before adding provider two. |
| GROK-01 | **The Grok adapter uses the weaker scripting surface.** It launches one-shot streaming headless output (`packages/engine-grok/src/session.ts:171`) and guesses normalized tool events. Current official guidance recommends ACP for IDE/tool integrations. | Parser drift, incomplete approvals/audit, no native session continuation, and brittle behavior on CLI updates. | Implement Grok via `grok agent stdio` ACP with a version/capability handshake. Keep headless streaming behind an explicit degraded capability flag. Pin a tested CLI version range, pass `--no-auto-update` for deterministic subprocesses, and surface upgrade incompatibility before task start. |
| GROK-02 | **Current policy-to-CLI translation is explicitly provisional and semantically wrong for current docs.** Strict maps to `--permission-mode plan`; shell/network map to `--deny shell` and `--deny network` (`packages/shared/src/policy-to-grok-flags.ts:17-21`, `:48-64`). The adapter does not pass `--sandbox`. | Strict can mean plan-only rather than “ask for every effect”; deny tokens do not match documented fine-grained rules; the sandbox defaults off. | Replace string heuristics with a versioned, capability-tested compiler using documented rules and sandbox profiles. Network policy must cover web search, subprocess networking, MCP, and browser tools separately. Snapshot the effective provider policy on each run and display it. Unsupported mappings fail closed. |
| GROK-03 | **The CLI inherits uncontrolled user/project Grok configuration and leaves workspace mutations.** Inspection showed global hooks/plugins/skills are inherited. The adapter writes `.grok/config.toml` and installs skills in the project (`packages/engine-grok/src/session.ts:64`, `:126`), with no ownership manifest or cleanup. | A task can trigger third-party hooks outside Desk's policy/audit, behavior differs by machine, and generated files/secrets can persist or be committed. | Default to an isolated `GROK_HOME`/provider profile owned by Desk, importing only explicitly approved auth and capabilities. Offer a visible compatibility mode for user Grok config. Use ephemeral run directories and an ownership manifest. Add `grok inspect --json`/equivalent diagnostics and tests with hostile hooks/project config. |
| GROK-04 | **Subprocess resource limits and event semantics are weak.** `stderr` grows without a cap (`packages/engine-grok/src/session.ts:207`, `:280-281`); there is no maximum wall time/turn/tool budget; a 12-second heartbeat is emitted as assistant text (`:211`, `:248`); MCP config failure emits an error and execution can continue. | Hung or noisy CLI processes can consume memory, credits, and time; fake assistant content contaminates transcripts; setup failures can produce contradictory task states. | Bound stdout line, stderr, wall-clock, idle, turn, and tool budgets. Use a transient `run_progress` event, not assistant content. Treat provider/config initialization as an atomic preflight. Add overflow, malformed stream, timeout, and setup-failure tests. |
| REMOTE-03 | **Desktop remote secrets are stored in SQLite rather than an OS credential store.** Machine private material, desk token, and device pair secret/session material are retrieved from database-backed services (`packages/gateway/src/services/remote.ts:292-320`). | Database theft or diagnostics leakage can expose durable remote control material. | Move private keys/tokens/pair secrets to OS-protected storage; keep only key IDs/hashes/public metadata in SQLite. Pairing QR secrets should be memory-only with expiry and one-time use. Provide rotation/re-pair migration and tests proving DB copies cannot establish a session. |
| REMOTE-04 | **Telepresence is globally owned but remotely callable by multiple devices.** Mobile sends a device ID for start/stop, while quality/list/input omit it (`apps/mobile/src/api/remote-client.ts:935-957`); gateway dispatch lacks a remote principal. | One paired device can interfere with or control another device's stream. Session ownership, consent, and revocation are ambiguous. | Give every stream an owner principal, session ID, expiry, consent state, and capability token. Validate owner on every frame/input/quality/stop operation; allow explicit takeover only through a desktop confirmation. Add concurrent two-device tests and revoke-during-input tests. |
| REMOTE-05 | **The checked-in relay's authentication and abuse controls are development-grade.** Desk and device token maps are process memory (`services/remote-relay/src/store.ts:28-49`); device tokens are not anchored to a durable registry; no explicit message/connection rate limits or bounded global resource policy were found. | Relay restart loses token continuity; attackers can squat, churn, or exhaust relay memory/bandwidth. E2E protects content, not availability or routing identity. | Audit the actual `grok-landing` deployment source. Use durable hashed credentials or signed short-lived relay tickets; enforce per-IP/machine/device connection, byte, message, and channel limits; set WebSocket max payload before parsing; add idle expiry, metrics, and abuse tests. Keep the relay blind to task content. |
| REMOTE-06 | **Protocol v1 lacks cryptographic domain separation and useful negotiation.** `deriveControlKeys` returns one frame key (`packages/shared/src/remote-crypto.ts:96-112`) used for both directions and control/media; protocol hello only compares literal version 1 (`packages/gateway/src/services/remote-session.ts:396-413`). AEAD has no machine/device/channel/direction AAD. | Cross-context misuse is harder to rule out, rekey/evolution is brittle, and incompatible clients get little diagnostic information. | Protocol v2 derives directional control/media keys and binds version, machine, device, channel, direction, epoch, and sequence as AAD. Negotiate min/max versions and capability bits. Validate rekey public keys as exactly 32 decoded bytes. |
| REMOTE-07 | **Desk-side transport reliability is lossy and weakly observable.** `send` drops frames when disconnected and returns no delivery result (`packages/gateway/src/services/remote-session.ts:256-277`); reconnect delays are fixed; top-level message errors are swallowed (`:307-312`). | A successful gateway mutation can lose its reply; the phone retries and duplicates it. Fleet reconnects can stampede, and failures are hard to diagnose. | Pair idempotent receipts with an outbound response buffer/ack policy, bounded retries, exponential backoff with jitter, desk heartbeat, structured error metrics, and user-visible degraded state. Make send return a result. Do not count telepresence frames before actual enqueue/delivery. |
| TASK-04 | **Scheduling is not durable or behaviorally aligned with interactive tasks.** `lastFired` is an in-memory map (`packages/gateway/src/services/scheduler.ts:15-18`), startup looks back two minutes (`:139-153`), invalid cron is silently ignored, and scheduled tasks call `TaskService.create` directly (`:161-170`) then only pump the runner (`packages/gateway/src/index.ts:271-281`). | Restarts can duplicate or miss runs; scheduled tasks bypass interactive memory, attachment/preamble, role-pack merge, and title behavior. | Persist schedule occurrences with a unique `(scheduleId, scheduledFor)` key, next/last run, status, misfire policy, and error. Route every source through one `TaskSubmissionService`. Add edit/delete/run-now/history APIs and restart/timezone/DST/exactly-once tests. |
| TASK-05 | **Task context injection is a private monkey patch with a leak.** Gateway casts the runner to add `preambles`, patches its private engine, and never deletes the map entry (`packages/gateway/src/index.ts:1042-1086`). Engine swaps can also invalidate the wrapper. | Context behavior differs by entry path, grows memory, and is fragile under refactors/provider changes. | Make `RunContext` an explicit immutable input assembled by one submission/run service. Delete sensitive context at terminal state, persist only provenance/snapshot fields that are needed, and test interactive/scheduled/remote/retry paths identically. |
| TASK-06 | **Artifacts, event sequencing, and completion metadata are heuristic.** Deliverable harvesting scans primary-root files with `mtime >= task.createdAt` (`packages/gateway/src/services/runner.ts:375-393`, `:754-807`); event sequence uses `MAX(seq)+1` (`packages/gateway/src/services/tasks.ts:306`); completion time uses `COALESCE` (`:233`). | Artifacts can be missed or misattributed under multiple roots/concurrent tasks; concurrent writers can collide; retried tasks retain stale completion metadata. | Define provider-neutral artifact declarations plus an optional bounded filesystem diff across all approved roots. Allocate event sequence transactionally with a task counter. Model run attempts separately so completion belongs to an attempt. Test concurrent appends, preserved mtimes, multiple roots, retries, and unrelated file writes. |
| AUDIT-01 | **Audit is append-only internally but not complete or usable.** Tool events are only recorded when the provider emits them; no audit list/export UI/API was found; retention/redaction and correlation are undefined. | Users cannot verify what happened, and sensitive command/path data may be retained without a policy. | Add a structured `OperationReceipt` generated at the authoritative broker with request, decision, effect/result, provider, principal, timestamps, redaction class, and correlation IDs. Expose filtered UI/export, retention controls, and integrity checks. Audit denied and failed operations too. |

### P2 — UX, operations, and maintainability

| ID | Finding and evidence | Impact | Required fix and acceptance proof |
|---|---|---|---|
| CMD-01 | **Most slash “commands” are localized prompt macros.** `/brief`, `/research`, `/organize`, `/image`, and `/video` are `kind: "fill"`; only folder/schedule/tools/memory are actions (`apps/desktop/src/renderer/lib/composer-input.ts:56-127`). | Behavior is model- and locale-dependent; `/image` or `/video` can imply a capability that is unavailable; there is no stable execution receipt. | Create a neutral command catalog with typed arguments, availability predicate, confirmation policy, handler/prompt strategy, and telemetry event. Label prompt templates as templates. Capability-gate media commands and show the selected provider/tool. |
| CMD-02 | **Provider/skill commands are not dynamically discoverable.** The slash registry is hard-coded even though Grok supports user-invocable skills and providers will expose different features. | New skills and providers require renderer releases; command menus can lie about capabilities. | Merge core commands, installed Desk skills, provider commands, and workspace commands through one registry. Namespace collisions, show provenance, cache capability snapshots, and test keyboard/IME/no-match behavior across dynamic updates. |
| CMD-03 | **MCP configuration lacks a safe preflight/doctor flow.** The UI can enable custom servers and credentials, but no `mcp doctor`/capability test is integrated. | A task discovers broken or malicious connector configuration only after it starts; users cannot see the exact command/environment boundary. | Add connector preflight, health, schema/capability display, least-privilege environment selection, per-task enablement, and explicit trust labeling. Use provider-native doctor commands only behind a neutral interface. Never return secret values to the renderer. |
| SEC-04 | **Agent-rendered remote content can make network requests.** CSP allows `img-src ... https:` and all `wss:`/`https:` connections (`apps/desktop/src/renderer/index.html:7`); Markdown renders arbitrary links and remote images (`apps/desktop/src/renderer/components/ui/markdown.tsx:49-55`). | Model output can leak the user's IP and viewing time through tracking pixels; unsafe link schemes depend on the permissive Electron handler. | Proxy/cache remote media through a consented, size/type-limited fetcher or block it by default. Sanitize URL schemes and Markdown. Narrow CSP to explicit origins and use separate app protocols for approved assets. |
| OPS-01 | **Desktop-to-gateway RPC has no deadline or cancellation.** The gateway child can restart, but a request to an alive/stalled process can wait indefinitely (`apps/desktop/src/main/gateway-process.ts`; `apps/desktop/src/renderer/lib/api.ts`). | UI actions can hang with no recovery or retry classification. | Add per-method deadlines, cancellation, bounded request tracking, reconnect generation IDs, and idempotent retry rules. Surface “gateway unavailable” separately from task failure. |
| OPS-02 | **Dependency audit currently reports two moderate transitive advisories.** Mobile's Expo toolchain pulls vulnerable `postcss@8.4.49` and `uuid@7.0.3`. | Known vulnerable dependencies remain in the production dependency graph; actual exploitability depends on use. | Upgrade Expo/transitives or apply a tested override if compatible. Add scheduled audit/SBOM/license checks and a documented severity/exploitability exception process. Acceptance: `pnpm audit --prod` clean or time-bounded exceptions recorded. |
| OPS-03 | **The production live smoke has a protocol-correlation bug and poor CLI ergonomics.** It has no `--help`; it defaults to localhost; `rpc()` accepts the next frame on a channel rather than the matching response ID, so a `tasks.changed` event caused `expected res` after production `tasks.create` succeeded (`scripts/remote-live-smoke.mjs`). Failure cleanup is not in `finally`. | A healthy production path reports failure, temporary resources can remain, and operators can misdiagnose incidents. | Parse all control frames, route responses by ID, handle events independently, add `--help`/`--relay`/timeouts, unique machine/device IDs, and `finally` cleanup. Run it in a controlled canary environment with a machine-readable report. |
| DOC-01 | **Status documents overstate shipped guarantees.** `apps/mobile/IMPROVEMENTS.md` marks client mutation idempotency complete, but the gateway strips/ignores `clientMutationId`. Product/design language around “fully audited,” credential storage, and remote completeness does not match code. | Planning and release decisions rely on false confidence; regressions hide behind checked boxes. | Replace completion checklists with evidence links: implementation PR, test name, invariant, and last verification date. Add a claim-to-test matrix and automatically flag stale evidence paths. |
| MAINT-01 | **Core modules are oversized and cross-layer behavior is monkey-patched.** At audit time `App.tsx`, task workspace view, gateway index, runner, and mobile remote client are each large multi-responsibility files; gateway patches task methods and engine internals (`packages/gateway/src/index.ts:290-309`, `:1042-1086`). | Security review and provider work have a wide regression radius; invariants are implicit. | Split by bounded context after contracts are defined: task submission/run recovery, provider registry, remote transport/session/application services, audit, command registry, and view-model hooks. Prefer constructor interfaces/events over private casts and method replacement. |

## Detailed redesign

### 1. Provider-neutral runtime

Create `packages/agent-runtime` as the only runtime contract imported by the gateway and shared UI schemas. Suggested concepts:

```ts
type ProviderRef = { providerId: string; modelId: string };

interface ProviderCapabilities {
  sessions: "none" | "resume" | "branch";
  toolMediation: "gateway" | "provider-permission-rpc" | "uncontrolled";
  sandboxProfiles: string[];
  supportsMcp: boolean;
  supportsUsage: boolean;
  supportsArtifacts: boolean;
  modalities: Array<"text" | "image" | "audio" | "video">;
}

interface AgentProvider {
  readonly id: string;
  probe(): Promise<ProviderHealth>;
  listModels(): Promise<ModelDescriptor[]>;
  getCapabilities(modelId: string): Promise<ProviderCapabilities>;
  createSession(input: SessionInput): Promise<AgentSession>;
  resumeSession(binding: ProviderSessionBinding): Promise<AgentSession>;
}

interface AgentSession {
  runTurn(input: TurnInput, sink: RuntimeEventSink): Promise<TurnResult>;
  cancel(reason: string): Promise<void>;
}
```

The actual contract must also define auth state without exposing credentials, policy compilation results, permission requests, structured tool calls/results, usage, provider/version identity, diagnostics, and error taxonomy. `executesOwnTools: boolean` is too weak; an uncontrolled provider cannot satisfy a policy claim and should run only in visibly degraded mode.

Recommended packages:

- `packages/agent-runtime`: neutral contracts, event schema, capability negotiation, policy IR, conformance kit, fake provider;
- `packages/provider-grok`: ACP transport, Grok auth/model/usage integration, policy compiler, version compatibility;
- future `packages/provider-openai` and/or `packages/provider-anthropic`: adapters added without changing gateway task semantics;
- `packages/credential-vault`: main-process-only interface backed by Electron safe storage/keychain;
- gateway `ProviderRegistry`: selects a provider/model and snapshots capabilities/config version per run.

Do not put provider-specific auth, model discovery, title generation, STT, billing, or usage calls directly in gateway switch cases. Auxiliary capabilities should be optional provider services or independent product services.

### 2. Integration options and trade-offs

| Option | What it means | Benefit | Cost/risk | Recommendation |
|---|---|---|---|---|
| A. Grok custom-model configuration only | Continue using Grok Build as the runtime and point its documented custom models at compatible endpoints. | Fastest access to more models; reuses Grok tools. | Still locked to Grok Build's auth/session/tool/policy/event semantics; not genuine provider portability. | Useful short-term experiment, not the target architecture. |
| B. Neutral runtime with provider adapters | Gateway owns neutral task/session/policy semantics; Grok ACP is adapter one; add other adapters later. | Preserves product behavior, makes capabilities explicit, supports real conformance tests, reduces vendor leakage. | Requires data migration and a deliberate runtime contract. | **Recommended.** |
| C. Product-owned agent/tool loop over raw model APIs | Desk implements planning, tool dispatch, context, approvals, and provider SDK calls itself. | Maximum control and portability. | Highest engineering/security burden; must recreate mature agent runtime behavior. | Consider only if ACP/provider runtimes cannot provide enforceable mediation. |

### 3. Task and conversation model

Separate these concepts:

- **Conversation**: user-visible chat and branch structure.
- **Turn**: one user request and its assistant result.
- **Task**: durable unit of scheduled/interactive/remote work.
- **Run attempt**: lease, provider binding, effective policy/capabilities, start/end/terminal reason.
- **Operation**: approval-mediated tool or external effect with a receipt.
- **Artifact declaration**: provider/tool-declared output plus verified path metadata.

Add fields/tables rather than overloading the existing task row:

- `provider_id`, `model_id`, `provider_session_id`;
- `provider_version`, `provider_config_version`, `capability_snapshot_json`;
- `conversation_id`, `turn_id`, `parent_turn_id`;
- `task_run_attempts` with lease owner/expiry, retry number, cancellation intent, terminal reason;
- `task_mutation_receipts` for remote/local idempotency;
- `schedule_occurrences` with unique scheduled timestamp and misfire status;
- `operation_receipts` with redaction and correlation metadata.

Migration rules:

1. Backfill existing bare models as `provider_id = "grok"`; preserve the original model string.
2. Convert parent-task chains into conversations/turns without inventing provider session IDs.
3. Mark active legacy tasks found during migration as `interrupted`, never silently `done` or resumed.
4. Introduce new nullable columns/tables first, dual-read, backfill transactionally, then make invariants required in a later schema version.
5. Back up the database before migration and test upgrade from every supported schema version plus downgrade refusal.

### 4. One task submission path

Interactive, follow-up, remote, schedule, inbox, retry, and automation sources must call one `TaskSubmissionService`. It should:

1. authenticate the caller and attach a principal/context;
2. validate provider/model/capabilities;
3. resolve workspace roots and attachments;
4. compose role, memory, skills, and conversation context deterministically;
5. compile and snapshot effective policy;
6. allocate an idempotency receipt and durable queued run attempt;
7. return after the database commit;
8. let a durable worker claim/pump the attempt.

This removes the scheduler bypass and the current preamble monkey patch.

### 5. Policy and command execution

Define a provider-neutral policy IR with separate capabilities for:

- filesystem read, write, create, delete, and roots;
- shell command families and subprocess environment;
- network DNS/connect, web search, browser navigation, download/upload;
- MCP server/tool identity;
- desktop observation and input;
- clipboard, camera, microphone, screen capture;
- secret access;
- maximum duration, bytes, tool calls, and spend.

Every operation should be one of: `allow`, `deny`, or `ask`, with a reason and immutable effective-policy version. A provider adapter may compile this IR only if its conformance tests prove equivalent behavior. Otherwise the gateway must own the tool or the product must show that the capability is unavailable/degraded.

Commands should use a `CommandDescriptor` rather than localized text as the contract:

```ts
interface CommandDescriptor<Args> {
  id: string;
  source: "core" | "skill" | "provider" | "workspace";
  argsSchema: unknown;
  isAvailable(ctx: CommandContext): Availability;
  confirmation: "none" | "preview" | "always";
  execute(args: Args, ctx: CommandContext): Promise<CommandReceipt>;
}
```

Prompt templates remain useful, but should be labeled and tested as templates rather than implied deterministic commands.

### 6. Remote protocol v2

The remote application boundary should look like:

```text
relay-authenticated channel
  -> decrypt + replay check
  -> RemotePrincipal(deviceId, machineId, sessionEpoch)
  -> remote method policy
  -> typed remote application service
  -> idempotency transaction
  -> gateway domain service
  -> encrypted correlated receipt
```

Required protocol properties:

- signed/anchored relay tickets without revealing content;
- directional keys for control request, control response/event, and media;
- AEAD AAD binding protocol, machine, device, channel, direction, epoch, and counter;
- replay window and key rotation;
- min/max version plus capabilities;
- request correlation, mutation idempotency, response receipts, bounded offline/outbound queues;
- explicit telepresence owner, consent, expiry, and revocation semantics;
- exponential backoff/jitter, heartbeat, congestion/backpressure, and delivery/drop metrics.

The deployed relay repository and infrastructure configuration must be reviewed before declaring production remote secure. Health alone proves reachability, not identity durability, limits, or code equivalence.

### 7. Electron and content boundary

Treat all provider output, remote content, project files, and links as hostile input.

- Enforce a single trusted renderer origin and reject navigation.
- Verify sender origin/window in every privileged IPC handler.
- Use narrow typed IPC methods, deadlines, payload limits, and cancellation.
- Sanitize Markdown and URL schemes.
- Disable remote images by default or fetch through a controlled proxy with consent, size/type checks, caching, and privacy messaging.
- Narrow CSP to the actual provider/relay endpoints needed by the relevant process; the renderer should not need arbitrary network access.
- Keep credentials, filesystem authority, and provider process spawning out of the renderer.

## Phased implementation plan

### Phase 0 — freeze claims and add regression harnesses

1. Update release/product wording: do not claim full sandboxing, full audit, idempotency, or provider independence.
2. Add failing characterization tests for the P0 findings: denied operations with real/fake provider, two-device confused deputy, replayed mutation, crash recovery, secret canaries, Electron navigation.
3. Fix `scripts/remote-live-smoke.mjs` response correlation and cleanup so it can be trusted as a canary.
4. Snapshot current DB schemas and migration fixtures.

**Exit gate:** every P0 invariant has a failing test or explicit reproduction before implementation begins.

### Phase 1 — contain immediate trust-boundary risk

1. Add Electron navigation, scheme, sender, permission, and CSP restrictions.
2. Add credential vault, redact renderer/diagnostic settings, stop writing literal secrets into projects, and migrate existing values.
3. Bind remote requests to `RemotePrincipal`; fix cross-device rekey/telepresence.
4. Make current Grok mode visibly degraded until sandbox/policy equivalence is proven; enable a tested sandbox and documented rules where possible.
5. Fix SIGKILL escalation and add subprocess resource limits.

**Exit gate:** secret-canary suite is clean; cross-device/replay tests cannot mutate state; denied operations cannot execute; hostile navigation cannot reach preload IPC.

### Phase 2 — durable task kernel

1. Add conversations, turns, run attempts, leases, terminal reasons, operation receipts, and durable idempotency.
2. Implement startup recovery and one submission service for all task sources.
3. Persist schedule occurrences/misfire policy; add schedule edit/delete/history/run-now.
4. Replace preamble patches with explicit `RunContext`.
5. Add declared artifacts and transactional event sequencing.

**Exit gate:** kill/restart matrix passes at every task state; schedule restarts are exactly-once by occurrence; follow-ups preserve context across app restart.

### Phase 3 — neutral runtime and Grok ACP

1. Create `packages/agent-runtime` and its conformance kit.
2. Move neutral events/types out of `engine-grok`; add provider registry and provider/model storage.
3. Implement `packages/provider-grok` using ACP, version handshake, sessions, structured permission flow, inspect/doctor, and deterministic update behavior.
4. Move Grok auth/models/usage/title/STT behind capability interfaces or independent services.
5. Keep the old streaming adapter only behind a compatibility flag with reduced capabilities.

**Exit gate:** fake and Grok providers pass the same task/session/policy/event conformance tests; gateway has no import from the Grok provider package except composition root registration.

### Phase 4 — remote protocol v2 and production relay hardening

1. Implement directional keys, AAD, counters/epochs, replay window, negotiation, receipts, and rekey.
2. Add OS-protected remote key storage and migration.
3. Harden and load-test the actual production relay: durable/signed auth, rate/size/resource limits, metrics, alerts, deploy parity proof.
4. Add telepresence ownership, consent, session TTL, adaptive backpressure, and truthful frame metrics.

**Exit gate:** adversarial two-device, replay, reorder, reconnect, relay restart, load, and revoke tests pass against a production-equivalent deployment.

### Phase 5 — command system and provider two

1. Introduce the typed command catalog and dynamic skill/provider discovery.
2. Capability-gate media, MCP, browser, desktop, and provider-specific commands.
3. Add safe MCP doctor/preflight and command receipts/telemetry.
4. Implement a second provider adapter to validate the abstraction. Do not reshape the runtime merely to mimic Grok; record capability differences explicitly.

**Exit gate:** the same core task and command flows work with fake, Grok, and provider two; unsupported features are unavailable with an explanation rather than failing mid-task.

### Phase 6 — decomposition and release hardening

1. Split large gateway/renderer/remote modules along the new service boundaries.
2. Add observability dashboards for task leases, provider failures, remote replay/drop/rate limits, approvals, audit completeness, and secret redaction.
3. Resolve dependency advisories, generate SBOMs, run packaging/notarization/update tests, and execute the production canary.
4. Commission an independent security review of the provider broker, Electron IPC, remote protocol, vault migration, and deployed relay.

## Required test matrix

| Area | Minimum cases |
|---|---|
| Policy | Each capability in allow/deny/ask; write path symlink traversal; shell indirection; subprocess network; MCP tool; browser; desktop; hostile provider adapter; unsupported policy fails closed. |
| Task durability | Crash at submit, lease claim, stream, tool approval, tool result, artifact, terminal commit; stale lease; duplicate worker; cancel/restart; provider resume unavailable. |
| Conversation | Follow-up after restart; branch; retry; provider/model change; context limit; failed prior turn; legacy migration. |
| Remote auth | Two devices; mismatched body device ID; rekey another device; revoke during request; expired ticket; relay restart. |
| Remote crypto/reliability | Exact replay, nonce/counter reuse, reorder, old epoch, wrong channel/direction AAD, reconnect duplicate, lost response, offline retry, queue bounds. |
| Telepresence | Owner/non-owner input, takeover consent, TTL, revoke, permission loss, frame backpressure, oversize frame, display change. |
| Secrets | Canary through DB, renderer IPC, logs, audit, diagnostics, crash dump, temp/project config, backups, migration, uninstall cleanup. |
| Electron | Same-window navigation, popup, external scheme allowlist, untrusted sender IPC, remote Markdown image/link, CSP, permission requests. |
| Provider conformance | Probe/version, models, auth unavailable, capabilities, session create/resume, cancellation, malformed event, policy request, usage, artifact, timeout. |
| Scheduling | DST forward/back, timezone change, restart before/after fire, two scheduler instances, invalid cron, quiet hours, missed-run policy, occurrence uniqueness. |

## Observability and operational requirements

- Correlation chain: UI action -> IPC request -> task/turn -> run attempt -> provider session -> operation receipt -> artifact -> remote request if applicable.
- Metrics: queue age, lease expiry/recovery, task terminal reasons, provider version/error taxonomy, approval latency, policy denials, incomplete operation receipts, remote handshake/replay/drop/rate-limit counts, telepresence frame enqueue/drop/latency.
- Logs: structured and bounded, with secret classification/redaction before serialization; raw provider stderr is never dumped wholesale.
- Diagnostics bundle: configuration metadata and hashes only, provider/relay health, schema/version, recent redacted errors, no tokens/prompts/file content unless separately opted in.
- Release gate: test/build/audit/SBOM, schema migration rehearsal, packaged Electron security tests, provider compatibility canary, production relay canary, rollback plan.

## Documentation and product claims that must change

Until the corresponding exit gates pass, do not claim:

- “sandboxed” without naming the effective provider sandbox and tested restrictions;
- “fully audited” while provider-owned operations can bypass the broker or audit has no complete receipt UI/export;
- “idempotent remote actions” while `clientMutationId` is not a schema-backed, durable gateway invariant;
- “provider independent” while gateway schemas, models, auth, auxiliary services, and adapter types are Grok-specific;
- “production relay verified” based only on the local relay source or a health endpoint;
- “pause stops work” when it only pauses queue/event processing;
- “credentials stay in the OS keychain” while literals can exist in SQLite/project config/renderer responses.

Every major claim should link to: the invariant, implementation owner, automated test, production verification, and last-verified date.

## External reference check

Checked on 2026-07-14 against official xAI documentation:

- [Grok Build overview](https://docs.x.ai/build/overview) — headless and ACP integration surfaces, custom models.
- [CLI reference](https://docs.x.ai/build/cli/reference) and [headless scripting](https://docs.x.ai/build/cli/headless-scripting) — current flags, sessions, formats, and deterministic scripting guidance.
- [Enterprise sandbox and permissions](https://docs.x.ai/build/enterprise) — sandbox profiles and fine-grained permission rules.
- [Settings](https://docs.x.ai/build/settings) — configuration scope and custom model configuration.
- [MCP servers](https://docs.x.ai/build/features/mcp-servers) — MCP configuration and diagnostics.
- [Skills, plugins, and marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces) and [modes and commands](https://docs.x.ai/build/modes-and-commands) — dynamic runtime capabilities relevant to the command catalog.

External documentation is version-sensitive. The provider adapter must use a runtime capability/version handshake and conformance tests rather than assuming these behaviors forever.

## Definition of done for the overhaul

The overhaul is done only when all of the following are true:

1. The product can prove which component authorized every external effect and can show a complete redacted receipt.
2. A denied operation cannot happen through provider tools, MCP, hooks, shell indirection, browser, desktop control, or remote control.
3. Gateway/app/relay crashes cannot leave ambiguous task state or duplicate a mutation/schedule occurrence.
4. Remote requests are replay-resistant, principal-bound, idempotent, and isolated between paired devices.
5. No durable secret reaches SQLite, the renderer, logs, diagnostics, or user projects in plaintext.
6. Follow-ups preserve intentional context and provider sessions across restart.
7. The gateway and UI refer to providers/models/capabilities neutrally; a second provider passes the conformance suite without rewriting core task behavior.
8. Production-equivalent relay, packaged Electron, database migrations, provider compatibility, dependency audit, and adversarial security tests are release gates rather than manual assumptions.

