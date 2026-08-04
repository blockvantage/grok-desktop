# Frontend 10/10 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise every frontend design-quality score from the live audit to ~10/10 without adding dependencies or inventing a second design system — only enforce and complete the one in `apps/desktop/DESIGN.md`.

**Architecture:** Six score dimensions map to six workstreams. Wave order is dependency-first: **tokens & grid → layout shells → empty/first-run → component consistency → motion → enforcement tests**. Each wave ends with a visual pass on Home, Chats, Artifacts, Memory, Settings, and (if possible) a task workspace. No new UI libraries; CSS + existing shadcn/Radix only.

**Tech Stack:** Electron + React 18, Tailwind 3 + owned tokens (`globals.css`, `tailwind.config.js`), Radix/shadcn primitives under `src/renderer/components/ui/`, CSS view transitions (`withViewTransition`), Vitest for unit/regression guards.

**Baseline scores (post first polish pass):**

| Dimension | Now | Target | Gap driver |
| --- | ---: | ---: | --- |
| Design system foundation | 9 | 10 | Incomplete token ladder (borders, display type, chrome sizes) |
| Token discipline | 9 | 10 | No automated guard; onboarding display sizes still freeform |
| Spacing / rhythm | 7.5 | 10 | Off-grid chrome, mixed page padding, uneven Settings cards |
| Component consistency | 8.5 | 10 | Dual search, tertiary rails, CTA hierarchy, engineer copy |
| Empty / first-run polish | 7 | 10 | Artifacts empty triple-column; multi Sign-in; sparse Settings |
| Motion smoothness | 8 | 10 | Content VT ghosting between nav surfaces |

**Constraint:** Prefer reducing on-screen signal. Do not add dashboard chrome, extra cards, or new accent colors.

**Definition of done (overall):**
1. Live walkthrough of all primary surfaces scores ≥9.5 on the rubric below.
2. `pnpm --filter @grokdesk/desktop typecheck` clean.
3. Targeted Vitest + any new token/guard tests green.
4. `DESIGN.md` updated with the new tokens/rules so the system stays enforceable.

---

## Score → workstream map

```
Foundation (→10)     W1 tokens, border ladder, type 3xl/4xl, chrome sizes
Token discipline     W1 + W6 (lint/test guards)
Spacing / rhythm     W1 chrome grid + W2 page shells
Component consistency W2 Artifacts/Settings + W4 CTA/copy/primitives
Empty / first-run    W3 empty states + first-run hierarchy
Motion               W5 view-transition paint + duration
```

---

## File map

| Area | Primary files |
| --- | --- |
| Tokens / type / motion CSS | `apps/desktop/src/renderer/styles/globals.css`, `apps/desktop/tailwind.config.js`, `apps/desktop/DESIGN.md` |
| Shell chrome | `components/shell/app-sidebar.tsx`, `components/shell/app-topbar.tsx`, `App.tsx` |
| Page shells | `views/home-view.tsx`, `views/tasks-view.tsx`, `views/artifacts-view.tsx`, `views/memory-view.tsx`, `views/scheduled-view.tsx`, `views/settings-view.tsx`, `page-header.tsx`, `empty-state.tsx` |
| Settings detail | `views/settings/account-tab.tsx`, `preferences-tab.tsx`, `settings-row.tsx` |
| Motion | `lib/view-transition.ts`, `globals.css` (`::view-transition-*`, `.vt-content`) |
| Enforcement | `ui-structure.test.ts` (extend) or new `lib/design-tokens.test.ts` |

---

## Wave 0 — Baseline capture (30 min)

### Task 0: Freeze baseline before changing layout

**Files:**
- Create: `docs/analysis/2026-07-22-frontend-10-baseline.md` (short notes only)

- [ ] **Step 1: Restart app and capture screenshots**

```bash
pnpm dev
# Capture: Home (unsigned), Chats empty, Artifacts empty, Memory empty,
# Settings Account, Settings Preferences, command palette (⌘K)
```

- [ ] **Step 2: Write baseline notes**

Record for each surface: padding, dual-search yes/no, number of primary sand CTAs, any mid-nav ghosting. This is the before picture for the final rubric.

- [ ] **Step 3: Commit baseline notes only if useful**

```bash
git add docs/analysis/2026-07-22-frontend-10-baseline.md
git commit -m "docs: capture frontend 10/10 polish baseline"
```

---

## Wave 1 — Design system foundation + token discipline (9 → 10)

**Goal:** Close the last foundation gaps so every surface *can* be 10 without inventing one-off values.

### Task 1: Canonical hairline + chrome size tokens

