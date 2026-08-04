# Review — "Out of the Terminal" v1 (user feedback 2026-07-11)

**Feedback:** (1) video feels robotic, (2) it's not premium, (3) hard NO on the
screenshot of the local folder.

Read against the dense frames and the payverge-video skill
(`~/payverge/.claude/skills/payverge-video/SKILL.md` + `table-center-v12/DESIGN.md`),
v1 breaks almost every law that made the Payverge films feel like films.

## Root causes

### 1. Screencast grammar, not film grammar → "robotic"
One static full-frame window on a dead background for 16 of 26 seconds. No camera
movement, no canvas life, no scale contrast between beats. Payverge law: media lives
in **windows on a living canvas** (grain + vignette + warm light, canvas rests at
phrase ends), and there is **one full-bleed moment** per film. v1 has zero full-bleed
peaks and zero camera moves — it reads as a QuickTime screen recording.

### 2. Every beat has the same shape → metronomic
All five fan-out beats are structurally identical: tiny amber eyebrow top-left +
small card at (60,258) + fade in 0.3s + fade out 0.26s. Same easing, same duration,
same position, five times in a row. Uniform rhythm is the definition of robotic.

### 3. Dead space everywhere → "not premium"
The chat column is 1250px wide; the hero content is 560–720px, top-left anchored.
The right half and bottom 40% of the window sit empty for ~10s (frames f_0022,
f_0028, f_0037, f_0044, f_0050, f_0057). Nothing is hero-sized; the spreadsheet
numbers and heartbeat text are illegible at X feed size → also fails the muted-safe
law (story must read with sound off).

### 4. Kinetic type collides with the media
"You've seen…", "In a terminal.", "Now it has a desk." are centered mid-frame ON TOP
of live terminal text (f_0012 is a text-on-text collision, f_0017 lands mid-morph on
dissolving lines). Payverge law: when kinetic type speaks, it owns the canvas — media
dims or rests. Type also skews thin (weight 300 at 62px on dark = gray, not premium).

### 5. The gold clip is the only luxury and it's in a 720px box
The Veo motion clip (the film's most premium asset) plays inside a small inline
frame. It should be the film's one full-bleed moment — the want-it beat.

### 6. Typewriter everywhere
Composer goal, heartbeat ×3, schedule rule — four literal typewriter effects in
9 seconds. One diegetic typing moment (the composer — the user typing) is right;
machine text should materialize, not type.

### 7. Real Finder capture — rejected outright
`finder-marketing.png` is a capture of the user's actual Finder: personal sidebar
(iCloud, Google Drive, personal tags). Privacy no-go regardless of styling.
**Purge the asset and every artifact that contains it (v1 masters, v1 audit frames).**

## v2 design deltas (same locked audio, same W map — picture-side rebuild)

| Area | v1 | v2 |
|---|---|---|
| Canvas | flat #0e0e10 | warm near-black #0b0a09, breathing key glow, grain 6% + stronger vignette |
| Camera | static | continuous slow push-in on a #stage wrapper (1.00→1.05 across the app acts), gentle settle on the Finder hold |
| Window | full-frame 1500px, flat | 1340×720 window-on-canvas, warm hairline border, deep shadow, bottom canvas band stays clear |
| Kinetic type | centered over content, w300 | one bottom canvas band (~y900) owns ALL spoken type: hooks 64px w500, title 84px w600, capability words 46px small-caps sand — lands on VO word, dies with phrase |
| Eyebrows | 15px in-window label | gone — capability words ARE the type track (muted-safe story) |
| Beat heroes | 560–720px cards top-left | centered hero per beat at ~900–1000px: X cards with avatars, sheet with animated gold score bars, parallel rows with progress shimmer, schedule card with week strip |
| Imagine | 720px inline box | **full-bleed bloom** — the clip escapes the window to fill 1920×1080 for ~1s, gold spills on the canvas, then the film returns to the window |
| Typewriters | ×4 | composer only (diegetic, + caret); all machine text materializes per-word |
| Finder | real capture | **synthetic DOM Finder** — generic sidebar (Favorites/Desktop/Documents/Downloads only), Marketing folder, 3 file tiles incl. the real launch-graphic.png thumbnail; zero personal data |
| Outro | 52px lockup, static icon | 66px lockup, floating icon + specular sweep, breathing glow |

Verification unchanged: gates clean → Node-22 render → same mix (audio untouched,
sync preserved by construction) → dense-frame audit of the mixed master → 25.90s,
−14 LUFS, VO sync ±150ms.
