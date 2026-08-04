# Polish Round 4 — Session 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every broken-behavior finding and land the three mechanical sweeps (destructive-text contrast, muted-alpha floor, i18n batch) from `apps/desktop/POLISH_REVIEW_2026-07-28.md`.

**Architecture:** Ten independent tasks, each committed separately, each guarded by a test where one is feasible (source-scan tests in `ui-structure.test.ts` for class-string rules; unit tests for pure helpers; a locale-parity test for i18n). No task depends on another except Task 7 (needs Task 1's scan helper) and Task 9 (needs Task 6's key). The spec is the review doc — each task cites its finding IDs; mark them **DONE** in the review file as you go (Task 10).

**Tech Stack:** React 18 + Tailwind 3 + vitest (renderer), better-sqlite-style gateway service (packages/gateway), i18n via `useT()` from `@/i18n` (7 locales in `src/renderer/i18n/locales/`).

**Working directory:** `apps/desktop` unless a path starts with `packages/`. All renderer paths below are relative to `apps/desktop/src/renderer/`.

**Gates (run per task, all must pass before each commit):**

```bash
pnpm --filter @grokdesk/desktop typecheck
pnpm --filter @grokdesk/desktop test          # vitest run
```

Facts verified against source on 2026-07-28 (re-verify line numbers before editing; files drift):

- `useT()` works without a provider — `i18n/context.tsx:115-123` builds a fallback translator, so converting components to `useT()` cannot break provider-less unit tests.
- Gateway schedule RPCs are only `schedule.list` / `schedule.create` / `schedule.setEnabled` (`packages/gateway/src/services/side-data-dispatch.ts:21-23`); `schedule.delete` must be added end-to-end. `memory.delete` in the same file is the exact pattern to copy.
- The home composer already has the IME guard as the first line of its `onKeyDown` (`views/home-view.tsx:1066`: `if (e.nativeEvent.isComposing) return;`); the workspace composer does not (`views/task-workspace-view.tsx:~2795` — Escape branches run first).
- `ui-structure.test.ts` (renderer root) is an existing source-scan suite with `read()`/`exists()` helpers — new scan tests belong there.
- `SettingsRow` (`components/views/settings/settings-row.tsx`) renders `label` as a plain div and `control` as an opaque `ReactNode` — no id/labelledby wiring.

---

## Task 1: Broken opacity utilities (review C-1)

Tailwind 3 only generates slash-opacity classes for multiples of 5; `/12` and `/92` compile to **no CSS**. Add a permanent scan test, then fix the 10 sites.

**Files:**
- Modify: `src/renderer/ui-structure.test.ts`
- Modify: `src/renderer/components/ui/button.tsx:15`
- Modify: `src/renderer/components/ui/tabs.tsx:33`
- Modify: `src/renderer/components/license-activation-screen.tsx:111`, `components/task-stream.tsx:1573`, `components/deliverables-digest.tsx:64`, `components/runtime-install-step.tsx:60`, `components/onboarding-wizard.tsx:230,716`, `components/views/settings/license-tab.tsx:44`, `components/views/artifacts-view.tsx:585`

- [ ] **Step 1: Write the failing scan test**

Add to `ui-structure.test.ts` (top-level, next to the existing helpers):

```ts
function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}
```

And inside the describe block:

