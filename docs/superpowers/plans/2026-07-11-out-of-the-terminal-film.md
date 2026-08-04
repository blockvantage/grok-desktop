# Grok Desk Launch Film "Out of the Terminal" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the locked, verified ~34s VO-led launch film master `videos/out/grokdesk-out-of-the-terminal-en-v1-locked.mp4` per `docs/superpowers/specs/2026-07-11-launch-video-design.md`.

**Architecture:** Payverge-proven pipeline adapted to this repo: assets via mcp-store (HTTP MCP server at `127.0.0.1:7777/mcp` — bridged by a small Node script because this session's MCP connection is down) → VO recorded and whisper word-mapped → music generated and kick-band measured → hyperframes DOM composition (one continuous window: terminal → morph → app UI) → lint/validate/inspect gates → background render on Node 22 → ffmpeg mix → dense-frame + sync verification on the mixed master → locked delivery.

**Tech Stack:** mcp-store (`generate_audio`, `generate_music`, `generate_image`), `whisper` CLI (installed at `/opt/homebrew/bin/whisper`), hyperframes via `npx`, GSAP (bundled with hyperframes), ffmpeg, Node 22 (`nvm use 22`; default is 20), Python 3 for beatgrid.

**Canonical references (read before the relevant task):**
- Pipeline runbook: `/Users/maceo/payverge/.claude/skills/payverge-video/references/pipeline.md`
- Comp rules + failure modes: `/Users/maceo/payverge/.claude/skills/payverge-video/SKILL.md`
- Worked VO-led comp: `/Users/maceo/payverge/videos/scripts/table-center-v12/`
- Spec (beat map, VO script, identity): `docs/superpowers/specs/2026-07-11-launch-video-design.md`

**Film constants used throughout:**
- Film slug: `out-of-the-terminal` · lang `en` · 1920×1080 · 30fps · target ~34s (exact duration = VO map + outro hold)
- Palette: canvas `#0e0e10`, card `#131316`, cream `#f2f0ea`, muted `#8a887f`, sand `hsl(34 32% 56%)` ≈ `#b99763`, success `hsl(152 32% 44%)`, amber `hsl(36 52% 52%)`
- Fonts: `"SF Pro Display", -apple-system` (type cards + UI), `"SF Mono", ui-monospace, Menlo` (terminal) — system fonts, resolved by headless Chrome on this Mac

---

## File structure

```
videos/
  .gitignore                          # media untracked
  scripts/
    mcpstore.mjs                      # MCP HTTP bridge for mcp-store tools
    beatgrid.py                       # copied from payverge skill
    make-props.py                     # generates competitors.xlsx + brief.md prop files
    mix-out-of-the-terminal.sh        # ffmpeg mix
    audit-out-of-the-terminal.sh      # dense frames + duration + LUFS
    out-of-the-terminal/
      index.html                      # hyperframes comp (the film)
      renders/                        # render output (untracked)
  assets/
    audio/out-of-the-terminal/        # vo takes, words.json, music candidates
    audio/sfx/                        # generic UI sfx kit (untracked media + sources.md)
    generated/out-of-the-terminal/    # launch-graphic.png etc + sources.md
    props/Marketing/                  # real deliverable files for the Finder capture
    props/finder-marketing.png        # real Finder window capture
  treatments/
    iteration-log.md
    out-of-the-terminal-v1-dense-audit.md
    out-of-the-terminal-strings.md    # verbatim product strings + truth-gate verdicts
  out/                                # masters (untracked)
```

---

### Task 1: Scaffold `videos/` + tooling bridge

**Files:**
- Create: `videos/.gitignore`, `videos/scripts/mcpstore.mjs`, `videos/scripts/beatgrid.py` (copy), `videos/treatments/iteration-log.md`

- [ ] **Step 1: Create the tree and .gitignore**

```bash
mkdir -p videos/scripts/out-of-the-terminal/renders \
         videos/assets/audio/out-of-the-terminal videos/assets/audio/sfx \
         videos/assets/generated/out-of-the-terminal videos/assets/props/Marketing \
         videos/treatments videos/out
cat > videos/.gitignore <<'EOF'
out/
**/renders/
assets/**/*.mp3
assets/**/*.wav
assets/**/*.mp4
assets/**/*.png
assets/**/*.jpg
assets/**/*.xlsx
EOF
```

(`sources.md`, `*.json` word maps, and `brief.md` stay tracked — text provenance is committed, media is not.)

- [ ] **Step 2: Copy beatgrid.py**

```bash
cp /Users/maceo/payverge/.claude/skills/payverge-video/scripts/beatgrid.py videos/scripts/beatgrid.py
python3 videos/scripts/beatgrid.py --help | head -5   # expect usage text, no ImportError
```

If it errors on missing deps: `pip3 install numpy scipy` (it uses numpy/scipy only).

- [ ] **Step 3: Write the mcp-store bridge**

This session's MCP connection to mcp-store is down, but the server is alive at `http://127.0.0.1:7777/mcp` (verified: responds to JSON-RPC). Tools: `generate_music`, `generate_audio`, `generate_image`, `generate_video` (plus job/list helpers — discover with `tools/list`). Create `videos/scripts/mcpstore.mjs`:

```js
#!/usr/bin/env node
// Call an mcp-store tool over MCP streamable HTTP.
// usage: node videos/scripts/mcpstore.mjs list
//        node videos/scripts/mcpstore.mjs call <tool> '<json-args>'
const URL_ = "http://127.0.0.1:7777/mcp";

async function rpc(body, sid) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sid ? { "mcp-session-id": sid } : {}),
    },
    body: JSON.stringify(body),
  });
  const newSid = res.headers.get("mcp-session-id") ?? sid;
  const text = await res.text();
  if (!text.trim()) return { data: null, sid: newSid };
  const data = text.includes("data:")
    ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5))
    : JSON.parse(text);
  return { data, sid: newSid };
}

const [mode, tool, argsJson] = process.argv.slice(2);
const init = await rpc({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "grokdesk-film", version: "1.0.0" } },
});
await rpc({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, init.sid);
const req = mode === "list"
  ? { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  : { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: JSON.parse(argsJson || "{}") } };
const out = await rpc(req, init.sid);
console.log(JSON.stringify(out.data, null, 2));
```

- [ ] **Step 4: Verify the bridge**

```bash
node videos/scripts/mcpstore.mjs list
```

Expected: JSON with the tool list including `generate_music`, `generate_audio`, `generate_image`. Note each tool's input schema — later tasks pass arguments matching it. If the server is down, start it from `/Users/maceo/blockvantage/mcp-store` (check its README/package.json for the start script) or ask the user. If the schemas differ from what later tasks assume (prompt/voice/duration fields), adapt the arguments — the intent of each call is stated in its step.

- [ ] **Step 5: Seed the iteration log**

```bash
cat > videos/treatments/iteration-log.md <<'EOF'
# Grok Desk film iteration log

| Ver | File | What changed | gates/stop verdict |
|---|---|---|---|
EOF
```

- [ ] **Step 6: Commit**

```bash
git add videos/.gitignore videos/scripts/mcpstore.mjs videos/scripts/beatgrid.py videos/treatments/iteration-log.md
git commit -m "feat(video): scaffold film pipeline - tree, mcp-store bridge, beatgrid"
```

---

### Task 2: Product-truth gate + verbatim strings doc

**Files:**
- Create: `videos/treatments/out-of-the-terminal-strings.md`

Every string shown in the film must exist in the product; every claimed capability must work in the current build (spec §9).

- [ ] **Step 1: Write the strings doc from already-verified sources**

These were verified by grep on 2026-07-11 (paths relative to `apps/desktop/src/renderer/`). Write `videos/treatments/out-of-the-terminal-strings.md` containing this table:

```markdown
# Verbatim product strings for the film (verified 2026-07-11)

| Film use | String | Source |
|---|---|---|
| Thinking heartbeat | "Connecting the dots" (pool also has "Thinking it through", "Untangling the threads", "Doing the quiet math") | components/task-stream.tsx THINKING_PHRASES |
| Tool chip verbs | "Reading" / "Writing" / "Searching" / "Browsing the web" / "Running a command" | components/task-stream.tsx humanizeTool() |
| Want-it button | "Reveal in Finder" | components/views/artifacts-view.tsx:289 + i18n home.revealFinder |
| Rail header | "Deliverables" | i18n home.deliverables |
| Composer placeholder | "Reply to refine or take this further…" | components/views/task-workspace-view.tsx:534 |
| Schedule nav/title | "Scheduled" / "New schedule" | i18n nav.scheduled, scheduled.create |
| Model chip | "grok-4.5" | components/views/scheduled-view.tsx |

# Capability verdicts
| Beat | Verdict | Evidence |
|---|---|---|
| Parallel tasks (switcher) | REAL | gateway multi-task manager + sidebar chats (memory: pass 5) |
| Scheduler | REAL | scheduled-view.tsx create form, SchedulerService |
| Reveal in Finder | REAL | artifacts-view.tsx:289 |
| Inline image artifact | REAL | ArtifactMedia renders images/videos inline (task-stream.tsx) |
| X search | <probe result> | <fill from Step 2> |
| Code execution | <probe result> | <fill from Step 2> |
```

- [ ] **Step 2: Probe the engine for X search and code execution**

The engine is the `grok` CLI (`packages/engine-grok`). Run two live probes in a scratch dir:

```bash
cd "$(mktemp -d)"
grok -p "Search X for recent posts about xAI Grok and list 3 with authors." --max-turns 4 2>&1 | tee probe-x.txt | tail -20
grok -p "Using code execution or shell, compute 17*23 and write the result to result.txt" --max-turns 4 2>&1 | tee probe-code.txt | tail -10
cat result.txt
```

Expected: probe-x output cites X/Twitter posts (any tool named like x_search/x_keyword_search counts); result.txt contains `391`. Fill the two `<probe result>` cells with REAL/FAILED + the tool name observed.

- [ ] **Step 3: Decide fallbacks for any FAILED row**

- X search FAILED → VO line "It searches X." becomes "It searches the web." and the eyebrow SEARCHES X becomes SEARCHES THE WEB; flag the change to the user before composing.
- Code execution FAILED → replace the spreadsheet beat with a second file-write beat (`brief.md` filling in). Flag to the user.

- [ ] **Step 4: Commit**

```bash
git add videos/treatments/out-of-the-terminal-strings.md
git commit -m "docs(video): product-truth gate - verbatim strings and capability verdicts"
```

---

### Task 3: VO — cast, record, pick

**Files:**
- Create: `videos/assets/audio/out-of-the-terminal/vo_<voice>.mp3` (2–3 takes, untracked), `videos/assets/audio/out-of-the-terminal/sources.md`

- [ ] **Step 1: Write the TTS script text**

Exactly the spec §4 script. One take per voice, full script, natural pauses kept (ellipses and the em-dash matter for pacing):

```text
You've seen what Grok Build can do... in a terminal.

Now it has a desk.

One goal. It searches X. It imagines. It runs code. Three tasks at once. Every Monday at nine.

And when it's done — it doesn't send you a reply. It hands you the work.

Grok Desk. The whole power of Grok Build. On your desk.

No terminal required.
```

(If Task 2 downgraded X search, swap that sentence here too.)

- [ ] **Step 2: Generate 3 candidate takes via mcp-store**

Payverge's EN launch voice was ElevenLabs **Sarah** — warm, confident. Generate Sarah plus two contrasting options (one deeper male, one dry/neutral — pick from `generate_audio`'s voice list; if the schema has `list_voices`, call it first):

