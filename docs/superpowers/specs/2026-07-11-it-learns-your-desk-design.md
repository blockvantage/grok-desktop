# "It Learns Your Desk" — film two design (feature tour, ~60s)

**Format:** feature tour, ~60s, 1920×1080, X pinned post / website hero.
**Spine:** the memory arc — day one you explain everything; day thirty you say three words.
Tour beats (voice, cockpit, trust, suggestions) hang off that spine so the film stays one story,
not a checklist.
**Grammar (locked from film one):** cinematic generated footage carries emotion; serif kinetic
words (DM Serif Display) land on the spoken word ±150ms; product truth ONLY as small cream cards;
canvas rests at phrase ends; exactly ONE full-bleed (day thirty); hard cuts inside beats.
**Voice:** George (`JBFqnCBsd6RMkjVDRZzb`) — brand continuity with film one.
**Claim gate:** every claim maps to a SOLID row in
`videos/treatments/2026-07-11-product-truth-map.md`. Computer Use, auto-update, Heavy mode:
banned (SPEC-ONLY). Zero screen/desktop/OS recreations of any kind.

## VO script (~118 words ≈ 48s George)

> Day one, you explain everything. The brand. The folders. The rules.
> Or you just… say it.
> Then you watch it work. A browser of its own. Helpers, fanning out.
> Files, landing where they belong.
> But here's the thing about a good desk — it remembers.
> Your brand kit. Your standing rules. What Tuesday's report is supposed to look like.
> By week two, it's suggesting the Monday review — before you've asked.
> And you hold the keys. Everything asks first — or nothing does.
> One click… and the whole desk waits.
> Day thirty. Three words.
> It already knows the rest.
> Grok Desk. The desk that learns you.
> Still no terminal required.

## Beat map (timings locked later from whisper grid)

| # | Beat | ~t | Footage (generated) | Cream card (product truth) | Claim → truth-map row |
|---|---|---|---|---|---|
| 1 | Day one | 0–8 | A fresh desk at morning: bare wood, one lamp, unopened boxes | Goal card with a LONG paragraph goal | core loop |
| 2 | Say it | 8–12 | Quiet room, dust motes in lamplight; a ripple of light crosses as the voice speaks | Dictation card: mic glyph + live partial transcription | voice dictation (Grok STT) |
| 3 | Watch it work | 12–22 | Fast run: brass porthole/lens onto a river of pages · paper lanterns multiplying over dark water · a wooden card catalog filing itself | Subagent card "3 helpers working" · origin-approval card "Allow example.com? [Allow once]" | agent browser (isolated), subagent HUD, artifact harvesting |
| 4 | It remembers | 22–31 | The SAME desk gaining character across two stages — pinned swatches, photos, ink notes; light shifts season | Memory cards stack: Brand kit · Standing rule · "Remember takeaways" | memory system, episodic |
| 5 | It suggests | 31–36 | Dawn over the desk, first sun on the pinned wall | Suggestion card: "Weekly review — Mondays 9:00 · Add schedule" | automation suggestions + cron |
| 6 | You hold the keys | 36–44 | A hand resting on a brass lever; workshop machines settling to stillness | Approval-modes dial card: Strict · Balanced · Autopilot; then "Paused" chip | approval modes, pause-all, audit |
| 7 | **Day thirty — FULL-BLEED** | 44–52 | The desk in full golden morning, rich with thirty days of character, finished brief waiting in the tray | Tiny goal card, three words: "Monday review. Go." | the want-it beat |
| 8 | End card | 52–~62 | Near-black, icon breath | DM Serif "Grok Desk" + "The desk that learns you." · mono wink "( it never forgets where the files go. )" | — |

## Identity
Palette and type identical to film one: black canvas, warm amber, cream cards (#f5efe4 family),
DM Serif Display for kinetic words, DM Sans for cards, mono only for the wink. The desk in beats
1/4/7 must read as the SAME desk aging — generate stage-1 still first, then feed it as visual
reference in later-stage prompts.

## Music
~70s instrumental, two candidates, picked by beatgrid structure: near-silent first bar (day one),
patient build through beats 3–6, warm resolve landing at the full-bleed, tail under the end card.

## Handled test
1. Says what it is — "Grok Desk. The desk that learns you." ✓
2. Shows it working — cockpit beat + files card + suggestion card ✓
3. One want-it beat — the three-word goal at day thirty ✓
4. Muted-safe — "Day one / Day thirty" serif arc carries the story silent ✓

## Gates (same as film one)
hyperframes lint/validate/inspect 0 · unique id per `<video data-start>` · loudness −14±0.5 LUFS
(retarget for quiet tail) · re-whisper the MIXED master, every anchor ±150ms · dense-frame audit ·
media untracked, text sources committed by explicit path.