**Files:**
- Modify: `apps/desktop/src/renderer/styles/globals.css` (`:root` token block)
- Modify: `apps/desktop/tailwind.config.js` (extend colors/spacing if needed)
- Modify: `apps/desktop/DESIGN.md` (document the ladder)

- [ ] **Step 1: Add hairline opacity tokens to `:root`**

In `globals.css` under `:root`, keep existing tokens and add:

```css
/* Hairline ladder — only three levels (quiet / default / strong) */
--hairline-quiet: 0 0% 100% / 0.05;
--hairline: 0 0% 100% / 0.08;
--hairline-strong: 0 0% 100% / 0.12;
```

(Replace or alias the existing single `--hairline` if already defined — one source of truth.)

- [ ] **Step 2: Extend Tailwind so components can use them**

In `tailwind.config.js` `theme.extend.colors` (or `borderColor`):

```js
hairline: {
  quiet: "hsl(var(--hairline-quiet))",
  DEFAULT: "hsl(var(--hairline))",
  strong: "hsl(var(--hairline-strong))",
},
```

- [ ] **Step 3: Align chrome to 8pt grid**

| Element | Current | Target |
| --- | --- | --- |
| Sidebar width expanded | `w-[252px]` | `w-64` (256px) |
| Sidebar collapsed | `w-[68px]` | `w-16` (64px) or `w-[72px]` if icons need it — pick one and document |
| Topbar height | `h-[52px]` | `h-12` (48) **or** `h-14` (56) — prefer `h-14` if search feels cramped |

Modify:
- `app-sidebar.tsx` width classes
- `app-topbar.tsx` header height

- [ ] **Step 4: Document in DESIGN.md**

Add under Token map:

```markdown
| `--hairline-quiet` / `--hairline` / `--hairline-strong` | Only three border opacities |
| Sidebar | 256px expanded / 64–72px collapsed |
| Topbar | 56px (h-14) |
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/styles/globals.css apps/desktop/tailwind.config.js apps/desktop/DESIGN.md \
  apps/desktop/src/renderer/components/shell/app-sidebar.tsx \
  apps/desktop/src/renderer/components/shell/app-topbar.tsx
git commit -m "feat(ui): hairline ladder + 8pt chrome sizes"
```

### Task 2: Display type scale + onboarding migration

**Files:**
- Modify: `apps/desktop/tailwind.config.js` `fontSize`
- Modify: `apps/desktop/src/renderer/components/onboarding-wizard.tsx` (all `text-[1.75rem]` / `text-[2rem]` / etc.)

- [ ] **Step 1: Add display steps to Tailwind**

```js
// tailwind.config.js fontSize
"3xl": ["28px", { lineHeight: "1.2", letterSpacing: "-0.028em" }],
"4xl": ["32px", { lineHeight: "1.15", letterSpacing: "-0.03em" }],
```

- [ ] **Step 2: Replace onboarding arbitrary sizes**

| Was | Becomes |
| --- | --- |
| `text-[1.75rem]` / `sm:text-[2rem]` | `text-3xl` |
| `text-[1.85rem]` / `sm:text-[2.15rem]` | `text-3xl` or `text-4xl` for hero only |
| `text-[2rem]` / `sm:text-[2.35rem]` | `text-4xl` |

Drop `sm:` size variants that only exist for web responsive — desktop window is fixed; one size is enough unless the onboarding scene is intentionally large.

- [ ] **Step 3: Grep for remaining arbitrary display sizes**

```bash
rg -n 'text-\[[0-9]' apps/desktop/src/renderer --glob '*.tsx'
```

