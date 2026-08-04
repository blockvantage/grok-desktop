# "The Night Shift" — Grok Desk launch film three (design)

**Date:** 2026-07-30 · **Slug:** `night-shift` · **Shape:** ~36.0s · 1920×1080 · 30fps · beat-led
**Concept:** The launch anthem on the product's own tagline. You hand Grok the jobs at night;
it plans, browses, writes — three at once — while you sleep; anything risky waits for your yes;
at dawn the finished work is on your desk. Close: George VO signature, "Sleep on it."

Grammar: payverge editorial lineage as locked in `escape-the-terminal` (windows on a warm
near-black canvas, serif kinetic type carries the story, product truth as cream cards, canvas
rests at phrase ends, ONE full-bleed want-it, grain + vignette). Identity constants from the
ETT comp: canvas `#0d0b09`, cream `#f5f3ee`, ink `#17130c`, gold `hsl(38 55% 58%)`, card
`#f2efe7`; DM Serif Display + DM Sans (+ one mono clock/wink nod).

## Why beat-led (production constraint turned device)

ElevenLabs quota was exhausted mid-production (81 credits left; a full VO take needs ~293).
The film is therefore **type-led on a measured kick grid** — the proven Hundred Jobs grammar —
and the silence becomes the premise: the night shift works quietly. George survives as a
**VO signature close only** (60 chars, generated inside the remaining quota):
"Grok Desk. The desktop workspace for SuperGrok. Sleep on it." (4.09s,
`videos/assets/audio/night-shift/vo_george_close.mp3`, art_01KYRJ59HXK43D6CHTZ7VW8JEJ).

## Audio plan

**Music:** `videos/assets/audio/night-shift/music_final.mp3` = OOTT `music_b` — brand-generated
2026-07-11 (mcp-store music_v1), never released (both OOTT films rejected on picture, not
music; it was the user's structural pick). **Measured** (beatgrid.py, kick band): 99.9 BPM,
kick PHASE 0.000, B = 0.6006006s, 30.04s. Structure: steady premium groove 0–17s, REAL quiet
section ~17–23s, decay tail to −78dBFS by 30s.

**Grid law:** every comp time = `bt(n) = n × 0.6006006`. PHASE 0.000 → no head trim.

**Mix map (all splices bar-aligned, kicks verified across splices on the master):**

| Film (canvas) | Source (track) | What |
|---|---|---|
| 0 → bt(36) 21.62 | 0 → 21.62 straight | night groove; the track's natural quiet dip (~17s) lands under the trust beat |
| bt(36) → bt(48) 21.62–28.83 | bt(8) → bt(20) 4.80–12.01 | splice BACK to groove = the dawn bloom (film bar 9 ← track bar 2) |
| bt(48) → bt(58) 28.83–34.83 | bt(40) → bt(50) 24.02–30.03 | decay tail under end card (film bar 12 ← track bar 10) |
| bt(58) → DUR | apad silence | the music falls asleep before the film ends |

**DUR = 36.033s** (1081 frames @30fps; bt(60) within one frame).
George close placed ≈ bt(48.5) 29.13 → 33.22. Loudness target −14 ±0.5 LUFS.

**SFX (mix, kit + lavfi):** soft tick at goal card bt(11) · pink-noise riser bt(34)→bt(36)
(pre-dawn breath) · low whoosh + soft drop at bt(36) (full-bleed lands) · warm bell at bt(48)
(brand) · key-click at the wink bt(55). Music ducked under the VO close.

## Beat map

| Act | bt / time | Picture | Type on screen |
|---|---|---|---|
| 1 COLD OPEN | 0–8 / 0–4.80 | lamp-night Veo clip (motes drift) on 95% black | mono gold clock "11:58 PM" at bt1; serif hook "Some work shouldn't wait for morning." lands ≤1.5s, holds to bt7.5 |
| 2 HAND-OFF | 8–14 / 4.80–8.41 | night-desk Veo in window on canvas | serif "Hand it to the night shift."; cream goal card bt11: **Tonight** — Brief the launch. Price the tiers. Find the imagery. |
| 3 TRIPTYCH | 14–23 / 8.41–13.81 | hard cuts, 3 beats each: plans-constellation (still+breath) · browses-river (Veo) · writes-ink (still+breath) | "it plans." / "it browses." / "it writes." |
| 4 THREE CARDS | 23–28 / 13.81–16.82 | canvas rest; three task cards stagger in, gold dots pulse | cards: Launch brief · Pricing tiers · Launch imagery; gold sub "three jobs at once — while you sleep." |
| 5 THE YES | 28–36 / 16.82–21.62 | moon-window still dimmed in window; amber-edged approval card | card: **Needs your yes** — Submit the partner form? · waiting; serif "anything risky waits for your yes." (sits in the track's real quiet) |
| 6 DAWN (FULL-BLEED) | 36–48 / 21.62–28.83 | dawn-desk Veo escapes the window → 1920×1080, held solo to bt41.5; return to canvas | mono clock "6:04 AM"; serif "On your desk." at bt38; then cream card **Delivered overnight** — launch-brief.md · pricing.docx · imagery — 6 files; serif "Finished." |
| 7 END CARD | 48–60 / 28.83–36.03 | icon float + sheen, breathing glow | serif "Grok Desk" + "The desktop workspace for SuperGrok."; George VO bt48.5; serif "Sleep on it." on his word; footer "grokdesk.app — macOS · Windows"; mono wink "( the night shift starts tonight. )" bt55, holds ≥3s |

## Handled test

1. **Says what it is** — "Grok Desk. The desktop workspace for SuperGrok." (VO + type). ✓
2. **Shows it working** — goal card in → three task cards running → Delivered card with real file types. ✓
3. **One want-it beat** — the dawn full-bleed, held solo. ✓
4. **Muted-safe** — hook ≤1.5s, type carries the story silent, end card ≥7s. ✓

## Claims gate (2026-07-11 product-truth map)

Parallel default-3 SOLID · form-submit approval ("needs your yes") SOLID · md/docx/image
deliverables auto-harvested SOLID · overnight = queued tasks running unattended SOLID.
No SPEC-ONLY claims (no computer-use, no auto-update, nothing engine-gated).

## Assets (all generated fresh this film — sources.md in assets/generated/night-shift/)

Stills: gpt-5.4-image-2 (lamp, night-desk, writes-ink, dawn ×2) + gemini-3-pro-image
(constellation, river, moon). Motion: veo-3.1-fast image-to-video from keepers
(lamp, night-desk, river, dawn) — 1280×720 ≈8s each. No screen/desktop recreations,
no personal data, no stock.

## Verification gates

lint 0 · validate WCAG clean · inspect 0 (art-directed tiles `data-layout-ignore`, verified
on dense frames) · render Node 22 `-q high -w 2 --no-browser-gpu` background · mix per
conventions → **verify the MIXED MASTER**: dense frames (fps=4 @540px), kick check
`beatgrid.py --check 99.9,0` across BOTH splices, duration exactly 36.033, −14 ±0.5 LUFS,
re-whisper the close line vs its word map (±150ms).

## Deliverables

`videos/out/grokdesk-night-shift-en-v1-locked.mp4` + `-en-latest` copy · dense-audit doc ·
iteration-log row · share copy block · master opened in the player · text sources committed
(comp, mix script, spec, treatments) — media untracked, explicit paths only.
