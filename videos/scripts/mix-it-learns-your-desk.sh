#!/usr/bin/env bash
# Mix: silent hyperframes picture + VO/music/SFX stems -> delivered master.
# Model: mix-escape-the-terminal.sh (VO-led, sidechain duck, -14 LUFS via I=-13.5 retarget).
# Usage: videos/scripts/mix-it-learns-your-desk.sh <picture.mp4> <out.mp4>   (ABSOLUTE paths)
set -euo pipefail
cd "$(dirname "$0")/.."   # -> videos/

PIC="${1:?picture mp4}"
OUT="${2:?output mp4}"
DUR=49.50                                   # from timing.md (1485 frames @30fps)
A=assets/audio/it-learns-your-desk
K=assets/audio/sfx/kit

# VO_OFFSET 1.20s (day-one morning holds in near-silence first). music_cand_b: built-in quiet
# intro, fade out st=46.5 d=2.9 under the end card.
# SFX keyed to W word times (ms): low whoosh @W.watch 8600 (watch-it-work begins); soft drop
# @35000 (full-bleed blooms); warm bell @W.brandcard 39800; key-click @45100 (the wink).
ffmpeg -y -loglevel error \
  -i "$PIC" \
  -i "$A/vo_george_take1.mp3" \
  -i "$A/music_cand_b.mp3" \
  -i "$K/impact/impactSoft_medium_001.ogg" \
  -i "$K/interface/drop_001.ogg" \
  -i "$K/impact/impactBell_heavy_000.ogg" \
  -i "$K/interface/select_008.ogg" \
  -filter_complex "\
[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=1200|1200,asplit=2[voA][voB];\
[2:a]aresample=48000,volume=0.32,afade=t=out:st=46.5:d=2.9[mus];\
[mus][voB]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=420:makeup=1[musd];\
[3:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.40,adelay=8600|8600[whoosh];\
[4:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.30,adelay=35000|35000[drop];\
[5:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.36,adelay=39800|39800[bell];\
[6:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.42,adelay=45100|45100[click];\
[voA][musd][whoosh][drop][bell][click]amix=inputs=6:duration=longest:normalize=0,\
apad=whole_dur=${DUR},loudnorm=I=-13.5:TP=-1.5:LRA=11,atrim=0:${DUR}[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"

echo "mixed -> $OUT"
ffprobe -v error -show_entries format=duration -of default=nw=1 "$OUT"