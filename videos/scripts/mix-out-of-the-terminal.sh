#!/usr/bin/env bash
# Mix: silent hyperframes picture + VO/music/SFX stems -> delivered master.
# Model: payverge mix-table-center-v12.sh (VO-led, sidechain duck, -14 LUFS).
# Usage: videos/scripts/mix-out-of-the-terminal.sh <picture.mp4> <out.mp4>
set -euo pipefail
cd "$(dirname "$0")/.."   # -> videos/

PIC="${1:?picture mp4}"
OUT="${2:?output mp4}"
DUR=25.90                                   # from timing.md (777 frames @30fps)
A=assets/audio/out-of-the-terminal
K=assets/audio/sfx/kit

# VO starts at t=0 ("You've seen..."); music_b phase 0.000 so downbeat is at 0 (no atrim).
# SFX placements keyed to W word times (ms): whoosh @W.desk 3760; soft drop @W.done 13060;
# clean ding @W.work 16680; warm bell @W.brand 17920; wink key-click @23600 (after VO ends 23.40).
ffmpeg -y -loglevel error \
  -i "$PIC" \
  -i "$A/vo_final.mp3" \
  -i "$A/music_final.mp3" \
  -i "$K/impact/impactSoft_medium_001.ogg" \
  -i "$K/interface/drop_001.ogg" \
  -i "$K/impact/impactGlass_light_001.ogg" \
  -i "$K/impact/impactBell_heavy_000.ogg" \
  -i "$K/interface/select_008.ogg" \
  -filter_complex "\
[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=0|0,asplit=2[voA][voB];\
[2:a]aresample=48000,volume=0.30,afade=t=out:st=24.0:d=1.9[mus];\
[mus][voB]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=420:makeup=1[musd];\
[3:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.42,adelay=3760|3760[whoosh];\
[4:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.32,adelay=13060|13060[drop];\
[5:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.5,adelay=16680|16680[ding];\
[6:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.4,adelay=17920|17920[bell];\
[7:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.45,adelay=23600|23600[click];\
[voA][musd][whoosh][drop][ding][bell][click]amix=inputs=7:duration=longest:normalize=0,\
apad=whole_dur=${DUR},loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:${DUR}[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"

echo "mixed -> $OUT"
ffprobe -v error -show_entries format=duration -of default=nw=1 "$OUT"
