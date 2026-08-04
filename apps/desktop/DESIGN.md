# Grok Desk Design System

Research-backed system for a premium dark Mac desktop agent (2025–2026 SOTA).

## Design read

**macOS productivity agent for SuperGrok power users** — Linear precision + Raycast chrome + Apple HIG density + Material 3 tonal elevation. **Deep Navy + Ice** brand (parity with the public landing site). Own shadcn (never ship defaults). The **app stays dark product chrome** (midnight/navy stack); ice is a scarce accent, not a page wash.

## Brand palette (canonical hex)

| Token | Hex | Role |
| --- | --- | --- |
| `--color-midnight` | `#050e21` | Canvas / window flash |
| `--color-navy` | `#07142c` | Elevated base |
| `--color-ink` | `#0b1736` | Surfaces / ink labels on ice |
| `--color-panel` | `#10213f` | High panels |
| `--color-ice` | `#9fddff` | Primary brand (scarce) |
| `--color-electric` | `#4c8bff` | Focus, activity, links, progress |
| `--color-frost` | `#d7e6ff` | Bright text / frost emphasis |
| `--color-success` | `#67d9b5` | Completed / approved |
| `--color-approval` | `#f2b96b` | Needs you / waiting for yes |
| `--color-danger` | `#f47c88` | Destructive / error |

### Usage mix (dark app)

| Mix | Use |
| --- | --- |
| ~70–80% | Midnight / navy / ink / panel surfaces |
| ~10–15% | Frost/cloud text and muted neutrals |
| ~5% | Ice primary actions and brand emphasis |
| Functional | Success / approval / danger / electric activity |

**Ice** — primary buttons, active nav, live model/activity emphasis, selected controls, key empty-state CTAs.  
**Electric** — processing, links, progress, focus rings.  
**Approval amber** — only “needs you / waiting for yes”.  
**Success** — only completed/approved.  
**Danger** — only destructive/error.  
Never use approval for success or ice as a full-window wash. Status must stay distinguishable **with text/icon**, not color alone.

## Sources synthesized

| Source | Takeaway applied |
| --- | --- |
| Atmos / Material dark theme | No pure black; elevation via lighter surfaces; restrained chromatics on dark |
| Material 3 | Tone-based surface roles (surface → surface-container-high) over heavy shadows |
| Linear / GitHub / Notion dark | Restrained palette, scannable hierarchy, subtle elevation, keyboard-first |
| Raycast analysis | Dark chrome instrument feel; accent used sparingly for primary actions |
| Apple HIG (macOS) | ~13pt body floor, clear grouping, whitespace for hierarchy, SF Pro |
| shadcn 2026 best practices | Token layer first; customize primitives; fewer variants |
| Landing Deep Navy + Ice | Shared brand family with marketing site; app remains dark desktop-native |

## Principles

1. **Never pure #000 / #fff** — midnight navy and frost/off-white only.
2. **Elevation = lighter tone**, not black drop shadows.
3. **One brand accent** — ice (scarce); functional status colors stay distinct.
4. **Desaturated chromatics** on dark to reduce vibration / eye strain.
5. **8pt grid**, 4pt subdivisions.
6. **macOS body ~13–13.5px**; display tracking tight.
7. **Focus rings always visible** (keyboard users) — electric/ice.
8. **Grain optional and subtle** — depth without noise.
9. **Honor `prefers-reduced-motion`** — motion explains state, never decorates alone.

## Token map

| Role | Intent |
| --- | --- |
| `--background` / `--surface-0` | Midnight canvas |
| `--sidebar` | Slightly deeper/cooler rail |
| `--card` / surface-1 | Navy elevated content panels |
| `--popover` / surface-2 | Ink floating elevated UI |
| `--surface-3` / panel high | Highest tonal surface |
| `--primary` | CTA / brand **ice** (ink label via `--primary-foreground`) |
| `--ring` | Electric focus / activity |
| `--muted-foreground` | Secondary text ≥ ~4.5:1 on bg |
| `--border` | Hairlines at white ~6% |
| `--hairline-quiet` / `--hairline` / `--hairline-strong` | Only three border opacities (5% / 8% / 12% white) — use `border-hairline`, `border-hairline-quiet`, `border-hairline-strong` |
| `--success` / `--warning` / `--destructive` | Semantic status only — never raw Tailwind `rose`/`amber`/`sky` palette utilities |
| `--destructive-text` | Destructive text/icon on dark surfaces (AA-safe); `--destructive` is the fill tone — use `text-destructive-text`, never bare `text-destructive` |
| `--warning` | **Approval waiting** (maps to `--color-approval`) |
| Electron `backgroundColor` | `#050e21` midnight (no launch flash) |

## Type scale

| Token | Size | Use |
| --- | --- | --- |
| `2xs` | 11px | Badges, kbd, micro labels |
| `xs` | 12px | Secondary chrome |
| `sm` | 13px | Compact UI |
| `base` | 13.5px | Body / product chrome |
| `md`–`2xl` | 15–24px | Titles through page headers |
| `3xl` / `4xl` | 28 / 32px | Onboarding + rare display heroes only |

No arbitrary `text-[Npx]` in product chrome. Chat prose uses `.typeset` (14.5px).

## Shell chrome (8pt grid)

| Element | Size |
| --- | --- |
| Sidebar expanded | `w-64` (256px) |
| Sidebar collapsed | `w-16` (64px) |
| Topbar | `h-14` (56px) |

## Page shells

| Surface type | Horizontal pad | Max width |
| --- | --- | --- |
| Centered focus (Home, Memory, Scheduled) | `px-8` | `max-w-3xl` |
| List/detail (Tasks, Artifacts main) | `px-6` | full |
| Settings | `px-6` | `max-w-[1400px]` |
| Workspace chat column | `px-6` (browser split may use `px-3`) | keep |

## Libraries

- **UI**: shadcn new-york (owned source) + Radix primitives
- **Icons**: Lucide at stroke 1.75 (project already committed)
- **Motion**: CSS only; honor `prefers-reduced-motion`; content view-transition is opacity-only (~160ms) with opaque `.vt-content`
- **Not used**: Material Web / Fluent (Electron React shell stays Tailwind + tokens)
