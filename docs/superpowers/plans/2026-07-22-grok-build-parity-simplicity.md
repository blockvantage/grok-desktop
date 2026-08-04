# Grok Build Parity + Simplicity — Implementation Plan

> **For agentic workers:** Prefer `superpowers:subagent-driven-development` or `superpowers:executing-plans` when executing a wave. This document is the **program plan** (waves + outcomes). Later wave execution plans may add TDD step-level tasks; do not treat frozen file paths here as acceptance criteria.

**Design:** `docs/superpowers/specs/2026-07-22-grok-build-parity-simplicity-design.md`  
**Goal:** Get Desk as close as practical to Grok Build capabilities while keeping the default experience simple for non-power users — not a 100% CLI clone, not a second TUI.  
**Baseline:** Sticky + Magic CLI port landed (ACP-default when probed, resume, power gate, plan-first, interject, compact/meter, rewind, media artifacts, citations, mermaid, effort mapping, isolated profile, bundled skills, connector presets). **Do not re-implement those as greenfield.** Honesty gaps remain: sandbox not passed, coarse permission compile, inherit profile env-only, weekly recap deferred, no real subagent/goal-progress HUD, no hunk review.  
**Current-app improvements:** Design §7 — polish the shell we already ship (conversation truth, readiness, budgets, god-files, golden E2E, surface depth). Wave **I** is first-class, not optional tidy-up.

**Architecture (stable, non-prescriptive):**  
Desk continues to run Grok via engine adapter + optional ACP provider; gateway owns tasks, approvals, scheduler, memory, and IPC; renderer owns coworker language and dual-path UI. Waves **Surface/Bridge** CLI behavior first; **Reimplement** only where Desk already owns the domain (scheduler, memory store) or CLI is blind (headless).

**Tech stack:** TypeScript monorepo, vitest, Electron desktop, gateway, engine-grok, provider-grok, shared contracts. Live CLI `grok` 0.2.x; capability probes over hard-coded method lists.

---

## Wave order and hard prerequisites

```text
  [Baseline sticky/magic + landed polish rounds]
           │
           ▼
     Wave I  Current-app improvements (truth, readiness, health)
           │  parallel with early T where independent
           ▼
     Wave T  Trust honesty
           │  (required before autopilot claims / scheduled heavy use)
           ▼
     Wave C  Coworker stickiness  ──┐
           │                        │ parallel after T1–T3 minimum
           ▼                        │
     Wave E  Ecosystem (curated) ───┘  (requires T4/T5 for trust gates)
           │
           ▼
     Wave X  CLI headliners (advanced-only)
           │
           ▼
     Wave A  Own-the-loop (OPTIONAL / DEFERRED program)
```

| Gate | Rule |
|------|------|
| G0 | No new UI control that only works on headless-degraded without a hidden/disabled state |
| G1 | Wave T1–T3 before any copy that claims OS sandbox or “fully safe autopilot” |
| G2 | Wave E marketplace/skills project roots require T4 (inherit) and T5 (folder trust) semantics decided |
| G3 | Wave C helper HUD must use real events only (no invented agents) |
| G4 | Wave X never changes Home defaults (cost / surprise) |
| G5 | Wave A (pure API) is not committed work in this program |
| G6 | Wave E marketplace / X cost features only after I11 readiness + I23 golden path exist |
| G7 | Wave I must not rebuild landed polish (slash send-time expand, media posters, i18n LANG-*, queue undo) — only residual gaps |

---

## Wave I — Current-app improvements (design §7)

**Outcomes:** Desk already feels like a product; make the **existing** surfaces truthful, reliable, and maintainable so new Grok Build capability has a shell worth landing on. Prefer copy/projector/extraction over net-new features.

### Scope (design IDs)

| Priority | IDs | Outcomes |
|----------|-----|----------|
| **I-P0** | I1, I2, I3, I4, I6, I7, I11 | Conversation noun; one status hierarchy; effective protection; clear approvals; degraded-mode honesty; run budgets; single readiness checklist when blocked |
| **I-P1** | I5, I8–I10, I40–I45 | Worker event fidelity (feeds C4); human recovery copy; usage soft warn; proactivity quality; search/export/tray/a11y residuals |
| **I-P2** | I20–I24 | God-file extraction, main-chunk split, gateway composition cleanup, golden E2E, CLI version pin |
| **I-P2 surfaces** | §7.4 | Depth on Memory / Scheduled / Artifacts / Browser / Desktop / Remote / Settings without new nav |
| **Security residual** | I30–I33 | Align with Wave T; keep vault/CSP/sandbox gains |

