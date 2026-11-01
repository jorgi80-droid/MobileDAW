// Engine commands as text lines for the C++ engine (format: native/engine/commands.h). Used by the Android native bridge and by the
// golden tests (tools/golden), so the tests exercise the exact encoding the app sends.
// Numbers use the JS shortest round-trip form, so the C++ side reads back exactly the same doubles.
export const num = (v) => (v === true ? '1' : v === false ? '0' : v == null ? 'u' : typeof v !== 'number' ? (Number.isNaN(+v) ? 'nan' : String(+v))
  : Number.isNaN(v) ? 'nan' : v === Infinity ? 'inf' : v === -Infinity ? '-inf' : Object.is(v, -0) ? '-0' : String(v));
// f32: callback for Float32Array arguments (returns '@offset:length'); without it they are written as plain arrays
export function encode(name, args, f32) {
  let s = name;
  for (const v of args) {
    if (v instanceof Float32Array && f32) s += ' ' + f32(v);
    else if (Array.isArray(v) || ArrayBuffer.isView(v)) { s += ' [' + v.length; for (let i = 0; i < v.length; i++) s += ' ' + num(v[i]); s += ']'; }
    else s += ' ' + num(v);
  }
  return s;
}
// SoundFont (sf2.js parse result) for the C++ engine: `sf id data rates zones counts`. data = the int16 sample values as Float32Array
// (exact) or null when it is sent separately (Android: through the sample channel as id 1000 + slot). zones: 18 numbers each, in order.
export const SF_FIELDS = ['lo', 'hi', 'vlo', 'vhi', 'sample', 'root', 'tune', 'loop', 'atten', 'pan', 'a', 'd', 's', 'r', 'start', 'end', 'ls', 'le'];
export function sfArgs(id, sf, withData = true) {
  const zones = [], counts = [];
  for (const p of sf.presets) { counts.push(p.zones.length); for (const z of p.zones) for (const k of SF_FIELDS) zones.push(+z[k] || 0); }
  return [id, withData ? Float32Array.from(sf.data) : null, sf.shdr.map((h) => h.rate), zones, counts];
}
