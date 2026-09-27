#!/bin/bash
# frames.sh video.webm start_sec dur_sec fps crop(w:h:x:y) out.png cols
v=$1; ss=$2; t=$3; fps=$4; crop=$5; out=$6; cols=${7:-6}; sw=${8:-300}
tmp=$(mktemp -d)
ffmpeg -loglevel error -ss $ss -t $t -i "$v" -vf "fps=$fps,crop=$crop,scale=${sw}:-1" "$tmp/f_%03d.png"
n=$(ls $tmp | wc -l | tr -d ' ')
rows=$(( (n + cols - 1) / cols ))
ffmpeg -loglevel error -y -i "$tmp/f_%03d.png" -vf "tile=${cols}x${rows}:padding=4:color=black" -frames:v 1 "$out"
echo "$n frames -> $out"
rm -rf $tmp
