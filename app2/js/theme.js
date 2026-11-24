// Themes (Live-style dark / light / black). CSS variables for the DOM, and C() for colours drawn on canvases:
// neutral greys are remapped per theme, hue colours (clips, accents, meters) stay as they are.
const THEMES = {
  dark:  { '--warn': '#e8d040', '--ok-ink': '#5fd08a', '--bad-ink': '#ff6a6f', '--on-col': '#15151a', '--lv-title': '#4a4a4e', '--lv-body': '#343437', '--lv-well': '#1c1c1e', '--lv-ctl': '#55555a', '--lv-ctl2': '#66666c', '--lv-ink': '#e4e4e6', '--lv-dim': '#a0a0a6', '--lv-edge': '#08080a', '--lv-trk': '#5f5f66', '--lv-sel': '#3f8ea0', '--lv-div': '#131316', '--lv-arc': '#4fc3f0', '--lv-or': '#ffad32', '--lv-orink': '#ffad32', '--mx-bg': '#121213', '--mx-strip': '#242426', '--mx-strip-sel': '#2f2f33', '--mx-well': '#101011', '--bg': '#1b1b1c', '--panel': '#242426', '--panel2': '#2d2d30', '--raise': '#38383c', '--raise2': '#4a4a50', '--line': '#08080a', '--sep': '#0e0e10', '--menu': '#2f2f33', '--well': '#17171a', '--text': '#cfcfd2', '--dim': '#8b8b92', '--accent': '#ffa722', '--accent-ink': '#1a1100', '--play': '#5bd876', '--rec': '#e5484d', '--ok': '#7ac555', '--key-w': '#d9d9dd', '--key-b': '#1d1d20', '--key-bhit': '#b97409', '--key-ink': '#444448', '--mute': '#f2c744', '--solo': '#4fa3e0', '--c0': '#000000', '--c255': '#ffffff', '--shadow': '#000000aa', '--scrim': '#00000066', '--toast': '#000000dd', '--toast-ink': '#ffffff' },
  live : { '--warn': '#e8d040', '--ok-ink': '#5fd08a', '--bad-ink': '#ff6a6f', '--on-col': '#15151a', '--lv-title': '#626262', '--lv-body': '#565656', '--lv-well': '#3a3a3a', '--lv-ctl': '#6a6a6a', '--lv-ctl2': '#7c7c7c', '--lv-ink': '#f0f0f0', '--lv-dim': '#c4c4c4', '--lv-edge': '#2a2a2a', '--lv-trk': '#8a8a8a', '--lv-sel': '#4aa6bb', '--lv-div': '#3d3d3d', '--lv-orink': '#ffad32', '--mx-bg': '#3f3f3f', '--mx-strip': '#565656', '--mx-strip-sel': '#666666', '--mx-well': '#3a3a3a', '--bg': '#484848', '--panel': '#565656', '--panel2': '#4f4f4f', '--raise': '#6a6a6a', '--raise2': '#7c7c7c', '--line': '#2a2a2a', '--sep': '#3d3d3d', '--menu': '#5c5c5c', '--well': '#3a3a3a', '--text': '#efefef', '--dim': '#b8b8b8', '--key-w': '#e6e6e6', '--key-b': '#2a2a2a', '--key-ink': '#4a4a4a', '--c0': '#000000', '--c255': '#ffffff', '--shadow': '#00000088', '--scrim': '#00000055', '--toast': '#000000dd', '--toast-ink': '#ffffff', '--lv-arc': '#4fc3f0', '--lv-or': '#ffad32', '--accent': '#ffa722', '--accent-ink': '#1a1100', '--play': '#5bd876', '--rec': '#e5484d', '--ok': '#7ac555', '--mute': '#f2c744', '--solo': '#4fa3e0', '--key-bhit': '#c98a1a' },
  light: { '--warn': '#8a6500', '--ok-ink': '#1f7a42', '--bad-ink': '#c2262c', '--on-col': '#15151a', '--lv-title': '#b4b4b4', '--lv-body': '#c9c9c9', '--lv-well': '#aeaeae', '--lv-ctl': '#e4e4e4', '--lv-ctl2': '#f1f1f1', '--lv-ink': '#121212', '--lv-dim': '#454545', '--lv-edge': '#8c8c8c', '--lv-trk': '#8f8f8f', '--lv-sel': '#3b93a8', '--lv-div': '#a4a4a4', '--lv-orink': '#7a4500', '--mx-bg': '#bdbdbd', '--mx-strip': '#cfcfcf', '--mx-strip-sel': '#dedede', '--mx-well': '#b0b0b0', '--bg': '#d6d6d6', '--panel': '#c9c9c9', '--panel2': '#c0c0c0', '--raise': '#e4e4e4', '--raise2': '#d2d2d2', '--line': '#8c8c8c', '--sep': '#aaaaaa', '--menu': '#ececec', '--well': '#b4b4b4', '--text': '#111111', '--dim': '#4a4a4a', '--key-w': '#ffffff', '--key-b': '#2a2a2a', '--key-ink': '#555555', '--c0': '#f7f7f7', '--c255': '#000000', '--shadow': '#00000044', '--scrim': '#00000040', '--toast': '#222222ee', '--toast-ink': '#ffffff', '--lv-arc': '#4fc3f0', '--lv-or': '#ffad32', '--accent': '#ffa722', '--accent-ink': '#1a1100', '--play': '#5bd876', '--rec': '#e5484d', '--ok': '#7ac555', '--mute': '#f2c744', '--solo': '#4fa3e0', '--key-bhit': '#c97800' },
  black: { '--warn': '#e8d040', '--ok-ink': '#5fd08a', '--bad-ink': '#ff6a6f', '--on-col': '#15151a', '--lv-title': '#1b1b1d', '--lv-body': '#0c0c0d', '--lv-well': '#000000', '--lv-ctl': '#27272b', '--lv-ctl2': '#35353b', '--lv-ink': '#e6e6e8', '--lv-dim': '#8c8c92', '--lv-edge': '#000000', '--lv-trk': '#3b3b41', '--lv-sel': '#2f7384', '--lv-div': '#050506', '--lv-arc': '#4fc3f0', '--lv-or': '#ffad32', '--lv-orink': '#ffad32', '--mx-bg': '#000000', '--mx-strip': '#0b0b0c', '--mx-strip-sel': '#161618', '--mx-well': '#000000', '--bg': '#000000', '--panel': '#0b0b0c', '--panel2': '#141416', '--raise': '#222225', '--raise2': '#333338', '--line': '#000000', '--sep': '#0a0a0b', '--menu': '#161618', '--well': '#0a0a0b', '--text': '#d2d2d6', '--dim': '#85858c', '--accent': '#ffa722', '--accent-ink': '#1a1100', '--play': '#5bd876', '--rec': '#e5484d', '--ok': '#7ac555', '--key-w': '#c8c8cc', '--key-b': '#111113', '--key-bhit': '#a86608', '--key-ink': '#3a3a3e', '--mute': '#f2c744', '--solo': '#4fa3e0', '--c0': '#000000', '--c255': '#ffffff', '--shadow': '#000000cc', '--scrim': '#00000099', '--toast': '#1c1c1eee', '--toast-ink': '#ffffff' },
};
// Theme library inspired by Live's built-in themes. Each one is derived from a base theme: every neutral grey token is passed through
// lightness = a + b * lightness (brightness / contrast), hue colours (clips, accent, record, meters) stay as they are - like in Live.
// `tone` picks the base CSS rules ([data-theme] selectors): 'light' themes reuse every light-theme rule.
const LIB = {
  middark:  { name: 'Mid Dark',                 base: 'dark',  a: 22, b: 0.96 },
  lowc:     { name: 'Dark Neutral Low Contrast', base: 'dark',  a: 26, b: 0.82 },
  highc:    { name: 'Dark Neutral High Contrast', base: 'dark', a: -8, b: 1.14 },
  medc:     { name: 'Dark Neutral Medium Contrast', base: 'dark', a: 10, b: 0.98 },
  // Live 12's default dark theme (refs/live12-official 01-03): the greys a little lighter and cool - lanes about #2c2e35, panels #23252a
  // Live 12's light theme (refs/live12-official 04): cool greys - lanes / ruler / header #a1a5ae, the alternate bands #989ca5
  live12light: { name: 'Light (Live 12)', base: 'light', a: -33, b: 1.0, tint: [0, 4, 13], over: { '--line': '#3a3c43', '--sep': '#55585f', '--tb-bg': '#7d818d', '--tb-fld': '#a1a5ae', '--hd-bg': '#a1a5ae', '--hd-bgsel': '#b4b8c1', '--hd-fld': '#d2d4da', '--hd-ink': '#0f1014', '--hd-ink2': '#0f1014', '--hd-bd': '#3a3c43', '--hd-line': '#3a3c43', '--hd-well': '#e1e2e7', '--hd-vol': '#05c9d9', '--hd-vink': '#0f1014', '--hd-mw': '#a1a5ae', '--hd-mb': '#3a3c43', '--tb-line': '#3a3c43', '--tb-ico': '#0f1014', '--btn-bd': '#3a3c43' } },
  // MobileDAW 2's own theme: warm charcoal greys, cream accent (playhead, selection, active tools), a deep red record button
  studio:   { name: 'Studio (MobileDAW 2)', base: 'dark', a: 4, b: 0.99, tint: [9, 5, 0], over: { '--accent': '#e8dcc4', '--accent-ink': '#1c1915', '--text': '#e4dccf', '--dim': '#9b9287',
    '--rec': '#d6303d', '--play': '#e8dcc4', '--lv-or': '#e8dcc4', '--lv-orink': '#e8dcc4', '--menu': '#36322e', '--toast': '#e8dcc4ee', '--toast-ink': '#1c1915' } },
  live12:   { name: 'Dark (Live 12)', base: 'dark', a: 10, b: 0.96, tint: [-2, 0, 12], over: { '--tb-bg': '#272a33', '--tb-fld': '#333541', '--tb-line': '#1c1e25', '--tb-ico': '#d4d5db', '--btn-bd': '#16171c' } },   // lanes / ruler #323440 as sampled from refs/live12-official/02
  lightmc:  { name: 'Light Neutral Medium Contrast', base: 'light', a: -26, b: 1.04 },
  lightlc:  { name: 'Light Neutral Low Contrast', base: 'light', a: -8, b: 0.86 },
  midlight: { name: 'Mid Light',                base: 'light', a: -42, b: 1.0 },
  lighthc:  { name: 'Light Neutral High Contrast', base: 'light', a: -14, b: 1.1 },
  // the device panels of the owner's Ableton Live screenshots, colours measured in them: title bar #a5a5a5, body #878787, dark display #282828,
  // button face #a8a8a8 with a #515151 border, black text, orange #fdb443; the other greys follow the light theme shifted down to that body
  // Light = Live 12's light theme, every value sampled from the owner's reference (refs/live12-official/04): window frame and control bar #7d818d,
  // panels / lanes / ruler / device bodies #a1a5ae, the alternate bands #989ca5, device title bars #bbbbc5, displays #21252e, menus #dedfe3
  ableton:  { name: 'Light (Ableton Live)',  base: 'light', a: -33, b: 1.0, tint: [0, 4, 13], over: {
    '--lv-title': '#bbbbc5', '--lv-body': '#a1a5ae', '--lv-well': '#21252e', '--lv-ctl': '#b9bcc5', '--lv-ctl2': '#c6c9d1', '--lv-ink': '#0f1014', '--lv-dim': '#2e3038', '--lv-edge': '#7d818d',
    '--lv-trk': '#4e525c', '--lv-div': '#7d818d', '--lv-arc': '#05c9d9', '--lv-or': '#fdb443', '--lv-orink': '#1a1100', '--dim': '#2e3038', '--text': '#0f1014',
    '--menu': '#dedfe3', '--tb-bg': '#7d818d', '--tb-fld': '#a1a5ae', '--line': '#3a3c43', '--sep': '#55585f', '--hd-bg': '#a1a5ae', '--hd-bgsel': '#b4b8c1', '--hd-fld': '#d2d4da', '--hd-ink': '#0f1014', '--hd-ink2': '#0f1014', '--hd-bd': '#3a3c43', '--hd-line': '#3a3c43', '--hd-well': '#e1e2e7', '--hd-vol': '#05c9d9', '--hd-vink': '#0f1014', '--hd-mw': '#a1a5ae', '--hd-mb': '#3a3c43', '--tb-line': '#3a3c43', '--tb-ico': '#0f1014', '--btn-bd': '#3a3c43' } },
};
const grey = (hex) => { const h = hex.slice(1, 7), [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b) < 14 ? (r + g + b) / 3 : -1; };
for (const [id, t] of Object.entries(LIB)) {
  const src = THEMES[t.base], out = {};
  for (const [k, v] of Object.entries(src)) {
    const L = typeof v === 'string' && /^#[0-9a-f]{6}/i.test(v) && k !== '--c0' && k !== '--c255' ? grey(v) : -1;
    if (L < 0) { out[k] = v; continue; }
    const g = Math.max(0, Math.min(255, Math.round(t.a + t.b * L))), d = t.tint || [0, 0, 0], hx2 = (q) => Math.max(0, Math.min(255, q)).toString(16).padStart(2, '0');
    out[k] = '#' + hx2(g + d[0]) + hx2(g + d[1]) + hx2(g + d[2]) + v.slice(7);
  }
  if (t.over) Object.assign(out, t.over);
  THEMES[id] = out;
}
// the Light theme IS the Ableton Live reference palette (owner's request: 'pakai tema light'); the derived Mid Light / High Contrast themes were built from the old values above
THEMES.light = THEMES.ableton; delete THEMES.ableton;
// Material You (Material 3, dark, the baseline tonal palette of Android / Pixel): tonal surfaces from the neutral palette, a soft primary for what
// is on, a deep primary container as the ink on it. MobileDAW 2's default theme.
THEMES.materialyou = { ...THEMES.dark, '--bg': '#141218', '--panel': '#1d1b20', '--panel2': '#211f26', '--raise': '#2b2930', '--raise2': '#36343b', '--line': '#0f0d13', '--sep': '#1d1b20',
  '--menu': '#2b2930', '--well': '#0f0d13', '--text': '#e6e0e9', '--dim': '#cac4d0', '--accent': '#d0bcff', '--accent-ink': '#381e72', '--play': '#d0bcff', '--rec': '#f2766b', '--ok': '#9ad3a0',
  '--mute': '#efb8c8', '--solo': '#ccc2dc', '--key-w': '#e6e0e9', '--key-b': '#1d1b20', '--key-ink': '#49454f', '--toast': '#e6e0e9ee', '--toast-ink': '#322f35' };
