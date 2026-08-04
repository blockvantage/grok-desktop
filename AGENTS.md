# Agent notes — Grok Desk monorepo

## Credential storage (do not reverse)

**Never use OS Keychain, Windows Credential Manager, `@github/keytar`, `keytar`, or Electron `safeStorage` for product keys / device identity.**

Production path: `createSafeStorageCredentialVault` — AES-256-GCM file under Electron `userData` + local `.key` file.

Full decision: `docs/decisions/2026-07-24-no-keychain.md`.

Unit tests may use `createMemoryCredentialVault` only (never bootstrap).
