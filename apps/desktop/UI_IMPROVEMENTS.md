# Grok Desk — UI Radical Critique & Fix Plan

Second-round review, 2026-07-13, focused purely on UI/UX quality (the functional
pass lives in `IMPROVEMENTS.md`). Method: four parallel deep-read critiques
(design-system foundation **DS**, shell/Home **SH**, chat surface **CH**,
secondary surfaces **SC**), each finding anchored to `file:line`. The sharpest
claims (DS-1, DS-5, DS-6, DS-9, CH-1, SC-2, SC-8, SH-5) were re-verified
line-by-line before this doc was written — they are all true in source.

**The one-paragraph verdict:** the token/surface foundation, `.typeset` prose,
toasts, and the Home composer are genuinely premium — and then the system stops
being enforced. Dialogs/sheets/popovers ship as byte-for-byte stock shadcn on the
*darkest* token (inverting the tonal ladder), ~100 raw emerald/amber utilities
bypass the semantic tokens, 17 distinct font sizes render with no scale, the
workspace composer is a single-line `<input>` that cannot hold a paragraph, the
approval banner never says what is being approved, Home has re-inflated into an
8-block dashboard, and settings is five tabs speaking four layout languages.
The fix is not more design — it is making the existing design system mandatory.

**Bar:** DESIGN.md (Linear precision, Raycast chrome, HIG density, Deep Navy + Ice
brand — scarce ice primary, tonal elevation, CSS-only motion). Constraint everywhere
below: no new dependencies (one *removal* is proposed: `motion`).

Severity: **Critical** = actively contradicts the product bar or shows wrong
data · **High** = visibly cheap/confusing on a primary path · **Medium** =
inconsistency users feel but can't name · **Polish** = last-mile.

---

## 1. Foundation / design system (DS)

### DS-1. Overlay fleet is stock shadcn — the tonal ladder inverts at its top [Critical] [verified] **DONE**
`ui/dialog.tsx:22,39,45,89`, `ui/alert-dialog.tsx:19,37,80`, `ui/sheet.tsx:22,32,65,109`,
`ui/popover.tsx:22`, `ui/hover-card.tsx:19`, `ui/dropdown-menu.tsx:48` (SubContent only).
Modals paint `bg-background` (the darkest token) with stock `shadow-lg`, `bg-black/80`
overlay (registry double-space typo intact), `text-lg` titles, stock close-ring, and
`sm:` responsive prefixes in a fixed-size desktop window. The floating layer is darker
than the cards below it.
**Fix:** one re-skin pass across all five: overlay `bg-black/60 backdrop-blur-[2px]`;
content `rounded-2xl border-white/10 bg-[hsl(var(--surface-3)/0.97)] backdrop-blur-xl`
+ inset top hairline + deep ambient shadow; titles `text-[15px] font-semibold
tracking-tight`; drop every `sm:` prefix; close buttons inherit the global focus ring.
Align dropdown SubContent with the already-owned Content (line 66).

### DS-2. Semantic status tokens defined, bypassed ~100× [Critical] **DONE**
`globals.css:51-52` defines desaturated `--success`/`--warning`; usage tally:
`text-success` 3, `bg-success`/`*-warning` **0** — versus 100+ raw `emerald-400`
(hsl 158 64% 52%) / `amber-400` (43 96% 56%) utilities, i.e. the exact neon-on-dark
vibration DESIGN.md rule 4 forbids, in permanent chrome (`app-topbar.tsx:76-79`,
`home-view.tsx:1208`, `browser-pane-slot.tsx:137` — three different glow recipes for
the same dot). `tooltip.tsx:18` uses `bg-zinc-900/95` off-ladder. (SC-13 is the same
disease in settings: 28 sites + a stray `sky-400`.)
**Fix:** sweep every status color to `text-success`/`text-warning`/`bg-*` variants
(add `--info` only if the sky/violet cases survive triage); ONE `.dot-status` recipe
(size + `0 0 8px currentColor` glow); tooltip → `bg-[hsl(var(--surface-3)/0.95)]`.

### DS-3. No type scale: 20 class variants, ~17 rendered sizes [High] **DONE**
Tally: `86× text-[11px]`, `72× text-xs`, `55× text-sm`, `41× text-[13px]`,
`41× text-[12px]`, `30× text-[12.5px]`, `27× text-[10px]`, `13× text-[13.5px]`, plus
10.5/11.5/14/14.5/15/15.5/16/17px one-offs. `button.tsx:7` is 13px while
`input.tsx:10`/`select.tsx:17` are `text-sm` (14px) — a form row's button and input
render different sizes.
**Fix:** tokenize `fontSize` in `tailwind.config.js` (`2xs:11, xs:12, sm:13,
base:13.5, md:15, lg:17, xl:20, 2xl:24`), migrate all `text-[Npx]` to nearest token,
set inputs/select to 13px to match Button. Mechanical sweep; do it early so later
phases write against the scale.

