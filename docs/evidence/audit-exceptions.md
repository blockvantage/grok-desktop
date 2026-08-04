# Production dependency audit exceptions

**Last reviewed:** 2026-08-04
**Command:** `pnpm audit --prod` (also full `pnpm audit`)

## Active exceptions

None. Both `pnpm audit --prod` and full `pnpm audit` report **no known vulnerabilities** after the 2026-08-04 toolchain upgrade (Electron 43.x, Vite 6.4.x, Vitest 3.2.x, electron-builder 26.15.x, and related overrides).

Historical mobile Expo exceptions (postcss/uuid) from 2026-07-14 are **cleared** by the current lockfile/overrides; re-open rows here only if a future audit reintroduces them.

## Process

1. Re-run `pnpm audit --prod` and full `pnpm audit` on each release candidate.
2. Prefer direct version bumps; use `pnpm.overrides` only for deep transitives parents have not patched.
3. Do not silence advisories in desktop/main or gateway production graphs without a new review.
4. Exception expiry forces re-review; extend only with written exploitability analysis.

## Residual full-audit policy

If a future full audit cannot reach zero without an unshipped upstream fix, record package path, severity, exploitability, owner, and expiry in the table above before claiming release readiness.
