# Phase 4 exit gates (2026-08-28)

Post-skeptic rebuild (ACP media window, live PNG, `waiting_approval` resume). Host: Node 22.23.2, darwin arm64, `grok 1.0.5`. Pass 1 ran full `pnpm test` (includes live ACP fixture) then `e2e:chat` (rebuild). Pass 2 reused that `out/` tree.

## Pass 1 and pass 2 (same observables)

| Gate | Pass 1 | Pass 2 |
|---|---|---|
| `pnpm typecheck` | 0 | 0 |
| `pnpm test` | 0 (desktop **1913**, gateway **919**, live-cli PNG) | — (live-cli already spent credits on pass 1) |
| `pnpm --filter @grokdesk/desktop release-qa` | 0 (78 tests) | 0 (78 tests) |
| `pnpm --filter @grokdesk/desktop bundle-budget` | 0 — JS **2,102,309** (`index-C2CHC-HD.js`) | 0 — same bytes |
| `e2e:chat` | **17 passed** ×2, then **18 passed** after `/video` journey | same 17-pass dual-gate; video added later |

Logs: implementer scratch `gates/pass-1/` and `gates/pass-2/`. Live PNG: `docs/evidence/phase4-exit/live-cli-ok.txt`.

## Unsigned installers (prepare, not GitHub-publish)

`electron-builder --mac --arm64` with `identity=null`, notarize off. Output under `apps/desktop/release/` (gitignored):

- `Grok Desk-1.0.0-arm64.dmg` (170 MB)
- `Grok Desk-1.0.0-arm64-mac.zip` (168 MB)

Checksums: `docs/evidence/phase4-exit/SHA256SUMS.txt`. Windows x64 and mac Intel were not produced on this arm64 host (owner CI / `dist:win`). Signing/notarization remain O-001.

After pack, `better-sqlite3` was restored to Node ABI 127 (`prebuild-install --runtime node --target 22.23.2`) so gateway tests run again.

## Live CLI ACP + flagship journeys

`grok 1.0.5` on PATH. Isolated `GROK_HOME` (user hooks not copied), Desk MCP/skills on `session/new`, ContentBlock `session/prompt`. Permission replies use ACP `{ outcome: { outcome: "selected", optionId } }`. Successful prompt without workspace media **fails**. Pass-1 `pnpm test` re-ran the fixture: `workspacePng=true` (`live-cli-ok.txt`).

DoD #4: `apps/desktop/e2e/flagship-journeys.spec.ts` — seven fake-provider journeys (model, inbox, deep-research, image, **video**, search, 429). `e2e:chat` **18 passed** after the video journey.