### Prerequisites

- Do **not** re-open DONE polish from `EXPERIENCE_IMPROVEMENTS.md` / UX review unless dogfood proves regression (Gate G7).
- I3/I30 share ownership with Wave T (same honesty problem).
- I5 shares ownership with Wave C4 (helpers HUD).

### Implementation notes

- **I1:** Projector + copy pass first (`chat` / `conversation` in user strings); keep `parentTaskId` as storage for turns; never re-enable parentTaskId→subagent inference (`subagent-hud.ts` already returns false).
- **I2:** Extend notice-slot severity ranking so entitlement/runtime/gateway/auth/update cannot all shout at once.
- **I7:** Engine/gateway enforce wall + idle budgets; terminal event reason codes mapped to human strings.
- **I11:** When create/run fails readiness, one sheet: License · Runtime · Sign-in · Workspace — not four banners.
- **I20–I22:** Extract only with characterization tests; no drive-by refactors inside port PRs.
- **I23:** Playwright golden path against mock or local gateway fixture — not flaky live SuperGrok as the only gate.
- **Surfaces:** one vertical slice per PR (e.g. Memory semantic search only); avoid “redesign Settings” PRs.

### Success signals

- Default user can answer “what is this chat / why am I blocked / what needs me” from one glance.
- God-file top-5 line counts trend down each milestone without feature loss.
- Golden E2E green on CI; no false “Sign in again” on fresh profile.
- Degraded headless sessions labeled once; budgets stop runaway CLI spend.

### Stretch / cut

| Item | Cut rule |
|------|----------|
| Full Memory knowledge-base UI | Semantic search + pin/forget only |
| Browser multi-tab | Capability routing honesty only |
| Bundle ≤1.8 MB | Aim; do not block T on perfect score |
| I40–I45 | Ship opportunistically after I-P0 |

### Risks

- “Improvement” PRs that restyle without fixing truth models — reject in review.
- Extraction PRs mixed with feature work — split for bisectability.

---

## Wave T — Trust honesty

**Outcomes:** What the UI promises matches what the CLI enforces; default users get Safe workspace without jargon; power users can opt into personal Grok plugins deliberately.

### Scope (design IDs)

| ID | Outcome | Default / Advanced |
|----|---------|-------------------|
| T1 | Pass sandbox profile when probe + OS support | **Safe workspace** default when available → CLI `strict` or `workspace` (pick one default after probe matrix; prefer `workspace` for daily coding, `read-only` when Desk mode is Careful/strict research) |
| T2 | Compile approval modes to real CLI modes/rules | Careful / Balanced / Autopilot; Advanced: Accept edits, Auto-approve safe |
| T3 | Effective protection chip | Always visible when running/resumable |
| T4 | Inherit user Grok profile | Settings toggle off by default + risk dialog |
| T5 | Folder trust soft gate | First-use prompt; list in Settings |

### Prerequisites

- CLI probe already reports `supportsSandbox` (`discover`).
- Existing approval modes in Desk policy snapshot.
- Conformance tests **required** for T1 before flipping default on in production builds (can ship behind “enable when tests green” flag in dogfood first).

### Implementation notes (guidance, not file contracts)

- Extend policy→CLI mapping to emit `--sandbox <profile>` only when probe says supported; otherwise omit and chip shows “Sandbox unavailable.”
- Map Desk modes roughly: Autopilot → `bypassPermissions` + always-approve (existing); Balanced → `default`; Careful → deny side-effects on headless + ACP ask; Advanced Accept edits → `acceptEdits`; Advanced Auto → `auto` when CLI advertises it.
- Prefer documented `--allow`/`--deny` / `--disallowed-tools` tool ids already used; expand coverage with tests against live `grok --help` / docs, not invent tokens.
- Protection chip reads the **same** snapshot used to spawn the run (single source of truth).
- Inherit toggle sets explicit run option / settings key replacing silent env-only `GROKDESK_INHERIT_USER_GROK` for product path (env may remain override for debugging).

### Success signals

- Zero dogfood reports of “UI said Safe workspace but process had no sandbox.”
- `policyToGrokArgs` (or successor) includes `--sandbox` in unit tests when probe mock supports it; omits when not.
- Autopilot copy never claims more than chip shows.
- Inherit toggle requires explicit confirmation; default remains isolated.

### Stretch / cut

