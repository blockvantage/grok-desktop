# Refined Chat Experience Design

Date: 2026-08-05
Status: Approved direction, implementation pending

## Problem

Recent production chat traces show that Grok Desk behaves like a task-event viewer instead of a coherent conversation. The latest runs repeatedly timed out on ACP initialization, lost the in-app browser when falling back, mislabeled terminal commands as deletion, leaked a binary tool envelope into assistant text, persisted only user turns, and rendered the same approval through multiple surfaces.

The result is slow first feedback, weak continuation context, repetitive progress narration, misleading approval prompts, visual blinking, and report-like answers even for casual questions.

## Goals

1. Preserve complete user and assistant conversation context across restarts and provider fallback.
2. Keep binary, JSON, diagnostic, and tool-protocol content out of assistant prose.
3. Remove approval fatigue for ordinary work inside authorized workspace roots.
4. Preserve approval gates for destructive, privileged, credential-related, outside-root, or externally consequential actions.
5. Present one stable live state, one stable approval interaction, and one durable final response per turn.
6. Ensure the in-app browser remains available when ACP falls back to the headless engine.
7. Make ordinary questions feel conversational rather than forcing every response into a deliverable report.
8. Make loading, streaming, message arrival, and state transitions feel smooth and spatially stable.
9. Open safe web links and citations inside Desk's in-app browser by default.

## Non-goals

- Do not weaken the file-vault credential policy or access credential-vault data.
- Do not silently allow destructive file deletion, writes outside configured roots, privilege escalation, software installation, credential access, or consequential external actions.
- Do not replace the audit/event ledger. Raw execution detail remains available through an optional details surface.
- Do not redesign unrelated settings, onboarding, or navigation surfaces in this pass.

## Approaches considered

### A. Presentation-only cleanup

Hide duplicate cards, soften animation, and restyle the live rail. This is low risk but leaves the runtime and transcript defects intact. The UI would still receive corrupt payloads, lose assistant context, and ask incorrect approvals.

### B. Runtime-only repair

Fix parsing, ACP fallback, tool classification, and transcript persistence without changing the renderer. This restores correctness but leaves multiple competing live and approval surfaces, so the experience remains noisy.

### C. End-to-end conversational repair — selected

Repair the protocol boundary, durable conversation model, policy classification, event projection, and canonical chat UI together. Each layer gets a narrow contract and regression tests based on anonymized real traces. This is the smallest approach that fixes both trust and perceived quality.

## Architecture

### 1. Protocol ingress and event classification

`packages/engine-grok` owns the boundary between Grok CLI streaming JSON and Desk events.

- Recognize nested tool envelopes even when the CLI wraps them in a `text` event.
- Treat `tool_call_update` as tool activity/result, never assistant text.
- Extract media paths or artifact metadata without retaining inline binary data.
- Reject user-visible assistant text that is a protocol envelope, data URL, or oversized binary-like payload.
- Classify tools using exact names and ordered semantic matching. `run_terminal_command` maps to `shell`; substring fragments such as `rm` must not classify a name as deletion.
- Add a bounded assistant-prose limit significantly below the existing 500,000-character coalescing ceiling. Oversized protocol data is dropped from chat and retained only as a redacted diagnostic marker.

### 2. Provider fallback and capability continuity

ACP remains preferred when its handshake succeeds. When initialization fails:

- Record a process-level failure circuit for the current CLI/provider version so subsequent turns do not pay the same initialization timeout repeatedly.
- Fall back immediately while the circuit is open.
- Compose the fallback engine with the same Desk browser/desktop MCP servers and skills as the primary execution path.
- Run a preflight capability check before advertising browser availability.
- Keep the fallback truthful: if the connector is unavailable, expose one concise product error rather than encouraging the model to retry alternate spellings or shell-open an external application.

### 3. Durable conversation ledger

Every accepted task continues to create one user turn. Every terminal task with a valid final assistant response creates one assistant turn.

- Add an idempotent uniqueness rule for one assistant turn per task.
- Persist only a sanitized final response, not progress or tool protocol data.
- Append the assistant turn before terminal completion is announced to downstream consumers, or reconcile it idempotently immediately after completion.
- Transcript fallback includes both roles and remains bounded by the existing character budget.
- Backfill existing conversations from the latest valid assistant `text` event per completed task, skipping JSON/tool envelopes and empty/provider-noise messages.
- Synchronize the generated root task title into the conversation row so the durable model and UI agree.

