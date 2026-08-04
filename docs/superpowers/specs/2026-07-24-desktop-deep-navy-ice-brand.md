# Grok Desk Desktop — Deep Navy + Ice Brand Alignment

**Status:** Implementation brief (source of truth for the `implement-app-brand` workflow)  
**Target:** `apps/desktop` (Electron + React renderer) inside `grok-desktop`  
**Reference:** Landing redesign at sibling `grok-landing` (`docs/superpowers/specs/2026-07-23-deep-navy-ice-landing.md`)  
**Goal:** Make the desktop product feel like the same brand as the public site — intelligent, calm, precise, premium, desktop-native — without breaking product architecture, token discipline, or functional UI.

## Context

The marketing site now ships a **Deep Navy + Ice** system. The desktop app still ships a **warm charcoal + sand** system (`DESIGN.md`, `globals.css`). Users who buy from the landing page open a product that currently feels like a different product family.

This work **rebrands the app** to share the landing palette, semantic roles, and interaction language while remaining a **dark, dense desktop agent** (not a light marketing page).

## Non-goals

- Do not rebuild information architecture, routes, or agent runtime.
- Do not add large UI dependencies.
- Do not turn the entire app light-theme cloud/white (landing uses ~55% cloud for editorial marketing; the **app stays dark product chrome** using the deep navy stack).
- Do not claim xAI affiliation beyond SuperGrok support.
- Do not break checkout/license/onboarding flows, IPC, or tests for behavior.

## Canonical palette (hex)

Match landing exactly at the brand layer:

```css
--color-midnight: #050e21;
--color-navy:     #07142c;
--color-ink:      #0b1736;
--color-panel:    #10213f;

--color-ice:      #9fddff;
--color-electric: #4c8bff;
--color-frost:    #d7e6ff;

--color-cloud:    #f3f7fb;
--color-white:    #ffffff;
--color-slate:    #5f6d84;
--color-mist:     #8794a8;
--color-border:   #d7dee8;

--color-success:  #67d9b5;
--color-approval: #f2b96b;
--color-danger:   #f47c88;
--color-disabled: #8290a5;
```

### HSL approximations for the existing shadcn token layer

Desktop uses `hsl(var(--token))` channels. Map roles (tune for WCAG on dark surfaces):

| Role | Intent | Suggested HSL channels |
| --- | --- | --- |
| `--background` / `--surface-0` | Midnight canvas | `221 74% 7%` |
| `--sidebar` | Slightly deeper/cooler rail | `221 78% 5.5%` |
| `--card` / `--surface-1` | Navy elevated | `219 73% 10%` |
| `--surface-2` / popover-ish | Ink | `223 66% 13%` |
| `--surface-3` / panel high | Panel | `218 59% 15%` |
| `--foreground` | Frost/cloud text | `218 100% 94%` or frost-leaning off-white |
| `--muted-foreground` | Mist/slate readable secondary | ~`216 16% 64%` (verify contrast) |
| `--primary` | **Ice brand** (CTAs, key actions) | `201 100% 81%` — may darken slightly for fills if contrast fails; prefer token-level adjust |
| `--primary-foreground` | Ink on ice buttons | `221 74% 7%` |
| `--primary-hover` | Slightly brighter/cooler ice | e.g. `201 100% 86%` |
| `--ring` | Electric or ice focus | `219 100% 65%` (electric) |
| `--success` | Completed / approved | `161 60% 50–55%` (desaturate if vibrating) |
| `--warning` | **Approval waiting** (was sand-ish warning) | `35 84% 58–62%` → maps to approval |
| `--destructive` | Danger | `354 70% 55%` range |
| `--glow-primary` | Soft ice/electric glow, scarce | ice/electric alpha |
| Electron `backgroundColor` | Match midnight, kill flash | `#050e21` |

Also expose explicit CSS custom properties for the brand names (`--color-ice`, etc.) so new code can reference semantic brand tokens, not only shadcn roles.

## Color usage in the product (dark app)

| Mix | Use |
| --- | --- |
| ~70–80% | Midnight / navy / ink / panel surfaces |
| ~10–15% | Frost/cloud text and muted neutrals |
| ~5% | Ice primary actions and brand emphasis |
| Functional | Success / approval / danger / electric activity |

**Ice is scarce.** Primary buttons, active nav item, live model/activity, selected controls, key empty-state CTAs.  
**Electric** for processing, links, progress, focus rings.  
**Approval amber** only for “needs you / waiting for yes” (approvals, held file ops).  
**Success** only for completed/approved.  
**Danger** only for destructive/error.  
Never use approval for success or ice as a full-window wash.

Status must remain distinguishable **with text/icon**, not color alone.

## Typography

