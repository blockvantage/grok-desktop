# Slash Commands — Review Findings & Implementation Plan

Scope: the `/` command system in the desktop composer. Findings verified against source
on 2026-07-13. Every item lists file:line evidence and an acceptance check. Mark each
item `DONE` or `SKIPPED (reason)` in place — the review pass diffs this file.

How it works today (verified): `extractSlashQuery` (`src/renderer/lib/composer-input.ts:115`)
detects `/token` at line start; 4 "fill" commands insert template text from `slash.*Goal`
i18n keys, 4 "action" commands open app surfaces (all wired, `App.tsx:1124-1161`). The
goal runs via `tasks.create` → Grok Build CLI (`--model`, `--reasoning-effort`), which
executes its own tools; the gateway harvests workspace files as artifacts afterward.

Verdict driving this round: commands are honestly wired but shallow — they type text
instead of configuring the run, and two commands can silently under-deliver.

---

## Phase 1 — Correctness (broken)

### SC-1: IME composition guard in composer keydowns — [DONE]
- Evidence: `src/renderer/components/views/home-view.tsx:627` onKeyDown has no
  `isComposing` check; same for the follow-up composer keydown in
  `src/renderer/components/views/task-workspace-view.tsx` (~1342). We ship ja/zh locales:
  confirming a CJK composition with Enter sends the goal mid-composition.
- Fix: bail out of keydown handling when `e.nativeEvent.isComposing` is true. Prefer
  extending `composerKeyAction` (`src/renderer/lib/composer-input.ts:15`) to accept
  `isComposing` and return `ignore`, so the rule is a tested pure function; then pass it
  from every composer keydown (home, follow-up, and any other composer using it).
- Accept: unit test — Enter with `isComposing: true` returns `ignore`; both composers
  pass the flag.

### SC-2: /organize must have a folder to organize — [DONE]
- Evidence: `slash.organizeGoal` says "Organize files in this folder", but with no root
  chosen `createTask` sends `workspaceRoots: []` (`App.tsx:655`) and the task runs in an
  auto-provisioned scratch workspace — it "organizes" an empty folder.
- Fix: when `/organize` is applied and `props.root` is empty, call `props.onPickRoot()`
  in addition to filling the goal (picker first, fill regardless; the run picks up the
  root chosen by the time Run is pressed). Do NOT block filling on the picker result.
- Accept: with no folder set, selecting /organize opens the folder picker and the goal
  is filled; with a folder set, behavior unchanged.

---

## Phase 2 — Interaction polish (rough)

### SC-3: Escape should dismiss the menu, not delete typed text — [DONE]
- Evidence: `home-view.tsx:693-702` — Escape removes the typed `/token` from the goal.
  Slack/Linear convention: Escape closes the menu, text stays.
- Fix: add a dismissed state (e.g. keyed on `slashQuery.start` + token) that suppresses
  the menu until the token changes or the composer re-triggers; Escape sets it instead of
  editing text. Mind the mention menu at `home-view.tsx:657-664` — leave its behavior as
  is (its Escape contract was deliberate) unless trivially unifiable.
- Accept: type `/res`, Escape → menu hides, text intact; typing another character
  re-opens with the narrower filter.

### SC-4: No-match state instead of silent vanish — [DONE]
- Evidence: `home-view.tsx:667` — with zero candidates the menu unmounts; `/x` + Enter
  sends "/x" as a literal goal with no signal.
- Fix: when a slash query is active but no command matches, render a single muted,
  non-interactive row in the menu: "No matching command. Enter sends this as text."
  (new i18n key in ALL 7 locales). Keyboard handlers must not swallow keys in this state
  (Enter still sends, Escape dismisses per SC-3).
- Accept: type `/x` → muted hint row shows; Enter sends the literal text.

### SC-5: Arguments after the command token — [DONE]
- Evidence: `composer-input.ts:127` regex rejects anything after the token, so
  "/research quantum computing" closes the menu at the space and the user loses the
  affordance.
- Fix: when the text before the space exactly matches a command token, keep the query
  active with the remainder as `args`; menu shows the matched command with the args
  echoed in the row. On select, weave args into the fill (fill commands only, e.g.
  template + "\n\nTopic: <args>" via a new i18n key; action commands ignore args).
  Extend `extractSlashQuery`/`applySlashCommand` with unit tests for: args capture,
  no-args unchanged, non-matching token with space still closes, line-start file paths
  like /Users/... still never match commands mid-typing.
- Accept: "/research grok pricing" + Enter fills the research template including the
  topic; all existing composer-input tests still pass.

### SC-6: /research escalates effort (first command that configures the run) — [DONE]
- Evidence: the composer already owns `effort`/`onEffort` (fast/normal/heavy select in
  the run-options popover, `home-view.tsx:909-928`) mapping to the engine's real
  `--reasoning-effort` flag. "Deep research with sources" currently runs at default
  effort like everything else.
- Fix: add optional `effort?: EffortLevel` to `SlashCommand`; `/research` sets `heavy`
  via `props.onEffort` when applied. The change must be visible to the user (the
  run-options trigger already reflects effort — verify it does; if not, surface a small
  chip). Do not silently reset after the run — the user keeps control.
- Accept: selecting /research flips the effort control to Heavy visibly; the created
  task carries `effort: "heavy"`.

---

## Phase 3 — Parity & dedup

### SC-7: One source of truth for goal templates — [DONE]
- Evidence: smart-start goals (`home.idea*Goal`) and slash fills (`slash.*Goal`) are
  near-duplicates and already drifting — `home.ideaResearchGoal` ends "save notes under
  ./artifacts.", `slash.researchGoal` doesn't (en.json:119-132 vs 1179-1201).
