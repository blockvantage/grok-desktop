# Node version for local development

Grok Desk desktop ships with **Electron 43**, which bundles Node 24. Packaging
rebuilds `better-sqlite3` against Electron's Node ABI. Local gateway unit tests
still run under the host Node pin below; pretest rebuilds the native module when
the host ABI differs from the last build.

## Pin

- Root `.nvmrc` → `22`
- `package.json` `engines.node` → `>=22.12.0 <23` (Volta pin optional)
- If you run gateway tests under a different Node (e.g. 22/24),
  `packages/gateway` pretest rebuilds `better-sqlite3` when the ABI mismatches.

## Commands

```bash
nvm use        # or fnm / volta
pnpm install
pnpm test      # runs every package suite (desktop + gateway + …)
```

Packaging rebuilds native modules for Electron via
`apps/desktop/scripts/rebuild-native-for-electron.mjs` at dist time — the
shipped app is independent of your local Node major.
