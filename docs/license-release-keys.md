# Grok Desk license keys (GD2 release flow) — RETIRED

**Status:** Retired (2026-07-31). Grok Desk is free; product-key issuance, GD2/GD3
activation, and baking `GROKDESK_LICENSE_PUBLIC_KEY` for Desk product-license
verification are **not** part of the free desktop app path.

## Free app

- Desktop starts and runs without a Desk product key.
- Gateway does not fail-closed on missing Desk entitlement/lease state.
- Do not re-enable product-key walls for free public builds.

## Historical notes only

Older release tooling (`scripts/license-keygen.mjs`, `@grokdesk/license` product-key
modules) may remain in the monorepo for crypto tests or non-Desk uses. They must
not reintroduce paid Desk gates in the desktop app.

Release-manifest public keys (`GROKDESK_RELEASE_PUBLIC_KEYS`) used for **app/runtime
update verification** are separate from retired product licensing and may still be
baked at build time when update signing is configured.

## SuperGrok

Account sign-in and SuperGrok usage remain required for model access; that is
xAI account auth, not a Desk product license.
