#!/usr/bin/env bash
# Mix: silent hyperframes picture + VO/music/SFX stems -> delivered master.
# Model: payverge mix-table-center-v12.sh (VO-led, sidechain duck, -14 LUFS).
# Usage: videos/scripts/mix-escape-the-terminal.sh <picture.mp4> <out.mp4>   (ABSOLUTE paths)
set -euo pipefail
cd "$(dirname "$0")/.."   # -> videos/

PIC="${1:?picture mp4}"
OUT="${2:?output mp4}"
DUR=24.90                                   # from timing.md (747 frames @30fps)
A=assets/audio/escape-the-terminal
K=assets/audio/sfx/kit

# VO_OFFSET 1.20s (cursor-void holds in near-silence first). music_cand_a phase 0.000 -> no atrim.
# SFX keyed to W word times (ms): low whoosh @W.desk 4940 (the spill); soft drop @W.there 13740
# (full-bleed lands); warm bell @W.brand 16100; key-click @21600 (the wink, after VO ends 20.40).
ffmpeg -y -loglevel error \
  -i "$PIC" \
  -i "$A/vo_george_take1.mp3" \
  -i "$A/music_cand_a.mp3" \
  -i "$K/impact/impactSoft_medium_001.ogg" \
  -i "$K/interface/drop_001.ogg" \
  -i "$K/impact/impactBell_heavy_000.ogg" \
  -i "$K/interface/select_008.ogg" \
  -filter_complex "\
[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=1200|1200,asplit=2[voA][voB];\
[2:a]aresample=48000,volume=0.32,afade=t=out:st=23.0:d=1.9[mus];\
[mus][voB]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=420:makeup=1[musd];\
[3:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.40,adelay=4940|4940[whoosh];\
[4:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.30,adelay=13740|13740[drop];\
[5:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.36,adelay=16100|16100[bell];\
[6:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.42,adelay=21600|21600[click];\
[voA][musd][whoosh][drop][bell][click]amix=inputs=6:duration=longest:normalize=0,\
apad=whole_dur=${DUR},loudnorm=I=-13.5:TP=-1.5:LRA=11,atrim=0:${DUR}[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"

echo "mixed -> $OUT"
ffprobe -v error -show_entries format=duration -of default=nw=1 "$OUT"