Expected: zero product chrome hits; only intentional layout max-widths like `max-w-[46rem]` if kept.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): display type scale 3xl/4xl; migrate onboarding"
```

### Task 3: Mechanical border opacity migration

**Files:** many under `src/renderer/components/**/*.tsx` (mechanical)

- [ ] **Step 1: Map old → new**

| Old class fragments | New |
| --- | --- |
| `border-white/[0.03]`, `/[0.04]`, `/[0.05]` | `border-hairline-quiet` |
| `border-white/[0.06]`, `/[0.07]`, `/[0.08]` | `border-hairline` |
| `border-white/[0.1]`, `/[0.12]`, `/[0.14]` | `border-hairline-strong` |

Prefer editing shared primitives first so call sites inherit:
- `ui/button.tsx`, `ui/input.tsx`, `ui/textarea.tsx`, `ui/card.tsx`, `ui/badge.tsx`, `ui/tabs.tsx`, `ui/dialog.tsx`, `ui/select.tsx`

- [ ] **Step 2: Sweep high-traffic product files**

```bash
rg -n 'border-white/\[' apps/desktop/src/renderer --glob '*.tsx' | wc -l
# Drive count toward 0 for borders (bg-white/[...] fill tints can stay for now
# or map 0.03–0.05 → quiet fill recipes in a follow-up)
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(ui): migrate borders to hairline token ladder"
```

**Wave 1 exit criteria:** DESIGN.md documents hairlines + chrome + display type; chrome is on 8pt; onboarding uses `3xl`/`4xl`; border freeform count near zero.

---

## Wave 2 — Spacing / rhythm + component shells (7.5 → 10 spacing, part of consistency)

**Goal:** One page shell language across secondary surfaces; fix the worst layout imbalances.

### Task 4: Shared page content padding contract

**Files:**
- Modify: `page-header.tsx` (if needed)
- Modify: `home-view.tsx`, `tasks-view.tsx`, `artifacts-view.tsx`, `memory-view.tsx`, `scheduled-view.tsx`, `settings-view.tsx`
- Optionally add: `components/page-shell.tsx` (only if DRY pays off in ≥3 call sites)

**Contract:**

| Surface type | Horizontal pad | Max width |
| --- | --- | --- |
| Centered focus (Home, Memory, Scheduled) | `px-8` | `max-w-3xl` (Home already) |
| List/detail (Chats/Tasks, Artifacts main) | `px-6` | full |
| Settings | `px-6` / `max-w-[1400px]` | keep |
| Workspace chat column | `px-6` (browser split may use `px-3`) | keep |

- [ ] **Step 1: Document contract in DESIGN.md** under a “Page shells” section
- [ ] **Step 2: Align Memory/Scheduled/Home** to the centered contract (same vertical rhythm: `py-6` / `space-y-5|6`)
- [ ] **Step 3: Align Tasks/Artifacts headers** to shared `px-6 py-5` header strip + `PageHeader` or identical heading stack (`text-2xl` + `text-sm` muted)
- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(ui): unify page shell padding and headers"
```

### Task 5: Artifacts empty layout (triple column → calm)

**Files:**
- Modify: `apps/desktop/src/renderer/components/views/artifacts-view.tsx`
- Possibly: `App.tsx` / topbar search wiring if suppressing dual search

- [ ] **Step 1: When `artifacts.length === 0`, hide the type-filter aside**

Render a single full-width empty column (header + `EmptyState` + optional “New chat” CTA). Category rail returns only when `artifacts.length > 0`.

- [ ] **Step 2: Kill dual search when empty**

Options (pick one):
- **A (recommended):** Keep in-page search only when there is data; when empty, no search fields.
- **B:** Drive filtering only from topbar search (`props.search`) and remove local search input entirely.

Implement A unless topbar is already the source of truth for this view.

- [ ] **Step 3: Visual check**

Empty Artifacts = one sidebar + one content pane, one empty state, no second search.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(ui): calm Artifacts empty layout; remove dual search"
```

### Task 6: Settings Preferences card balance + product copy

**Files:**
- Modify: `views/settings/preferences-tab.tsx`
- Modify: `i18n/locales/en.json` (+ other locales if keys change meaning)
- Modify: `account-tab.tsx` action hierarchy if not already ideal

- [ ] **Step 1: Layout**

Replace uneven `md:grid-cols-2` short/tall pair with either:
- **Stack** (single column `max-w-2xl`) — simplest, densest, most Linear-like; **recommended**
- Or equal-height cards with `h-full` + internal spacing so voids collapse

- [ ] **Step 2: Productize engineer copy**

Keys currently describing “AgentProvider / gateway-mediated / cutover” → user language, e.g.:
- Title: “Experimental engine path”
- Body: “Use an alternate run path for testing. Leave off unless you know you need it.”

Keep technical detail in a tooltip or Advanced tab if engineers need it.

- [ ] **Step 3: Account tab CTA hierarchy**

```
[ Sign in with SuperGrok ]     ← primary (default)
[ Refresh status ] [ Run setup again ]  ← outline, same row if space
```

Not three equal-width stacked buttons of mixed importance.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(ui): Settings preferences layout and account CTA hierarchy"
```

**Wave 2 exit criteria:** No triple-column empty Artifacts; Settings Preferences not a half-empty grid; page pads match the contract.

---

## Wave 3 — Empty / first-run polish (7 → 10)

### Task 7: First-run Sign-in hierarchy

**Files:**
- Modify: `home-view.tsx` (readiness stays primary)
- Modify: `app-sidebar.tsx` (footer Sign in treatment when unsigned)
- Possibly: `readiness-checklist.tsx` emphasis only

