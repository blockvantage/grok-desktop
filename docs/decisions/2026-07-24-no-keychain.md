# Decision: Never use OS Keychain / keytar for Grok Desk secrets

**Date:** 2026-07-24
**Status:** Accepted (do not reverse without explicit product ownership)
**Scope:** Desktop app secret vault and any future secret storage

**Note (2026-07-31):** Desk **product licensing / product keys are retired** — the desktop app is free. This decision still applies to any remaining secret material (device identity leftovers, future secrets): never store them in OS Keychain / keytar / Electron `safeStorage`. Historical vault modules may remain in-tree for migration/safety; they must not reintroduce paid Desk gates.

## Decision

Grok Desk stores sensitive local material in an **AES-256-GCM file vault under Electron `userData`** (`createSafeStorageCredentialVault`), with a local app-owned key file (`credential-vault/.key`, mode `0o600`), when a vault is used.

We **do not** use:

- macOS Keychain  
- Windows Credential Manager  
- `@github/keytar` / `keytar`  
- Electron `safeStorage` (still Keychain-backed on macOS)

## Why

1. **Rebuild/signature churn** — keytar items bind to code signature. Unsigned or re-signed local builds prompt “Grok Desk wants to use your keychain” repeatedly. That is overkill and trust-eroding for this product.
2. **Simpler ops** — app data folder is predictable for support, wipe, and migration.
3. **Already shipped** — production path used the file vault only (never keytar).

## Rules for implementers / agents

- **Never** re-add `@github/keytar` or `keytar` as a dependency.
- **Never** call Keychain/Credential Manager APIs for product or device secrets.
- When a vault is needed, use `createSafeStorageCredentialVault` (not keychain).
- Unit tests may use `createMemoryCredentialVault` only (not production).
- Marketing copy must not claim “secrets live in the OS keychain.”
- Do **not** reintroduce Grok Desk product-key / paid entitlement gates.

## Where secrets live (user-facing truth)

Any vaulted material lives in an encrypted file under Grok Desk’s application data directory on disk — not in the macOS Keychain or Windows Credential Manager. SuperGrok account auth is separate and remains required for model access.
