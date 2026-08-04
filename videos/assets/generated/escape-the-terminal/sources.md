# Generated sources — escape-the-terminal

All imagery generated fresh for this film 2026-07-11 (user law: no desktop captures, no
recycled imagery, premium models only). Style baked into every prompt: warm near-black
charcoal + gold, cinematic 35mm, shallow DOF, film grain, no text/logos/UI.

## Stills (mcp-store `generate_image`)

| File | Model | Artifact | Beat | Keeper? |
|---|---|---|---|---|
| cursor-macro_1.png | openai/gpt-5.4-image-2 | img_01KX9PNHCZ96309W7ZKF4G23B4 | cold open | ✓ (animated) |
| light-spill_1.png | openai/gpt-5.4-image-2 | img_01KX9PSW4A1J8V0345SJ2VVQJ1 | spill | alt |
| light-spill_2.png | openai/gpt-5.4-image-2 | img_01KX9PYHC2X1WCDM8DGNCNK6F7 | spill | ✓ (animated) |
| desk-dusk_1.png | openai/gpt-5.4-image-2 | img_01KX9Q2R940515SH4V38QTQMKT | the desk | ✓ (animated) |
| desk-dusk_2.png | openai/gpt-5.4-image-2 | img_01KX9Q71589KFAA0PM3EYR6AB6 | the desk | alt |
| x-night_1.jpg | google/gemini-3-pro-image | img_01KX9Q7HG1XPEYWX6X6AR5Q1Y2 | searches X | ✓ (animated) |
| imagine-bloom_1.png | openai/gpt-5.4-image-2 | img_01KX9QC28X8JBB51YRX51982ME | imagines | rejected (religious figure) |
| imagine-bloom_2.png | openai/gpt-5.4-image-2 | img_01KX9QGAX5ZHSXEE4445G6NWX6 | imagines | ✓ (still) |
| code-lattice_1.jpg | google/gemini-3-pro-image | img_01KX9QGY24TK9YA0MDQ3HBMAMH | runs code | ✓ (still) |
| dawn-sky_1.jpg | google/gemini-3-pro-image | img_01KX9QHEKS8CJNWH5HVF5W42V6 | schedule | ✓ (still) |
| morning-handoff_1.png | openai/gpt-5.4-image-2 | img_01KX9QNKGY998DAHBW1FSVD03K | want-it | alt |
| morning-handoff_2.png | openai/gpt-5.4-image-2 | img_01KX9QST6AC0FX8FQCQ7QVEMSQ | want-it | ✓ (animated, FULL-BLEED) |

## Motion (mcp-store `generate_video`, google/veo-3.1-fast, 6s image-to-video from the keeper stills)

| File | Job | Artifact | Beat |
|---|---|---|---|
| cursor-motion.mp4 | job_01KX9QXVRADJA990TPQX17ERBH | vid_01KX9R138XY36XAP2GE07ATY5Z | cold open (cursor breathes) |
| spill-motion.mp4 | job_01KX9QXVXGQ2YCP48QBZKNNH8Z | vid_01KX9R13EN2445K97XM2YR6M0C | the spill widens |
| desk-motion.mp4 | job_01KX9QXW2PFGT5TCM54KHWFXKE | vid_01KX9R3JM0BHK1GCG2AGHJS8JQ | dusk desk breathes |
| x-motion.mp4 | job_01KX9QXW7JV56R8Y3JQEFZZMR4 | vid_01KX9R3DGH9WASR3029TBVWFDB | river of lights streams |
| handoff-motion.mp4 | job_01KX9QXWBE6C63GX19VWR0EKW6 | vid_01KX9R6VHJNKF5KGFCMEZXX8MJ | hands lift the brief (FULL-BLEED want-it) |

## Audio (`videos/assets/audio/escape-the-terminal/`)

- `vo_george_take1.mp3` — ElevenLabs George `JBFqnCBsd6RMkjVDRZzb` (art_01KX9PHN0H5ES567S24KHY96FB),
  take 1 untouched, 19.2s speech; word map `vo_george_take1.json` (whisper medium).
  Casting samples (George/Lily/Harrison) in `casting/`.
- `music_cand_a.mp3` — mcp-store generate_music (art_01KX9PHXFQF8V57992XMVQFRRK), 90.0 BPM,
  kick phase 0.000, 32s — CHOSEN by structure (quiet intro → builds → full 16–26s → 5s decay).
- `music_cand_b.mp3` — art_01KX9PJ5QBJKHEHEDGSK0V9QMV, 84 BPM — flat envelope, backup.