| Item | Cut rule |
|------|----------|
| T5 full trusted-folders.toml parity | Soft first-folder prompt only if list UI slips |
| Custom sandbox.toml editor | Always cut from T |
| Remembered grant UI browser | Cut; rely on CLI remembered grants unless product pain |

### Risks

- Sandbox profiles differ macOS vs Linux (child network). Chip must not claim “network blocked” on macOS if CLI no-ops.
- `executesOwnTools` remains true — document partial mediation; do not claim gateway audit of every effect after T.

---

## Wave C — Coworker stickiness

**Outcomes:** Long-running coworker tasks feel alive and controllable: progress, helpers, reviewable edits, optional watch, weekly learning — without new top-level products.

### Scope

| ID | Outcome | Default / Advanced |
|----|---------|-------------------|
| C1 | Goal progress binding | **Working toward…** automatic from events / task goal |
| C2 | Hunk / review changes | **Review changes** after edit tools |
| C3 | Fork | **Try another approach** overflow |
| C4 | Real subagent / helpers HUD | Compact row only with real events |
| C5 | Worktree isolation | **Work in a safe copy** off by default |
| C6 | Monitor → watch until | Suggestion + in-task strip |
| C7 | Loop → Desk schedule bridge | Confirm card → existing Schedules |
| C8 | Background process strip | Auto when events present |
| C9 | Weekly recap | Opt-in inbox item (was sticky stretch) |

### Prerequisites

- **ACP path healthy** for C1 (rich), C2, C4, C6, C8.
- Wave **T1–T3** complete before promoting Autopilot + Watch for unattended use.
- C9 reuses Desk memory + scheduler + inbox (takeaways foundation may exist).

### Implementation notes

- Prefer ACP `session/update` tool/subagent events and extension methods discovered at `initialize` (do not hard-code a frozen method list as permanent contract).
- C2: start with file list + accept/reject or “keep / undo file” if full hunk tracker events are thin; escalate to hunk-level only if CLI exposes clean events.
- C3: fork creates a new Desk task/conversation linked to parent; engine `--fork-session` or ACP equivalent when available.
- C4: if no subagent events, show nothing (or single “Working”) — **never** fabricate N agents.
- C6/C7: parse user intent lightly or offer chip when tools request monitors; durable recurrence always lands in Desk scheduler.
- C9: scheduled job builds inbox recap from Desk memory/takeaways; accept/edit/dismiss per bullet; respect quiet hours.

### Success signals

- Helper row appears only when agent actually spawns helpers (instrumented dogfood).
- Review-changes usage > full undo on edit-heavy tasks.
- Watch-until tasks complete without user opening external terminal for the same check.
- Weekly recap: accept rate measured; opt-out easy; no daily spam complaints.

### Stretch / cut

| Item | Cut rule |
|------|----------|
| C5 worktree | Cut if git edge cases dominate; keep fork only |
| C6 persistent monitors | Ship one-shot “watch until condition” first |
| C8 kill controls | Read-only strip first if kill RPC flaky |
| C9 | Cuttable again if memory quality poor — same as sticky C4 |

### Risks

- Rewind + hunks + user uncommitted work — always confirm file lists.
- Dual scheduler confusion — success criterion is **one** Schedules UI of record.

---

## Wave E — Ecosystem (curated)

**Outcomes:** Skills and project rules work without configuration for normal repos; extensions are a small trusted catalog; power users can go deeper without forcing everyone through marketplace chrome.

### Scope

| ID | Outcome |
|----|---------|
| E1 | Multi-root skill discovery (trusted folder) |
| E2 | Teach Desk this workflow wizard |
| E3 | Extensions recommended set + trust-gated marketplace |
| E4 | AGENTS.md / project rules chip |
| E5 | Import Claude / Cursor onboarding optional step |
| E6 | MCP doctor on connector failure |

### Prerequisites

- **T4** semantics for what is loaded from user home.
- **T5** before enabling project-local hooks/MCP/skills automatically.
- Wave T complete preferred; E1/E4 silent paths can start after T5 minimum.

### Implementation notes

- Discovery roots align with Grok Build docs: bundled Desk skills, user settings paths, then project `.grok` / `.agents` / `.claude` / `.cursor` when trusted.
- E3: ship **recommended** packs first (role packs as curated plugins); full marketplace browse is advanced and behind trust.
- E2: short form (name, when to use, steps) → write SKILL.md under Desk-managed skills path.
- E5: one-shot file/dir import; no continuous bi-directional sync UI.
- E6: reuse connector presets; add health check action and human-readable failure.

### Success signals

