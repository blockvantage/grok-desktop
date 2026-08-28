# Phase 4.3 — owner-gated release steps

These do **not** block the in-repo program. They need secrets, Apple/Microsoft signing identities, or the landing repo.

| ID | Work | Status in this repo |
| --- | --- | --- |
| readme-v1 7–8 | History rewrite, git tag, GitHub release, installers + `SHA256SUMS.txt` | **Prepared 2026-08-28:** unsigned mac arm64 DMG+zip in `apps/desktop/release/` (gitignored); checksums in `docs/evidence/phase4-exit/SHA256SUMS.txt`. Tag + GitHub upload still owner. |
| O-001 | macOS notarization + Windows Authenticode | Owner. Release notes must state the signing status of each artifact. |
| O-005–007 site | Re-deploy grokdesk.app from `docs/honesty/site-copy.md` | Copy is paste-ready here. Landing repo is outside this workspace. |
| Crash telemetry | Opt-in product telemetry | None exists; do not invent a pipeline for v1. |

Engineering that *is* in this repo for 4.3: lazy-split Home/Workspace (I21), `nav-transition.ts` as the nav/route module plus task-selection helpers, bundle-budget script (advisory pass when `out/` is missing; JS target 2.2 MB, regression ceiling 2.7 MB).
