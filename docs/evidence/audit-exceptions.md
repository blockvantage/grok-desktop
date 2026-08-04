# Production dependency audit exceptions

**Last reviewed:** 2026-07-14  
**Command:** `pnpm audit --prod`

## Active exceptions

| Advisory | Package | Severity | Path | Exploitability note | Expires | Owner |
|---|---|---|---|---|---|---|
| GHSA related to postcss | `postcss` &lt; 8.5.10 | moderate | apps/mobile → Expo toolchain | Transitive via Expo/Metro; not in desktop main process. Mobile bundler-only. | 2026-10-14 | desk-platform |
| GHSA-w5hq-g745-h8pq | `uuid` &lt; 11.1.1 | moderate | apps/mobile → expo → xcode → uuid@7 | Buffer bounds check in v3/v5/v6 when `buf` provided; Expo CLI path, not shipped desktop secret path. | 2026-10-14 | desk-platform |

## Process

1. Re-run `pnpm audit --prod` on each release candidate.
2. Prefer upgrading Expo when a compatible release removes the advisories.
3. Do not silence advisories in desktop/main or gateway production graphs without a new review.
4. Exception expiry forces re-review; extend only with written exploitability analysis.

## Not claimed

Clean `pnpm audit --prod` is **not** claimed until these exceptions are resolved or renewed with evidence.
