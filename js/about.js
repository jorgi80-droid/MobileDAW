// About tab: what MobileDAW is, who makes it, and the code it is written in (GitHub-style Languages bar).
import { h } from './ui.js';
import { LANGS } from './aboutdata.js';

const AVATAR = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="11"/><path d="M10 58c1.5-12 10.5-19 22-19s20.5 7 22 19z"/></svg>';
const fmtPct = (p) => (p < 0.1 ? '<0.1' : p.toFixed(1)) + '%';
const fmtKB = (b) => (b / 1024 >= 100 ? Math.round(b / 1024) : (b / 1024).toFixed(1)) + ' KB';

function person(name, role, avatar) {
  const av = h('div', { class: 'ab-av' + (avatar === 'empty' ? ' empty' : ' mark') });
  if (avatar === 'empty') av.innerHTML = AVATAR; else av.textContent = avatar;
  return h('div', { class: 'ab-person' }, av, h('div', { class: 'ab-pn' }, h('b', {}, name), h('span', {}, role)));
}

function languages() {
  const total = LANGS.reduce((s, l) => s + l.bytes, 0) || 1;
  const bar = h('div', { class: 'ab-bar', role: 'img', 'aria-label': 'Bahasa pemrograman: ' + LANGS.map((l) => l.name + ' ' + fmtPct(l.bytes / total * 100)).join(', ') });
  for (const l of LANGS) bar.append(h('i', { style: `flex:${l.bytes};background:${l.color}`, title: l.name }));
  const legend = h('div', { class: 'ab-leg' });
  for (const l of LANGS) legend.append(h('span', { class: 'ab-lg' }, h('i', { style: 'background:' + l.color }), h('b', {}, l.name), ' ' + fmtPct(l.bytes / total * 100)));
  const stats = h('div', { class: 'ab-stats' });
  for (const l of LANGS) stats.append(h('div', { class: 'ab-row' }, h('span', {}, l.name), h('span', {}, `${l.files} file \u2022 ${l.lines.toLocaleString('id-ID')} baris \u2022 ${fmtKB(l.bytes)}`)));
  return [bar, legend, stats];
}

export function aboutTabs() {
  const sec = (title, ...kids) => h('div', { class: 'set' }, h('h4', {}, title), ...kids);
  const hero = h('div', { class: 'ab-hero' },
    h('img', { class: 'ab-ic', src: 'icons/icon-192.png', alt: '', width: 56, height: 56 }),
    h('div', {}, h('div', { class: 'ab-title' }, 'MobileDAW'), h('div', { class: 'sv' }, 'DAW seluler berbasis web dengan tampilan terinspirasi Ableton Live. Berjalan offline sebagai aplikasi terpasang.')));
  return [
    hero,
    sec('Informasi', h('div', { class: 'sv' }, 'Timeline, mixer, piano roll, step sequencer, sampler, synth, dan efek, semuanya berjalan di browser dengan Web Audio dan AudioWorklet. Proyek disimpan sebagai berkas .mdaw dan audio diproses tanpa server.')),
    sec('Contributors', h('div', { class: 'ab-people' }, person('JORGYRMX', 'Maintainer', 'empty'), person('Claude', 'Contributor', 'C'))),
    sec('Languages', ...languages()),
  ];
}
