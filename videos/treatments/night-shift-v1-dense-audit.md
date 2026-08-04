# Night Shift v1 — dense audit (locked master)

Master: `videos/out/grokdesk-night-shift-en-v1-locked.mp4`
Picture: `videos/scripts/night-shift/renders/night-shift_2026-07-30_01-17-55.mp4` (1920×1080 · 30fps · 1081 frames)
Mix: `videos/scripts/mix-night-shift.sh` (music splice built in the mix; loudnorm I=-11.6 single-pass)
Audited 2026-07-30, 144 dense frames (fps=4 @540px) + beatgrid + re-whisper on the delivered file.

## Verdict: PASS — ship it

| Gate | Result |
|---|---|
| Duration | 36.033333s exact (= bt60 within one frame) ✓ |
| Loudness | −14.3 LUFS integrated (target −14 ±0.5) · TP −1.2 dBTP ✓ |
| Beat grid (99.9 BPM, phase 0.000) | all audible kicks ≤6ms except b36 flag — justified below · 8 quiet beats skipped ✓ |
| Re-whisper VO sync (on delivered master) | all word-END deltas +11…+111ms vs expected (gate ±150ms) ✓ |
| Dense frames 1–144 | every beat on grid, zero clipping/orphan text/layout errors ✓ |
| Lint / validate / inspect (pre-render) | 0/0 · 10 text pass WCAG AA · 0 layout issues across 15 samples ✓ |

## The b36 "−38.7ms" flag — detector artifact, justified

`beatgrid.py --check 99.9,0` flags b36 (21.622s, the dawn splice downbeat) at −38.7ms.
Exhaustively isolated; the flag is **byte-identical across every variant**:
original mix · riser highpassed 320Hz · segA tail faded · segA hard-cut at 21.502 +
120ms inserted silence · riser fully MUTED. The source track itself checks clean.

Proof it's not in the audio: kick-band (35–130Hz) RMS envelope of the delivered master
in 5ms windows — noise floor (RMS 18–79) through 21.619, then 4629 → 11508 at
21.624/21.629. Zero pre-energy; the hit is sample-exact on the grid by construction
(atrim/adelay are sample-accurate). The detector's onset window straddles the
razor-sharp silence→groove step at the splice and pulls the flux centroid ~3 hops
early. Audible reality: one stacked downbeat exactly at bt36.

## VO sync detail (re-whisper of delivered master, medium model)

VO delayed 29.129s (bt48.5). Expected = source word map + 29.129.

| Word boundary | Expected | Measured | Δ |
|---|---|---|---|
| "Desk" end | 30.069 | 30.080 | +11ms |
| "the" start | 30.289 | 30.260 | −29ms |
| "workspace" end | 31.329 | 31.340 | +11ms |
| "SuperGrok." end | 32.149 | 32.180 | +31ms |
| "it." end | 32.949 | 33.060 | +111ms |

Two start boundaries ("Grok" −649ms, "Sleep" −169ms) are whisper segment-boundary
snapping (it butts adjacent words together and inflates segment-initial words over the
bell+music); a fixed adelay cannot shift words relative to each other, and the deltas
straddle zero — no global offset. PASS.

## Dense-frame walkthrough (sheet = 9 frames, f(N) ≈ (N−1)/4 s)

- **f1–18 (0–4.25s)** Lamp cold open (Veo push-in). Clock "11:58 PM" bt1; hook
  "Some work shouldn't wait for morning." bt2.5, complete by 1.7s (muted-safe). Clean.
- **f19–33 (4.5–8.1s)** Hard cut to teacup rain window bt8 on the kick; "Hand it to
  the night shift." bt8.5; goal card (TONIGHT — brief/tiers/imagery) bt11 + tick. Clean.
- **f34 (8.25s)** Designed dip: win-desk fades under the bt14 cut — reads as a breath.
- **f35–54 (8.5–13.3s)** Triptych on hard cuts bt14/bt17/bt20 (plans constellation /
  browses interchange Veo / writes ink). f49 samples the exact bt20 instant mid word
  cross-fade ("browses"→"writes" both ~40% for ~0.2s) — normal dissolve, invisible at 30fps.
- **f55–66 (13.5–16.3s)** Three task cards on half-beats bt23/23.5/24 with dot pulses;
  gold sub "three jobs at once — while you sleep." bt24. Clean.
- **f67–90 (16.5–22.25s)** THE YES: moon window bt28 under the track's natural quiet;
  amber approval card bt29 ("NEEDS YOUR YES — Submit the partner form? · waiting for
  you"); "anything risky waits for your yes." bt31. Exit ~bt35.5 leaves one breath of
  black at 21.5s, then **DAWN full-bleed slams bt36 with the music bloom**; "6:04 AM"
  bt36.5. The money moment lands exactly as designed.
- **f91–108 (22.5–26.75s)** "On your desk." bt38 over sunrise; bleed out bt41.5;
  Delivered card (launch-brief.md · pricing.docx · 4 images) bt42; "Finished." bt43. Clean.
- **f109–144 (27–36s)** End card: icon bt48 + bell; "Grok Desk" on George's word
  (~29.6); line on VO_LINE; footer grokdesk.app bt53; gold "Sleep on it." on VO_SLEEP;
  mono wink "( the night shift starts tonight. )" bt55 + click; holds 3s; music asleep
  from bt58, film ends in silence. Clean.

## Claims check (vs product-truth map)

All on-screen claims are the verified set: goal hand-off, plans/browses/writes,
three parallel jobs, risky-action approval gate, files delivered, macOS · Windows,
grokdesk.app. No UI recreations, no personal data, all footage generated (provenance:
`videos/assets/generated/night-shift/sources.md`).

## Known accepted nits

- b36 detector flag (above) — audio verified sample-exact by waveform.
- Whisper hallucinates "music" at 1.5–2.9s (transcribing the score); no VO exists there.
- Goal/approval/delivered cards render small at 540px audit scale; verified legible at
  full 1080 (validate WCAG pass + spot frames).