Keep desktop density (Apple HIG ~13–13.5px body, existing type scale). Optional brand alignment:

- Continue SF Pro / system stack for product chrome (native feel).
- If marketing fonts are already available in the renderer, do **not** force Instrument Serif into dense chrome; serif emphasis only for rare onboarding/marketing moments if already used.

Preserve design-token discipline: no arbitrary `text-[Npx]` in product chrome; no raw Tailwind palette colors (`rose-500`, etc.).

## Surfaces & chrome to retokenize

Implementers must inspect and update (non-exhaustive — discover more):

1. **`src/renderer/styles/globals.css`** — full token remap; body gradients from warm sand → cool ice/electric ambient (subtle); selection, focus, grain, scroll thumbs.
2. **`tailwind.config.js`** — ensure success/warning/destructive/hairline still resolve; add brand color aliases if useful (`ice`, `electric`, `midnight`…).
3. **`src/main/index.ts`** — `backgroundColor: "#050e21"` (or matching midnight).
4. **`DESIGN.md`** — rewrite principles: Deep Navy + Ice, not warm sand.
5. **Brand mark / splash / onboarding** — `brand-mark.tsx`, `onboarding-wizard.tsx`, license screens: no leftover sand-only aesthetics.
6. **Approval UX** — any “waiting for approval” chips, gates, strips must use approval token + label (and success after approve).
7. **Activity / running** — live ticks, progress, streaming avatar rings: electric/ice, not sand.
8. **Buttons, badges, focus rings** — primary = ice system; focus-visible always visible.
9. **Hardcoded HSL/hex** — purge warm sand `34 32%`, `#0e0e10`, and similar across renderer + main window chrome.
10. **Tests** — update `design-tokens.test.ts` and any tests asserting sand/warm copy; keep forbidden raw palette rules; add assertions that brand tokens (ice/midnight or primary mapped to ice) exist.
11. **Mobile companion (`apps/mobile`)** — if it shares brand colors, apply the same token map at a proportional depth so tray/companion doesn’t clash; do not block desktop ship if mobile is structurally separate, but prefer parity when cheap.

## Interaction language (match landing)

- Motion explains state; honor `prefers-reduced-motion`.
- Approval controls visibly transition approval → success.
- Running/processing uses electric/ice activity cues.
- No purple glow / generic AI aesthetics / glassmorphism spam.
- Keep existing functional interactions (command palette, composer, approvals, tray).

## Accessibility

- WCAG AA for text on dark navy surfaces (especially ice-on-navy and muted-on-midnight).
- If pure ice `#9fddff` as solid button fill fails contrast with intended label color, adjust **token values** (slightly darker ice fill or ink label) rather than abandoning the brand.
- Focus rings use electric/ice, high visibility.
- Do not communicate status by color alone.

## Technical constraints

- Preserve Electron + Vite + React architecture under `apps/desktop`.
- Prefer retokenizing CSS variables so most components inherit brand automatically.
- Surgical class fixes only where hard-coded colors remain.
- Commands (from monorepo root or package as appropriate):
  - `pnpm --filter @grokdesk/desktop test` or `cd apps/desktop && pnpm test`
  - `pnpm --filter @grokdesk/desktop typecheck`
  - `pnpm --filter @grokdesk/desktop build` (or package scripts that are standard in this repo)
- Read root `package.json` / `apps/desktop/package.json` for the real scripts before claiming pass/fail.
- Do not weaken security (sandbox, CSP) for cosmetics.

## Working process

1. Inspect current token system, DESIGN.md, design-tokens tests, brand surfaces, hard-coded sand colors.
2. Define semantic brand tokens + map into shadcn roles.
3. Retokenize globals + Electron backgroundColor.
4. Sweep hard-coded leftovers; fix approval/activity/primary surfaces.
5. Align DESIGN.md and tests.
6. Optionally align mobile theme tokens.
7. Run typecheck, unit tests, build; fix all implementation-caused failures.
8. Leave app deployable / packable.

## Definition of done

- Desktop product chrome reads as the same brand family as the Deep Navy + Ice landing page.
- Warm sand is no longer the primary accent.
- Ice is intentional and scarce; approval/success/danger/electric roles are correct and distinct.
- Window launch background matches midnight (no light/warm flash).
- Token discipline tests pass; typecheck and package tests pass; production build for desktop package succeeds (or documented monorepo-equivalent).
- No regression to forbidden marketing words or broken license/onboarding primary paths.

## Reference landing tokens file

Sibling path (when available):  
`/Users/maceo/blockvantage/grok/grok-landing/src/app/globals.css`  
`/Users/maceo/blockvantage/grok/grok-landing/docs/superpowers/specs/2026-07-23-deep-navy-ice-landing.md`
