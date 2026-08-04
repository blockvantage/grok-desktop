# Grok Desk Launch Film — "Out of the Terminal"

**Date:** 2026-07-11
**Status:** Approved design (brainstorm complete)
**Deliverable:** ~34s VO-led launch film, 16:9 1080p, for the X launch post
**Method lineage:** payverge-video skill (`~/payverge/.claude/skills/payverge-video/SKILL.md`) + hyperframes pipeline; story grammar from the Payverge "Table Center" treatment

---

## 1. One-line brief

Grok Build's raw power has lived in a terminal; Grok Desk gives it a body, a desk, and manners — the film opens on the terminal, morphs it live into the premium app, fans out the full Grok surface on one goal, and ends with real files in a real Finder folder.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Channel | X launch post (primary home; cutdowns later) |
| Audience | SuperGrok subscribers — no need to explain Grok; the film assumes they know Grok Build exists |
| Tone | Premium with a wink: confident and clean, one dry Grok-flavored punchline |
| Thesis | "The whole power of Grok Build, now on your desk" |
| Want-it beat | Reveal in Finder — the deliverable in the user's real filesystem, held solo |
| Narration | VO-led, with muted-safe type cards that speak the same words |
| Format | 16:9, 1920×1080, ~34s (final duration set by the recorded VO word map) |
| Music | Beat-measured original track under the VO, −14 LUFS master |

## 3. Creative device and arc

One device: **the unveil**. A single window persists through the whole film. It starts as a terminal running `grok`, morphs live into Grok Desk, and never cuts away — the same engine re-rendered as a product. One arc: raw power → given a desk → hands you the work.

The morph is honest: Grok Build CLI is literally the execution engine under the app (`packages/engine-grok`). The film dramatizes the architecture.

## 4. VO script (locked draft — record, then whisper-map)

Voice: warm, confident, unhurried; dry on the last line. Cast 2–3 ElevenLabs options and pick before composing.

```text
You've seen what Grok Build can do...

...in a terminal.

Now it has a desk.

One goal.
It searches X. It imagines. It runs code.
Three tasks at once. Every Monday at nine.

And when it's done — it doesn't send you a reply.
It hands you the work.

Grok Desk.
The whole power of Grok Build. On your desk.

No terminal required.
```

Sync law (from payverge-video): on-screen type is the verbatim spoken word, ±150ms. Type stays silent when the VO says something different. The wink parenthetical "(It's still in there.)" appears as type only, after the VO ends.

## 5. Beat map (provisional — retime onto the measured VO word map)

| Act | TC (guide) | Screen | VO | Type on screen |
|---|---|---|---|---|
| 1 · Hook | 0:00–0:05 | Black → terminal window, SF Mono. `❯ grok` fires; agent stream floods it: tool calls, file writes, tokens. Fast, raw, slightly intimidating. Quiet mechanical keyboard under. | "You've seen what Grok Build can do... in a terminal." | "You've seen what Grok Build can do." → "In a terminal." |
| 2 · Unveil | 0:05–0:09 | The morph (§7): chrome rounds, background cools to app charcoal, mono lines FLIP into tool chips / artifact card / chat turn; vibrancy sidebar slides in; menu-bar dot ticks amber. Music opens up exactly here. | "Now it has a desk." | "Now it has a desk." |
| 3 · Fan-out | 0:09–0:23 | Composer types the goal: "Research our competitors, design the launch graphic, file everything in /Marketing." Send. Then, ~2s per beat, each real: X-search citation cards flip in → Imagine graphic blooms inline in chat → code execution fills a spreadsheet, numbers tick → task switcher shows 3 tasks running, heartbeat line "Connecting the dots…" → schedule rule "Every Monday · 9:00" snaps in. | "One goal. It searches X. It imagines. It runs code. Three tasks at once. Every Monday at nine." | Eyebrows per beat: SEARCHES X · IMAGINES · RUNS CODE · IN PARALLEL · ON A SCHEDULE |
| 4 · Want-it | 0:23–0:28 | Held solo. Artifact card lands (`brief.md · competitors.xlsx · launch-graphic.png`) → cursor clicks **Reveal in Finder** → real Finder window, real `/Marketing` folder, the files sitting there. Music strips to near-silence; one clean "done" ding on the reveal. | "And when it's done — it doesn't send you a reply. It hands you the work." | "Not a chat reply. Deliverables." |
| 5 · Outro | 0:28–0:34 | Charcoal canvas, sand glow breathes. Grok Desk icon lands. Platform chips. Music resolves and fades under the mark. | "Grok Desk. The whole power of Grok Build. On your desk. (beat) No terminal required." | "The whole power of Grok Build. On your desk." · macOS · Windows · then small: "No terminal required. (It's still in there.)" |

"It hands you the work" must land on the Finder reveal frame.

Creative-laws check: says what it is in words (outro) ✓ · shows it working (every fan-out beat is a live feature) ✓ · one want-it beat held solo (Finder reveal) ✓ · muted-safe (hook type lands by 0:02; story reads sound-off; end card ~5s) ✓.

## 6. On-screen type system

| Line | When | Style |
|---|---|---|
| "You've seen what Grok Build can do." / "In a terminal." | Act 1 | SF Pro Display Light, cream on charcoal, center |
| "Now it has a desk." | Act 2 | SF Pro Display Semibold, cream, center — the title beat |
| Capability eyebrows | Act 3 | Small caps, sand, one per beat, corner-anchored |
| "Not a chat reply. Deliverables." | Act 4 | SF Pro Display, cream, lower third |
| Outro line + wink | Act 5 | Semibold lockup; wink in small muted type |

Never stack a type sentence over a different VO sentence.

