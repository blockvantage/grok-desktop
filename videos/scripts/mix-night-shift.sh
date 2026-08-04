#!/usr/bin/env bash
# Mix: silent hyperframes picture + music splice / VO close / SFX -> delivered master.
# Beat-led film on music_final (99.9 BPM, kick phase 0.000, B=0.6006006).
# Music arrangement is built HERE (bar-aligned splices, all at kick instants):
#   film 0        -> bt36 21.622 : track 0.000 -> 21.622  (groove + natural quiet dip)
#   film bt36     -> bt48 28.829 : track bt8 4.805 -> bt20 12.012 (dawn bloom, +lift)
#   film bt48     -> bt58 34.835 : track bt40 24.024 -> bt50 30.030 (decay tail)
#   film bt58     -> 36.033      : silence (the music falls asleep before the film ends)
# George close (4.087s) at bt48.5 = 29.129s. SFX on the grid (ms = round(bt*1000)):
#   tick @bt11 6607 (goal card) · riser bt34->bt36 (pre-dawn breath, lavfi pink)
#   soft impact @bt36 21622 (full-bleed lands) · bell @bt48 28829 (brand)
#   click @bt55 33033 (the wink).
# Usage: videos/scripts/mix-night-shift.sh <picture.mp4> <out.mp4>   (ABSOLUTE paths)
set -euo pipefail
cd "$(dirname "$0")/.."   # -> videos/

PIC="${1:?picture mp4}"
OUT="${2:?output mp4}"
DUR=36.033                                  # bt(60), 1081 frames @30fps
A=assets/audio/night-shift
K=assets/audio/sfx/kit

ffmpeg -y -loglevel error \
  -i "$PIC" \
  -i "$A/vo_george_close.mp3" \
  -i "$A/music_final.mp3" \
  -i "$K/interface/select_008.ogg" \
  -f lavfi -i "anoisesrc=d=1.30:c=pink:a=0.28:r=48000" \
  -i "$K/impact/impactSoft_medium_001.ogg" \
  -i "$K/impact/impactBell_heavy_000.ogg" \
  -i "$K/interface/select_008.ogg" \
  -filter_complex "\
[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=29129|29129,asplit=2[voA][voB];\
[2:a]aresample=48000,aformat=channel_layouts=stereo,asplit=3[mA][mB][mC];\
[mA]atrim=0:21.502,asetpts=PTS-STARTPTS,afade=t=out:st=21.442:d=0.060[segA];\
aevalsrc=0:d=0.120:s=48000,aformat=channel_layouts=stereo[gap];\
[mB]atrim=4.805:12.012,asetpts=PTS-STARTPTS,volume=1.12[segB];\
[mC]atrim=24.024:30.030,asetpts=PTS-STARTPTS[segC];\
[segA][gap][segB][segC]concat=n=4:v=0:a=1,volume=0.55[mus];\
[mus][voB]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=420:makeup=1[musd];\
[3:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.30,adelay=6607|6607[tick];\
[4:a]afade=t=in:st=0:d=1.15,afade=t=out:st=1.15:d=0.15,highpass=f=320,lowpass=f=2600,pan=stereo|c0=c0|c1=c0,adelay=20420|20420,volume=0.30[riser];\
[5:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.45,adelay=21622|21622[land];\
[6:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.34,adelay=28829|28829[bell];\
[7:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=0.40,adelay=33033|33033[click];\
[voA][musd][tick][riser][land][bell][click]amix=inputs=7:duration=longest:normalize=0,\
apad=whole_dur=${DUR},loudnorm=I=-11.6:TP=-1.5:LRA=11,atrim=0:${DUR}[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -t ${DUR} "$OUT"

echo "mixed -> $OUT"
ffprobe -v error -show_entries format=duration -of default=nw=1 "$OUT"