```bash
node videos/scripts/mcpstore.mjs call generate_audio '{"text":"<script from Step 1>","voice":"Sarah","model":"eleven_multilingual_v2"}'
```

Repeat per voice. The tool returns artifact URLs — `curl -o videos/assets/audio/out-of-the-terminal/vo_sarah.mp3 <url>` each. Record voice ids + prompts in `sources.md` next to the takes.

- [ ] **Step 3: Let the user pick (AskUserQuestion)**

Open all takes for the user (`open videos/assets/audio/out-of-the-terminal/vo_*.mp3`) and ask which voice carries the film. Options: the 3 voices + regenerate. Copy the winner to `vo_final.mp3`.

- [ ] **Step 4: Commit sources**

```bash
git add videos/assets/audio/out-of-the-terminal/sources.md
git commit -m "feat(video): VO takes generated and cast (media untracked)"
```

---

### Task 4: Whisper word map → timing constants

**Files:**
- Create: `videos/assets/audio/out-of-the-terminal/vo_final.words.json` (tracked), `videos/scripts/out-of-the-terminal/timing.md`

- [ ] **Step 1: Word-map the final take**

```bash
whisper videos/assets/audio/out-of-the-terminal/vo_final.mp3 \
  --model medium --word_timestamps True --output_format json \
  --output_dir videos/assets/audio/out-of-the-terminal/
mv videos/assets/audio/out-of-the-terminal/vo_final.json videos/assets/audio/out-of-the-terminal/vo_final.words.json
```