### DS-4. Seven focus-ring treatments; the typed-in ring is a 20%-alpha ghost [High] **DONE**
Global `:focus-visible` double-ring at `globals.css:166-171` is correct — then
`input.tsx:13` (`ring-primary/20`), `textarea.tsx:13` (`/15`), `select.tsx:17`
(plain `focus:` — flashes on mouse click), `tabs.tsx:30`, `switch.tsx:12`,
`dialog.tsx:45`/`sheet.tsx:65` (stock), `badge.tsx:6` (ring on a non-focusable div)
all override it differently.
**Fix:** delete every per-component ring utility and let the global rule own focus.
Inputs keep only a `focus-visible:border-primary/40` border shift; select moves to
`focus-visible:`; strip badge's ring.

### DS-5. `animate-ui` icons: ~3,000 lines + `motion` runtime for 14 hover wiggles [High] [verified] **DONE**
`animate-ui/icons/icon.tsx:12` imports `motion/react` (`package.json` dep), 23 files /
2,982 lines consumed by exactly 3 files; 7 of 21 icons imported nowhere (`bell`, `bot`,
`chevron-down`, `list`, `play`, `sparkles`, `x`). DESIGN.md says "Motion: CSS only";
motion/react writes inline styles the reduced-motion kill-switch cannot stop.
**Fix:** delete the 7 dead icon files immediately; replace the remaining hover wiggles
with Lucide + CSS (`transition-transform`, `group-hover:rotate-90`, etc.); remove the
`motion` dependency (lockfile update; verify nothing else imports it). This is the
review's only dependency change and it's a deletion.

### DS-6. Grain overlay paints OVER every dialog and menu [High] [verified] **DONE**
`globals.css:124` — `body::after { z-index: 50; mix-blend-mode: overlay }`. Radix
portals are z-50 children of body, so the noise film sits on top of every
modal/dropdown/select; toasts (z-100) and palette (z-120) escape, so grain is
inconsistent across floating layers. POLISH-PLAN 4.6 flagged this and was never done.
**Fix:** `z-index: 1`. One line.

### DS-7. `rounded-lg` and `rounded-xl` render the identical 12px [Medium] **DONE**
`tailwind.config.js:51-55` maps only lg/md/sm (12/10/8); default `xl` = 12px too.
53× `rounded-xl` vs 50× `rounded-lg` — a hundred callsites split between two names
for one value, plus hand-typed `rounded-[15px]` (`home-view.tsx:575`), `rounded-[2px]`
(`scheduled-view.tsx:226`).
**Fix:** config `xl: calc(var(--radius)+4px)` (16px), `2xl: +8px`; re-audit the 53
`rounded-xl` uses; replace the bracket radii.

### DS-8. Three spinner implementations; Skeleton used in 2 files [Medium] **DONE**
`Loader2` ×10, hand-rolled border-spinner in `dictation-button.tsx:63`, a *different*
hand-rolled one in `tools-tab.tsx:298`, `animate-pulse` box QR placeholder
(`remote-tab.tsx:664`), plain-text loading (`artifacts-view.tsx:93,171`), and nothing
at all (permissions initial fetch). (Same finding as SC-10 from the settings side.)
**Fix:** one `<Spinner size>` primitive (`border-2 border-primary/25 border-t-primary`,
`ease-linear`); rule: Skeleton for layout-known regions, Spinner for in-button/inline
pending. Replace all bespoke sites.

### DS-9. Dead flagship CSS — the "shipped" radar-ping dot has zero users [Medium] [verified] **DONE**
`.dot-live` + `dot-ping` (`globals.css:371-393`): 0 usages — live dots still use the
`animate-pulse` hard blink the plan claims was replaced (`desktop-control-hud.tsx:38`,
`browser-pane-slot.tsx:135`). Also dead: `.gap-grid`/`.p-grid`/`.text-pretty`/
`.field-hint`/`.field-error`; `markdown.tsx:59` applies `md-task-check` which no rule
defines; the whole `::-webkit-scrollbar` block (`globals.css:141-158`) is inert because
`scrollbar-width` on `*` disables webkit pseudo-styling in Chromium 121+.
**Fix:** wire `.dot-live` onto the status dots (fold into the DS-2 `.dot-status`
recipe); delete the dead utilities + webkit block; define or drop `md-task-check`.

### DS-10. Motion tokens exist; ~140 transitions ride the stock curve [Medium] **DONE**
`ease-premium` used 10× vs 139 bare `transition*` on Tailwind's factory cubic-bezier;
no `transitionDuration` extension exists (the plan's 120/180/240/400 ramp was never
added); `sheet.tsx:32` animates at stock 500ms — the slowest motion in the app is an
unmodified default.
**Fix:** config `transitionTimingFunction.DEFAULT = cubic-bezier(0.16,1,0.3,1)` so
every bare `transition-*` inherits the premium curve for free; add the duration ramp;
sheet → 280ms open / 200ms close.