### 4. Approval policy without fatigue

Balanced mode becomes the default productive mode:

Automatically allow inside configured workspace roots:

- Structured file read, list, search, stat, and diff operations.
- Structured file create/edit/write operations.
- Network research when network tools are enabled.
- In-app browser open/read/click/type/scroll/screenshot under browser policy.
- Recognized read-only shell commands whose parsed command contains no control operators, redirections, substitutions, or mutation-capable arguments.
- Recognized local verification commands such as project tests, typechecks, lint, and builds when they run inside the authorized workspace and do not install packages.

Still require approval for:

- Delete, recursive removal, destructive overwrite, reset, or discard operations.
- Writes or commands targeting outside configured workspace roots.
- Unclassified shell commands, shell control operators, redirection, command substitution, or privilege escalation.
- Dependency installation, system configuration, permission changes, credential access, or external application launch.
- Actions with externally consequential side effects unless already represented by a narrower authorized structured capability.

Strict mode retains approval-heavy behavior. Autopilot retains its current broad allow semantics subject to hard denies and product safety boundaries.

Approval payloads carry normalized `what`, `where`, `why`, effect class, and scope. They never infer the user-facing description from a lossy tool category alone.

### 5. Chat event model and projection

The UI distinguishes:

- Progress: transient, compact, not part of the answer.
- Tool activity: summarized into the optional work drawer.
- Approval: one parked interaction.
- Final assistant response: one stable Markdown surface.

The projector must not replace the final-answer slot with each progress sentence. Until a final marker is available, it selects the latest safe assistant text only as a provisional streaming response and suppresses known progress narration. Terminal completion promotes the final safe message.

### 6. Canonical chat presentation

The canonical conversation remains the primary surface.

- Render one compact live-state row. Do not show the generic five-stage rail for short or single-action tasks.
- Render one inline approval card with the decision controls. The workspace header may show a passive jump link, but no duplicate approve/reject controls.
- The live-state row transforms into the approval state without mounting a second animated alert.
- Entrance animation runs only for a newly created turn, not for every status transition.
- Use stable component identity across `running -> waiting_approval -> running`.
- Render the assistant final with a clear conversational anchor and restrained actions.
- Show citations adjacent to researched claims and artifacts as filename-first attachments; hide raw absolute paths until requested.
- Keep raw events, tool names, and payload detail in the existing optional work/audit surfaces.

#### Message and loading motion

Loading uses spatial continuity instead of generic indefinite animation:

- Initial conversation hydration renders a transcript-shaped skeleton that matches the final chat column width and message geometry.
- A new user message settles into place immediately after durable acceptance; the live assistant state appears in the reserved response slot without shifting the transcript.
- Streaming text updates the same response block and caret. Existing paragraphs do not replay entrance animation on every token or event.
- Progress labels crossfade in place only when their semantic activity changes; elapsed-time ticks do not trigger visible remounts.
- Approval, recovery, completion, citations, and artifacts morph or reveal within the reserved turn region rather than inserting competing cards above and below it.
- Completion removes indeterminate motion before revealing the final response, preventing a spinner and finished answer from appearing simultaneously.
- Animation uses transform and opacity only, with short 140–220 ms durations and the existing premium easing. No shimmer, pulse, bounce, glow, or attention animation runs indefinitely in the main transcript.
- `prefers-reduced-motion` receives immediate state changes with the same spatial reservation and hierarchy.

The opening boot screen may keep determinate progress only when it is tied to real boot stages. Conversation hydration and model execution use honest state labels rather than percentage bars that imply unavailable precision.

#### Link and citation routing

HTTP and HTTPS links rendered in assistant Markdown, citation cards, and artifact summaries open in the Desk browser pane by default.