// MobileDAW 2: every view uses the same surfaces. The device cards, the mixer, the browser and the editors read the Live tokens (--lv-*, --mx-*):
// here they follow each theme's own panel / background / text / accent, so modules and mixer look like the rest of the app in every theme.
for (const t of Object.values(THEMES)) {
  Object.assign(t, { '--lv-title': t['--raise'], '--lv-body': t['--panel2'], '--lv-well': t['--bg'], '--lv-ctl': t['--raise'], '--lv-ctl2': t['--raise2'], '--lv-ink': t['--text'], '--lv-dim': t['--dim'],
    '--lv-edge': t['--line'], '--lv-div': t['--line'], '--lv-sel': t['--accent'], '--lv-or': t['--accent'], '--lv-orink': t['--accent'], '--lv-arc': t['--accent'], '--lv-trk': t['--raise2'],
    '--mx-bg': t['--bg'], '--mx-strip': t['--panel'], '--mx-strip-sel': t['--panel2'], '--mx-well': t['--bg'], '--menu': t['--menu'] || t['--panel2'] });
}
export const THEME_TONE = { live12light: 'light', light: 'light', midlight: 'light', lighthc: 'light', lightmc: 'light', lightlc: 'light' };
export const THEME_NAMES = { materialyou: 'Material You', studio: 'Studio (MobileDAW 2)', dark: 'Dark', middark: 'Mid Dark', lowc: 'Dark Neutral Low Contrast', live12: 'Dark (Live 12)', live12light: 'Light (Live 12)', medc: 'Dark Neutral Medium Contrast', highc: 'Dark Neutral High Contrast', live: 'Live Classic', black: 'Darkest (OLED)', midlight: 'Mid Light', light: 'Light (Ableton Live)', lightmc: 'Light Neutral Medium Contrast', lightlc: 'Light Neutral Low Contrast', lighthc: 'Light Neutral High Contrast' };
// swatches for the theme picker: background, panel, control, text
export const themeSwatch = (id) => { const t = THEMES[id] || THEMES.dark; return [t['--bg'], t['--panel2'], t['--raise2'], t['--text']]; };
// ---- Live 12's theme adjustments (Settings -> Tema): every theme can be shifted without making a new one.
//   brightness / contrast: the neutral greys (lightness around mid grey)      tone: greys tinted cool (-1) .. warm (+1)
//   intensity: saturation of the accent / state colours                         hue: their hue, in degrees
const ADJ = { brightness: 0, contrast: 0, tone: 0, intensity: 0, hue: 0 };
const adjOn = () => ADJ.brightness || ADJ.contrast || ADJ.tone || ADJ.intensity || ADJ.hue;
const KEEP = new Set(['--c0', '--c255', '--scrim', '--shadow', '--toast', '--toast-ink', '--key-w', '--key-b']);
function hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return [0, 0, l];
  const sat = d / (1 - Math.abs(2 * l - 1)), hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [hh * 60, sat, l]; }