### DS-11. Contrast failures — all from alpha-slashing a passing token [Medium] **DONE**
`--muted-foreground` itself is 7.36:1; then `input.tsx:12` placeholder `/55` → 2.99:1,
`textarea.tsx:12` `/50` → 2.67:1, `toast.tsx:190` dismiss `/60` → 3.12:1 (interactive),
`table.tsx:76` header `/75` at 11px → 4.46:1. `--destructive` as *text*
(`alert.tsx:13`) → 3.68:1.
**Fix:** floor placeholders at `/70`; toast dismiss `/80`; table head `/85`; add
`--destructive-text: 0 55% 64%` for text uses.

### DS-12. 125+ instances of sub-12px text, floor 10px [Medium] **DONE**
`27× text-[10px]` (incl. `.kbd` and tooltip kbd), `5× 10.5px` (`.code-block-lang`),
`86× 11px`, `7× 11.5px` — against DESIGN.md's "~13px body floor".
**Fix:** hard floor 11px app-wide (folds into the DS-3 sweep: `2xs` = 11px is the
smallest token); kbd + code-lang labels → 11px.

### DS-13. The signature top-hairline is re-typed with six different alphas [Polish] **DONE**
`inset 0 1px 0 0 rgba(255,255,255,α)` at α ∈ {.03,.035,.04,.05,.14,.2} across
`button/card/tabs/select/task-stream`; `button.tsx` previously hardcoded hover HSL so
re-tuning `--primary` desynced it (now uses ice `--primary-hover` token).
**Fix:** `boxShadow` tokens (`hairline-top`, `ambient-sm/md/lg`, `primary-glow`);
button hover → `--primary-hover` token.

### DS-14. Two scrollbar systems with mismatched thumbs [Polish] **DONE**
Native `scrollbar-color` thumb ≈ white/19; ScrollArea thumb `bg-white/15 hover:25` at
different width.
**Fix:** one `--scroll-thumb` token used by both; matched widths.

### DS-15. SelectItem vs DropdownMenuItem: two row recipes for one menu concept [Polish] **DONE**
`select.tsx:116` (`rounded-sm text-sm focus:bg-accent`, stock) vs `dropdown-menu.tsx:85`
(`rounded-lg text-[13px] focus:bg-white/[0.06]`, owned); checkbox/radio items still stock.
**Fix:** standardize all menu rows on the owned dropdown recipe.

---

## 2. Chat surface (CH) — the heart of the app

### CH-1. The composer is a single-line `<input>` [Critical] [verified] **DONE**
`task-workspace-view.tsx:1286` renders `<Input>` (`ui/input.tsx` = native single-line
input). No Shift+Enter branch exists; `workspace.enterHint` ("Enter to send") is
defined in en.json and rendered **nowhere**; the hint that does ship is
`workspace.followUpHint` = "Continues in the same folder as a new task" (folder
plumbing as the only guidance). A message longer than ~70 chars scrolls horizontally
in a 36px strip; a newline is physically impossible.
**Fix:** auto-growing `<textarea rows=1>` (max ~8 rows via scrollHeight effect) inside
the existing `vt-compose glow-ring` shell; Enter sends, Shift+Enter newlines; show the
`enterHint` kbd affordance on focus; delete `followUpHint`. Match the Home composer's
behavior so both composers feel like one object.

### CH-2. The approval moment never says WHAT is being approved [High] **DONE**
`task-workspace-view.tsx:878-928`: an amber strip with `workspace.approvalNeeded` +
free-text `reason` (renders an empty `<p>` when absent) — no tool name, no command, no
path. The same approval renders three times (strip + in-stream card at
`task-stream.tsx:754-767` + header StatusPill) with an infinite `breathe-amber` pulse,
and Approve is `size="sm"`, the same weight as Send.
**Fix:** the in-stream card becomes the single decision surface: add tool/command/path
from the event payload in a `font-mono` line (reuse the ToolActionRow detail pattern);
Approve at default size, Reject as ghost; the top strip shrinks to one line —
"Waiting for your approval · Jump to request".

### CH-3. Send silently becomes "enqueue" mid-run; no stop at the composer [High] **DONE**
`task-workspace-view.tsx:1177-1185`: while live, Enter diverts the message into the
queue with no button change and no confirmation (placeholder copy is the only cue).
Stop requires the header Pause icon or overflow menu — the opposite corner. Escape
does nothing (except dismiss mentions).
**Fix:** while live, morph the send button into a stop button (wired to `onCancel`) —
the industry-standard affordance; Enter still queues but gets an inline "Queued — sends
when Grok is free" confirmation (existing toast primitive); Escape in the composer
stops the run.

### CH-4. Up to four simultaneous "working" animations [High] **DONE**
`task-stream.tsx:183` renders `WorkingIndicator` (shimmer + bouncing dots + pulsing
avatar ring) *below* a live `ThinkingTrail` (its own dots), while a running
`ToolActionRow` spins a `Loader2` and the header pulses a StatusPill. Lines 185-192
acknowledge the overlap by relabeling instead of removing it.
**Fix:** exactly one live signal in the stream: suppress `WorkingIndicator` whenever
live progress or a running tool row is already the last item; the header pill is the
only chrome-level status.