- Add a structured `browser.openUrl` gateway operation parallel to `browser.openHtml`.
- Validate the scheme, reject embedded credentials, and route through the existing browser host policy and task partition.
- Clicking a link opens or reveals the right-side browser pane while preserving the conversation and scroll position.
- Repeated clicks in the same conversation reuse the existing browser session.
- The link shows a small domain cue and accessible “Open in Desk browser” label; citation cards use the same handler.
- A context-menu or explicit secondary action may open the system browser. Ordinary primary clicks never call `window.open` or create an external browser tab.
- Fragment-only links remain local to the rendered response. Unsupported schemes render as inert text.
- Local workspace links resolve through the existing asset/file-preview boundary and never become `file://` navigation.
- Browser-open failure leaves the chat in place and shows one concise inline/toast recovery message with a retry action.

### 7. Conversational response policy

The fallback prompt becomes intent-aware:

- Questions and recommendations: answer directly; do not create a file unless requested or materially helpful.
- Build/edit tasks: create deliverables and summarize them concisely.
- App actions such as opening an existing local deliverable: use the deterministic host capability rather than starting a general model run when the target can be resolved safely.
- Match the user's level of formality.
- Avoid repeated “I'll…”, “Let me…”, headings, tables, and status recaps unless they improve comprehension.
- Research involving current prices, rankings, requirements, or recommendations must emit citations or state that sources could not be attached.

## Data flow

1. User submit is durably accepted and its user turn is written.
2. Gateway resolves an intent shortcut or starts the provider runtime.
3. Runtime events pass through strict protocol normalization and payload guards.
4. Progress and tool events update one compact live state; they never replace final prose.
5. Policy auto-allows safe in-scope work or parks one descriptive approval.
6. The final safe response is persisted as the assistant turn.
7. Terminal status is published and the UI renders the durable final plus citations/artifacts.
8. A follow-up transcript contains alternating user and assistant turns.

## Error handling

- ACP initialization failure opens a version-scoped circuit and produces one diagnostic event.
- Missing Desk browser capability produces one product-facing failure with a recovery action.
- Invalid or binary-like assistant text is dropped and replaced by a diagnostic event; it cannot become the final response.
- Assistant-turn persistence is idempotently reconciled on startup if the process exits between provider completion and ledger write.
- Approval state is derived from one unresolved approval ID and cannot resurrect after terminal completion.

## Testing strategy

Test-first regressions will cover:

1. Nested `tool_call_update` image data never becomes assistant text.
2. Oversized/base64-like assistant content is rejected at ingress and persistence.
3. `run_terminal_command` maps to `shell`, not deletion.
4. Safe balanced-mode workspace reads and recognized verification commands auto-allow.
5. Destructive or unclassified shell operations still require approval.
6. The agent-provider fallback receives Desk browser/desktop MCP servers.
7. Repeated ACP initialization failures use the circuit instead of paying repeated timeouts.
8. Completed tasks persist exactly one assistant turn and transcript fallback includes both roles.
9. The projector separates progress from the final answer.
10. Canonical chat renders only one approval decision surface.
11. Approval status transitions do not replay entrance animation or remount duplicate controls.
12. Research without citation events cannot present unsupported source cards.
13. An in-app open request takes the deterministic host path when a safe local HTML target is available.
14. Assistant Markdown links and citation cards call the structured in-app `browser.openUrl` path and never default to `window.open`.
15. Streaming updates preserve one message DOM identity and do not replay entrance motion per token.
16. Loading-to-live-to-final transitions reserve space and never show simultaneous indeterminate and completed states.
17. Motion-reduced rendering remains complete and usable without animation.

The final verification gate includes focused unit tests, desktop renderer tests, gateway tests, typecheck, full workspace tests, build, and the existing chat E2E/visual QA suites.

## Success criteria

- No protocol JSON or inline binary appears as assistant prose.
- The second turn after an ACP failure does not incur another ACP initialization timeout.
- “Continue” receives prior assistant responses after restart.
- Routine in-workspace work completes without approval interruptions in balanced mode.
- Destructive and outside-scope operations remain gated.
- Each unresolved approval has one visible decision surface with accurate what/where/why copy.
- A turn presents one live state and one final assistant response without content flashing.
- In-app browser capability remains available through provider fallback.
- Research answers expose usable citations for time-sensitive claims.
- Safe web links and citations open in the task-partitioned Desk browser while the conversation remains visible.
- Loading and streaming preserve layout, avoid repeated pulses/shimmers, and transition smoothly into the final response.
