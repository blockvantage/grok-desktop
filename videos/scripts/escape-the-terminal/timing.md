# escape-the-terminal — locked grid (LOAD-BEARING)

Source: `videos/assets/audio/escape-the-terminal/vo_george_take1.json`
(whisper medium, word timestamps), George `JBFqnCBsd6RMkjVDRZzb`, take 1 untouched.

- **VO_OFFSET = 1.20s** — VO adelay 1200ms; the cursor-void holds in near-silence first.
- **DUR = 24.90s** (747 frames @ 30fps). VO speech ends 20.40; wink type at 21.60.
- Music: `music_cand_a.mp3` — 90.0 BPM, kick phase 0.000, 32s; quiet intro 0–5s under the
  void, full section ≈16–26s under want-it/end card; mix fades st=23.0 d=1.9.

## W constants (canvas time = whisper word start + 1.20)

```js
var W = { seen: 1.20, terminal: 3.50, now: 4.02, desk: 4.94, goal: 5.60,
          x: 6.98, imagines: 7.88, code: 8.94, three: 9.90, schedule: 11.64,
          there: 13.74, files: 14.70, brand: 16.10, power: 17.06, required: 19.40 };
var VO_END = 20.40, DUR = 24.90;
```

## Key word windows (canvas time)

| Anchor | word | start | end |
|---|---|---|---|
| seen | You've | 1.20 | 1.60 |
| terminal | terminal. | 3.50 | 3.72 |
| now | Now | 4.02 | 4.32 |
| desk | desk, | 4.94 | 5.26 |
| goal | one goal. | 5.60 | 6.10 |
| x | X, | 6.98 | 7.46 |
| imagines | imagines, | 7.88 | 8.36 |
| code | code. | 8.94 | 9.40 |
| three | Three | 9.90 | 10.44 |
| schedule | schedule | 11.64 | 11.88 |
| there | there. | 13.74 | 14.34 |
| files | Files, | 14.70 | 15.12 |
| brand | Grok (Desk.) | 16.10 | 16.82 |
| power | The (whole power…) | 17.06 | 19.22 |
| required | no (terminal required.) | 19.40 | 20.40 |

Structure note: the capability run (x → imagines → code) is a fast triptych (0.9–1.1s
per window — montage grammar, hard cuts). The film's ONE full-bleed is the want-it beat
at `W.there` (morning hand-off footage), blooming from ~13.3 so it is full as "there."
lands, held through "Files, finished."