```ts
it("only uses real Tailwind opacity steps (multiples of 5) in slash modifiers", () => {
  const offenders: string[] = [];
  for (const file of walkSourceFiles(rendererRoot)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(
      /(?:bg|text|border|ring|from|to|via)-[a-zA-Z][\w-]*\/(\d{1,3})(?![\d\]])/g,
    )) {
      const n = Number(m[1]);
      if (n % 5 !== 0 || n > 100)
        offenders.push(`${path.relative(rendererRoot, file)}: ${m[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it — expect FAIL listing exactly the 10 sites**

```bash
pnpm --filter @grokdesk/desktop test -- src/renderer/ui-structure.test.ts
```

Expected offenders: `hover:bg-destructive/92` (button.tsx), `data-[state=active]:bg-primary/12` (tabs.tsx), `bg-primary/12` ×7, `bg-white/12` (onboarding-wizard.tsx:230). If the list differs, fix what the test found — the test is the source of truth.

- [ ] **Step 3: Fix all sites with bracketed arbitrary alpha**

- `ui/button.tsx:15`: `hover:bg-destructive/92` → `hover:bg-destructive/[0.92]`
- `ui/tabs.tsx:33`: `data-[state=active]:bg-primary/12` → `data-[state=active]:bg-primary/[0.12]`
- All 7 `bg-primary/12` → `bg-primary/[0.12]`
- `onboarding-wizard.tsx:230`: `bg-white/12` → `bg-white/[0.12]`

- [ ] **Step 4: Re-run the test — PASS. Run both gates.**
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(ui): repair /12 and /92 opacity classes that compiled to no CSS (C-1)"
```

---

## Task 2: IME guard for Escape-stops-run (review H-16)

**Files:**
- Modify: `src/renderer/components/views/task-workspace-view.tsx:~2795` (the `onKeyDown` containing the `// CHAT-6` and `// CH-3` comments)

- [ ] **Step 1: Add the guard as the first statement of that `onKeyDown`, identical to the home composer's (home-view.tsx:1066):**

```tsx
onKeyDown={(e) => {
  // SC-1: never handle keys while an IME composition is active.
  if (e.nativeEvent.isComposing) return;
  // CHAT-6: Escape cancels an open composer revision edit.
  ...
```

- [ ] **Step 2: Verify both composers now guard:**

```bash
grep -n "isComposing) return" src/renderer/components/views/home-view.tsx src/renderer/components/views/task-workspace-view.tsx
```

Expected: one hit in each file, above any Escape handling. Run both gates.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "fix(workspace): don't let Escape cancel the run during IME composition (H-16)"
```

---

## Task 3: Artifacts type filter on stable kind ids (review H-12)

The filter substring-matches the **localized** label against English chip values (`views/artifacts-view.tsx:338-341`) — zero results in non-English locales.

**Files:**
- Modify: the module that defines `artifactKindLabel` (find it: `grep -rn "export function artifactKindLabel" src/renderer`)
- Test: sibling `.test.ts` of that module (create if absent)
- Modify: `src/renderer/components/views/artifacts-view.tsx:335-341`

- [ ] **Step 1: Write the failing test for a new pure helper**

```ts
import { describe, it, expect } from "vitest";
import { artifactKindId } from "./<module>";

describe("artifactKindId", () => {
  it("returns locale-independent kind ids", () => {
    expect(artifactKindId("notes/report.md", "Report")).toBe("markdown");
    expect(artifactKindId("data.xlsx", "Data")).toBe("excel");
    expect(artifactKindId("script.py", "Script")).toBe("python");
    expect(artifactKindId("clip.mp4", "Clip")).toBe("media");
    expect(artifactKindId("misc.bin", "Blob")).toBe("other");
  });
});
```

- [ ] **Step 2: Run it — FAIL (`artifactKindId` not exported).**
- [ ] **Step 3: Implement `artifactKindId` next to `artifactKindLabel`**

Read `artifactKindLabel` first and extract its extension→kind discriminant so **both** functions share one switch (DRY — do not duplicate the extension lists):

```ts
export type ArtifactKindId = "media" | "markdown" | "excel" | "python" | "other";
export function artifactKindId(p: string | undefined, title: string): ArtifactKindId {
  /* same discriminant artifactKindLabel uses; media = isMediaPath */
}
```

- [ ] **Step 4: Test PASS. Swap the view's filter (artifacts-view.tsx:335-341):**

```tsx
if (typeFilter !== "all") {
  if (artifactKindId(a.path, a.title) !== typeFilter) return false;
}
```

(The separate `typeFilter === "media"` branch collapses into this — `artifactKindId` covers media. The `SelectItem` values `"media" | "markdown" | "excel" | "python"` at :540-553 already match the ids; leave them.)

- [ ] **Step 5: Both gates. Commit:**

```bash
git add -A && git commit -m "fix(artifacts): filter on locale-independent kind ids, not localized labels (H-12)"
```

---

## Task 4: `schedule.delete` end-to-end (review C-4)

Schedules currently can never be deleted. Copy the existing `memory.delete` pattern at every layer.

**Files:**
- Modify: `packages/gateway/src/services/scheduler.ts` (model on `setEnabled` at ~:194)
- Test: `packages/gateway/src/services/scheduler.test.ts`
- Modify: `packages/gateway/src/services/side-data-dispatch.ts` (+ its test if one exists)
- Modify: the gateway deps wiring site — find it: `grep -rn "scheduleSetEnabled:" packages/gateway/src`
- Modify: `src/renderer/components/views/scheduled-view.tsx` (row at ~:283-289, props at ~:31-46)
- Modify: `src/renderer/App.tsx:~2048` (ScheduledView wiring)
- Modify: all 7 files in `src/renderer/i18n/locales/`

- [ ] **Step 1: Failing gateway test** — in `scheduler.test.ts`, using the file's existing factory/setup idiom:

```ts
it("deletes a schedule rule", () => {
  const rule = /* create via the same helper the setEnabled tests use */;
  scheduler.delete(rule.id);
  expect(scheduler.list().find((r) => r.id === rule.id)).toBeUndefined();
});
```

- [ ] **Step 2: Run — FAIL. Implement `delete(id)` in scheduler.ts:**

```ts
delete(id: string): void {
  this.db.prepare(`DELETE FROM schedule_rules WHERE id = ?`).run(id);
}
```

(Match the exact db-call style `setEnabled` uses at ~:194.) Run — PASS.

- [ ] **Step 3: Wire dispatch.** In `side-data-dispatch.ts`: add `"schedule.delete"` to `SIDE_DATA_METHODS`, add `scheduleDelete: (id: string) => void` to `SideDataDeps`, and add a case mirroring `memory.delete` byte-for-byte (id-required guard + `okResponse()`). Add the same one-line dep at the wiring site found by the grep. If `side-data-dispatch` has a test file, add:

```ts
it("dispatches schedule.delete", () => {
  const deps = makeDeps(); // the file's existing mock-deps helper
  dispatchSideDataMethod("schedule.delete", { id: "s1" }, deps);
  expect(deps.scheduleDelete).toHaveBeenCalledWith("s1");
});
```

- [ ] **Step 4: Gateway gates:** `pnpm --filter @grokdesk/gateway test` and `pnpm --filter @grokdesk/gateway build`. Commit:

```bash
git add -A && git commit -m "feat(gateway): schedule.delete RPC (C-4, backend)"
```

- [ ] **Step 5: Add locale keys** (all 7 files, translate for each locale):

```json
"scheduled": {
  "delete": "Delete schedule",
  "deleteConfirmTitle": "Delete “{name}”?",
  "deleteConfirmBody": "This permanently removes the schedule. Tasks it already created are kept.",
  "deleteConfirm": "Delete"
}
```

- [ ] **Step 6: Renderer.** In `scheduled-view.tsx` add `onDelete: (id: string) => void` to props. In the row, after the Switch cell (SC-15 note: the old menu died because it had one redundant item — this one has a real item), add a delete affordance modeled on the AlertDialog idiom in `views/memory-view.tsx:282-312`:

```tsx
<TableCell className="w-10">
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={t("scheduled.delete")}>
        <Trash2 className="size-4 text-muted-foreground" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t("scheduled.deleteConfirmTitle", { name: s.name })}</AlertDialogTitle>
        <AlertDialogDescription>{t("scheduled.deleteConfirmBody")}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
        <AlertDialogAction onClick={() => props.onDelete(s.id)}>
          {t("scheduled.deleteConfirm")}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</TableCell>
```

(Import `Trash2` and the alert-dialog primitives; copy exact import paths and any destructive-action styling from memory-view's dialog. If `common.cancel` doesn't exist, grep for the cancel key memory-view uses and reuse it.)

- [ ] **Step 7: Wire App.tsx** next to `onToggle` (~:2048):

```tsx
onDelete={(id) =>
  void rpc("schedule.delete", { id })
    .then(refreshSide)
    .catch((e) => toast({ description: String(e), variant: "destructive" }))
}
```

- [ ] **Step 8: Both desktop gates. Commit:**

```bash
git add -A && git commit -m "feat(scheduled): delete schedules with confirm dialog (C-4)"
```

*Deliberately deferred (YAGNI for this session): schedule **edit** needs a `schedule.update` RPC — note it under C-4 in the review file as a follow-up rather than half-shipping it.*

---

## Task 5: Accessible names for every Switch (review C-3)

**Files:**
- Create: `src/renderer/components/views/settings/settings-row.test.tsx`
- Modify: `src/renderer/components/views/settings/settings-row.tsx`
- Modify: `src/renderer/components/desktop-task-toggle.tsx:83`, `components/views/scheduled-view.tsx:~283`
- Verify: `components/views/settings/tools-tab.tsx:309,316,726`, `permissions-tab.tsx:98`

- [ ] **Step 1: Failing test** (match the setup style of an existing component test, e.g. `components/context-meter.test.tsx`):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SettingsRow } from "./settings-row";
import { Switch } from "@/components/ui/switch";

describe("SettingsRow", () => {
  it("names a Switch control after the row label", () => {
    render(<SettingsRow label="Master toggle" control={<Switch checked={false} />} />);
    expect(screen.getByRole("switch", { name: "Master toggle" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — FAIL (switch has no accessible name).**
- [ ] **Step 3: Implement labelledby wiring in SettingsRow:**

```tsx
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
// inside SettingsRow:
const labelId = useId();
// label div gains id:
<div id={labelId} className="text-sm font-medium text-foreground">{label}</div>
// control rendering becomes:
{control ? (
  <div className="shrink-0">
    {isValidElement(control)
      ? cloneElement(control as ReactElement<{ "aria-labelledby"?: string }>, {
          "aria-labelledby":
            (control.props as { "aria-labelledby"?: string })["aria-labelledby"] ?? labelId,
        })
      : control}
  </div>
) : null}
```

- [ ] **Step 4: Test PASS. Fix the two non-SettingsRow switches:**
- `desktop-task-toggle.tsx:83`: add `aria-label={t("desktop.toggle")}` to the `<Switch>` (the same key already renders as the sibling span).
- `scheduled-view.tsx` row Switch: add `aria-label={t("scheduled.toggleFor", { name: s.name })}` and add the key to all 7 locales: `"toggleFor": "Enable {name}"` (translated per locale).

- [ ] **Step 5: Sweep for stragglers:**

```bash
grep -rn "<Switch" src/renderer --include="*.tsx" | grep -v test
```

For each hit: confirm it is either a direct `control={<Switch …/>}` of SettingsRow (now auto-named) or carries `aria-label`. tools-tab:309,316,726 — if any Switch is wrapped in an intermediate element inside `control`, give that Switch an explicit `aria-label` from the row's label key.

- [ ] **Step 6: Both gates. Commit:**

```bash
git add -A && git commit -m "fix(a11y): accessible names for all Switch controls (C-3)"
```

---

## Task 6: Honest copy toast (review M-22)

**Files:**
- Modify: `src/renderer/components/views/artifacts-view.tsx:~468` (the text-content copy branch only — the path-copy branches keep `media.copiedPath`)
- Modify: all 7 locale files

- [ ] **Step 1: Add key** `"media": { "copiedContent": "Copied file contents" }` — translated in each of the 7 locales.
- [ ] **Step 2: Swap the toast in the branch that calls `navigator.clipboard.writeText(r.content)`:** `t("media.copiedPath")` → `t("media.copiedContent")`.
- [ ] **Step 3: Both gates. Commit:**

```bash
git add -A && git commit -m "fix(artifacts): correct toast after copying file contents (M-22)"
```

---

## Task 7: destructive-text contrast sweep (review H-7 + config part of H-2)

`text-destructive` as body text is 4.0–4.45:1; `--destructive-text` (7.55:1) exists for exactly this. Depends on Task 1 (reuses `walkSourceFiles`).

**Files:**
- Modify: `tailwind.config.js` (colors block)
- Modify: `src/renderer/ui-structure.test.ts`
- Modify: ~20 renderer files (mechanical)

- [ ] **Step 1: Map the missing tokens in `tailwind.config.js` colors** (alongside the existing entries; these vars all exist in globals.css):

```js
"destructive-text": "hsl(var(--destructive-text))",
"primary-hover": "hsl(var(--primary-hover))",
surface: {
  0: "hsl(var(--surface-0))",
  1: "hsl(var(--surface-1))",
  2: "hsl(var(--surface-2))",
  3: "hsl(var(--surface-3))",
},
```

(Only `destructive-text` is consumed this session; the rest unblock Session 2's codemod.)

- [ ] **Step 2: Failing scan test** in `ui-structure.test.ts`:

```ts
it("uses text-destructive-text for destructive foreground text", () => {
  const offenders: string[] = [];
  for (const file of walkSourceFiles(rendererRoot)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/text-destructive(?![-\w])|text-\[hsl\(var\(--destructive-text\)\)\]/g))
      offenders.push(`${path.relative(rendererRoot, file)}: ${m[0]}`);
  }
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 3: Run — FAIL (~45 sites: 31 bare `text-destructive` + 14 arbitrary-value).**
- [ ] **Step 4: Mechanical sweep** (the lookahead protects `text-destructive-foreground`):

```bash
cd src/renderer
grep -rlE 'text-destructive([^-a-zA-Z]|$)|text-\[hsl\(var\(--destructive-text' . --include="*.tsx" \
  | xargs perl -pi -e 's/text-\[hsl\(var\(--destructive-text\)\)\]/text-destructive-text/g; s/text-destructive(?![-\w])/text-destructive-text/g'
```

Then `git diff` and eyeball every hunk: the change must only ever be a class-name swap on **text** color (fills like `bg-destructive`, borders, and `text-destructive-foreground` untouched).

- [ ] **Step 5: Test PASS. Both gates. Commit:**

```bash
git add -A && git commit -m "fix(a11y): route destructive text through --destructive-text (7.55:1) (H-7)"
```

---

## Task 8: Muted-alpha floor, placeholders, shimmer, hljs (review H-8, H-9, M-8, M-13)

**Files:**
- Modify: `src/renderer/ui-structure.test.ts`
- Modify: ~25 renderer files (mechanical), `components/ui/input.tsx:12`, `ui/textarea.tsx:12`, `views/home-view.tsx:1063`
- Modify: `src/renderer/styles/globals.css` (`.hljs-comment` ~:1133, `.thinking-shimmer` ~:466)

- [ ] **Step 1: Failing scan test:**

```ts
it("never dims muted-foreground below AA (alpha < 85 banned)", () => {
  const offenders: string[] = [];
  for (const file of walkSourceFiles(rendererRoot)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/text-muted-foreground\/(\d{1,3})/g)) {
      if (Number(m[1]) < 85) offenders.push(`${path.relative(rendererRoot, file)}: ${m[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run — FAIL (~58 sites at /70,/60,/50,/45,/40).**
- [ ] **Step 3: Sweep to the plain token** (the token itself is the muted step — 7.33:1; hierarchy stays via size/weight):

```bash
cd src/renderer
grep -rl "text-muted-foreground/" . --include="*.tsx" \
  | xargs perl -pi -e 's/text-muted-foreground\/(?:[1-7]\d|80)\b/text-muted-foreground/g'
```

`git diff` review: placeholder variants (`placeholder:text-muted-foreground/70` in input.tsx/textarea.tsx, `/45` in home-view.tsx:1063) correctly become the plain token too.

- [ ] **Step 4: Give the home composer a real accessible name** — on the same textarea (home-view.tsx:~1062), add `aria-label={t("home.title")}` (its accessible name currently falls back to the placeholder).
- [ ] **Step 5: globals.css fixes:**
- `.hljs-comment` (~:1133): lightness `48%` → `54%`.
- `.thinking-shimmer` (~:466-479): raise the gradient's dimmest stop from alpha `0.55` to `0.8`, and add a reduced-motion fallback that drops the gradient entirely:

```css
@media (prefers-reduced-motion: reduce) {
  .thinking-shimmer {
    animation: none;
    background: none;
    -webkit-background-clip: initial;
    background-clip: initial;
    -webkit-text-fill-color: currentColor;
    color: hsl(var(--muted-foreground));
  }
}
```

(Adapt property names to the actual shimmer implementation in that block.)

- [ ] **Step 6: Scan test PASS. Both gates. Visual spot-check** (`pnpm --filter @grokdesk/desktop dev`): command palette hints, sidebar counts, timestamps — dimmer metadata should now read clearly, nothing should look *brighter than* primary text.
- [ ] **Step 7: Commit:**

```bash
git add -A && git commit -m "fix(a11y): floor muted text at AA contrast; placeholder, shimmer, hljs fixes (H-8, H-9, M-8, M-13)"
```

---

## Task 9: i18n batch — untranslated strings + parity guard (review H-10, H-11, M-14, M-21, P-8)

**Files:**
- Create: `src/renderer/i18n/locales-parity.test.ts`
- Modify: all 7 locale files
- Modify: `components/license-activation-screen.tsx`, `components/security-update-banner.tsx`, `components/update-restart-dialog.tsx`, `components/runtime-install-step.tsx`
- Modify: `components/task-stream.tsx:884,930,1168-1169`, `components/context-meter.tsx:27,49`, `components/shell/app-sidebar.tsx:462-464,508,531,563-564`, `components/deliverables-digest.tsx:175`, `lib/stream-view.ts:714`

- [ ] **Step 1: Write the guard test** (it will drive the whole task):

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "locales");
const LOCALES = ["de", "es", "fr", "ja", "pt", "zh"];
// Strings legitimately identical across languages (brand/product names, true loanwords).
// Extend ONLY with a comment justifying each entry.
const ALLOW = new Set(["app.name", "topbar.superGrok", "connector.aws-kb.name"]);

function flat(o: Record<string, unknown>, p = ""): [string, unknown][] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, v]],
  );
}
const load = (l: string) =>
  new Map(flat(JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), "utf8"))));
