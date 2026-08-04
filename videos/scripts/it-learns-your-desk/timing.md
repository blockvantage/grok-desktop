# it-learns-your-desk — locked grid (LOAD-BEARING)

Source: `videos/assets/audio/it-learns-your-desk/vo_george_take1.json`
(whisper medium, word timestamps), George `JBFqnCBsd6RMkjVDRZzb`, take 1 untouched, 42.82s file.

- **VO_OFFSET = 1.20s** — VO adelay 1200ms; day-one morning holds in near-silence first.
- **DUR = 49.50s** (1485 frames @ 30fps). VO speech ends 43.66; wink type at 45.10.

## W constants (canvas time = whisper word start + 1.20)

```js
var W = { day1: 1.20, explain: 2.24, brand: 3.62, folders: 4.36, rules: 4.96,
          sayit: 6.88, watch: 8.60, browser: 9.72, helpers: 11.10, files: 12.58,
          here: 14.74, remembers: 16.96, brandkit: 18.04, standing: 19.18, tuesday: 20.88,
          weektwo: 23.76, suggesting: 24.80, monday: 25.40, asked: 27.02,
          keys: 28.48, asks: 29.58, nothing: 31.52, click: 32.88, waits: 34.22,
          thirty: 35.50, three: 36.58, knows: 38.36,
          brandcard: 39.80, learns: 41.56, required: 42.38 };
var VO_END = 43.66, DUR = 49.50;
```

## Key word windows (canvas time)

| Anchor | word | start | end |
|---|---|---|---|
| day1 | Day (one,) | 1.20 | 1.90 |
| explain | explain | 2.24 | 2.58 |
| brand | brand, | 3.62 | 4.00 |
| folders | folders, | 4.36 | 4.64 |
| rules | rules. | 4.96 | 5.34 |
| sayit | say (it.) | 6.88 | 7.90 |
| watch | watch (it work,) | 8.60 | 9.30 |
| browser | browser (of its own,) | 9.72 | 10.74 |
| helpers | helpers (fanning out,) | 11.10 | 12.24 |
| files | files (landing…) | 12.58 | 14.16 |
| here | But (here's the thing…) | 14.74 | 16.52 |
| remembers | remembers, | 16.96 | 17.34 |
| brandkit | brand (kit,) | 18.04 | 18.62 |
| standing | standing (rules,) | 19.18 | 20.00 |
| tuesday | Tuesday's (report…) | 20.88 | 23.08 |
| weektwo | By (week two,) | 23.76 | 24.52 |
| suggesting | suggesting | 24.80 | 25.16 |
| monday | Monday (review,) | 25.40 | 26.16 |
| asked | asked, | 27.02 | 27.36 |
| keys | keys. | 28.48 | 28.80 |
| asks | Everything (asks first,) | 29.58 | 31.16 |
| nothing | nothing (does,) | 31.52 | 32.38 |
| click | click, | 32.88 | 33.14 |
| waits | waits. | 34.22 | 34.68 |
| thirty | (Day) thirty, | 35.50 | 36.12 |
| three | three (words,) | 36.58 | 37.14 |
| knows | knows (the rest.) | 38.36 | 39.34 |
| brandcard | Grok (Desk,) | 39.80 | 40.62 |
| learns | learns (you,) | 41.56 | 42.18 |
| required | (still no terminal) required. | 42.38 | 43.66 |

Music: `music_cand_b.mp3` — 122.7 BPM, kick phase 0.352, 72s. Picked by STRUCTURE: quiet intro
(−55 → −19 dBFS over first ~6s) maps the day-one open, steady warm body carries the tour; mix
fades st=46.5 d=2.9 under the end card. Candidate A rejected: 21s of leading digital silence.

Structure note: beats 1–2 (day one / say it) rest on a near-silent canvas; the watch-it-work run
(watch → browser → helpers → files) is a fast montage with hard cuts; the memory beat (here →
tuesday) is the slow heart; the film's ONE full-bleed blooms from ~35.0 so it is full as
"thirty," lands, held through "knows the rest."; end card from `brandcard`, wink at 45.10.