### CH-5. Entrance animation replays on every remount [High] **DONE**
`.chat-msg-in` (0.34s) is baked into every row type; the virtualizer
(`overscan: 8`, `task-stream.tsx:341-346`) unmounts/remounts rows, so scrolling up
makes year-old messages "arrive"; toggling density replays the whole thread.
**Fix:** gate `chat-msg-in` on genuinely-new items only (capture `lastSeenSeq` in a
ref on mount; animate `seq >` that, and only while the task is active).

### CH-6. Uniform 20px card-stack rhythm, zero timestamps [Medium] **DONE**
One `gap-5` between every item kind (`task-stream.tsx:417`); tool rows, trails, and
artifact cards are all bordered boxes, so a 5-tool turn reads as six equal cards.
No turn shows a time; the only time on the surface is header `relativeTime`.
**Fix:** group consecutive tool/progress items of one turn into a shared gutter
container with tight internal spacing (`gap-2`); hover-revealed relative timestamp in
the existing 11px muted style on assistant label and user bubble.

### CH-7. "Jump to latest" floats at `bottom-24` over the queue's buttons [Medium] **DONE**
`task-workspace-view.tsx:960-969` assumes a ~96px footer; with queue rows + "What
next?" chips + recovery banner the footer grows 200-300px and the z-10 pill overlaps
interactive queue controls.
**Fix:** position it inside the scroll area (or derive `bottom` from measured footer
height) so it always hovers just above the composer.

### CH-8. Question chips: double-fire, discarded prompt, drifting tokens [Medium] **DONE**
`task-stream.tsx:290-299`: chips have no disabled/busy state (`followUpBusy` never
reaches TaskStream) — double-click sends two turns; `user-question.ts` extracts the
question `prompt` and the render throws it away for a generic "Choose one"; chip
classes drift from the adjacent "What next?" chips (border alpha, hover color); both
rows can compete simultaneously.
**Fix:** pass `followUpBusy` down; disable + `Loader2` the clicked chip; render the
extracted prompt as the header; one shared chip class; suppress "What next?" while a
question is pending.

### CH-9. Chat code blocks have no max-height [Medium] **DONE**
`.code-block pre` (`globals.css:984-990`) — a 400-line file dump renders ~10,000px
between two sentences. Tool output already learned this (`max-h-64`,
`task-stream.tsx:1024`).
**Fix:** `max-height: 28rem; overflow-y: auto` on `.code-block pre` + an expand
affordance in `.code-block-head` beside Copy.

