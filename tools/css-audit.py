# CSS audit across the cascade (app -> live -> float -> ableton). Reports, and with --write removes:
#  - selectors that use a class / id no JS file or index.html mentions (dead rules),
#  - declarations a LATER rule with the identical selector overrides (same property, same or unconditional @media, importance not weaker).
# Usage: python3 tools/css-audit.py [--write]      Then verify visually: node tools/ui-shots.mjs before/after and compare.
# Classes built from string pieces at run time ('ph' + n) are not seen: check the reported names before using --write.
import re, sys, glob
FILES = ['css/app.css', 'css/live.css', 'css/float.css', 'css/ableton.css']
src = open('index.html').read() + ''.join(open(f).read() for f in glob.glob('js/**/*.js', recursive=True))
WORDS = set(re.findall(r'[A-Za-z_][\w-]*', src))
DEAD = set()
FALLBACK = re.compile(r'dvh|svh|lvh|dvw|color-mix|-webkit-|-moz-')

def split_top(s, ch):
    out, depth, q, start = [], 0, None, 0
    for i, c in enumerate(s):
        if q:
            if c == q: q = None
        elif c in '"\'': q = c
        elif c in '([': depth += 1
        elif c in ')]': depth -= 1
        elif c == ch and depth == 0: out.append((start, i)); start = i + 1
    out.append((start, len(s)))
    return out

def parse(text):
    rules = []   # dict(ctx, sel_span, sels, block_span, decls[(prop, val, imp, start, end)])
    i, n = 0, len(text)
    def skip_ws_comments(i):
        while i < n:
            if text.startswith('/*', i): i = text.index('*/', i) + 2
            elif text[i].isspace(): i += 1
            else: break
        return i
    def parse_block(i, ctx, end_char):
        while True:
            i = skip_ws_comments(i)
            if i >= n or text[i] == '}': return i + 1
            j = i
            while text[j] != '{':
                if text.startswith('/*', j): j = text.index('*/', j) + 2
                else: j += 1
            prelude = text[i:j].strip()
            if prelude.startswith('@media') or prelude.startswith('@supports'):
                i = parse_block(j + 1, prelude, '}')
                continue
            depth, k = 1, j + 1
            while depth:
                if text.startswith('/*', k): k = text.index('*/', k) + 2; continue
                if text[k] == '{': depth += 1
                elif text[k] == '}': depth -= 1
                k += 1
            if not prelude.startswith('@'):
                body = text[j + 1:k - 1]
                decls = []
                for a, b in split_top(body, ';'):
                    raw = body[a:b]
                    stripped = re.sub(r'/\*.*?\*/', '', raw, flags=re.S)
                    if ':' not in stripped: continue
                    p, v = stripped.split(':', 1)
                    imp = '!important' in v
                    s0 = j + 1 + a + (len(raw) - len(raw.lstrip()))
                    e0 = j + 1 + b + (1 if b < len(body) else 0)
                    decls.append(dict(prop=p.strip().lower(), val=v.replace('!important', '').strip(), imp=imp, s=s0, e=e0))
                sels = [re.sub(r'\s+', ' ', prelude[a:b].strip()) for a, b in split_top(prelude, ',')]
                rules.append(dict(ctx=ctx, sels=sels, ps=i, pe=j, bs=j, be=k, decls=decls))
            i = k
    parse_block(0, '', None)
    return rules

texts = {f: open(f).read() for f in FILES}
for f in FILES:
    for m in re.finditer(r'([^{}]+)\{', re.sub(r'/\*.*?\*/', '', texts[f], flags=re.S)):
        if not m.group(1).strip().startswith('@'): DEAD.update(nm for nm in re.findall(r'[.#]([A-Za-z_][\w-]*)', m.group(1)) if nm not in WORDS)
print('dead class / id names:', sorted(DEAD))
allr = []
for fi, f in enumerate(FILES):
    for r in parse(texts[f]):
        r['f'] = f; allr.append(r)
# override analysis
edits = {f: [] for f in FILES}
removed_decls = 0
later = {}   # (sel, prop) -> list of (ctx, imp, val) from later rules ; walk backwards
for r in reversed(allr):
    for d in r['decls']:
        ok = True
        for s in r['sels']:
            hits = later.get((s, d['prop']), [])
            if not any((c == '' or c == r['ctx']) and (imp or not d['imp']) and not FALLBACK.search(v) for c, imp, v in hits): ok = False; break
        if ok and r['sels']:
            edits[r['f']].append((d['s'], d['e'], '')); removed_decls += 1; d['gone'] = True
    for d in r['decls']:
        for s in r['sels']: later.setdefault((s, d['prop']), []).append((r['ctx'], d['imp'], d['val']))
# dead selectors / empty rules
removed_rules = removed_sels = 0
for r in allr:
    keep = [s for s in r['sels'] if not any(nm in DEAD for nm in re.findall(r'[.#]([A-Za-z_][\w-]*)', s))]
    alive = [d for d in r['decls'] if not d.get('gone')]
    if not keep or not alive:
        edits[r['f']] = [e for e in edits[r['f']] if not (r['bs'] <= e[0] < r['be'])]
        edits[r['f']].append((r['ps'], r['be'], '')); removed_rules += 1
    elif len(keep) < len(r['sels']):
        edits[r['f']].append((r['ps'], r['pe'], ', '.join(keep) + ' ')); removed_sels += len(r['sels']) - len(keep)
for f in FILES:
    t = texts[f]
    for s, e, rep in sorted(edits[f], key=lambda x: -x[0]): t = t[:s] + rep + t[e:]
    t = re.sub(r'[ \t]+\n', '\n', t); t = re.sub(r'\n{3,}', '\n\n', t)
    if '--write' in sys.argv: open(f, 'w').write(t)
print('overridden declarations removed:', removed_decls, 'rules removed:', removed_rules, 'selectors removed:', removed_sels)
