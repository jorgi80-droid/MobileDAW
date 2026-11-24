// "Long-press a control -> create automation for it".
import { menu, toast, lastControl, ask } from './ui.js';
import { fmtParam } from './defs.js';
import { eng } from './engine.js';
import * as P from './project.js';

// FL Studio Mobile "Fine tune control": the exact value typed in, in the control's own unit, clamped to its range (stepped controls rounded)
export function fineTune(target, label) {
  const d = target.def || {}, now = P.targetValue(target); if (now == null) return toast('Kontrol ini tidak bisa diatur dengan angka.', 2500);
  const lo = d.min ?? 0, hi = d.max ?? 1, unit = d.unit ? ' ' + d.unit : '';
  const shown = Math.round(now * 10000) / 10000;
  ask(label + ' (' + lo + ' \u2026 ' + hi + unit + '; sekarang ' + fmtParam(d, now) + ')', shown, (v) => {
    if (!Number.isFinite(v)) return toast('Angka tidak valid.', 2000);
    let x = Math.min(hi, Math.max(lo, v)); if (d.step) x = lo + Math.round((x - lo) / d.step) * d.step;
    P.applyTargetValue(target, x); toast(label + ': ' + fmtParam(d, x), 1600);
  }, 'number');
}
export function offerAutomation(rect, target, label) {
  menu([{ label: 'Nilai persis (Fine tune)\u2026', fn: () => fineTune(target, label) }, { sep: true }, {
    label: 'Otomatisasi: ' + label,
    fn: () => {
      const t = P.addAutoTrack(target, label);
      toast(t ? 'Track otomasi siap. Ketuk-ganda klipnya untuk mengedit titik.' : 'Jumlah track sudah maksimum.', 3200);
    },
  }, ...(() => {                                                  // FL Studio Mobile: Link to Current Track (the selected automation track)
    const i = P.state.sel.track, t = P.state.tracks[i];
    return t && t.kind === 'auto' && t.target && t.target.kind !== 6 ? [{ label: 'Link ke track otomasi terpilih (' + t.name.replace(/^Auto: /, '') + ')', fn: () => { P.retargetAutoTrack(i, target, label); toast('Track otomasi kini mengendalikan ' + label + '.', 2600); } }] : [];
  })(), {
    label: 'Hubungkan ke MIDI CC',
    fn: () => {
      if (!eng.midiDevices().length) return toast('Belum ada controller MIDI terhubung. Aktifkan MIDI di Pengaturan.', 3600);
      P.startCcLearn(target, label);
      toast('Menunggu CC\u2026 gerakkan knob atau fader pada controller MIDI.', 6000);
    },
  }], rect.left, rect.bottom + 2);
}

// the CTRL button: the automation / link / MIDI CC menu for the control that was moved last
export function ctrlButton(rect) {
  const f = lastControl();
  if (!f) return toast('Gerakkan dulu sebuah knob, fader atau slider, lalu tekan CTRL untuk membuat otomasi, me-link ke track otomasi terpilih, atau menghubungkannya ke MIDI CC.', 4500);
  f(rect);
}
