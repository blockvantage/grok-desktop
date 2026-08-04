# "Escape the Terminal" — Grok Desk launch film (editorial rebuild)

**Date:** 2026-07-11 · **Placement:** X launch post (SuperGrok audience) · **Duration:** ~28s target (locked to measured VO)
**Supersedes:** "Out of the Terminal" v1/v2 (rejected: robotic, not premium, desktop recreations).

## Why this film exists (the lesson)

v1/v2 were product screencasts — 26s of DOM-drawn app UI with captions. The payverge films
(the study source) are editorial films: cinematic footage carries the emotion, serif type
lands on the spoken word, the product appears only as small cream truth-cards, the canvas
rests between phrases. This film adopts that grammar wholesale:

1. **No UI recreation of any kind.** No terminal window, no app window, no Finder — nothing
   that imitates a screen. The terminal exists as ONE blinking amber cursor glyph in a void.
2. **All footage is generated fresh** (premium image models → Veo image-to-video), graded to
   the identity. Nothing captured from anyone's machine.
3. **Product truth = cream cards.** Small, minimal, floating on canvas — props, not sets.
4. **One full-bleed moment** (the imagine peak). Everything else lives in windows on canvas.
5. **Type = serif display** (DM Serif Display, OFL, from the payverge kit) for kinetic words;
   DM Sans for cards/subtitles. Kinetic words are the verbatim spoken word, ±150ms.

## Identity

- Canvas `#0d0b09` warm near-black · grain ~6% + vignette, constant
- Cream `#f5f3ee` (kinetic serif, cards) · gold `hsl(36 52% 58%)` (accents, cursor, subtitles)
- Footage grade: warm charcoal/gold, cinematic 35mm, shallow depth, no text/logos in frame
- Motion: window pops 0.25–0.4s power3/back in busy beats; soft scale-fades in warm beats;
  hard cuts inside beats; canvas rests at phrase ends; NO crossfade language

## VO script (to be measured; anchors locked after whisper)

> You've seen what Grok Build can do — in a terminal.
> *(rest)*
> Now… give it a desk.
> One goal. It searches X. It imagines. It runs code.
> Three tasks at once — on a schedule you set.
> And the work is just… there. Files. Finished.
> Grok Desk. The whole power of Grok Build — on your desk.
> No terminal required.

Wink (type only, after VO ends): `(It's still in there.)`

## Beat map (times illustrative until the word map locks them)

| Beat | ~t | Picture | Type / cards |
|---|---|---|---|
| Cursor void | 0–2.5 | pure black canvas, ONE amber cursor glyph blinking | serif: "You've seen what Grok Build can do." then small mono line "— in a terminal." |
| The spill | 2.5–5 | the cursor's light spills/blooms — macro gold-light footage window grows | serif title: **"Now — give it a desk."** |
| The desk | 5–7 | cinematic desk-world shot (dusk desk, warm lamp, no screens visible) in window | cream card: the goal, one line |
| Searches X | 7–9 | footage: night city / feed-of-light macro | serif word **X.** + card `Searched X · 214 posts` |
| Imagines | 9–12 | **FULL-BLEED** newly-generated imagine footage (gold particle bloom, NOT the old desk image) | serif: **imagines.** |
| Runs code / parallel | 12–15 | macro footage: mechanical/light lattice; canvas rest after | cards: `Running code ✓` `3 tasks · in parallel` |
| Schedule | 15–17 | dawn-sky timelapse window | card: `Every Monday · 9:00` |
| The morning (want-it) | 17–21 | dawn desk footage: hands lift a printed brief; a print of the graphic leans on the lamp | serif: **"Just… there."** + card `brief.md ✓ competitors.xlsx ✓ launch-graphic.png ✓` |
| End card | 21–28 | icon + lockup on breathing gold glow | "Grok Desk — the whole power of Grok Build. On your desk." → "No terminal required." → wink |

## Handled test

1. Says what it is: "Grok Desk. The whole power of Grok Build — on your desk."
2. Shows it working: capability beats + the morning hand-off footage.
3. One want-it beat: "the work is just… there" — hands lifting the finished brief at dawn.
4. Muted-safe: hook type ≤2s, kinetic words carry the story silent, end card ≥3s.

## Product truth

Only claims verified on the live grok engine in the v1 strings pass: X search REAL,
image generation REAL, code execution REAL, parallel tasks REAL, scheduling REAL,
file deliverables REAL. Card copy uses those artifacts (brief.md / competitors.xlsx /
launch-graphic.png). "214 posts" style counts must be plausible-generic, not fake precision
about a specific run — final card copy says `Searching X…` / `Searched X ✓` (no counts).

## Audio

- VO: recast — 3 candidates auditioned by the user (warmer/lower cinematic read).
- Music: 2 fresh candidates generated for this pacing; music_b remains the fallback; pick by structure.
- Mix: sidechain-duck under VO, sparse SFX on beat anchors, `apad`+`atrim` to DUR, loudnorm −14.

## Verification gates (unchanged laws)

lint/validate/inspect clean → Node-22 background render → mix → dense-frame audit of the
MIXED master: exact DUR, −14 ±0.5 LUFS, re-whisper sync ±150ms, hook ≤2s, one full-bleed only,
end card ≥3s. Deliver `videos/out/grokdesk-escape-the-terminal-en-v1-locked.mp4` + `-latest`.

## Repo hygiene

Media untracked; commit text sources only, explicit paths, on `main`. Fresh assets under
`videos/assets/generated/escape-the-terminal/` + `videos/assets/audio/escape-the-terminal/`
with provenance in `sources.md`.
