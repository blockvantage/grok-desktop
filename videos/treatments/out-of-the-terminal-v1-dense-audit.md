# Dense-frame audit — out-of-the-terminal v1 (mixed master)

**Master:** `videos/scripts/out-of-the-terminal/renders/out-of-the-terminal-v1-mixed.mp4`
**Date:** 2026-07-11 · **Voice:** Sarah · **Music:** music_b (99.9 BPM, kick phase 0.000)

## Hard numbers
- Duration: **25.900s** = DUR (777 frames @ 30fps) ✓
- Loudness: **−14.2 LUFS** (target −14 ±0.5) ✓
- Audio: aac stereo, mean −17.4 dB, max −1.5 dB (no clipping); per-second RMS shows content across all 26s, no dead air ✓
- Picture: 1920×1080 h264, `-c:v copy` from the gated render (lint/validate/inspect clean)

## Beat verification (read from render frames + mixed master)
| Beat | W (s) | Verdict | Note |
|---|---|---|---|
| Hook "You've seen what Grok Build can do." | 0.52 | PASS | lands over empty terminal ≤0.6s (muted-safe) |
| "In a terminal." + terminal floods 14 lines | 2.36 | PASS | real grok shapes, legible SF Mono |
| UNVEIL / morph "Now it has a desk." | 3.76 | PASS | one continuous window; radius+bg morph; sidebar slides in |
| One goal — composer types goal | 4.70 | PASS (v1.1 fix) | was "0" (snap-numeric bug); now types "Research our competitors…" |
| SEARCHES X + citation cards | 5.90 | PASS | real @handles from sources |
| IMAGINES + motion clip blooms inline | 6.88 | PASS | Veo motion clip; gold-particle cursor burst lands on beat |
| RUNS CODE + spreadsheet counters tick | 8.26 | PASS | prices $20–30, scores 81–92 animate up |
| IN PARALLEL + "Connecting the dots" | 10.18 | PASS (v1.1 fix) | heartbeat text was snap-numeric; now types |
| ON A SCHEDULE "Every Monday · 9:00" | 11.82 | PASS (v1.1 fix) | rule text was snap-numeric; now types; grok-4.5 chip |
| Deliverables card + cursor→Reveal in Finder | 13.06 | PASS | 3 files + button; cursor glides and clicks |
| WANT-IT: real Finder folder, held solo | 16.68 | PASS | finder-marketing.png fills frame; "Not a chat reply. Deliverables." |
| OUTRO: icon + "The whole power… On your desk." | 17.92 | PASS | real 1024² app icon; macOS · Windows chips; sand glow |
| "No terminal required." + wink | 22.82 | PASS | wink "(It's still in there.)" after VO ends, held to DUR |

## VO sync (re-whisper of the mixed master vs timing.md anchors)
VO placed at adelay=0 (no time-shift filters) → sync preserved by construction. Re-whisper of the mixed master (whisper medium, word timestamps) vs all 12 measured anchors: **worst drift 0ms** — every anchor (seen/terminal/desk/goal/x/imagines/code/once/nine/done/work/required) matches timing.md exactly. PASS (within ±150ms).

## SFX placements (mix)
whoosh @W.desk 3.76 · soft drop @W.done 13.06 · clean ding @W.work 16.68 · warm bell @W.brand 17.92 · wink key-click @23.6. Music sidechain-ducked under VO; afade out 24.0→25.9.

## Fixes applied
- v1.1: composer/heartbeat/schedule text were driven by `snap:{textContent:1}` (numeric-only → rendered "0"); replaced with a stepped `typeOn()` text reveal. Commit 4fce4aa.
