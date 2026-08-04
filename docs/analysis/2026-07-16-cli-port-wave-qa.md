# CLI Feature Port Wave QA — 2026-07-16 / 2026-07-17

**Spec:** `docs/superpowers/specs/2026-07-15-cli-feature-port-design.md`  
**Plan:** `docs/superpowers/plans/2026-07-16-cli-feature-port-wave.md`  
**Branch:** `main`

## Test matrix (automated)

| Package | Result | Notes |
|---------|--------|-------|
| `@grokdesk/shared` | PASS (269) | max effort, honest strict, plan_update/citations kinds |
| `@grokdesk/engine-grok` | PASS (100) | session_meta + usage from end; --resume argv |
| `@grokdesk/provider-grok` | PASS (35) | plan set_mode, interject/rewind -32601 degrade |
| `@grokdesk/gateway` | PASS (678) | ACP factory, selection, power-state, runner, migration v10 |
| `@grokdesk/desktop` | PASS (1176) | plan card, context meter, mermaid sanitize, citation cards, projector plan/citations |
| `@grokdesk/agent-runtime` | PASS (4) | conformance suite (re-enabled, see below) |
| `@grokdesk/provider-echo` | PASS (3) | provider suite (re-enabled, see below) |

Full logs: implementer scratch `cli-port-wave-test-matrix.log`.

`pnpm -r test` is fully green (exit 0). The earlier failure was the repo-root `vitest.config.ts` (scripts-only include) shadowing packages without a local config; `agent-runtime` and `provider-echo` now carry package-local configs so their suites are discovered again.

## Protocol probes (from `/tmp/grok-build`)

See implementer scratch `protocol-probes.md`:

| Feature | Observed shape |
|---------|----------------|
| exit_plan_mode | `x.ai/exit_plan_mode` camelCase `{ sessionId, toolCallId, planContent? }` → `{ outcome: approved\|cancelled\|abandoned }` |
| rewind points | `{ rewind_points: [{ prompt_index, created_at, num_file_snapshots, has_file_changes, prompt_preview? }] }` |
| media output | tool ids `image_gen`/`image_edit`/…; saved absolute path in tool output prose |

## Manual matrix

| Scenario | Status | Reason |
|----------|--------|--------|
| ACP default when CLI supports stdio | SKIP | Requires live grok binary + Electron; unit coverage via engine-selection + factory |
| FORCE_HEADLESS=1 | PASS (unit) | `engine-selection` test |
| Sleep/wake power state | PASS (unit) | PowerStateGate order + scheduler pause |
| Plan-first toggle + card | PARTIAL | Engine/UI wired; full ACP plan approval loop needs live agent |
| Nudge interject | PASS (unit) | -32601 degrade + success path |
| Context compact | PASS (unit) | compact() + meter chip render |
| Undo rewind | PASS (unit) | points shape + RPC surface |
| Media/citations/mermaid | PASS (unit/struct) | mapping + components; live CLI media harvest best-effort path extraction |
| Strict headless read-only | PASS (unit) | deny Write/Edit/Bash + disallowed-tools |

## Task 15 weekly recap

**Explicitly deferred** (stretch/cuttable per plan). Takeaways foundation remains; no scheduler/inbox wiring in this wave.

## Ownership guardrails

Changed-file list audited: no `license-*`, `entitlement*`, or `managed-runtime*` paths modified.

## Transcript purity

- `session_meta`, `usage`, `run_progress` → not conversation transcript events  
- `plan_update`, `citations` → persisted as task events  

## Commits (wave)

See `wave-commits.log` in implementer scratch; series starts with `feat(engine): add max effort…` through Phase B/C bundle and closeout.


## Skeptic gap fix (follow-up)

Product path wiring landed after first closeout:

- ACP plan-review / ask permissions park via `permission_request` + human-permission bridge resolved by `tasks.approve`.
- Home plan-first toggle + `buildCreateTaskParams.planFirst`.
- ContextMeter mounted with `task.contextUsage` / `task.compact`.
- Mid-run queue Send now → `task.interject` (degrades).
- Undo this turn → `task.rewindPoints` / `task.rewind`.

Tests: gateway 676, desktop 1163; `cli-port-ui-wiring` structural suite.

## QA-gap fix (second follow-up)

Post-wave review found four gaps; all closed:

- Package-local vitest configs for `agent-runtime` and `provider-echo` — the root scripts-only config was shadowing them, so their real suites silently never ran. `pnpm -r test` now exits 0 across all 12 packages.
- `mermaid-block.test.tsx` — hostile-SVG tests prove `<script>`, `on*` handlers, and `foreignObject` are stripped; sanitize logic extracted to exported `sanitizeMermaidSvg()`.
- `FORBID_TAGS: ["foreignObject"]` added to the mermaid DOMPurify config (defense-in-depth; the SVG profile already strips it).
- `citation-cards.test.tsx` plus projector cases for `turn.plan` attachment, plan-review approval flip, and `turn.citations` population.

Tests: desktop 1176, agent-runtime 4, provider-echo 3. New devDependency: `jsdom` (desktop, test-only — happy-dom was rejected because it let `onclick`/`foreignObject` survive DOMPurify, making security assertions meaningless).
