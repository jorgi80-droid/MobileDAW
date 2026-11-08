#!/bin/bash
# usage: score.sh <tag>  -> prints "type name score" for every mapped device
SP=/tmp/claude-0/-home-user-MobileDAW/c47664c0-803d-5780-beca-8d2b625e3853/scratchpad; cd $SP
while read n t; do
  [ -f fxr/ours/card-$t.png ] || { echo "$t missing"; continue; }
  python3 -I -c "from PIL import Image; Image.open('fxr/ours/card-$t.png').convert('RGB').save('fxr/o-$t.png')"
  python3 -I rep2/crop.py fxr/o-$t.png fxr/oc-$t.png >/dev/null
  s=$(python3 -I /home/user/MobileDAW/tools/imgdiff.py fxr/ref-$t.png fxr/oc-$t.png --json | python3 -I -c "import json,sys; print(json.load(sys.stdin)['score'])")
  echo "$t $s"
done < fxr/map.txt