const en = load("en");

describe("locale files", () => {
  for (const l of LOCALES) {
    it(`${l} has exact key parity with en`, () => {
      const m = load(l);
      expect([...en.keys()].filter((k) => !m.has(k))).toEqual([]);
      expect([...m.keys()].filter((k) => !en.has(k))).toEqual([]);
    });
    it(`${l} has no untranslated long strings`, () => {
      const m = load(l);
      const stale = [...en]
        .filter(([k, v]) => typeof v === "string" && v.length > 15 && !ALLOW.has(k) && m.get(k) === v)
        .map(([k]) => k);
      expect(stale).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run — parity PASSES today; the untranslated check FAILS with ~39 keys per locale** (`conversation.*`, `settings.inheritUserGrok*`, `dictation.noMic/busy/entitlementReadOnly`, `workspace.undoUnavailable/summarizeUnavailable`, `home.planFirstToggle`, …). The failure list is the authoritative work list.
- [ ] **Step 3: Translate every flagged key in each locale.** Match the register of the surrounding translations in each file. If a flagged string is genuinely identical cross-language, add it to `ALLOW` with a justification comment. Re-run until green.
- [ ] **Step 4: Convert the four `DEFAULT_LABELS` components to `useT()`** (safe without a provider — `i18n/context.tsx:115-123` has a fallback). Pattern, shown for `license-activation-screen.tsx` and repeated identically for `security-update-banner.tsx`, `update-restart-dialog.tsx`, `runtime-install-step.tsx`:

```tsx
// before: const labels = { ...DEFAULT_LABELS, ...props.labels };
const t = useT();
const labels = { ...defaultLabels(t), ...props.labels }; // labels prop remains a test-only override

function defaultLabels(t: TranslateFn) {
  return {
    title: t("license.activationTitle"),
    /* one key per DEFAULT_LABELS entry; English values move to en.json verbatim */
  } as const;
}
```

Add the new key families (`license.*`, `securityUpdate.*`, `updateRestart.*`, `runtimeInstall.*`) to en.json with the exact current English strings, then to the other 6 locales (the Step-1 test enforces both parity and translation). Existing component tests keep passing because the `labels` prop still overrides.

- [ ] **Step 5: Replace hardcoded renderer strings with keys** (add each key ×7 locales):
- `task-stream.tsx:1168-1169`: `"started"`/`"finished"` → `t("stream.stepStarted")` / `t("stream.stepFinished")`.
- `task-stream.tsx:884,930`: `"Result"` label → `t("stream.toolResult")`.
- `context-meter.tsx:27,49`: the `title` template and the visible "Long conversation — summarize so far?" chip → keys named consistently with the aria-label key already used two lines above (read the file, follow its prefix).
- `shell/app-sidebar.tsx:462-464,508,531,563-564`: `` `${usagePct}% used` `` → the existing `t("settings.usagePercent", { pct })` (usage-meter.tsx:70 shows the call shape); `` `reset ${resetLabel}` `` → new key `"sidebar.usageReset": "reset {when}"`.
- P-8 singular: add `"moreFilesOne": "{n} more file"` next to en.json's `moreFiles` and branch on `n === 1` at `deliverables-digest.tsx:175` and `lib/stream-view.ts:714` (copy the singular/plural branch idiom from `conversation/worker-strip.tsx:33-38`).

- [ ] **Step 6: Full gates + parity test green. Commit:**

```bash
git add -A && git commit -m "fix(i18n): translate stale key batch, localize label-prop components and shell strings, add parity guard (H-10, H-11, M-14, M-21, P-8)"
```

---

## Task 10: Close out the session

- [ ] **Step 1: Mark the review.** In `apps/desktop/POLISH_REVIEW_2026-07-28.md`, append ` — **DONE**` to: C-1, C-3, C-4 (note: "delete shipped; edit deferred, needs schedule.update"), H-7, H-8, H-9, H-10, H-11, H-12, H-16, M-8, M-13, M-14, M-21, M-22, P-8 — plus partial note on H-2 ("config mapping shipped; call-site codemod pending").
- [ ] **Step 2: Full gates across touched packages:**

```bash
pnpm --filter @grokdesk/desktop typecheck && pnpm --filter @grokdesk/desktop test
pnpm --filter @grokdesk/gateway test && pnpm --filter @grokdesk/gateway build
```

- [ ] **Step 3: Launch and eyeball** (`pnpm --filter @grokdesk/desktop dev`): destructive button hover, active tab tint, schedule delete flow, artifacts filter in German (`Einstellungen → Sprache`), muted text readability.
- [ ] **Step 4: Commit the review-file updates:**

```bash
git add apps/desktop/POLISH_REVIEW_2026-07-28.md && git commit -m "docs(polish): mark session-1 findings done"
```

---

## Out of scope for this session (next plans to write)

Each is an independent subsystem and deserves its own plan, in this order:

1. **Session 2 — Design-token enforcement codemod** (H-1 hairline ladder, fill-token trio, M-1/M-2/M-4/M-5 surface+shadow recipes, P-1/P-2/P-3, + scan-test bans). Mechanical but wide; needs the Task 7 config mappings (done here).
2. **Session 3 — Core-loop screen-reader parity** (C-2 combobox pattern, H-5 approval announcements, H-6 streaming log region, M-9 composer focus ring, M-10/M-11 semantics).
3. **Session 4 — Perf architecture** (C-5 state slices + memo, C-6 tick scoping + turn virtualization, H-19 single projection pass, H-21/M-29 visibility-gated timers, H-22 thumbnails, M-28 breathe-amber). Biggest and riskiest; do last, with the review's Strengths section as the template list.
4. **Session 5 — Consistency pass** (H-15 banner unification, H-18 confirm dialogs, M-23 startNewChat, M-26 PageHeader, M-27 dead code, M-34 doc refresh, remaining Polish items).
