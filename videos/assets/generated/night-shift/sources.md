# night-shift asset provenance

All media generated fresh for this film via mcp-store on 2026-07-30. Zero screen/desktop/OS
recreations, zero personal data, zero stock. Stills → Veo 3.1-fast image-to-video for the
four motion beats; the rest used as stills with a breath (slow scale) in comp.

## Audio

| File | Source |
|---|---|
| vo_george_close.mp3 | ElevenLabs George (JBFqnCBsd6RMkjVDRZzb) via generate_audio, art_01KYRJ59HXK43D6CHTZ7VW8JEJ — "Grok Desk. The desktop workspace for SuperGrok. Sleep on it." 4.086712s. Quota note: full-VO takes were impossible (81 credits left); this 60-char close fit. |
| music_final.mp3 | = ../audio/out-of-the-terminal/music_b.mp3 (brand-generated 2026-07-11, mcp-store music_v1; provenance in that folder's sources.md). Measured 99.9 BPM, kick phase 0.000, 30.04s. Never released. |

## Stills

| File | Model | Artifact | Role |
|---|---|---|---|
| lamp-night_1.png | gpt-5.4-image-2 | img_01KYRJA4Y89VCSK6PRGSQT644R | KEEPER → Veo (cold open lamp) |
| night-desk_1.png | gpt-5.4-image-2 | img_01KYRJGA1WK53JGM1AQGGS96XA | KEEPER → Veo (hand-off window) |
| plans-constellation_1.png | gemini-3-pro-image | img_01KYRJF503ST617NJ2S8VV4WR5 | KEEPER still ("it plans.") |
| plans-constellation_2.png | gemini-3-pro-image | img_01KYRJF507151GKQZQB69WMGRJ | alt |
| browses-river_1.jpg | gemini-3-pro-image | img_01KYRJFX22SX8T5TE8QZ9RAG1Y | KEEPER → Veo ("it browses.") |
| browses-river_2.jpg | gemini-3-pro-image | img_01KYRJFX24QM439G2EM6W5RF28 | alt |
| writes-ink_1.png | gpt-5.4-image-2 | img_01KYRK3BWHP4ZMNV35XZ3H5GAZ | KEEPER still ("it writes.") — one transport-dropped attempt before this succeeded |
| moon-window_1.jpg | gemini-3-pro-image | img_01KYRJM8P4NH7H186TZW46JTAS | KEEPER still (trust beat) |
| moon-window_2.jpg | gemini-3-pro-image | img_01KYRJM8P6EZ5XCYD4SV2RGFMS | alt |
| dawn-desk_1.png | gpt-5.4-image-2 | img_01KYRJSJ1F2CB3Q1AVKGV3CBDK | alt |
| dawn-desk_2.png | gpt-5.4-image-2 | img_01KYRJX308QBW389Y77SVEJJ55 | FULL-BLEED KEEPER → Veo (dawn) |

gpt-5.4-image-2 returns 1024×1024 regardless of requested size (known behavior, ETT
precedent); Veo i2v renders 1280×720 from them, and stills used as stills get cover-crop
with `data-layout-ignore`. Gemini stills are 1408×768.

## Motion (veo-3.1-fast i2v, ≈8s 1280×720 each)

| File | From still | Job | Artifact |
|---|---|---|---|
| lamp-motion.mp4 | lamp-night_1.png | job_01KYRK4CXG5PHW5H8C1793JV7R | vid_01KYRK7G40RQQHGTJAZERZ00K6 |
| night-desk-motion.mp4 | night-desk_1.png | job_01KYRK4ENRKXYHPYN3GWA368BF | vid_01KYRK8G5FWMHA9CWNBC7H0FCW |
| browses-motion.mp4 | browses-river_1.jpg | job_01KYRK4GXY10KTVBD94VBGBF5Z | vid_01KYRKAY58K1QMNJZDHSZFHHMV |
| dawn-motion.mp4 | dawn-desk_2.png | job_01KYRK4JJEKBZ095PCHTNQA03Y | vid_01KYRKATCYYM668AC405FXERXA |

All four verified 1280×720 · 8.000s by ffprobe and spot-checked frame-by-frame (no
film-frame hallucinations, no text, no people).