- Fix: make smart starts and slash commands share one template per intent (pick the
  better wording per pair; research should keep the ./artifacts clause). Whatever keys
  are removed/renamed must be applied to ALL 7 locale files — the i18n parity tests will
  catch misses.
- Accept: no duplicated goal template text between the two namespaces; parity tests
  green in all 7 locales.

### SC-8: Slash commands in the follow-up composer — [DONE]
- Evidence: `task-workspace-view.tsx` follow-up composer supports @-mentions but no
  slash commands (no imports of the slash helpers).
- Fix: wire `extractSlashQuery`/`filterSlashCommands`/`SlashCommandMenu` into the
  follow-up composer. Fill commands make sense mid-task; action commands too (they open
  global surfaces) — pass the same handlers down or accept a reduced command list if a
  handler genuinely isn't reachable there (document which and why in the mark).
  Include the SC-1 IME guard and SC-3/4/5 behaviors so the two composers stay identical.
- Accept: typing "/" in a task follow-up shows the same menu with working selection.

### SC-9: Tests for the interaction layer — [DONE]
- Evidence: `composer-input.test.ts` covers the pure functions only; nothing covers
  menu keyboard flow, dismissal, args, or IME.
- Fix: unit-test everything added this round at the pure-function level (args parsing,
  dismissal-state helper if extracted, composerKeyAction isComposing). Component-level
  tests only if the repo already has a pattern for them — do not introduce a new testing
  framework for this.
- Accept: new behaviors have failing-first tests; desktop suite grows accordingly.

---

## Phase 4 — Capability truth (decide, then copy or wire)

### SC-10: /image promise must be true — [DONE]
- Evidence: the app has zero image tooling. The whole /image path is: preamble asks Grok
  to save media files (`packages/engine-grok/src/session.ts:163`) + artifact harvest
  classifies media (`packages/gateway/src/services/runner.ts:812-818`). Whether an image
  ever appears depends entirely on the installed Grok Build CLI's own tools.
- Fix: run one live smoke: create a task with the /image fill against the real CLI and
  check a media artifact lands. If YES: mark done, no change. If NO: soften
  `slash.image`/`slash.imageDesc`/`slash.imageGoal` copy in all 7 locales to promise a
  "visual concept / spec" instead of a generated image, and note the finding here for a
  future bundled image MCP. Do not leave copy that promises what the engine cannot do.
- Accept: the command's description matches observed behavior on a real run.
- Live smoke (2026-07-13): `grok -p` with `slash.imageGoal` against real CLI wrote
  `artifacts/product-hero.jpg` + `caption.txt`. Copy left unchanged.

---

## Phase 5 — /video (capability proven, add the surface)

### SC-11: /video generates a short teaser video — [DONE]
- Evidence (capability smoke, 2026-07-13, PASSED): real Grok CLI 0.2.99 has built-in
  `image_to_video` / `reference_to_video` tools; `grok -p` with a video goal wrote
  `artifacts/desktop-ai-assistant-teaser.mp4` (~5.1s, 720p, real ISO MP4, 1.5MB) plus a
  caption.txt in ~1-2 minutes (image-first: keyframe, then animate). The delivery
  pipeline already ships: harvest classifies mp4/webm/mov as media
  (`packages/gateway/src/services/runner.ts:812-818`), chat embeds `<video controls>`
  inline (CSP `media-src` fixed, 64MB asset bridge), Deliverables previews with the
  Film icon. Generation does NOT need re-verification — only the new surface does.
- Fix: add ONE entry to `SLASH_COMMANDS` (`src/renderer/lib/composer-input.ts`) after
  `image`: id/token `video`, kind `fill`, `goalKey: "slash.videoGoal"`. Add
  `slash.video` / `slash.videoDesc` / `slash.videoGoal` to ALL 7 locales. The desc must
  set the time expectation (e.g. "Cinematic teaser video (takes a minute or two)").
  Goal template mirrors imageGoal and uses the smoke-proven phrasing: "Generate a short
  polished teaser video for this project and save it under ./artifacts as an mp4, with
  a short caption file." No component work — both composers' menus, no-match, dismiss,
  and args weaving pick the new command up automatically from the data.
- Accept: `/video` shows in the home AND follow-up menus; selecting fills the goal;
  "/video <topic>" keeps the menu open and weaves the Topic line (args mode requires
  the exact token, so this works only once the entry exists — add a unit test for it);
  7-locale parity tests green; desktop suite does not shrink from 283.

---

## Hard gotchas (read before coding)

- SlashCommandMenu was just fixed twice (commits 1aa053a, 19416fd): floating surfaces
  must stay fully opaque `bg-[hsl(var(--surface-3))]` with NO backdrop-blur (vibrancy
  window breaks backdrop-filter compositing), and the menu height-clamps to the space
  above the composer with scroll-edge fades. Preserve both behaviors in any edit.
- `ui-structure.test.ts` asserts App.tsx contains no em-dash characters — keep them out
  of App.tsx.
- i18n: 7-locale parity tests (en/de/es/fr/ja/pt/zh) — every key add/remove/rename hits
  all 7 files.
- `tsconfig.web.json` pins react types via paths — do not remove; avoid dependency
  installs. If pnpm-lock.yaml changes anyway, re-run mobile + gateway + shared gates too
  (gateway tests require Node 20).
- Renderer-only round: nothing here should touch packages/gateway or engine-grok except
  reading them.

## Gates (all must pass before each commit)

```
pnpm --filter @grokdesk/desktop typecheck
pnpm --filter @grokdesk/desktop test      # 283 passing after SC-1..SC-10; must not shrink
pnpm --filter @grokdesk/desktop build
```

Commit per phase with conventional-commit messages. When finished, update every item
mark in this file, then report: commit hashes, gate outputs, and any SKIPPED items with
reasons.
