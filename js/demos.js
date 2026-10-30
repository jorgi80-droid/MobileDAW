// Demo songs. Two ready-made projects that use the built-in virtual instruments. The first time a demo is opened, the SoundFont (and any
// samples) it needs are copied (once) from the app's own files into the library (/SoundFonts, /Samples/Demo); then the project opens.
import { eng, backend } from './engine.js';
import * as P from './project.js';

const SF_PATH = '/SoundFonts/TimGM6mb.sf2', SF_URL = 'demos/SoundFonts/TimGM6mb.sf2';
// Leftovers of the removed "Bombay Bass" demo: deleted from the library the next time a demo is opened.
const OLD = ['/Projects/Bombay Bass (Dubstep Demo).mdaw'].concat(['Kick Dub', 'Snare Dub', 'Clap Dub', 'Hat Closed', 'Hat Open', 'Tabla Na', 'Tabla Tin', 'Tabla Ge', 'Tabla Dha', 'Dhol Dha', 'Dhol Tak', 'Riser 4 Bars', 'Impact Boom', 'Downlifter 1 Bar'].map((s) => '/Samples/Demo/' + s + '.wav'));

export const DEMOS = [
  { id: 'meadow-wind', title: 'Meadow Wind \u2013 Orkestra', time: '2:48', file: 'demos/meadow-wind.mdaw', name: 'Meadow Wind (Orchestral Demo)', sf: true, samples: [] },
  { id: 'ghibli-sky', title: 'Ghibli Sky \u2013 Piano & Orkestra', time: '3:03', file: 'demos/ghibli-sky.mdaw', name: 'Ghibli Sky (Piano & Orchestra Demo)', sf: true, samples: [] },
];

async function getBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Gagal mengunduh ' + url + ' (' + r.status + ')');
  return r.arrayBuffer();
}

// Returns the list of files the project could not find (empty = everything loaded). Throws a readable Error on failure.
export async function openDemo(d, onStep) {
  if (backend !== 'web') throw new Error('Demo song hanya tersedia di versi web/PWA.');
  try { for (const p of OLD) if (eng.fileSize(p)) await eng.deleteFile(p); } catch (e) { /* cleanup is best-effort */ }
  const need = [];
  if (d.sf && !eng.fileSize(SF_PATH)) need.push([SF_PATH, SF_URL]);
  for (const s of d.samples) { const p = '/Samples/Demo/' + s + '.wav'; if (!eng.fileSize(p)) need.push([p, 'demos/Samples/' + encodeURIComponent(s) + '.wav']); }
  let k = 0;
  for (const [path, url] of need) {
    if (onStep) onStep(++k, need.length);
    const ok = await eng.saveBytes(path, await getBytes(url));
    if (!ok) throw new Error('Tidak bisa menyimpan ' + path);
  }
  const text = await (await fetch(d.file)).text();
  eng.writeText('/Projects/' + d.name.replace(/[^\w\- ]+/g, '') + '.mdaw', text);
  return P.deserialize(text);
}
