#!/usr/bin/env bash
# Dense-frame + duration + loudness audit of a MIXED master (verify the master, not the render).
# Usage: videos/scripts/audit-out-of-the-terminal.sh <master.mp4>
set -euo pipefail
MASTER="${1:?master mp4}"
OUTDIR="videos/out/_audit_$(basename "$MASTER" .mp4)"
mkdir -p "$OUTDIR"

# Dense frames (4 fps, 540px wide) for legibility/beat reading
ffmpeg -y -v error -i "$MASTER" -vf "fps=4,scale=540:-1" "$OUTDIR/f_%04d.jpg"
echo "frames -> $OUTDIR ($(ls "$OUTDIR"/f_*.jpg | wc -l | tr -d ' ') frames)"

echo -n "duration: "
ffprobe -v error -show_entries format=duration -of csv=p=0 "$MASTER"

echo -n "loudness (I): "
ffmpeg -nostats -i "$MASTER" -af "ebur128=framelog=verbose" -f null - 2>&1 | grep "I:" | tail -1