## 7. Visual identity (from the app's real tokens — invent nothing)

- Canvas charcoal `#0e0e10` (`--background: 240 6% 6%`); lifted cards `#131316` (`--card`)
- Cream text `#f2f0ea` (`--foreground: 40 8% 94%`); muted `--muted-foreground`
- **Sand** `hsl(34 32% 56%)` (`--primary`) — the only accent; sand glow from `--glow-primary`
- Success green `hsl(152 32% 44%)` for done states; amber (`--warning`) only for the working dot
- Fonts: SF Pro Display (type cards + UI), SF Mono (terminal act). No serif.
- Radius `0.75rem` on app chrome; soft vignette + subtle grain over the full frame
- Terminal styling: honest but on-palette — traffic lights, restrained ANSI (sand prompt, muted output), no hacker green

**UI is rebuilt as staged DOM, not screen-recorded**, using verbatim strings from the real renderer (tool-chip wording, thinking phrases like "Connecting the dots…", "Reveal in Finder", sidebar structure). Exception: the Act-4 Finder window is a **real macOS Finder capture** of a real folder containing the real generated files.

**Morph mechanics:** one continuous window element. At the unveil, border-radius eases up, background crossfades to `--card`, and mono lines FLIP-morph into their UI equivalents (`✓ web_search` → tool chip; `wrote launch-graphic.png` → artifact card; token stream → chat turn) while the sidebar slides in. GSAP FLIP or equivalent measured transforms; no cut.

## 8. Audio plan

- **VO first.** Record, then map with `openai-whisper --word_timestamps True` (not hyperframes transcribe). Retime the comp onto the word map.
- **Music:** generate an original minimal electronic track with a warm undertone; **measure it** (kick-band 35–130 Hz beat fit; never full-band), define `bt(n)`, and place cuts on it. Never reuse another film's BPM or offsets.
- **Arc:** sparse pulse (Act 1) → opens on the morph (Act 2) → confident groove, one motion-matched cue per fan-out beat (Act 3) → strip to near-silence, single clean ding on the Finder reveal (Act 4) → resolve and fade under the mark; the wink lands after the music on a tiny key-click (Act 5).
- **Rules:** SFX never on every beat, never over a line being read; music gain ≤0.35 relative; duck under VO; final master −14 LUFS.
- **Mix:** ffmpeg, payverge conventions (`apad`/`atrim` to exact duration; verify grid and VO sync on the **mixed master**, not the render).

## 9. Product-truth gate (before composing)

Verify each fan-out capability against the current build — cut or reword anything not wired today:

- [ ] X search visibly used by a task (engine surfaces it)
- [ ] Imagine/image generation lands an inline image artifact in chat
- [ ] Code execution produces a file artifact (spreadsheet or equivalent)
- [ ] 3+ parallel tasks run and display in the switcher/sidebar
- [ ] Schedule rule creation ("Every Monday 9:00") exists in the UI
- [ ] "Reveal in Finder" works from an artifact card
- [ ] Thinking-heartbeat phrases render as shown

Every string shown must exist in the product. No lorem props, no roadmap-only features.

## 10. Production pipeline and repo layout

Mirror the payverge structure in this repo:

```
videos/
  scripts/out-of-the-terminal/   # hyperframes comp (index.html + assets)
  assets/                        # music, VO takes, fonts, icon, finder capture
  treatments/                    # iteration log + dense-frame audit docs
  out/                           # masters — UNTRACKED
```

1. Cast VO (2–3 ElevenLabs options via AskUserQuestion) → record → whisper word map
2. Generate + measure music; build `bt(n)` grid
3. Build comp with the **hyperframes** skill; payverge comp rules apply (createElement/textContent only, exit hard-kills, `snap:{textContent:1}` counters, `overwrite:"auto"`, no `<template>` wrapper, check clip durations with ffprobe)
4. Gates: `npx hyperframes lint` / `validate` / `inspect` — clean
5. Render on Node 22, background (foreground Bash cap kills long renders)
6. ffmpeg mix (VO + music + SFX), exact-duration pad/trim
7. Dense-frame audit of the mixed master (fps=4 dump), VO-sync re-check, duration, LUFS
8. Deliver `videos/out/grokdesk-out-of-the-terminal-en-v1-locked.mp4` + `-latest` copy; iteration-log row; audit doc; open the master for review
9. Commit text sources only, explicit paths, never `git add -A`

## 11. Definition of done

- Gates clean; dense-frame audit doc written; VO sync ±150ms verified on the mixed master
- Exact duration recorded; −14 LUFS confirmed
- All product-truth checkboxes resolved (verified or beat removed)
- Master opened in the user's player; X post copy delivered alongside

## 12. X post copy (draft — finalize with the master)

> You've seen what Grok Build can do in a terminal.
>
> We gave it a desk.
>
> Grok Desk — the whole power of Grok on your desktop. It searches X, imagines, runs code, works three tasks at once, and ships on a schedule. Then it hands you the files.
>
> macOS + Windows. No terminal required.

## 13. Follow-ups (out of scope for v1)

- 9:16 and 1:1 cutdowns (muted-first re-edits; the payverge 9:16 safe-band rule applies)
- ES localization: full retime with a native voice (VO-led film, not a text swap)
- Mint a `grok-desk-video` project skill (`.claude/skills/`) capturing this identity, grid law, and conventions for film #2
- YouTube/landing-page master variant if the site wants a hero loop

## 14. Open items

| Item | Status |
|---|---|
| CTA / download URL | Unknown — outro ends on mark + "macOS · Windows" until the domain is confirmed |
| Product name treatment | Film uses "Grok Desk" (the working name from the product spec) |
| VO voice | Cast during production (2–3 options presented) |
