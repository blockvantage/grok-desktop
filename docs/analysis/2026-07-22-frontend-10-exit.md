# Frontend 10/10 polish — exit notes

Date: 2026-07-22  
Branch: `ux/review-improvements`  
Plan: `docs/superpowers/plans/2026-07-22-frontend-10-polish.md`  
Goal plan: harness acceptance criteria (tokens, Artifacts empty, first-run CTA, VT, tests)

## Shipped

| Area | Change |
| --- | --- |
| Tokens | `--hairline-quiet` / `--hairline` / `--hairline-strong`; Tailwind `border-hairline*` |
| Type | `3xl`/`4xl` display steps; onboarding migrated off arbitrary rem sizes |
| Chrome | Sidebar `w-64` / `w-16`; topbar `h-14` |
| Artifacts | Type rail + search only when `artifacts.length > 0` |
| Settings | Preferences single-column `max-w-2xl`; Account primary Sign-in + secondary row |
| First-run | Sidebar Sign-in demoted to `outline` |
| Motion | Opaque `.vt-content`; 160ms opacity-only content VT; busy-gate in `withViewTransition` |
| Guards | `design-tokens.test.ts`, `view-transition.test.ts`; extended `ui-structure.test.ts` |
| Docs | `DESIGN.md` page shells + hairlines + type scale |

## Verification

- `vitest` design-tokens + view-transition + ui-structure: pass  
- `tsc -p tsconfig.web.json --noEmit`: pass  
- Product grep: zero raw palette utilities; zero `text-[Npx|rem]` in non-test renderer sources  

## Residual (non-blocking)

- Not every product `border-white/[…]` fill was migrated (fills/tints); borders on primitives and hairline ladder are the contract.  
- Locale parity for experimental-engine English copy may lag until i18n pass.  
- Live Electron screenshot pass optional when harness has no display; structural tests gate the ship.  