- [ ] **Step 1: One primary sand Sign-in on Home**

Keep readiness checklist CTAs. Sidebar footer when unsigned:
- Change from full-width `default` sand button → `outline` or `ghost` “Sign in”, **or** collapse to avatar row that opens Account.

- [ ] **Step 2: Avoid three simultaneous sand CTAs**

Audit Home for `variant="default"` sand buttons while unsigned. Max **one** primary sand action in the main column (Run may stay disabled/secondary until ready).

- [ ] **Step 3: Empty states teach + act**

Ensure every empty surface has:
1. Icon in quiet surface
2. Title
3. One-line teaching description
4. **One** action when it makes sense (Conversations → New chat; Memory → Add memory; Artifacts → optional New chat)

`EmptyState` already supports this — wire missing `actionLabel`/`onAction` where absent.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(ui): first-run CTA hierarchy and empty-state actions"
```

### Task 8: Settings / secondary empty density

**Files:**
- `settings-view.tsx`, tab panels, `memory-view.tsx`, `scheduled-view.tsx`

- [ ] **Step 1: Reduce dead vertical void under short Settings Account content**

Options: pull next content up, add a compact “What’s next” strip (license/runtime status already on Home — don’t duplicate), or accept card-only with less top padding.

- [ ] **Step 2: Memory / Scheduled empty** — match Artifacts teaching quality; same `EmptyState` vertical centering.

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(ui): tighten secondary empty and settings density"
```

**Wave 3 exit criteria:** First-run has one obvious next action; empties never feel like abandoned chrome.

---

## Wave 4 — Component consistency (8.5 → 10)

### Task 9: Primitive consistency checklist

**Files:** `components/ui/*`

Walk each primitive against DESIGN.md:

| Primitive | Check |
| --- | --- |
| Button | One primary sand; outline/ghost for secondary; no random heights |
| Input / Textarea / Select | same `h-9`, `text-sm`, hairline border, shared focus (global ring + border shift) |
| Card | surface-1, radius from `--radius`, hairline |
| Dialog / Sheet / Popover | surface-3 float recipe (already owned) |
| Tabs | same active pill treatment Settings/elsewhere |
| Badge / StatusPill | only semantic status tokens |

- [ ] **Step 1: Diff primitives vs DESIGN.md; fix stragglers**
- [ ] **Step 2: Replace any remaining `focus:ring-*` overrides** that fight global `:focus-visible`
- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(ui): align primitives to design system checklist"
```

### Task 10: Shared list-row + filter-chip recipes

**Files:**
- `tasks-view.tsx` filter chips
- `artifacts-view.tsx` FilterBtn
- Possibly extract `components/filter-chip.tsx` if duplication is real

- [ ] **Step 1: One visual language for filter chips** (height, radius, active fill `bg-white/[0.08]` or primary/10, count badge)
- [ ] **Step 2: One list-row hover/active recipe** for chats, artifacts cards, memory rows
- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(ui): shared filter chip and list-row recipes"
```

**Wave 4 exit criteria:** Same control looks the same on every surface; no one-off filter styles.

---

## Wave 5 — Motion smoothness (8 → 10)

### Task 11: Kill content view-transition ghosting

**Files:**
- Modify: `apps/desktop/src/renderer/styles/globals.css` (VT blocks)
- Modify: `apps/desktop/src/renderer/App.tsx` (`.vt-content` already has `bg-background` — verify opaque)
- Possibly: `lib/view-transition.ts`

- [ ] **Step 1: Ensure `.vt-content` paints opaque background**

```css
.vt-content {
  view-transition-name: content-surface;
  background-color: hsl(var(--background)); /* solid — no bleed */
}
```

- [ ] **Step 2: Shorten content crossfade**

In `globals.css`:

```css
::view-transition-group(content-surface) {
  animation-duration: 160ms; /* was 240ms — snappier, less ghost */
}
```

Optionally disable old-root slide (`translateY`) for content-only transitions if still ghosty — prefer opacity-only for `content-surface`.

- [ ] **Step 3: Optional — skip VT when reduced motion or rapid re-entry**

If double-clicking nav still stacks transitions, gate `withViewTransition`:

```ts
// Skip if a transition is already running (document has active view transition)
let busy = false;
export function withViewTransition(update: () => void): void {
  if (busy || prefersReducedMotion() || !doc.startViewTransition) {
    update();
    return;
  }
  busy = true;
  const t = doc.startViewTransition(() => {
    flushSync(update);
  });
  Promise.resolve(t?.finished).finally(() => {
    busy = false;
  });
}
```