function unhsl(hh, sat, l) { const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - c / 2, q = Math.floor(((hh % 360) + 360) % 360 / 60);
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][q]; return [(r + m) * 255, (g + m) * 255, (b + m) * 255]; }
function adjust(map) {
  if (!adjOn()) return map;
  const out = {}, cl = (v) => Math.max(0, Math.min(255, Math.round(v))), h2 = (n) => cl(n).toString(16).padStart(2, '0');
  for (const [k, v] of Object.entries(map)) {
    if (typeof v !== 'string' || !/^#[0-9a-f]{6}/i.test(v) || KEEP.has(k)) { out[k] = v; continue; }
    const R = parseInt(v.slice(1, 3), 16), G = parseInt(v.slice(3, 5), 16), B = parseInt(v.slice(5, 7), 16), tail = v.slice(7);
    if (Math.max(R, G, B) - Math.min(R, G, B) < 14) {                       // a neutral: brightness, contrast, then the tone tint
      let L = (R + G + B) / 3; L = 128 + (L - 128) * (1 + 0.6 * ADJ.contrast) + 46 * ADJ.brightness; L = Math.max(0, Math.min(255, L));
      const t = ADJ.tone * 9 * (1 - Math.abs(L - 128) / 160);              // strongest on the mid greys, none on black / white
      out[k] = '#' + h2(L + t) + h2(L + t * 0.25) + h2(L - t) + tail;
    } else { const [hh, sat, l] = hsl(R, G, B), c = unhsl(hh + ADJ.hue, Math.max(0, Math.min(1, sat * (1 + 0.9 * ADJ.intensity))), l); out[k] = '#' + h2(c[0]) + h2(c[1]) + h2(c[2]) + tail; }
  }
  return out;
}
let ACT = THEMES.dark;                                    // the applied theme: the chosen one with the adjustments
export function setThemeAdjust(a) { for (const k of Object.keys(ADJ)) if (a && typeof a[k] === 'number' && isFinite(a[k])) ADJ[k] = k === 'hue' ? Math.max(-180, Math.min(180, a[k])) : Math.max(-1, Math.min(1, a[k])); applyTheme(current); }
export const themeAdjust = () => ({ ...ADJ });
// a clip / track colour under the Color Intensity and Color Hue adjustments (Live shifts the clip colours with them); unchanged without them
const toneCache = new Map();
export function tone(hex) {
  if (!ADJ.intensity && !ADJ.hue) return hex;
  let r = toneCache.get(hex); if (r) return r;
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return hex;
  const R = parseInt(m[1].slice(0, 2), 16), G = parseInt(m[1].slice(2, 4), 16), B = parseInt(m[1].slice(4, 6), 16), [hh, sat, l] = hsl(R, G, B), c = unhsl(hh + ADJ.hue, Math.max(0, Math.min(1, sat * (1 + 0.9 * ADJ.intensity))), l);
  r = '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); toneCache.set(hex, r); return r;
}
export const currentTone = () => THEME_TONE[current] || 'dark';
let current = 'dark';
const cache = new Map();

// Canvas colours are written in the dark palette. Every neutral grey is mapped through the SAME tokens the CSS uses for that
// role (anchors below) and greys in between are interpolated, so canvases (timeline, editors, meters) always match the DOM panels.
// Hue colours that are theme tokens (accent, rec, ok, play, solo) map exactly to the theme's own value.
const ANCHORS = [['--c0', 0], ['--line', 14], ['--bg', 27], ['--panel', 36], ['--panel2', 45], ['--raise', 56], ['--raise2', 74], ['--dim', 139], ['--text', 207], ['--c255', 255]];
const EXACT = { '#ffa722': '--accent', '#e5484d': '--rec', '#7ac555': '--ok', '#5bd876': '--play', '#4fa3e0': '--solo', '#f2c744': '--mute' };
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const hx = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
let ramp = [];
function buildRamp() { ramp = ANCHORS.map(([tok, key]) => [key, rgb(ACT[tok])]); }
function mapNeutral(v) {          // v: 0..255 grey of the dark design -> [r, g, b] of the current theme
  for (let i = 1; i < ramp.length; i++) {
    if (v <= ramp[i][0]) { const [k0, c0] = ramp[i - 1], [k1, c1] = ramp[i], t = (v - k0) / (k1 - k0 || 1); return c0.map((c, j) => c + (c1[j] - c) * t); }
  }
  return ramp[ramp.length - 1][1];
}
// '#rrggbb' / '#rgb' / '#rrggbbaa' -> themed colour string
export function C(hex) {
  let r = cache.get(hex);
  if (r !== undefined) return r;
  let h = hex.slice(1), a = '';
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 8) { a = h.slice(6); h = h.slice(0, 6); }
  const [R, G, B] = rgb('#' + h);
  const tok = EXACT['#' + h.toLowerCase()];
  if (tok) r = ACT[tok].slice(0, 7) + a;
  else if ((current === 'dark' && !adjOn()) || Math.max(R, G, B) - Math.min(R, G, B) >= 14) r = hex;
  else { const m = mapNeutral((R + G + B) / 3); r = '#' + hx(m[0]) + hx(m[1]) + hx(m[2]) + a; }
  cache.set(hex, r);
  return r;
}
export const T = (token) => ACT[token];     // theme token for canvas code, e.g. T('--mute')
export const currentTheme = () => current;
export function applyTheme(name) {
  if (!THEMES[name]) name = 'dark';
  current = name; ACT = adjust(THEMES[name]); cache.clear(); toneCache.clear(); buildRamp();
  const root = document.documentElement;
  for (const [k, v] of Object.entries(ACT)) root.style.setProperty(k, v);
  const tone = THEME_TONE[name] || name;              // derived themes reuse the CSS rules of their base
  root.dataset.theme = tone; root.dataset.themeId = name;
  root.style.colorScheme = tone === 'light' ? 'light' : 'dark';
  const cs = document.querySelector('meta[name=color-scheme]'); if (cs) cs.content = tone === 'light' ? 'light' : 'dark';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = ACT['--panel'];
  window.dispatchEvent(new Event('themechange'));
}
