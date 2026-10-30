// "Long-press a control -> create automation for it".
import { menu, toast } from './ui.js';
import { eng } from './engine.js';
import * as P from './project.js';

export function offerAutomation(rect, target, label) {
  menu([{
    label: 'Otomatisasi: ' + label,
    fn: () => {
      const t = P.addAutoTrack(target, label);
      toast(t ? 'Track otomasi siap. Buka tab Clip untuk mengedit titiknya.' : 'Jumlah track sudah maksimum.', 3200);
    },
  }, {
    label: 'Hubungkan ke MIDI CC',
    fn: () => {
      if (!eng.midiDevices().length) return toast('Belum ada controller MIDI terhubung. Aktifkan MIDI di Pengaturan.', 3600);
      P.startCcLearn(target, label);
      toast('Menunggu CC\u2026 gerakkan knob atau fader pada controller MIDI.', 6000);
    },
  }], rect.left, rect.bottom + 2);
}