- New repo with AGENTS.md: chip shows without settings visit.
- ≥1 recommended extension install path works end-to-end in dogfood.
- Import path reduces empty-skills setups for Claude/Cursor migrants.

### Stretch / cut

| Item | Cut rule |
|------|----------|
| Full marketplace browse | Recommended-only if trust review bandwidth low |
| E2 rich skill editor | Single wizard page only |
| Continuous Claude sync | Never in E |

### Risks

- Marketplace supply-chain — trust gate mandatory; no silent network install.
- Skill auto-invocation noise — prefer listing + model choice over forced always-on.

---

## Wave X — CLI headliners (advanced-only)

**Outcomes:** Power features available without polluting Home: best-of-N, self-check, restore-code, accept-edits (if not finished in T2), honest model catalog refresh.

### Scope

| ID | Outcome |
|----|---------|
| X1 | Try N approaches (2–3) with cost warning |
| X2 | Double-check when done |
| X3 | Restore code on resume (confirm) |
| X4 | Accept edits mode (if not in T2) |
| X5 | Live model catalog hardening |

### Prerequisites

- Wave T permission/sandbox honesty (especially before multi-run Autopilot).
- Probe flags for `--best-of-n`, `--check`, `--restore-code`.

### Implementation notes

- X1/X2 only on task overflow or Advanced task options — **never** Home default.
- X3 confirm lists git impact; refuse dirty tree if unsafe.
- X5: keep offline fallback list; prefer live when authed.

### Success signals

- Zero accidental multi-run cost incidents from default UI.
- Power users can discover features via overflow without support docs.

### Stretch / cut

| Item | Cut rule |
|------|----------|
| best-of-N > 3 | Cap at 3 |
| restore-code | Cut if git restore too dangerous without better UX |

---

## Wave A — Own-the-loop (OPTIONAL / not committed)

**Status:** Deferred long-term option only (design §5.5).

| When to open | What it is | Exit criteria to start |
|--------------|------------|------------------------|
| After T+C and ACP still cannot mediate policy for product claims | Desk-owned sampler + gateway tool runtime (`executesOwnTools = false`) | Explicit product decision; not part of default execute-plan for this program |

Do **not** schedule pure-API as a parallel track that starves Trust/Coworker.

---

## Cross-wave quality bar

1. **Default-user path:** product language only; no flag names.
2. **Advanced path:** Settings / overflow / diagnostics.
3. **Tests:** unit tests on real policy mapping and event projection; structural UI tests for new chips/strips; no test theater.
4. **Probes:** feature presence from CLI help / ACP initialize; degrade hide.
5. **i18n:** all new user-visible strings in locales.
6. **Honesty:** if unsupported, chip says so — never silent lie.

---

## Mapping: design inventory → waves

| Wave | Include IDs |
|------|-------------|
| Baseline (done) | Plan-first, interject, compact/meter, rewind, media, citations, mermaid, ACP default, resume, power, effort, isolated profile, skills bundle, connectors + polish rounds (slash/media/i18n/queue) |
| I | I1–I11, I20–I24, I30–I33, I40–I45, surface depth §7.4 |
| T | T1–T5 |
| C | C1–C9 |
| E | E1–E6 |
| X | X1–X5 |
| A | Deferred pure-API only |
| Defer list | See design §5.5 |
| Never | See design §5.6 + §7.8 |

---

## Suggested execution program (high-level checklist)

Later implementers break these into TDD tasks per wave. Order within a wave is recommended, not sacred, except where noted.

### Wave I (current app — start here or parallel early T)
- [x] I11: Single readiness checklist when blocked (license / runtime / sign-in / workspace)
- [x] I2: Severity-ranked notice stack owns all blocking reasons
- [x] I1: Conversation-as-noun copy + projector consistency (no storage rewrite required)
- [x] I4: Approval card always shows what / where / why
- [x] I6: Headless degraded labeled once; resume failure humanized
- [x] I7: Wall-clock + idle run budgets + terminal reason codes
- [x] I3: Effective protection chip (shared with T3)
- [x] I23: Golden-path structural+unit (create → approve → export entry points; Playwright deferred)
- [x] I20: Extract slices from task-workspace / App / runner (characterization tests)
- [ ] I21: Further lazy split Home vs Workspace vs stream (bundle trend down)
- [x] I10: Waiting-on-you inbox quality (dedupe + deep link)
- [ ] I-surface: one Memory or Scheduled depth slice (optional after I-P0)

