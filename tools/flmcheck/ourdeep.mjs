import fs from 'node:fs';
const { parseFlm } = await import('../../js/import/flm.js');
const f6 = (v) => v.toFixed(6), F = (v) => f6(Math.fround(v));
for (const file of process.argv.slice(2)) { const P = parseFlm(new Uint8Array(fs.readFileSync(file)).buffer); const out = [`## ${file.split('/').pop()}`];
  for (const ch of P.channels) { const n = ch.name;
    out.push(`${n}|chan|${(ch.rprm || []).slice(0, 6).map(F).join(',')}`);
    for (const m of ch.modules) out.push(`${n}|mod|${m.type}|${m.params.map(F).join(',')}`);
    for (const q of ch.pads) out.push(`${n}|pad|${q.cut}|${q.params.map(F).join(',')}`);
    for (const t of ch.tracks) for (const c of t.clips) {
      const K = { notes: 'Notes', drums: 'Drums', automation: 'Automation', audio: 'Audio' }[t.kind];
      out.push(`${n}|clip|${K}|${Math.round(c.pos * 128)}|${f6(c.lenFromCycle ? 0 : c.len)}|${f6(c.cycle)}|${f6(c.offset)}|${!!c.muted}`);
      if (t.kind === 'audio' && c.sample !== undefined) out.push(`${n}|smp|${c.stretchOn ? 1 : 0}|${f6(c.stretch ?? 1)}|${f6(c.pitch || 0)}|${(c.params || []).map(F).join(',')}`);
      for (const e of c.events) {
        const pos = Math.round(e.t * 128);
        if (t.kind === 'notes') out.push(`${n}|note|${pos}|${f6(e.len)}|${Math.min(127, e.pitch)}|${e.vel8}|${e.pan8}|${!!e.slide}`);
        else if (t.kind === 'drums') out.push(`${n}|drum|${pos}|${f6(e.len)}|${e.pitch}|${e.vel8}|${e.pan8}|${e.value}|${e.repeat & 255}`);
        else if (t.kind === 'automation') out.push(`${n}|auto|${pos}|${F(e.vel / 65535)}`);
        else out.push(`${n}|env|${pos}|${Math.abs(e.key ?? 0) - 1}|${F(e.vel / 65535)}`);
      } } }
  console.log(out.join('\n')); }
