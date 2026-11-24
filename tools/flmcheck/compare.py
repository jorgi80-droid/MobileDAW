# Compare Honeydew's FLM reader with MobileDAW's, value by value (see README.md). Usage: python3 -I compare.py honeydew.txt mobiledaw.txt
import sys, collections
def sec(p):
    o, cur = {}, None
    for l in open(p).read().splitlines():
        if l.startswith('##'): cur = l; o[cur] = collections.Counter(); continue
        parts = l.split('|')
        if parts[1] == 'pad': l = '|'.join(parts[:4])                                   # Honeydew also prints the slot's stretch fields
        if parts[1] == 'mod': l = '|'.join(parts[:3]) + '|' + ','.join(parts[3].split(',')[:3])   # Honeydew pads params to the module spec
        o[cur][l] += 1
    return o
H, U = sec(sys.argv[1]), sec(sys.argv[2]); bad = 0
for k in H:
    d1 = H[k] - U.get(k, collections.Counter())
    real = [x for x in d1 if not x.endswith('0.007812|false')]   # Rust rounds 0.0078125 half-to-even, JS up: same f64
    bad += len(real); print(k, 'items', sum(H[k].values()), 'differ', len(real))
    for x in real[:5]: print('   ', x[:200])
sys.exit(1 if bad else 0)
