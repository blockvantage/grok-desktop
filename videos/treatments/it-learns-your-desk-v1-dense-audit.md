# Dense-frame audit — it-learns-your-desk v1 (mixed master)

**Master:** `videos/out/grokdesk-it-learns-your-desk-en-v1-locked.mp4`
**Date:** 2026-07-12 · **Voice:** George (take 1, untouched) · **Music:** music_cand_b (122.7 BPM, quiet-intro structure pick)
**Concept:** feature tour (~50s) on the memory arc — day one you explain everything; day thirty
you say three words. Tour beats (voice, cockpit, trust, suggestions) hang off the spine.
Grammar: footage windows, serif kinetic words on the VO word, product truth as cream cards,
ONE full-bleed (day thirty).

## Hard numbers
- Duration: **49.500s** = DUR (1485 frames @ 30fps) ✓
- Loudness: **−14.4 LUFS** (target −14 ±0.5), TP −1.4 dBTP ✓
- Gates: lint 0/0 · validate 16 text elements pass WCAG AA · inspect 0 layout issues ✓
- Picture: 1920×1080 h264, `-c:v copy` from the gated render

## Beat verification (spot frames from the mixed master)
| Beat | W (s) | Verdict | Note |
|---|---|---|---|
| Day one — bare desk, empty corkboard (Veo) | 1.20 | PASS | goal card grows line-by-line on brand/folders/rules |
| Or just… say it — voice-ripple study (Veo) | 6.88 | PASS | dictation card, stepped transcription, pulsing mic dot |
| watch it work — brass porthole river of pages (Veo) | 8.60 | PASS | sub "a browser of its own." |
| helpers fanning out — lanterns over water (Veo) | 11.10 | PASS | "3 helpers · working" card, pulsing dots |
| files landing — card catalog self-filing (Veo) | 12.58 | PASS | delivered-files card with checks |
| it remembers — week-two desk, sparse pins (Veo) | 16.96 | PASS | memory cards stack: Brand kit · Standing rule · Tuesday report |
| By week two — dawn-raked pinboard (still+breath) | 23.76 | PASS | suggestion card "Weekly review · Mondays 9:00 · Add schedule" |
| You hold the keys — resting hand on brass lever (Veo) | 28.48 | PASS | approval dial Strict→Autopilot hard swap; Paused chip; footage dims on "waits." |
| **FULL-BLEED want-it — day-thirty desk (Veo, regen)** | 35.50 | PASS | v1 clip REJECTED (Veo push-in + film-frame/sprocket artifacts, lost the desk); regenerated locked-off wide — dense corkboard, tray of finished papers, steam. Mirrored composition accepted. |
| Three-word goal card "Monday review. Go." | 36.58 | PASS | |
| End card — icon + "Grok Desk" serif | 39.80 | PASS | "The desk that learns you." at learns |
| Mono wink "( it never forgets where the files go. )" | 45.10 | PASS | after VO ends 43.66; holds to DUR |

## VO sync (re-whisper of the mixed master vs timing.md)
All 30 anchors diffed; **true worst drift ≤40ms** (28/30 at 0–40ms). Two flagged values are
artifacts, not drift: `day1` −220ms is whisper first-word boundary jitter into the leading
silence (onset physically fixed by adelay=1200ms); `thirty` +200ms is the checker matching the
word "thirty" where the grid deliberately anchors the phrase at the spoken "Day" (observed
35.70 = take 34.50 + 1.20 exactly → 0ms). PASS (±150ms).

## Handled test
1. Says what it is — "Grok Desk. The desk that learns you." ✓
2. Shows it working — cockpit run + files card + memory cards + suggestion card ✓
3. One want-it beat — day-thirty full-bleed with the three-word goal ✓
4. Muted-safe — "Day one." / "it remembers." / "Day thirty." serif arc carries it silent ✓

## Privacy & product-truth law
Zero recreations of any screen/desktop/OS surface. Every visual generated (provenance:
`videos/assets/generated/it-learns-your-desk/sources.md`). Every claim maps to a SOLID row in
`videos/treatments/2026-07-11-product-truth-map.md` (memory system, dictation, agent browser,
subagent HUD, artifact harvesting, automation suggestions, approval modes, pause-all).
Computer Use / auto-update / Heavy mode: not shown, not claimed.

## SFX (mix)
low whoosh @8.60 (watch-it-work) · soft drop @35.00 (full-bleed lands) · warm bell @39.80
(brand) · key-click @45.10 (the wink). Music sidechain-ducked under VO; fade 46.5→49.4.

## Production incidents (for the record)
Render crashed 4× before succeeding — root cause was the machine's disk at 100% (free space
oscillated 0.2–1 GB; ENOSPC manifested as Chrome target death at 74%, silent init exits, and
an encoder EPIPE at 29%). Cleared after the user freed ~65 GB. The day-thirty Veo clip was
regenerated once (film-frame hallucination).
