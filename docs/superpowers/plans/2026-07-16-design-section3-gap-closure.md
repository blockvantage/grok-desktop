# Design §3 gap closure evidence

**Date:** 2026-07-17  
**Design:** `docs/superpowers/specs/2026-07-16-commerce-entitlements-runtime-updates-design.md` §3

| Audited gap | Closure | Primary evidence |
|---|---|---|
| License does not gate product behavior | Gateway `createEntitlementGuard` + entrypoint matrix + composition wiring | `packages/gateway/src/services/entitlement-*.ts`, entrypoint tests |
| Client-side HMAC activation with baked secret | GD3 + server activation/lease only; product-key verify rejects GD1/GD2 for local activation | `packages/license/src/product-key.ts`, activation flow |
| Online path extends grace locally | Network failure never extends lease `exp` | `refresh-loop.test.ts` |
| License + full key in SQLite | OS vault (keytar); legacy purge journal | `os-credential-vault.ts`, `legacy-migration.ts` |
| Device identity from hostname/user | Random UUID + Ed25519 | `device-identity.ts` |
| Missing Grok only shows install instructions | Managed runtime install path | `runtime-manager.ts`, production adapters |
| Missing Grok selects FakeEngine | Production requires managed binary; FakeEngine removed | `engine-testkit`, composition boundary tests; `rg FakeEngine` CLEAN |
| Installing Grok does not rebuild engine | `rebuildGateway` after switch | `createRebuildGatewayHandler` in update bootstrap |
| Update metadata only local disk | Signed remote manifest client | `manifest-client.ts` |
| Placeholder release manifest | Signed envelope + vectors | contracts + verifier |
| String inequality versions | SemVer resolver | `compatibility-resolver.ts` |
| Architecture download helper unused | Update adapters + protected downloads | production adapters, portal downloads |
| Opens web page for updates | Download/stage/install/rollback coordinator | update-coordinator, desk-updater |
| Packaging only ARM64+Win x64 example | CI matrix + win32-arm64 holdback assert | `release-desktop.yml`, `assert-release-targets.ts` |
| License entry plain text / bad UX | Activation screen password+Enter+Reveal | `license-activation-screen.tsx` |
| Permanent Mac/Windows URLs | Grants + remove DOWNLOAD_URL from customer env | commerce portal downloads |
| Stripe metadata only fulfillment | PostgreSQL entitlement API | stripe-fulfillment, migrations |
| Keys not recoverable | Portal magic-link + reconstruct | portal recovery, product-key issue |
| GD2 legacy | Server allowlist exchange + desktop journaled purge; **sunset 2026-12-31** | `legacy-gd2-exchange.ts`, `legacy-migration.ts`, runbook |

## Explicitly expiring migration path

- GD2 exchange closes at `LEGACY_GD2_EXCHANGE_SUNSET` default `2026-12-31T00:00:00.000Z`
- After sunset: purge + support only; no new exchange (`legacy_exchange_closed`)
