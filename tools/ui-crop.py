#!/usr/bin/env python3
"""Crop every card out of the ui-audit full-screen shots: python3 -I tools/ui-crop.py <audit.json> <shotdir> <outdir>
The audit's rects are in layout px (the app's UI scale); the shot is CSS px x DPR, so rect x (shot width / innerWidth)."""
import json, sys, os
from PIL import Image
rep = json.load(open(sys.argv[1]))['report']; sd, od = sys.argv[2], sys.argv[3]; os.makedirs(od, exist_ok=True)
for r in rep:
    f = os.path.join(sd, '%s-%s.png' % (r['kind'], r['t']))
    if not os.path.exists(f) or 'rect' not in r: continue
    im = Image.open(f); s = im.width / r['iw']; x, y, w, h = [v * s for v in r['rect']]
    im.crop((max(0, int(x)), max(0, int(y)), min(im.width, int(x + w)), min(im.height, int(y + h)))).save(os.path.join(od, 'card-%s-%s.png' % (r['kind'], r['t'])))
