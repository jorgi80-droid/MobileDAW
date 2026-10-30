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
