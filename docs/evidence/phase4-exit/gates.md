# Phase 4 exit gates (2026-08-28)

Rebuilt after 4.3 (`pnpm --filter @grokdesk/desktop build`), then ran the program gates **twice** against that `out/` tree (Playwright used the existing `out/main`, not a second `e2e:chat` rebuild). Host: Node 22.23.2, darwin arm64, `grok 1.0.5`.

## Pass 1 and pass 2 (same observables)

| Gate | Pass 1 | Pass 2 |
|---|---|---|
| `pnpm typecheck` | 0 | 0 |
| `pnpm test` | 0 (desktop 1913 tests) | 0 (desktop 1913 tests) |
| `pnpm --filter @grokdesk/desktop release-qa` | 0 (78 tests) | 0 |
| `pnpm --filter @grokdesk/desktop bundle-budget` | 0 — JS **2,102,309** ≤ 2.2 MB target | 0 — same bytes |
| chat e2e (delivery/recovery/approvals/experience) | **11 passed** | **11 passed** |

Logs: implementer scratch `gates/pass-1/` and `gates/pass-2/`. Bundle entry `assets/index-D_f-IL5P.js`.

## Unsigned installers (prepare, not GitHub-publish)

`electron-builder --mac --arm64` with `identity=null`, notarize off. Output under `apps/desktop/release/` (gitignored):

- `Grok Desk-1.0.0-arm64.dmg` (170 MB)
- `Grok Desk-1.0.0-arm64-mac.zip` (168 MB)

Checksums: `docs/evidence/phase4-exit/SHA256SUMS.txt`. Windows x64 and mac Intel were not produced on this arm64 host (owner CI / `dist:win`). Signing/notarization remain O-001.

After pack, `better-sqlite3` was restored to Node ABI 127 (`prebuild-install --runtime node --target 22.23.2`) so gateway tests run again.
