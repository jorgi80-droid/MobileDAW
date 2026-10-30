// Themes (Live-style dark / light / black). CSS variables for the DOM, and C() for colours drawn on canvases:
// neutral greys are remapped per theme, hue colours (clips, accents, meters) stay as they are.
const THEMES = {
  dark:  { '--warn': '#e8d040', '--ok-ink': '#5fd08a', '--bad-ink': '#ff6a6f', '--on-col': '#15151a', '--lv-title': '#4a4a4e', '--lv-body': '#343437', '--lv-well': '#1c1c1e', '--lv-ctl': '#55555a', '--lv-ctl2': '#66666c', '--lv-ink': '#e4e4e6', '--lv-dim': '#a0a0a6', '--lv-edge': '#141415', '--lv-trk': '#5f5f66', '--lv-sel': '#3f8ea0', '--lv-div': '#27272a', '--lv-arc': '#4fc3f0', '--lv-or': '#ffad32', '--lv-orink': '#ffad32', '--mx-bg': '#121213', '--mx-strip': '#242426', '--mx-strip-sel': '#2f2f33', '--mx-well': '#101011', '--bg': '#1b1b1c', '--panel': '#242426', '--panel2': '#2d2d30', '--raise': '#38383c', '--raise2': '#4a4a50', '--line': '#0e0e0f', '--sep': '#1b1b1d', '--menu': '#2f2f33', '--well': '#17171a', '--text': '#cfcfd2', '--dim': '#8b8b92', '--accent': '#ffa722', '--accent-ink': '#1a1100', '--play': '#5bd876', '--rec': '#e5484d', '--ok': '#7ac555', '--key-w': '#d9d9dd', '--key-b': '#1d1d20', '--key-bhit': '#b97409', '--key-ink': '#444448', '--mute': '#f2c744', '--solo': '#4fa3e0', '--c0': '#000000', '--c255': '#ffffff', '--shadow': '#000000aa', '--scrim': '#00000066', '--toast': '#000000dd', '--toast-ink': '#ffffff' },
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
  midlight: { name: 'Mid Light',                base: 'light', a: -42, b: 1.0 },
  lighthc:  { name: 'Light Neutral High Contrast', base: 'light', a: -14, b: 1.1 },
};
const grey = (hex) => { const h = hex.slice(1, 7), [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b) < 14 ? (r + g + b) / 3 : -1; };
for (const [id, t] of Object.entries(LIB)) {
  const src = THEMES[t.base], out = {};
  for (const [k, v] of Object.entries(src)) {
    const L = typeof v === 'string' && /^#[0-9a-f]{6}/i.test(v) && k !== '--c0' && k !== '--c255' ? grey(v) : -1;
    if (L < 0) { out[k] = v; continue; }
    const n = Math.max(0, Math.min(255, Math.round(t.a + t.b * L))).toString(16).padStart(2, '0');
    out[k] = '#' + n + n + n + v.slice(7);
  }
  THEMES[id] = out;
}
export const THEME_TONE = { light: 'light', midlight: 'light', lighthc: 'light' };
export const THEME_NAMES = { dark: 'Dark', middark: 'Mid Dark', lowc: 'Dark Neutral Low Contrast', highc: 'Dark Neutral High Contrast', live: 'Live Classic', black: 'Darkest (OLED)', midlight: 'Mid Light', light: 'Light', lighthc: 'Light Neutral High Contrast' };
// swatches for the theme picker: background, panel, control, text
export const themeSwatch = (id) => { const t = THEMES[id] || THEMES.dark; return [t['--bg'], t['--panel2'], t['--raise2'], t['--text']]; };
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
function buildRamp() { ramp = ANCHORS.map(([tok, key]) => [key, rgb(THEMES[current][tok])]); }
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
  if (tok) r = THEMES[current][tok] + a;
  else if (current === 'dark' || Math.max(R, G, B) - Math.min(R, G, B) >= 14) r = hex;
  else { const m = mapNeutral((R + G + B) / 3); r = '#' + hx(m[0]) + hx(m[1]) + hx(m[2]) + a; }
  cache.set(hex, r);
  return r;
}
export const T = (token) => THEMES[current][token];     // theme token for canvas code, e.g. T('--mute')
export const currentTheme = () => current;
export function applyTheme(name) {
  if (!THEMES[name]) name = 'dark';
  current = name; cache.clear(); buildRamp();
  const root = document.documentElement;
  for (const [k, v] of Object.entries(THEMES[name])) root.style.setProperty(k, v);
  const tone = THEME_TONE[name] || name;              // derived themes reuse the CSS rules of their base
  root.dataset.theme = tone; root.dataset.themeId = name;
  root.style.colorScheme = tone === 'light' ? 'light' : 'dark';
  const cs = document.querySelector('meta[name=color-scheme]'); if (cs) cs.content = tone === 'light' ? 'light' : 'dark';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = THEMES[name]['--panel'];
  window.dispatchEvent(new Event('themechange'));
}
