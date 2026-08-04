// measured from vo_final.words.json — NEVER hand-tuned. Voice: Sarah. Generated 2026-07-11.
// whisper medium, --word_timestamps. Every value is a measured word START time in seconds.
const W = { seen: 0.52, terminal: 2.36, desk: 3.76, goal: 4.70, x: 5.90, imagines: 6.88,
            code: 8.26, once: 10.18, nine: 11.82, done: 13.06, work: 16.68, brand: 17.92, required: 22.82 };
const DUR = 25.90; // last word "required" ends 23.40s + 2.5s outro hold, snapped to 30fps = 777 frames

/*
Anchor provenance (occurrence picked → start time), verified against the full 59-word timeline:

  seen      idx 1   0.52   "You've [seen]"                      hook line 1
  terminal  idx 8   2.36   "in a [terminal.]"  (FIRST of two)   hook line 2 — NOT idx57 "No terminal required"
  desk      idx 13  3.76   "Now it has a [desk.]" (FIRST desk)  THE UNVEIL / morph
  goal      idx 15  4.70   "One [goal.]"                        composer receives goal
  x         idx 18  5.90   "It searches [X.]"                   eyebrow SEARCHES X
  imagines  idx 20  6.88   "It [imagines.]"                     eyebrow IMAGINES
  code      idx 23  8.26   "It runs [code.]"                    eyebrow RUNS CODE
  once      idx 27  10.18  "at [once.]"                         eyebrow IN PARALLEL
  nine      idx 31  11.82  "Every Monday at [9.]"               eyebrow ON A SCHEDULE (whisper wrote "nine" as "9.")
  done      idx 35  13.06  "when it's [done,]"                  deliverables land
  work      idx 46  16.68  "It hands you the [work.]"           FINDER REVEAL frame (want-it beat)
  brand     idx 47  17.92  "[Grok Desk.]"                       outro lockup (whisper merged token "GrokDesk.")
  required  idx 58  22.82  "No terminal [required.]"            last content word; VO ends 23.40

Outro: VO ends 23.40; wink "(It's still in there.)" appears as type only after 23.40, held under the mark to DUR.
Sync law: on-screen type must show the verbatim word within ±150ms of these starts.
*/