(Use the `whisper` binary — `openai-whisper` is not on PATH on this machine. NOT `npx hyperframes transcribe`, which expects whisper-cpp and fails.)

- [ ] **Step 2: Extract anchor times into timing.md**

From the words JSON, record start times for these anchor words (the comp keys every beat to them): `seen`, `terminal`, `desk` (first = unveil), `goal`, `X`, `imagines`, `code`, `once`, `nine`, `done`, `work` (= Finder reveal frame), `Desk` (brand), `required`. Write them as a JS-ready block in `videos/scripts/out-of-the-terminal/timing.md`:

```js
// measured from vo_final.words.json — NEVER hand-tuned
const W = { seen: 0.42, terminal: 3.1, desk: 6.8, goal: 9.2, x: 11.0, imagines: 12.6,
            code: 14.1, once: 16.0, nine: 18.2, done: 21.5, work: 24.8, brand: 27.9, required: 31.6 };
const DUR = <last word end + 2.5s outro hold, rounded to a frame at 30fps>;
```

(The numbers above are illustrative — replace every value with the measured ones. Sync law: on-screen type shows the verbatim word ±150ms.)

- [ ] **Step 3: Commit**

```bash
git add videos/assets/audio/out-of-the-terminal/vo_final.words.json videos/scripts/out-of-the-terminal/timing.md
git commit -m "feat(video): VO word map and timing anchors"
```

