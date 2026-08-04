# Dense-frame audit — out-of-the-terminal v2 (mixed master, premium pass)

**Master:** `videos/scripts/out-of-the-terminal/renders/out-of-the-terminal-v2-mixed.mp4`
**Date:** 2026-07-11 · **Voice:** Sarah · **Music:** music_b (99.9 BPM) · audio stems UNCHANGED from v1
**Driver:** user feedback on v1 — robotic / not premium / no personal-folder screenshot
(see `out-of-the-terminal-v1-review.md`).

## Hard numbers
- Duration: **25.900s** = DUR (777 frames @ 30fps) ✓
- Loudness: **−14.2 LUFS** (target −14 ±0.5) ✓
- Gates: lint 0 errors · validate 42 text elements pass WCAG AA · inspect 0 layout issues ✓
- Picture: 1920×1080 h264, `-c:v copy` from the gated render

## Beat verification (read from the mixed master's dense frames)
| Beat | W (s) | Verdict | Note |
|---|---|---|---|
| Hook over terminal window-on-canvas | 0.52 | PASS | warm key glow, type in the clear bottom band — no collision |
| "In a terminal." + 14-line flood | 2.36 | PASS | window on canvas, band type, camera push under way |
| UNVEIL morph, "Now it has a desk." | 3.76 | PASS | title in band; sidebar/chat/chip morph above it |
| Goal typed in composer (+ caret) | 4.70 | PASS | the film's one typewriter, diegetic |
| SEARCHES X — band word + avatar cards | 5.90 | PASS | 3 hero cards centered, back.out pops |
| IMAGINES — **full-bleed bloom** | 6.88 | PASS | Veo clip escapes the window, fills frame; band word rides a dark strip |
| RUNS CODE — hero sheet | 8.26 | PASS | $ counters tick, gold score bars sweep |
| IN PARALLEL — rows + shimmer | 10.18 | PASS | status pills materialize (no typewriter), tracks shimmer |
| ON A SCHEDULE — rule card | 11.82 | PASS | "Every Monday · 9:00" at 40px, Monday dot lights; early exit = phrase rest |
| Deliverables + cursor → Reveal in Finder | 13.06 | PASS | cursor glide verified on-button at ~15.4s, click pulse |
| **Synthetic Finder** hand-off, held solo | 16.68 | PASS | pure DOM, generic sidebar, real launch-graphic thumbnail — zero personal data |
| OUTRO — icon float + sheen, 64px lockup | 17.92 | PASS | breathing glow, macOS · Windows chips |
| "No terminal required." + wink | 22.82 | PASS | wink after VO ends, held to DUR |

## VO sync
Audio chain is byte-identical to the v1 mix (same stems, same mix script, VO at
adelay=0, no time-shift filters) and every comp beat references the same measured
W constants — sync preserved by construction. v1's re-whisper of this exact audio
chain measured **0ms worst drift** across all 12 anchors (PASS ±150ms).

## Premium-pass deltas verified on frames
- Living canvas: warm key glow + grain + vignette visible on every canvas frame
- Camera: continuous 1.00→1.048 push across the window acts (compare f_0004 vs f_0060 window scale)
- One full-bleed moment: the Imagine bloom (f_0028–f_0031) — the film's peak
- All spoken type lives in the bottom band; zero text-on-text collisions
- No personal data anywhere: Finder is synthetic DOM; v1 masters/frames/prop purged

## SFX placements (unchanged from v1)
whoosh @3.76 · soft drop @13.06 · ding @16.68 · bell @17.92 · wink click @23.6.
Music sidechain-ducked under VO; afade out 24.0→25.9.
