# Node version for local development

Grok Desk desktop ships with **Electron 33**, which bundles a Node 20 ABI
(MODULE_VERSION 115). `better-sqlite3` in `packages/gateway` is therefore
built for Node **20.x**.

## Pin

- Root `.nvmrc` → `20`
- `package.json` `engines.node` → `20.x` (Volta pin optional)
- If you run gateway tests under a different Node (e.g. 24),
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
