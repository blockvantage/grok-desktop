# Dense-frame audit — escape-the-terminal v1 (mixed master)

**Master:** `videos/scripts/escape-the-terminal/renders/escape-the-terminal-v1-mixed.mp4`
**Date:** 2026-07-11 · **Voice:** George (take 1, untouched) · **Music:** music_cand_a (90.0 BPM, kick phase 0.000)
**Concept:** "Escape the Terminal" — editorial rebuild after v1/v2 of "Out of the Terminal" were
rejected (robotic / not premium / desktop recreations). Grammar: cinematic generated footage in
windows, serif kinetic words on the VO word, product truth as cream cards, ONE full-bleed.

## Hard numbers
- Duration: **24.900s** = DUR (747 frames @ 30fps) ✓
- Loudness: **−14.3 LUFS** (target −14 ±0.5) ✓ (loudnorm retargeted I=−13.5 to offset the quiet tail)
- Gates: lint 0/0 · validate 11 text elements pass WCAG AA · inspect 0 layout issues ✓
- Picture: 1920×1080 h264, `-c:v copy` from the gated render

## Beat verification (read from the mixed master's dense frames)
| Beat | W (s) | Verdict | Note |
|---|---|---|---|
| Cursor void — physical amber cursor breathes (Veo) | 1.20 | PASS | serif hook over 95% black; Veo's screen-bezel edge reads as confinement |
| "— in a terminal." mono line | 3.50 | PASS | the film's one mono nod; cursor dims on its blink |
| The spill — gold seam pours (Veo window) | 4.02 | PASS | "Now —" serif left column |
| The desk — dusk lamp footage + goal card | 4.94 | PASS | "give it a desk." serif; cream goal card; amber sub "one goal." |
| searches X. — river of lights (Veo) | 6.98 | PASS | fast triptych begins, hard cuts |
| imagines. — gold particle painting (still + breath) | 7.88 | PASS | bloom_2 keeper (bloom_1 rejected: religious figure) |
| runs code. — filament lattice (still + breath) | 8.94 | PASS | |
| Three task cards on canvas rest | 9.90 | PASS | amber sub "three tasks at once —"; dots pulse |
| Schedule — dawn city + "Every Monday · 9:00" card | 11.64 | PASS | amber sub "on a schedule you set." |
| **FULL-BLEED want-it** — hands lift the brief (Veo) | 13.74 | PASS | steam + dust motes in dawn light; "Just… there." serif |
| Delivered card — brief.md · competitors.xlsx · launch-graphic.png | 14.70 | PASS | |
| End card — icon + DM Serif "Grok Desk" | 16.10 | PASS | |
| "The whole power of Grok Build — on your desk." | 17.06 | PASS | W corrected from 17.18 (arithmetic slip caught by re-whisper) |
| "No terminal required." | 19.40 | PASS | W corrected from 19.52 (same slip) |
| Mono wink "( it's still in there. )" | 21.60 | PASS | after VO ends 20.40; holds to DUR |

## VO sync (re-whisper of the mixed master vs timing.md)
All 15 anchors diffed; worst true drift **≤140ms** (the "You've" onset — whisper boundary
jitter on the take's first word; all mid-film anchors ≤40ms). Two constants (power, required)
were found +120ms late by the first re-whisper — root cause was an arithmetic slip building
timing.md (word start + 1.20 mis-added), fixed and re-rendered. PASS (±150ms).

## Handled test
1. Says what it is — "Grok Desk. The whole power of Grok Build — on your desk." ✓
2. Shows it working — capability triptych + delivered-files card ✓
3. One want-it beat — the full-bleed morning hand-off, held solo ✓
4. Muted-safe — serif hook at 1.2s, kinetic words carry the story silent, end card 8.8s ✓

## Privacy law
Zero recreations of any screen/desktop/OS surface. Every visual is generated
(provenance: `videos/assets/generated/escape-the-terminal/sources.md`). The only
mono/terminal reference is one line of type and a physical cursor made of light.

## SFX (mix)
low whoosh @4.94 (the spill) · soft drop @13.74 (full-bleed lands) · warm bell @16.10
(brand) · key-click @21.60 (the wink). Music sidechain-ducked under VO; fade 23.0→24.9.