### Wave T
- [x] T1a: Sandbox probe → args mapping + unit tests (omit when unsupported)
- [x] T1b: Desk protection presets → profile mapping + dogfood default choice
- [x] T1c: Conformance / integration proof before default-on
- [x] T2: Permission mode compile (incl. acceptEdits/auto advanced) + fail-closed tests
- [x] T3: Effective protection chip (single snapshot source)
- [x] T4: Inherit profile Settings toggle + risk copy (replace env-only product path)
- [x] T5: Folder trust soft prompt + settings list (minimal)

### Wave C
- [x] C1: Goal progress events → Working toward… chrome
- [x] C4: Real helpers HUD (events only) — completes I5
- [x] C2: Review changes (file-level first)
- [ ] C3: Try another approach (fork)
- [ ] C5: Work in a safe copy (optional; cuttable)
- [ ] C8: Running process strip
- [ ] C6: Watch until… (monitor bridge)
- [ ] C7: Conversational loop → Desk schedule confirm
- [ ] C9: Weekly recap inbox (stretch)

### Wave E
- [ ] E1: Multi-root skill discovery under trust
- [ ] E4: Project rules chip
- [ ] E6: MCP doctor
- [ ] E2: Teach workflow wizard
- [ ] E5: Import Claude/Cursor
- [ ] E3: Recommended extensions + trust gate (marketplace browse stretch)

### Wave X
- [ ] X5: Model catalog hardening (if gaps remain)
- [ ] X4: Accept edits (if not done in T2)
- [ ] X2: Double-check when done
- [ ] X1: Try N approaches
- [ ] X3: Restore code on resume (cuttable)

### Wave A
- [ ] Not scheduled — explicit decision gate only

---

## Success signals (program-level)

| Horizon | Signal |
|---------|--------|
| After I | One-glance status; readiness checklist; budgets stop runaways; golden E2E green; god-files shrinking |
| After T | Protection chip matches spawn; sandbox present when claimed; no false autopilot safety |
| After C | Users stay in Desk for watch/review/helpers; weekly recap optional delight |
| After E | Fresh repos “just work” with rules/skills; extensions from recommended set |
| After X | Power features discoverable; zero default-path cost bombs |
| Moat | Grok Build users recognize capability; non-power users never need CLI docs |

---

## Risks / contradictions (program)

| Risk | Mitigation |
|------|------------|
| Capability greed expands Home chrome | Dual-path rules; any new top-level nav needs explicit design exception |
| CLI protocol churn | Probes + graceful degrade; contract tests against pinned CLI in CI when available |
| Trust work blocks all UX | Ship T1–T3 as first vertical; C can parallelize non-unattended pieces after T1–T3 |
| `executesOwnTools` honesty | Never claim full gateway mediation in release notes until Wave A or proven ACP mediation |
| Overlap with sticky wave docs | This plan **supersedes** sticky deferred list for goal/subagent/fork/recap/sandbox; does not re-open mermaid/citations/plan-first as greenfield |
| Port greed starves current-app truth | Wave I is mandatory sequencing; E/X gated on I11 + I23 |

---

## References

- Design: `docs/superpowers/specs/2026-07-22-grok-build-parity-simplicity-design.md` (incl. §7 current-app improvements)
- Catalog: `to_add.md`
- Sticky design/plan/QA: `docs/superpowers/specs/2026-07-15-cli-feature-port-design.md`, `docs/superpowers/plans/2026-07-16-cli-feature-port-wave.md`, `docs/analysis/2026-07-16-cli-port-wave-qa.md`
- Product experience audit: `docs/analysis/2026-07-15-product-experience-audit.md`
- Landed polish: `apps/desktop/IMPROVEMENTS.md`, `EXPERIENCE_IMPROVEMENTS.md`, `docs/plans/ux-review-improvements.md`
- Honesty: `codex_improve.md`
- Policy/engine: `packages/shared/src/policy-to-grok-flags.ts`, `packages/engine-grok/src/session.ts`, `packages/engine-grok/src/discover.ts`, `packages/provider-grok/`

## Deviations

- T5 enforce: project skills/MCP gated via allowProjectToolSetup at engine run; C2 file-list open (not hunk accept); C1 task.goal fallback when no goal events.

- T1/T3/I7 fixed for product ACP path: buildAcpSpawnArgs + live factory probe, AgentProviderEngine protection snapshot, TaskRunner wall/idle budgets; I23 structural; T5 shipped.

- I23: structural+unit golden path this session (Playwright env not required); T5 folder-trust soft prompt + Settings list shipped.
