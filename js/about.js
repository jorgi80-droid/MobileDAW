// About tab: what MobileDAW is, who makes it, and the code it is written in (GitHub-style Languages bar).
import { h } from './ui.js';
import { LANGS } from './aboutdata.js';

const USER_AV = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="11"/><path d="M10 58c1.5-12 10.5-19 22-19s20.5 7 22 19z"/></svg>';
// original monogram for the AI contributor (not a brand logo): a "C" with a small spark on a gradient disc
const CLAUDE_AV = '<svg viewBox="0 0 64 64" aria-hidden="true"><text x="31" y="43" text-anchor="middle">C</text><path class="ab-spk" d="M49 11l1.7 4.6 4.6 1.7-4.6 1.7L49 24.6l-1.7-4.6L42.7 18.3l4.6-1.7z"/></svg>';
const fmtPct = (p) => (p < 0.1 ? '<0.1' : p.toFixed(1)) + '%';
const fmtKB = (b) => (b / 1024 >= 100 ? Math.round(b / 1024) : (b / 1024).toFixed(1)) + ' KB';

function person(name, role, kind) {
  const av = h('div', { class: 'ab-av ab-' + kind });
  av.innerHTML = kind === 'user' ? USER_AV : CLAUDE_AV;
  return h('div', { class: 'ab-person' }, av, h('div', { class: 'ab-pn' }, h('b', {}, name), h('span', {}, role)));
}

function languages() {
  const total = LANGS.reduce((s, l) => s + l.bytes, 0) || 1;
  const files = LANGS.reduce((s, l) => s + l.files, 0), lines = LANGS.reduce((s, l) => s + l.lines, 0);
  const bar = h('div', { class: 'ab-bar', role: 'img', 'aria-label': 'Bahasa pemrograman: ' + LANGS.map((l) => l.name + ' ' + fmtPct(l.bytes / total * 100)).join(', ') });
  for (const l of LANGS) bar.append(h('i', { style: `flex:${l.bytes};background:${l.color}`, title: l.name }));
  const legend = h('div', { class: 'ab-leg' });
  for (const l of LANGS) legend.append(h('span', { class: 'ab-lg' }, h('i', { style: 'background:' + l.color }), h('b', {}, l.name), ' ' + fmtPct(l.bytes / total * 100)));
  const stats = h('div', { class: 'ab-stats' });
  for (const l of LANGS) stats.append(h('div', { class: 'ab-row' }, h('span', { class: 'ab-rn' }, h('i', { style: 'background:' + l.color }), l.name), h('span', { class: 'ab-rv' }, `${l.files} file · ${l.lines.toLocaleString('id-ID')} baris · ${fmtKB(l.bytes)}`)));
  const totalRow = h('div', { class: 'ab-total' }, h('span', {}, 'Total'), h('span', {}, `${files} file · ${lines.toLocaleString('id-ID')} baris`));
  return [bar, legend, h('div', { class: 'ab-statbox' }, stats, totalRow)];
}

export function aboutTabs() {
  const sec = (title, ...kids) => h('div', { class: 'set ab-sec' }, h('h4', {}, title), ...kids);
  const chip = (t) => h('span', { class: 'ab-chip' }, t);
  const hero = h('div', { class: 'ab-hero' },
    h('div', { class: 'ab-iconwrap' }, h('img', { class: 'ab-ic', src: 'icons/icon-192.png', alt: '', width: 64, height: 64 })),
    h('div', { class: 'ab-htext' },
      h('div', { class: 'ab-title' }, 'MobileDAW'),
      h('div', { class: 'ab-tag' }, 'DAW seluler berbasis web · terinspirasi Ableton Live'),
      h('div', { class: 'ab-chips' }, chip('Offline'), chip('Web Audio'), chip('Engine C++'), chip('PWA'))));
  return [
    hero,
    sec('Tentang', h('div', { class: 'sv' }, 'Timeline, mixer, piano roll, step sequencer, sampler, synth, dan efek — semuanya berjalan di browser dengan Web Audio dan AudioWorklet, atau di engine C++ native pada aplikasi Android. Proyek disimpan sebagai berkas .mdaw dan audio diproses tanpa server.')),
    sec('Kontributor', h('div', { class: 'ab-people' }, person('JORGYRMX', 'Maintainer', 'user'), person('Claude', 'AI pair-programmer', 'claude'))),
    sec('Bahasa', ...languages()),
    h('div', { class: 'ab-foot' }, 'Dibangun dengan ', h('b', {}, 'Claude Code'), ' · MobileDAW'),
  ];
}