---

### Task 5: Music — generate 2 candidates, measure, pick

**Files:**
- Create: `videos/assets/audio/out-of-the-terminal/music_a.mp3`, `music_b.mp3` (untracked), grid results appended to `sources.md`

- [ ] **Step 1: Generate two candidates**

Brief (structure over vibe — the film needs: sparse intro ~5s, opens up, steady groove ~14s, strip-back ~5s, warm resolve):

```bash
node videos/scripts/mcpstore.mjs call generate_music '{"prompt":"Minimal warm electronic product-film bed, ~100bpm, sparse dark intro with a low pulse for 5 seconds, then opens into a confident understated groove with soft kick and warm bass, strips back to near-silence around 24 seconds, warm resolved ending chord. Premium, restrained, not EDM, no vocals.","duration_s":38}'
```

Twice (or use the tool's candidate count if it has one). `curl` artifacts to `music_a.mp3` / `music_b.mp3`.

- [ ] **Step 2: Measure both on the kick band**

```bash
python3 videos/scripts/beatgrid.py --bpm 85,120 videos/assets/audio/out-of-the-terminal/music_a.mp3
python3 videos/scripts/beatgrid.py --bpm 85,120 videos/assets/audio/out-of-the-terminal/music_b.mp3
```

Record BPM + PHASE per candidate. **Never trust the requested BPM; never fit full-band** (hi-hat offbeat trap — the tool warns).

- [ ] **Step 3: Pick by structure**

Listen (`open`), pick the candidate whose open-up moment can sit at the unveil (`W.desk`) and whose quiet section can sit under the want-it beat (`W.done`–`W.work`) — the mix may bar-aligned-splice to help (multiples of 4 beats only). Keep the loser as backup. Append choice + BPM/PHASE to `sources.md`; commit `sources.md` as in Task 3.

---

### Task 6: Props — real deliverable files, Finder capture, launch graphic, SFX

**Files:**
- Create: `videos/scripts/make-props.py`, `videos/assets/props/Marketing/{brief.md,competitors.xlsx,launch-graphic.png}`, `videos/assets/props/finder-marketing.png`, `videos/assets/generated/out-of-the-terminal/sources.md`

- [ ] **Step 1: Generate the launch graphic via mcp-store**

This is the file "Imagine" produces in the film — it must be a real, good-looking image:

```bash
node videos/scripts/mcpstore.mjs call generate_image '{"prompt":"Minimal premium launch graphic for a desktop AI app called Grok Desk: dark charcoal background (#0e0e10), a warm sand-gold glowing desk icon motif, clean sans-serif feel, generous negative space, subtle grain, product-launch poster energy. No readable text, no logos.","aspect_ratio":"16:9"}'
curl -o videos/assets/props/Marketing/launch-graphic.png <artifact-url>
```

Record tool + prompt in `videos/assets/generated/out-of-the-terminal/sources.md`.

- [ ] **Step 2: Write make-props.py and generate the other two files**

```python
#!/usr/bin/env python3
"""Real prop files for the Finder want-it beat."""
from pathlib import Path
d = Path("videos/assets/props/Marketing"); d.mkdir(parents=True, exist_ok=True)
(d / "brief.md").write_text("""# Competitor brief — desktop AI coworkers
_Generated by Grok Desk · 2026-07-11_

## Landscape
| Product | Platform | Model access | Desktop-native agency |
|---|---|---|---|
| Claude Cowork | macOS | Claude | Yes — tasks, folders |
| ChatGPT desktop | macOS/Win | GPT | Chat-first, limited tasks |
| Grok Desk | macOS/Win | SuperGrok (full surface) | Parallel tasks, schedules, memory |

## Takeaway
The open slot is subscription-native desktop agency for Grok users:
X search + Imagine + code execution driving real files on the user's machine.
""")
try:
    import openpyxl
except ImportError:
    raise SystemExit("pip3 install openpyxl first")
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Competitors"
rows = [["Product", "Platform", "Pricing", "Agent tasks", "Schedules"],
        ["Claude Cowork", "macOS", "$20/mo", "Yes", "No"],
        ["ChatGPT desktop", "macOS/Windows", "$20/mo", "Limited", "Yes"],
        ["Grok Desk", "macOS/Windows", "SuperGrok sub", "Parallel", "Cron + NL"]]
for r in rows: ws.append(r)
wb.save(d / "competitors.xlsx")
print("props written")
```

```bash
python3 -c "import openpyxl" 2>/dev/null || pip3 install openpyxl
python3 videos/scripts/make-props.py   # expect: props written
ls videos/assets/props/Marketing        # brief.md  competitors.xlsx  launch-graphic.png
```

- [ ] **Step 3: Capture the real Finder window**

Dark mode, icon view, the three files visible:

```bash
open videos/assets/props/Marketing
osascript -e 'delay 1' -e 'tell application "Finder" to activate' \
          -e 'tell application "Finder" to set current view of front window to icon view'
python3 - <<'EOF'
import Quartz, subprocess
wins = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
finder = [w for w in wins if w.get("kCGWindowOwnerName") == "Finder" and w.get("kCGWindowName")]
wid = finder[0]["kCGWindowNumber"]
subprocess.run(["screencapture", "-o", f"-l{wid}", "videos/assets/props/finder-marketing.png"], check=True)
print("captured", finder[0]["kCGWindowName"])
EOF
```

If `import Quartz` fails (`pip3 install pyobjc-framework-Quartz`) or the capture is wrong, fall back to `screencapture -o -w videos/assets/props/finder-marketing.png` and ask the user for the one click on the Finder window. Verify by opening the png: three files, dark chrome, "Marketing" title.

- [ ] **Step 4: SFX kit**

Copy the generic UI kit from the payverge brag composition (ticks, dings, bells — generic sounds, provenance noted):

```bash
cp -R /Users/maceo/payverge/brag-output-2026-06-23-172839/composition/assets/sfx videos/assets/audio/sfx/kit
echo "sfx/kit copied from payverge brag composition 2026-06-23 (ende.app SFX pack)" >> videos/assets/audio/out-of-the-terminal/sources.md
```

Keyboard clatter for Act 1: generate via `node videos/scripts/mcpstore.mjs call generate_audio '{"text":"","sound_effect":"fast quiet mechanical keyboard typing, 5 seconds"}'` if the schema supports SFX; otherwise skip — the payverge lavfi recipes (pipeline.md §5) synthesize ticks/whooshes in the mix.

- [ ] **Step 5: Commit text sources**

```bash
git add videos/scripts/make-props.py videos/assets/props/Marketing/brief.md videos/assets/generated/out-of-the-terminal/sources.md videos/assets/audio/out-of-the-terminal/sources.md
git commit -m "feat(video): film props - deliverable files, finder capture, launch graphic, sfx kit"
```

---

### Task 7: Terminal act content — real `grok` stream shapes

**Files:**
- Create: `videos/scripts/out-of-the-terminal/terminal-script.md`

- [ ] **Step 1: Capture a real transcript**

```bash
cd "$(mktemp -d)"
grok -p "Research the three most popular AI desktop apps, then write a one-paragraph summary to summary.md" --max-turns 8 2>&1 | tee grok-transcript.txt | tail -30
```

- [ ] **Step 2: Distill into the act script**

Write `videos/scripts/out-of-the-terminal/terminal-script.md`: ~14 lines that will flood the terminal in Act 1, drawn from the real transcript's shapes (prompt line, tool-call lines, ✓ result lines, streaming text fragment, a `wrote summary.md` line). Keep real formatting/symbols; content may be trimmed for rhythm. Mark the 3 lines that will FLIP-morph into UI elements in Act 2:

- a `✓ web_search …` line → morphs into the "Browsing the web" tool chip
- a `wrote launch-graphic.png` line → morphs into the artifact card
- the streaming text fragment → morphs into the assistant chat turn

- [ ] **Step 3: Commit**

```bash
git add videos/scripts/out-of-the-terminal/terminal-script.md
git commit -m "docs(video): terminal act script from real grok transcript"
```

---

### Task 8: Compose the film (hyperframes)

**Files:**
- Create: `videos/scripts/out-of-the-terminal/index.html`

**REQUIRED SUB-SKILL:** invoke `hyperframes` before writing the comp. Payverge comp rules apply verbatim (SKILL.md table): `createElement`/`textContent` only (never `innerHTML`), every exit tween followed by a hard `tl.set(el,{opacity:0},t)` kill, counters via `snap:{textContent:1}`, `overwrite:"auto"` on re-tweens, no `<template>` wrapper, `data-layout-ignore` on art-directed crops, elements fully faded in at validate's sample timestamps.

- [ ] **Step 1: Comp skeleton**

Root: `data-composition-id="out-of-the-terminal" data-width="1920" data-height="1080" data-fps="30"`. Structure:

```html
<div class="canvas">                      <!-- #0e0e10, vignette + grain overlays -->
  <div class="window" id="win">           <!-- ONE continuous window, whole film -->
    <div class="chrome"> … traffic lights … <span class="wintitle">grok</span></div>
    <div class="term">   … terminal lines from terminal-script.md … </div>
    <div class="app">    … sidebar | chat column | rail — hidden until unveil …</div>
  </div>
  <div class="typecard" id="tc"></div>    <!-- centered VO-verbatim type -->
  <div class="eyebrow" id="eb"></div>     <!-- corner capability eyebrows -->
  <div class="outro">  … icon, lockup, platform chips, wink … </div>
</div>
```

CSS custom props exactly the palette constants at the top of this plan. Type cards: SF Pro Display Light 64–84px cream; punchlines Semibold. Terminal: SF Mono 22px, sand prompt `❯`, muted output.

- [ ] **Step 2: Timeline keyed to W constants**

Paste the measured `W`/`DUR` block from `timing.md` at the top of the script. Every placement references `W.*` — no magic numbers. Beats per spec §5:

- `W.seen`: type card "You've seen what Grok Build can do." while the term floods (stagger lines ~0.12s)
- `W.terminal`: card swaps to "In a terminal."
- `W.desk` (the unveil): window morph — border-radius 6→12px, chrome/background crossfade `#0a0a0a→#131316`, the 3 marked term lines FLIP to their UI positions (measure both positions, tween transform), sidebar slides in (translateX), menu-bar dot ticks amber; card "Now it has a desk."
- `W.goal`: composer receives the goal text (typed via `snap` textContent tween), send
- `W.x` / `W.imagines` / `W.code` / `W.once` / `W.nine`: one ~2s UI vignette each in the chat column + eyebrow swap (SEARCHES X · IMAGINES · RUNS CODE · IN PARALLEL · ON A SCHEDULE). Imagine beat blooms `launch-graphic.png` inline. Parallel beat shows the heartbeat line "Connecting the dots" + 3 running rows. Schedule beat snaps a "Every Monday · 9:00" rule row + "New schedule"/"grok-4.5" chrome.
- `W.done`: artifact card lands (`brief.md · competitors.xlsx · launch-graphic.png`), cursor glides to **Reveal in Finder**
- `W.work`: cut to the real `finder-marketing.png` capture filling a window frame — held solo ≥2.2s; type "Not a chat reply. Deliverables."
- `W.brand`: outro — icon (`apps/desktop/src/renderer/public/grok-desk-icon-full.png`, copy into comp assets), "The whole power of Grok Build. On your desk.", macOS · Windows chips
- `W.required`: "No terminal required." then, after VO ends, small muted "(It's still in there.)"

- [ ] **Step 3: Verify in-browser at key timestamps**

```bash
cd videos/scripts/out-of-the-terminal && npx hyperframes preview
```

Scrub to each `W.*` time; check type is fully faded in at each beat and the morph reads as one object.

- [ ] **Step 4: Commit**

```bash
git add videos/scripts/out-of-the-terminal/index.html
git commit -m "feat(video): out-of-the-terminal comp v1"
```

---

### Task 9: Gates

- [ ] **Step 1: Run all three**

```bash
cd videos/scripts/out-of-the-terminal
npx hyperframes lint && npx hyperframes validate && npx hyperframes inspect
```

Expected: clean (a `file-too-large` warning on the comp is precedent-ignored; `clipped_text` from `inspect` has NO escape — fix layout or add `data-layout-ignore` only for art-directed crops, then check legibility on dense frames in Task 12). Fix → re-run until clean. Commit fixes.

---

### Task 10: Render

- [ ] **Step 1: Render on Node 22, background**

```bash
source ~/.nvm/nvm.sh && nvm use 22
cd videos/scripts/out-of-the-terminal
npx hyperframes render -q high -w 2 --no-browser-gpu -o renders/out-of-the-terminal-v1.mp4
```

Run with `run_in_background` (the 10-min foreground Bash cap kills renders; never two renders concurrently; don't pipe through `tail`). Expected: `renders/out-of-the-terminal-v1.mp4` exists, duration ≈ DUR, silent (audio comes in the mix).

---

### Task 11: Mix

**Files:**
- Create: `videos/scripts/mix-out-of-the-terminal.sh`

- [ ] **Step 1: Write the mix script**

Model on `/Users/maceo/payverge/videos/scripts/mix-table-center-v12.sh` (VO-led canonical), with this film's values:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."   # videos/
DUR=<exact DUR from timing.md>
VO=assets/audio/out-of-the-terminal/vo_final.mp3
MUSIC=assets/audio/out-of-the-terminal/music_<winner>.mp3
PHASE=<measured phase>          # trim head so bt(n) lands on kicks
RENDER=scripts/out-of-the-terminal/renders/out-of-the-terminal-v1.mp4
OUT=scripts/out-of-the-terminal/renders/out-of-the-terminal-v1-mixed.mp4

ffmpeg -y -i "$RENDER" -i "$VO" -i "$MUSIC" \
  -filter_complex "\
[1:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=0|0[vo];\
[2:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=${PHASE},\
volume=0.30,\
volume=enable='between(t,<W.done>,<W.work+1>)':volume=0.10[mus];\
[vo][mus]amix=inputs=2:duration=longest:normalize=0,\
apad=whole_dur=${DUR},atrim=0:${DUR},loudnorm=I=-14:TP=-1.5:LRA=11[a]" \
  -map 0:v -map "[a]" -c:v copy -t "$DUR" "$OUT"
echo "mixed -> $OUT"
```

Add SFX inputs the same way (each through `aformat`, placed with `adelay=<ms>|<ms>` where ms = anchor-word time × 1000): morph whoosh at `W.desk`, per-beat soft ticks at `W.x/imagines/code/once/nine`, the clean ding at `W.work`, warm bell at `W.brand`, key-click after `W.required`. Restraint rules: never on every beat, never over a line being read, music ≤0.35 and dipped under the want-it beat (the `volume=enable` band above).

- [ ] **Step 2: Run it**

```bash
chmod +x videos/scripts/mix-out-of-the-terminal.sh && videos/scripts/mix-out-of-the-terminal.sh
```

Expected: `mixed -> …v1-mixed.mp4`.

- [ ] **Step 3: Commit**

```bash
git add videos/scripts/mix-out-of-the-terminal.sh
git commit -m "feat(video): mix script - vo bed, music duck, sfx placements"
```

---

### Task 12: Verify the mixed master

**Files:**
- Create: `videos/scripts/audit-out-of-the-terminal.sh`, `videos/treatments/out-of-the-terminal-v1-dense-audit.md`

- [ ] **Step 1: Audit script**

```bash
#!/usr/bin/env bash
set -euo pipefail
MASTER="$1"; OUTDIR="videos/out/_audit_$(basename "$MASTER" .mp4)"; mkdir -p "$OUTDIR"
ffmpeg -y -v error -i "$MASTER" -vf "fps=4,scale=540:-1" "$OUTDIR/f_%04d.jpg"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$MASTER"
ffmpeg -nostats -i "$MASTER" -af "ebur128=framelog=verbose" -f null - 2>&1 | grep "I:" | tail -1
```

- [ ] **Step 2: Run and check the numbers**

```bash
chmod +x videos/scripts/audit-out-of-the-terminal.sh
videos/scripts/audit-out-of-the-terminal.sh videos/scripts/out-of-the-terminal/renders/out-of-the-terminal-v1-mixed.mp4
```

Duration must equal DUR exactly; loudness −14 ±0.5 LUFS.

- [ ] **Step 3: VO-sync re-verification on the MASTER (not the render)**

```bash
whisper <mixed master> --model medium --word_timestamps True --output_format json --output_dir "$(mktemp -d)"
```

Diff the anchor words against `timing.md` — worst case ≤ ±150ms. If drift exceeds it, the mix delayed the VO: fix `adelay`, remix, re-verify.

- [ ] **Step 4: Read every dense frame**

Read the `f_*.jpg` sequence (all of them, in order). Checklist: hook type lands ≤2s; each beat's copy legible at 540px; the morph reads as one object; the Finder capture legible and held ≥2.2s; end card ≥3s; no dead air; type never mid-fade at a read moment. Record PASS/FAIL per beat + the duration/LUFS numbers in `videos/treatments/out-of-the-terminal-v1-dense-audit.md`, add an iteration-log row. Any FAIL → fix comp/mix, bump to v2, repeat Tasks 9–12.

- [ ] **Step 5: Commit**

```bash
git add videos/scripts/audit-out-of-the-terminal.sh videos/treatments/out-of-the-terminal-v1-dense-audit.md videos/treatments/iteration-log.md
git commit -m "test(video): dense-frame audit v1 - sync, duration, loudness verified"
```

---

### Task 13: Deliver

**Files:**
- Create: `videos/out/grokdesk-out-of-the-terminal-en-v1-locked.mp4` (+ `-latest`), `videos/out/share-copy.txt`

- [ ] **Step 1: Lock and open**

```bash
cp videos/scripts/out-of-the-terminal/renders/out-of-the-terminal-v1-mixed.mp4 videos/out/grokdesk-out-of-the-terminal-en-v1-locked.mp4
cp videos/out/grokdesk-out-of-the-terminal-en-v1-locked.mp4 videos/out/grokdesk-out-of-the-terminal-en-latest.mp4
open videos/out/grokdesk-out-of-the-terminal-en-latest.mp4
```

- [ ] **Step 2: Share copy**

Write `videos/out/share-copy.txt` with the spec §12 X post copy (updated if Task 2 changed any claim), CTA slot left as `<link>` until the user supplies the domain.

- [ ] **Step 3: Final commit (explicit paths — NEVER `git add -A`; media stays untracked)**

```bash
git add videos/scripts/out-of-the-terminal/index.html videos/scripts/mix-out-of-the-terminal.sh \
        videos/scripts/audit-out-of-the-terminal.sh videos/treatments/iteration-log.md \
        videos/treatments/out-of-the-terminal-v1-dense-audit.md
git commit -m "feat(video): out-of-the-terminal v1 locked - grok build unveiled on the desk"
```

- [ ] **Step 4: Update project memory**

Append a memory file note (auto-memory dir) with: measured BPM/PHASE, chosen voice, any new gotchas (mcp-store schema quirks, Finder capture method that worked) so film #2 starts warm.

---

## Definition of done (from spec §11)

- [ ] Gates clean; dense-frame audit doc written; VO sync ±150ms verified on the mixed master
- [ ] Exact duration recorded; −14 LUFS confirmed
- [ ] All product-truth verdicts resolved (probe REAL or beat reworded with user sign-off)
- [ ] Master opened in the user's player; share copy delivered alongside