### CH-10. Empty/waiting/failed states speak engine-ese [Medium] **DONE**
en.json: "Events will stream here as the agent plans and acts." / "No stream events
yet." / "This task has no stored stream events." — telemetry vocabulary as the first
thing a user reads in a new chat.
**Fix:** rewrite the four `EmptyStreamState` strings in product voice ("Grok is
getting started — replies will appear here."). All 7 locales + proseKeys.

### CH-11. The right rail sells policy telemetry, not deliverables [Medium] **DONE**
`task-workspace-view.tsx:1562-1610`: approval-mode + shell-policy badges + a
Created/Updated `<dl>` render permanently; image deliverables get a 36px thumbnail
after the code itself comments "the payoff shouldn't be a text row".
**Fix:** collapse policy badges + timestamps into one quiet meta line (or overflow
info); image deliverables get full-width `aspect-video object-cover` thumbs (data is
already fetched).

### CH-12. The streaming caret blinks on its own line below the text [Medium] **DONE**
`task-stream.tsx:700` puts `.stream-caret::after` on the wrapper div whose last child
is the block-level `.typeset` — the caret never trails the last character, on every
streamed reply.
**Fix:** move it into the flow: `.stream-caret .typeset > :last-child::after` with the
same keyframes.

### CH-13. Ten header controls, one duplicated [Medium] **DONE**
`task-workspace-view.tsx:742-874`: density trio + HUD + globe + pause + overflow +
a standalone rail toggle that duplicates the overflow's rail entry.
**Fix:** drop the standalone rail toggle; visible set = back/title/status + Pause +
overflow; density trio compacts (Work log is a debug view, not equal billing).

### CH-14. User bubble and assistant turn disagree on type scale [Polish] **DONE**
User `text-[14px]` vs typeset 14.5px; bubble `max-w-[85%]` in a 46rem column is
near-full-width; "Grok" label + avatars re-render on every turn.
**Fix:** same size both voices (via DS-3 tokens); bubble `max-w-[70%]`; author label/
avatar only when the previous item is a different author.

### CH-15. Preview Sheet: magic margins dodge the primitive's X [Polish] **DONE**
`task-workspace-view.tsx:1620-1638`: `mr-6`/`pr-6` compensate for the Sheet's absolute
close button; body height is a hard-coded `calc(100vh-3.5rem)`.
**Fix:** flex column layout (`SheetContent flex h-full flex-col`, header `shrink-0`,
body `flex-1 min-h-0`); delete the calc and compensation margins. (Lands naturally
with the DS-1 sheet re-skin.)

---

## 3. Shell & Home (SH)

### SH-1. Home is an 8-block dashboard again [High] **DONE**
`home-view.tsx` default state: notices (≤2) + 2.5rem greeting + composer + smart
starts ×4 + recent tasks ×6 + pinned memories + rail Workspace card + rail Activity
card — ~17 interactive surfaces, with the primary action starting ~40% down the
screen on a busy day.
**Fix:** Home = hero + composer + smart starts + recent chats (3 rows). Kill Pinned
memories on Home (Memory nav + `/memory` cover it); greeting drops to ~1.75rem so the
composer is the anchor. See SH-2/SH-3 for the rail cards.

### SH-2. "Running" renders up to five ways on one screen [High] **DONE**
Greeting fact + amber banner + rail Activity row + sidebar status dot/label + engine
dot (`greeting.ts:65-71`, `home-view.tsx:476-516,1192`, `app-sidebar.tsx:641-645`).
Same duplication for folder (chip + rail card) and sign-in (rail + footer + topbar).
**Fix:** the amber banner is the canonical Home "running" surface — delete the rail
Activity card's inProgress row and the greeting's live-stat facts (keep time-of-day
salutes; drop evergreen ad-copy lines for signed-in users with ≥1 task).

### SH-3. Three folder pickers + a slash command mutate one `root` [High] **DONE**
Composer chip (`home-view.tsx:729-762`) + toolbar FolderOpen (839-857) + rail card
buttons (1164-1181) + `/folder`.
**Fix:** the composer chip is THE folder control; rail Workspace card reduces to
read-only path + Reveal in Finder or dies entirely.

### SH-4. First-run: "Rise and shine, there" over two empty shells and 0/0/0 [High] **DONE**
`greeting.ts:52-54` falls back to "there"; below it an empty Recent tasks, a Pinned
memories header whose only content is an Add button, and an Activity card animating
0/0/0 with "Sign in required".
**Fix:** when `tasks.length === 0`, suppress Recent/Pinned/Activity entirely; drop the
name clause when unresolved ("Good morning." full stop). The Chats view empty state is
already the model.

### SH-5. Chat search still lives in three places [High] [verified] **DONE**
Topbar input (`app-topbar.tsx:52`) + sidebar input (`app-sidebar.tsx:289`) + palette
(`command-palette.tsx:93`), plus a second magnifier icon in the topbar that opens the
palette — two magnifying glasses 300px apart. (P4 was marked DONE; this survives it.)
**Fix:** kill the sidebar search (folder groups + "See all" route to Chats where
topbar search works); the topbar palette button gets the ⌘K glyph, not a magnifier.

### SH-6. The same object is a "chat", a "task", and a "run" [Medium] **DONE**
en.json: `nav.tasks: "Chats"` vs `home.recentTasks: "Recent tasks"`,
`toast.taskComplete: "Run complete"`, `inbox.openTask: "Open task"`; the palette shows
"New chat" directly above a "Recent tasks" group heading.
**Fix:** one rule — the container is a **chat**, one execution is a **run**, "task"
dies in user-facing copy. Sweep en.json + 6 locales. (Careful: `ui-structure.test.ts`
literals live in App.tsx code, not locale files.)

### SH-7. The palette is not a superset: Inbox has no entry and no shortcut [Medium] **DONE**
`command-palette.tsx` has no inbox item; global keys (`App.tsx:491-559`) bind only
⌘N, ⌘., Esc, `/`. The surface holding approvals — the thing that blocks the agent —
is the only shell surface a keyboard user cannot summon.
**Fix:** palette "Open Inbox" row with unread count; bind ⌘⇧I; add ⌘1-⌘6 for the
`NAV_IDS` order while there.

### SH-8. Hover-revealed row controls are invisible to keyboard focus [Medium] **DONE**
`app-sidebar.tsx:661,680`: stop + options buttons are `opacity-0 group-hover:opacity-100`
with no `focus-visible:opacity-100` — Tab lands on invisible buttons.
**Fix:** add `focus-visible:opacity-100` (+ `focus-within` on the row).

### SH-9. "Quick chats" folder chrome renders for a taxonomy of one [Medium] **DONE**
Every group gets a draggable header with grip + count (`app-sidebar.tsx:342-366`) even
when only the managed `__chat__` bucket exists; the reorder grip is opacity-0 with a
native `title` tooltip as its only hint.
**Fix:** render folder headers only when `folders.length > 1`; grip at low opacity
(not 0) + the Tooltip primitive.

### SH-10. Smart starts: three interaction modes and a toast for a visible effect [Medium] **DONE**
Click fills + fires a success toast ("Ready — press Enter to run"); double-click runs;
the "continue" card navigates instead (`home-view.tsx:1017-1031`).
**Fix:** one behavior — click fills and focuses (the caret in a filled composer IS the
feedback; delete the toast); drop onDoubleClick; "continue" moves to the Recent chats
header area as a distinct row.

### SH-11. Account/settings chrome ×5; the topbar only exists off-Home [Medium] **DONE**
Topbar status dropdown + standalone settings icon + sidebar footer dropdown + Home
rail sign-in row + palette entries; the topbar itself unmounts on Home
(`App.tsx:1045-1072`) so shell chrome pops per view.
**Fix:** sidebar footer is the account surface — delete the topbar status dropdown +
settings icon (keep search + ⌘K); delete the rail sign-in row (the shell reauth
banner owns that state).

### SH-12. Two card systems on one screen [Medium] **DONE**
Rail cards use tokenized `.surface-quiet`; left-column cards hand-roll
`border-white/[0.06] bg-white/[0.02]` (`home-view.tsx:1032,1062,1108`); section gaps
drift (mt-9 vs mt-11); Home alone spans six one-off caption sizes.
**Fix:** replace hand-rolled recipes with `.surface-quiet`; one section gap; caption
sizes collapse via DS-3.

### SH-13. Sidebar marquee-on-hover is a gimmick [Polish] **DONE**
`MarqueeText` infinitely rolls clipped titles on row hover (`app-sidebar.tsx:753-795`)
while every other truncated title in the shell uses a plain ellipsis; hovering down a
list sets multiple titles wiggling.
**Fix:** ellipsis at rest + Tooltip with the full title. Delete the marquee CSS.

### SH-14. Plumbing jargon in shell-level copy [Polish] **DONE**
"Local engine stopped — relaunch the app" / "CLI missing" / "blind relay… opaque
blobs" / "Managed workspace".
**Fix:** product voice: "Grok Desk lost its connection — relaunch the app to
continue." / "Grok isn't installed correctly" / relay mechanics move to a hint line /
"Private chat folder". All 7 locales.

### SH-15. Dead Home copy and double entrance [Polish] **DONE**
Nine orphaned `home.*` keys (`todayGlance`, `agentStatus`, `allOperational`,
`ideasToTry`, `filledSmartStart`, `goToTasks`, `start`, `deliverables`, `emptyRecent`);
`needsYou` slices 3 but renders `[0]!` only; Home plays `animate-fade-in` inside the
root view-transition crossfade — the only view that fades twice.
**Fix:** delete the nine keys across locales; slice(0,1) or render the rows; drop the
inner fade.

---

## 4. Settings & secondary surfaces (SC)

### SC-1. Five settings tabs, four layout languages, zero shared row primitive [Critical] **DONE**
`PrefRow` is display-only; Permissions rows use `border-border/60 bg-card/40` +
Switch; Remote invents `border-white/[0.06] bg-white/[0.02]` panels with raw
`<label>`s; Preferences/License/Tools use Card+CardHeader; the Advanced tab stacks
two languages back-to-back (`settings-view.tsx:548-565`). Heading scale collapses
(CardTitle 16px vs bare h3 14px).
**Fix:** ONE `SettingsRow` (label+description left, control right, tokenized
container) + ONE `SettingsSection` header; migrate Permissions and Remote onto them;
ban `white/[0.06]` borders in settings.

### SC-2. Tools save feedback renders into a `hidden` div [Critical] [verified] **DONE**
`connectorMsg` renders only inside the gallery panel (`tools-tab.tsx:281-294`) which
is `hidden` when `surface !== "gallery"` (`tools-tab.tsx:219`) — but
`showConnectorOk` fires from Installed-surface actions (`settings-view.tsx:507,521,536`).
Toggling an MCP server produces zero visible confirmation. Meanwhile errors show
inline text AND a toast simultaneously; Remote is toast-only; Preferences gives
nothing.
**Fix:** delete the inline strip; ONE rule for all five tabs — quiet success toast,
destructive toast for errors.

### SC-3. Remote tab can storm unbounded destructive toasts [High] **DONE**
Probe loop re-runs every 2.5s while enabled-but-disconnected
(`remote-tab.tsx:176-207`) and `refresh()` toasts on every failure (75-83);
`ToastProvider` appends without cap (`toast.tsx:81`).
**Fix:** toast the failure once (`hasToastedRef`), ongoing failure lives in the amber
StatusChip; add a provider cap (~4) + de-dupe on identical description.

### SC-4. Six remote toasts duplicate title as description, verbatim [High] **DONE**
`toast({ title: X, description: X })` at `remote-tab.tsx:276,298,367,387,402,419` —
renders "Remote access enabled / Remote access enabled".
**Fix:** description-only (the toast handles title-less layout).

### SC-5. Preferences is mostly fake settings [High] **DONE**
"Workspace behavior" = four read-only PrefRows styled exactly like controls
(`preferences-tab.tsx:70-85`); "Security & privacy" is a Card with a header and NO
content (89-99); Tools repeats it ("Local permissions", `tools-tab.tsx:826-845`).
**Fix:** make Default approval a real Select (the mode exists); restyle informational
rows as explicit muted text without row chrome; merge the Security paragraph into
Account's privacy panel.

### SC-6. Destructive friction is inverted; Delete rendered as the primary CTA [High] **DONE**
Revoking a paired phone = zero confirmation (`remote-tab.tsx:816-826`); deleting one
memory note = full AlertDialog whose confirm is `AlertDialogAction` = default primary
(`alert-dialog.tsx:105`, no className at `memory-view.tsx:318-322`).
**Fix:** AlertDialog on Revoke (copy the permissions-tab pattern); destructive-variant
styling on every destructive `AlertDialogAction` app-wide (fix the primitive to accept
a variant).

### SC-7. "Add custom" instantly commits a prefilled /tmp filesystem server [High] **DONE**
`tools-tab.tsx:623-630` calls `onAddMcp()` directly with draft state pre-seeded to
`npx -y @modelcontextprotocol/server-filesystem /tmp` (`settings-view.tsx:74-78`);
the always-visible form is a bare "Id / Command / Args" grid.
**Fix:** "Add custom" opens a Dialog (the tools tab already owns the detail-Dialog
pattern); empty defaults; fields "Name / Command / Arguments".

### SC-8. Every Artifacts card shows the SELECTED artifact's task badge [High] [verified] **DONE**
`task` derives from `selected` (`artifacts-view.tsx:228-230`) and is reused inside the
grid map for every card (365-373) — visible wrong data on the flagship utility view.
**Fix:** resolve `props.tasks.find(t => t.id === a.taskId)` per card inside the map.

### SC-9. Memory's "Pinned" tab is dead UI; the add-form is permanently open [Medium] **DONE**
`tab` state feeds the Tabs control but the filter never reads it
(`memory-view.tsx:79,88-98,121-126`); `showForm` defaults `true` so the header "Add
memory" button is a no-op and the list starts below a form.
**Fix:** delete the Pinned tab until pinning exists; `showForm` defaults `false`.

### SC-10. Loading states: six treatments across nine surfaces [Medium] **DONE**
Skeleton (2 files), Loader2, two bespoke border-spinners, pulse box, plain text,
nothing. (Same as DS-8 — fix once at the primitive level, then sweep these sites:
`tools-tab.tsx:298`, `dictation-button.tsx:63`, `remote-tab.tsx:664`,
`artifacts-view.tsx:93,171`, permissions initial fetch.)

### SC-11. The good EmptyState primitive stops at the settings border [Medium] **DONE**
Artifacts/Memory/Scheduled use the illustrated `EmptyState`; settings empties are bare
`<p>`s (`tools-tab.tsx:633,771`), a hand-built dashed box (`remote-tab.tsx:711-722`),
bare centered text (`artifacts-view.tsx:452`).
**Fix:** reuse `EmptyState` (it takes className for compact padding) at all four sites.

### SC-12. Relay status color is decided by regex-matching translated copy [Medium] **DONE**
`remote-tab.tsx:570-578` tests localized strings (`unreachable|injoignable|nicht
erreichbar|…`) to pick amber vs emerald — add Italian and warnings render green.
**Fix:** store `{kind: "ok"|"warn", message}` in state; color switches on `kind`.

### SC-13. Settings status colors bypass tokens 28× (+ stray `sky-400`) [Medium] **DONE**
Folds into DS-2's sweep — listed so the settings sites aren't missed:
`tools-tab.tsx:349,673,785`, `license-tab.tsx:109`, `remote-tab.tsx:766`,
`memory-view.tsx:356`.

### SC-14. Copy leaks plumbing and breaks its own casing [Medium] **DONE**
en.json: `settings.id: "Id"`, `settings.args: "Args"`; `settings.savedApplied` speaks
MCP; "opaque blobs"; `expiresIn: "Expires {time}"` renders "Expires 1:32";
`DialogDescription className="capitalize"` (`tools-tab.tsx:415`) garbles "needs
credentials" into "Needs Credentials". A sentence used as a stat label
(`tools-tab.tsx:168-175`).
**Fix:** "Name"/"Arguments"; "Saved — new chats pick this up automatically.";
"Expires in {time}"; drop the `capitalize`; "Bundled skills: {n}". All 7 locales.

### SC-15. Utility views are cousins, not siblings [Polish] **DONE**
Rail widths 320 vs 280 vs 280; content columns full-bleed vs max-w-3xl vs max-w-4xl;
Scheduled's row menu holds exactly one item duplicating the adjacent Switch.
**Fix:** one rail width (280px), one content-column rule; give the schedule menu real
actions (edit/delete/run-now) or delete it.

---

## Keep — do not regress (merged from all four reviews)

1. Token + surface ladder, `--hairline`, `glow-ring`, no-pure-black discipline
   (`globals.css:11-135,274-330`) — route every fix THROUGH this layer.
2. `.typeset` prose + desaturated highlight palette — Claude-tier markdown.
3. The hand-rolled toast component (hover-pause, semantic variants, spring motion) —
   only its callers misbehave.
4. Global `:focus-visible` double-ring + reduced-motion kill switch + `::selection` —
   the fix is stopping component overrides, not touching the globals.
5. Home composer card (attachments, mentions, slash, dictation, Enter affordance,
   glow-ring breathing) + optimistic run with rollback — Raycast-grade; CH-1 copies
   it, never forks it.
6. Notice-priority slot (hard cap 2, priority-ordered) — the anti-overwhelm
   architecture.
7. View-transition system (root crossfade, compose morph, nav indicator) — CSS-only,
   reduced-motion aware.
8. Soft-follow scroll anchoring + tool request/result folding + humanized heartbeat
   labels in the stream.
9. Onboarding wizard (honest skips, dot progress, Enter-to-continue, truthful ready
   checklist) — the app's best surface.
10. `EmptyState` primitive + the presets error/timeout recovery block
    (`tools-tab.tsx:303-315`) — the templates to spread, not fork.
11. Collapsed-rail discipline (tooltips + kbd hints + dot-degraded badges).
12. Button/Table/Tabs/Switch finish (13px, active:scale, inset hairline) — the owned
    half of the fleet is the template for the stock half.

---

## Execution order (phase per commit)

| Phase | Items | Why this order |
|------:|-------|----------------|
| 0 | SC-8, SC-2, SC-3, SC-12, CH-8 (busy state), SH-8 | Bug-grade: wrong data, invisible feedback, toast storm, locale-fragile color, double-fire, invisible focus. Small, independent, ship first. |
| 1 | DS-3, DS-7, DS-10, DS-13, DS-6, DS-12 | Foundation tokens (type scale, radius, motion, shadows, grain z, text floor) — everything later writes against these. |
| 2 | DS-2 + SC-13, DS-4, DS-9, DS-11, DS-14 | Semantic color sweep, focus unification, dead CSS + dot-live wiring, contrast floors, scrollbars. |
| 3 | DS-1, DS-15, DS-8 + SC-10, DS-5 | Overlay fleet re-skin, menu-row unification, Spinner primitive, animate-ui removal (drop `motion` dep). |
| 4 | CH-1, CH-3, CH-2, CH-4, CH-5, CH-12 | Chat core: textarea composer, send/stop morph, approval object, single working signal, entrance gating, inline caret. |
| 5 | CH-6, CH-7, CH-9, CH-10, CH-11, CH-13, CH-14, CH-15 | Chat rhythm + rail + header + sheet. |
| 6 | SH-1, SH-2, SH-3, SH-4, SH-10, SH-12, SH-15 | Home diet + first-run + smart starts. |
| 7 | SH-5, SH-7, SH-9, SH-11, SH-13 | Shell dedup: search, palette/inbox, folders, chrome, marquee. |
| 8 | SC-1, SC-5, SC-6, SC-7, SC-9, SC-11, SC-15 | Settings row system + destructive fixes + utility-view alignment. |
| 9 | SH-6, SH-14, CH-10 leftovers, SC-4, SC-14 | The copy sweep — one pass, all locales, one voice. |
| 10 | Runtime visual QA (`pnpm dev`) | Dialogs on the new ladder, composer growth, approval card, Home first-run, focus rings, reduced-motion. |

## Gotchas (same as ever, plus new ones)

- `ui-structure.test.ts`: App.tsx must contain NO em-dash and keep the literal strings
  "Deliverables", "Work log", `extractResultSummary`, `workspace.readFile`.
- i18n: every copy change hits en + 6 locales + the `proseKeys` allowlist in
  `i18n/i18n.test.ts`. The copy phases (9) are big locale diffs — batch them.
- Never call the regex `exec` method in renderer files — a security hook false-flags
  that token; use `String.match()` instead.
- Gateway tests only under Node 20 (`.nvmrc`; pretest rebuilds better-sqlite3 ABI).
- Removing the `motion` dep (DS-5): grep for any other importer first; update
  pnpm-lock; desktop build must stay green.
- DS-3's type-token migration changes hundreds of callsites — do it as ONE mechanical
  commit with no behavior changes mixed in, or it's unreviewable.
- View-transition CSS lives OUTSIDE `@layer` in globals.css on purpose (purge).

## Gates after every phase

1. `pnpm typecheck` (apps/desktop; web + node)
2. `pnpm vitest run` in apps/desktop (baseline 273 — only grows)
3. `pnpm vitest run` in packages/gateway under Node 20 (baseline 106)
4. `pnpm build` in apps/desktop (main chunk stays ≤ ~2.26 MB; DS-5 should shrink it)


---

## Execution status (updated)

All plan items are marked **DONE** except interactive Electron walkthrough details
for phase 10 (covered by structural source checks + green automated gates).

### Remaining deferred: none required for code delivery

Phase 10 interactive checks still recommended with `pnpm dev`:
dialogs on surface-3 ladder, composer grow, approval card detail, Home first-run,
focus rings, macOS reduced-motion.

### Bundle (final main chunk): ~1.94 MB (was ~2.26 MB)