(Adapt to the actual View Transition API shape in Chromium/Electron 33.)

- [ ] **Step 4: Manual test**

Rapidly click Home → Settings → Chats → Artifacts. No stacked Settings-under-Chats ghost.

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(ui): opaque content VT and shorter crossfade"
```

**Wave 5 exit criteria:** Fast nav never shows two surfaces at once.

---

## Wave 6 — Enforcement so scores don’t regress (locks 10s)

### Task 12: Automated design guards

**Files:**
- Create or extend: `apps/desktop/src/renderer/ui-structure.test.ts`
- Or: `apps/desktop/src/renderer/lib/design-tokens.test.ts`

- [ ] **Step 1: Forbid raw Tailwind palette in renderer product code**

```ts
// design-tokens.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const FORBIDDEN =
  /\b(text|bg|border|from|via|to)-(rose|amber|sky|violet|orange|zinc|emerald|red|green)-[0-9]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
      out.push(p);
  }
  return out;
}

it("renderer product code does not use raw Tailwind palette colors", () => {
  const hits: string[] = [];
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, "utf8");
    if (FORBIDDEN.test(src)) hits.push(file);
  }
  expect(hits).toEqual([]);
});
```

- [ ] **Step 2: Forbid arbitrary micro font sizes in product chrome**

```ts
const ARBITRARY_PX = /text-\[[0-9]+(\.[0-9]+)?px\]/;
// allowlist onboarding only if still needed — prefer zero after Task 2
```

- [ ] **Step 3: Run**

```bash
pnpm --filter @grokdesk/desktop test -- src/renderer/lib/design-tokens.test.ts src/renderer/ui-structure.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "test(ui): guard semantic colors and type scale"
```

### Task 13: Final rubric + DESIGN.md lock

**Files:**
- Modify: `apps/desktop/DESIGN.md`
- Create: `docs/analysis/2026-07-22-frontend-10-exit.md`

- [ ] **Step 1: Live re-score each dimension (0–10)**

| Dimension | Exit target | Pass rule |
| --- | --- | --- |
| Foundation | 10 | Tokens cover hairlines, display type, chrome; DESIGN.md matches code |
| Token discipline | 10 | Guards green; grep clean |
| Spacing / rhythm | 10 | Page contract + 8pt chrome; no off-grid one-offs in shell |
| Component consistency | 10 | Shared chips/rows; primitives checklist done |
| Empty / first-run | 10 | No dual search; one primary CTA; teaching empties |
| Motion | 10 | Rapid nav, no ghost |

- [ ] **Step 2: Full verification**

```bash
pnpm --filter @grokdesk/desktop typecheck
pnpm --filter @grokdesk/desktop test
```

- [ ] **Step 3: Exit doc with scores + residual known issues (if any)**
- [ ] **Step 4: Commit**

```bash
git commit -m "docs: frontend 10/10 polish exit rubric"
```

---

## Suggested schedule

| Wave | Effort | Score impact |
| --- | --- | --- |
| W0 Baseline | 0.5h | — |
| W1 Tokens / type / hairlines | 0.5–1d | Foundation 9→10, Token 9→10 |
| W2 Shells / Artifacts / Settings | 1d | Spacing 7.5→9.5+, Consistency + |
| W3 First-run / empties | 0.5d | Empty/first-run 7→9.5+ |
| W4 Primitives / chips | 0.5d | Consistency →10 |
| W5 Motion | 0.25–0.5d | Motion →10 |
| W6 Guards + exit | 0.25d | Locks all scores |

**Total:** ~3–4 focused days for one engineer (or one agent session series with review gates).

---

## Out of scope (do not do)

- New accent colors, glassmorphism, marketing gradients
- Redesigning the agent workspace chat transcript from scratch
- Mobile/responsive redesign (desktop product)
- Adding `framer-motion` / new animation libraries
- Rewriting i18n for all locales until English copy is locked (then translate in a dedicated i18n pass)

---

## Risk notes

1. **Sidebar width 252→256** may reflow screenshots/tests that assert pixel layouts — check `ui-structure.test.ts` / Playwright if any.
2. **Hairline migration is mechanical** — do primitives first to avoid thrash.
3. **View transition busy-gate** must not drop state updates; always run `update()` even when skipping animation.
4. **i18n:** product copy changes need `en.json` first; other locales can lag one PR if `createTranslator` falls back to English — prefer same-PR key parity if the project requires it (this repo has been strict about parity).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-frontend-10-polish.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task/wave, review between waves  
2. **Inline Execution** — run waves in this session with checkpoints after W1, W2, W3, W5  

**Which approach?**
