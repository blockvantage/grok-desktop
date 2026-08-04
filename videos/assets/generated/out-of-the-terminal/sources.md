# Generated visual sources — out-of-the-terminal

## Launch graphic — ANIMATED (final decision, user 2026-07-11)
The Imagine beat plays a MOTION clip; the Finder still is a hero frame FROM that clip (so both beats match).
- Motion: `videos/assets/generated/out-of-the-terminal/launch-graphic-motion.mp4` — image-to-video via mcp-store
  `generate_video`, model **`google/veo-3.1-fast`**, from the chosen gpt-5.4 still as reference. 1280x720, 24fps,
  8.0s, artifact `vid_01KX9ACBYB1AN3Q88TEFVC16CZ`, cost $0.96. Motion: warm desk, glowing cursor rises from the
  screen in a burst of gold particles, volumetric light, near-still camera. (Veo reinterpreted the still into a
  warmer wood-desk scene rather than animating it 1:1 — user chose to embrace the cinematic version.)
- Finder still: `videos/assets/props/Marketing/launch-graphic.png` is now the hero frame at t≈4.8s of that clip
  (1280x720), so the still thumbnail in the Finder reveal matches the moving version at the Imagine beat.
- COMP INTEGRATION (Task 8): play `launch-graphic-motion.mp4` at the Imagine beat (W.imagines). If this hyperframes
  build can't seek a <video> on the render clock, composite the clip in post (ffmpeg overlay over the artifact
  region for that ~1.5s window); the still is the fallback.
- ~~Finder re-captured after the swap~~ **PURGED (v2, user privacy 2026-07-11):** the real-Finder
  screencapture (`finder-marketing.png`) showed the user's personal sidebar and was rejected outright.
  Deleted everywhere (props, comp assets, v1 masters, v1 audit frames). The v2 Finder beat is a
  fully synthetic DOM window in the comp; the only image it uses is `launch-graphic.png` (our art).

## (superseded) Launch graphic — premium still, user pick 2026-07-11
File: `videos/assets/props/Marketing/launch-graphic.png`
Tool: `generate_image` via `videos/scripts/mcpstore.mjs`
Model: **`openai/gpt-5.4-image-2`** (premium). Dimensions 1024x1024, native PNG (no conversion).
Artifact id: `img_01KX99X1D9JHBHYK9E5G1CZSHS`.

User requirement: "make sure that each image is top quality." Three premium candidates were
generated and the user picked this one:
- gpt54_A (`openai/gpt-5.4-image-2`, 1024x1024) — **CHOSEN**: photoreal desk scene — warm lamp,
  pen holder, books, vase, and a glowing vertical cursor beam with a gold light-flow across the
  desk. Most literally "the power on your desk."
- gemini_pro_A (`google/gemini-3-pro-image`, 1376x768) — cinematic abstract gold flow + cursor glyph.
- gemini_pro_B (`google/gemini-3-pro-image`, 1376x768) — minimal glowing desk lamp.

Prompt (chosen): Premium product-launch hero graphic for a desktop AI app named Grok Desk. Wide
cinematic composition. Dark near-black charcoal backdrop (#0e0e10) with a soft warm sand-gold radial
glow. Centered motif: a minimalist glowing desk surface with a single elegant blinking cursor and a
subtle abstract flow of light suggesting an AI quietly at work. No text, no words, no logos. Photoreal.

Model-selection note: mcp-store's default image alias is broken — `config/model-aliases.json` keys the
fast alias as `image-fast` (hyphen) but the code falls back to the literal `"image:fast"` (colon), which
OpenRouter rejects. ALSO the `image-gpt` alias points at `openai/gpt-5.4-image` which OpenRouter rejects
as "not a valid model ID" (the real slug is `openai/gpt-5.4-image-2`). Always pass a real `model` slug
explicitly; the top-quality image models available on this account are `openai/gpt-5.4-image-2`,
`openai/gpt-5-image`, and `google/gemini-3-pro-image`.

(Superseded: the first pass used `google/gemini-3.1-flash-image-preview` (the fast default), 1408x768 —
replaced with the premium gpt-5.4-image-2 render above. The Finder capture `finder-marketing.png` was
re-captured afterward so its thumbnail shows the premium image, then bottom path bar cropped off,
final 1920x1215.)
