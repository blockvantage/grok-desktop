# Audio sources — out-of-the-terminal

## VO takes (generated 2026-07-11, mcp-store sample_voices, model eleven_multilingual_v2)
Script: spec §4 (locked; both product-truth probes REAL, no wording change).

| File | Voice | voice_id | artifact id | duration |
|---|---|---|---|---|
| vo_sarah.mp3 | Sarah — mature, reassuring, confident | EXAVITQu4vr4xnSDxMaL | art_01KX981WQN816S4TRY1XQ6ZX2V | 23.73s |
| vo_roger.mp3 | Roger — laid-back, casual, resonant | CwhRBWXzGAHq8TQ4Fs17 | art_01KX981XCW64E04A32RASGA7ZV | 24.15s |
| vo_charlie.mp3 | Charlie — deep, confident, energetic | IKne3meq5aSn9XLyUdCD | art_01KX981XTXKBR460S59FB88PFB | 25.08s |

Winner: **Sarah** (vo_sarah.mp3, voice_id EXAVITQu4vr4xnSDxMaL) — user pick 2026-07-11 → copied to vo_final.mp3 (23.73s)

## Music candidates (generated 2026-07-11, mcp-store generate_music, model music_v1, force_instrumental)
Prompt (music_a, seed param rejected by API — `seed` cannot be used with `prompt`, so variety came from a reworded prompt instead): Minimal warm electronic product-film score, around 100 BPM, instrumental only. Begins sparse and dark with a low sub pulse for the first ~4 seconds, then opens up with a confident, understated groove: soft kick, warm analog bass, a few gentle bell and pluck notes, holding steady and premium through the middle. Around 13 to 17 seconds it strips back to near-silence, just an airy pad. Then it resolves with a warm, hopeful closing chord that rings out. Restrained and expensive-sounding, never EDM, no big drops, no vocals.

Prompt (music_b, reworded variant): Minimal warm electronic product-film score, around 100 BPM, instrumental only. Opens sparse and dark with a low sub pulse for the first ~4 seconds, then blooms into a confident, understated groove: soft kick, warm analog bass, a few gentle bell and pluck notes, holding steady and premium through the middle. Around 13 to 17 seconds it pulls back to near-silence, just an airy pad breathing. Then it resolves with a warm, hopeful closing chord that rings out and fades. Restrained and expensive-sounding, cinematic and understated, never EDM, no big drops, no vocals.

duration_ms 30000 (both rendered 30.04s). Film DUR 25.90s.

| File | seed | kick BPM | kick PHASE (s) | structure summary |
|---|---|---|---|---|
| music_a.mp3 | n/a (seed unsupported w/ prompt) | 100.0 | 0.012 | Loudest at open (t0–1s ≈ −10dBFS), no distinct open-up bump at ~3.8s; fluctuates −11 to −18dBFS fairly uniformly through 4–24s with no real strip-back at 13–17s (same loudness as rest of groove); smooth decay/tail from ~24s to end (−23→−68dBFS by 30s). |
| music_b.mp3 | n/a (seed unsupported w/ prompt) | 99.9 | 0.000 | Steadier/quieter intro (≈−12 to −13dBFS) than A; holds a consistent groove −12 to −16dBFS through 4–17s; clear step-down to a genuine quiet section at t≈17–23s (−21 to −29dBFS) before continuing to decay into the outro tail (−32→−78dBFS by 30s). Strip-back is real but lands ~4–6s later than the briefed 13–17s window. |

Kick-band and full-band phase fits agreed exactly for both candidates (no half-beat hi-hat-offbeat lock). Both fit within the 85–120 BPM window at ~100 BPM; no re-run at a wider window was needed.

Winner: **music_b** (99.9 BPM, kick PHASE 0.000s) — user pick 2026-07-11 → copied to music_final.mp3 (30.04s). Mix note: natural quiet dip lands ~17–23s; the want-it strip-back at W.done→W.work (13.06–16.68) is created in the mix via the volume=enable duck band.

## SFX
sfx/kit copied from payverge brag composition 2026-06-23 (ende.app SFX pack). Act-1 keyboard clatter: generate_audio has NO sound_effect param, so synthesize in the mix via lavfi (payverge pipeline.md §5) or use kit ticks.
