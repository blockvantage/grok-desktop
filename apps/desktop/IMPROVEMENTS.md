# Grok Desk Desktop — Review Findings & Fix Plan

Full frontend review, 2026-07-12. Four review passes (Tasks integration trace,
renderer bug hunt, uncommitted-changes review, UX/premium audit) plus all
verification gates. Items marked **[verified]** were confirmed line-by-line in
source, not just reported by a review pass.

**Gate status at review time:** typecheck (web+node) pass · desktop tests 249/249
pass · production build pass · shared 160 / engine 56 / license 16 pass ·
**gateway 68/101 FAIL (environment, see B6)**.

**Status after fix initiative + follow-up session (2026-07-12/13):** typecheck
pass · desktop tests **273/273** · gateway **106/106** under Node 20 · production
build pass (main renderer chunk **~2.26 MB** + markdown ~723 kB + view chunks).

Severity legend: **B** = broken, fix first · **R** = risky/latent · **P** = UX
priority · **C** = copy/i18n · **A** = accessibility · **H** = code health.

---

## 1. Broken — fix first

### B1. Stale approval from a cancelled turn resurfaces; Approve/Reject spins forever [verified] — **DONE**
### B2. Queued follow-ups silently drop their attachments [verified] — **DONE**
### B3. Queue drains before the send is confirmed; failures lose the message [verified] — **DONE**
### B4. `user-question.ts` is fully orphaned — the question-chips feature is half-shipped — **DONE**
### B5. Stray compiled `index.js` at the repo root [verified] — **DONE**
### B6. Gateway test gate is dead on this machine (Node ABI mismatch) — **DONE**

---

## 2. Risky & latent

### R1. Whole conversation flashes empty and refetches on every follow-up — **DONE**
### R2. "Is task live" status sets are inconsistent — **DONE**
### R3. Renderer bundle / node:path — **DONE** (continued)
- paths without `node:path`; markdown lazy; Settings/Onboarding/Artifacts/Memory/Scheduled lazy
- Main chunk: **~3.2 MB → ~2.52 MB → ~2.26 MB** (≤1.8 MB not fully reached; remaining mass is Home/workspace/task-stream)

### R4. Relay status chip untranslated — **DONE**
### R5. Perpetual background polling — **DONE** (superseded by F4 push + 30s safety net)
### R6. Dead code sweep — **DONE**

---

## 3. UX — ranked

### P1. Chat vocabulary — **DONE**
### P2. Notice stack — **DONE**
### P3. Humanize errors — **DONE**
### P4. Duplicate entry points — **DONE**
### P5. Onboarding safety — **DONE**
### P6. Home rail trim — **DONE**
### P7. AlertDialog for desktop control — **DONE**
### P8. Fold takeaways into What next? — **DONE** (`df96ba9`)
### P9. Settings 7 → 5 tabs — **DONE** (`916ff66`) — Language in Preferences; License+Remote in Advanced; deep-link aliases

---

## 4. Copy & i18n — **DONE** (C1–C8)

## 5. Accessibility A1–A5 — **DONE**

## 6. Performance

- **F1–F3, F5** — **DONE**
- **F4 true gateway IPC push** — **DONE** (`71dd908`)
  - `notify.tasksChanged` / `notify.taskEvents` / `notify.inboxChanged` / `notify.remoteChanged`
  - stdio → main → preload → renderer; polls demoted to 30s safety nets

## 7. Code health

- **H1** — **DONE** (partial+) — `useChatEvents` + `useWorkspaceQueue`; giant workspace file still large
- **H2** — **DONE**
- **H3–H7** — **DONE**
- **H8** — **DONE** (`c8958f3`) remote-tab toast spacing

---

## Follow-up session commits (2026-07-13)

| Phase | Commit | Summary |
|------:|--------|---------|
| 0a | `13500fa` | feat(remote): relay/gateway/shared remote land |
| 0b | `210d049` | feat(mobile): premium remote shell polish |
| 1 | `d2878ae` | fix(desktop): runtime QA papercuts |
| 2 | `71dd908` | feat(desktop): gateway IPC push (F4) |
| 3 | `df96ba9` | refactor(desktop): takeaways → What next (P8) |
| 4 | `916ff66` | feat(desktop): Settings five tabs (P9) |
| 5 | `db2e7c1` | perf(desktop): lazy views + useWorkspaceQueue (R3/H1) |
| 6 | `c8958f3` | style(desktop): remote-tab toast spacing (H8) |

### Deliberately deferred

- **Per-task token usage** (phase 6a) — engine still drops usage on done; needs engine-grok event plumbing + task row schema
- **Dock icon rewire** (6b) — already configured (`electron-builder.yml` → `build/icon.icns`); no change
- **Main chunk ≤1.8 MB** — residual Home + TaskWorkspace + TaskStream; further splits left for a dedicated bundle pass

### Bundle sizes (this session)

| Build | Main index.js | Notes |
|-------|---------------|--------|
| Pre-lazy views | ~2,522 kB | after markdown split |
| Post R3 remainder | ~2,259 kB | + settings/onboarding/artifacts/memory/scheduled chunks |

Full narrative report (review source):
https://claude.ai/code/artifact/34e8aa74-5d65-4db0-98f8-bce623d234ed
