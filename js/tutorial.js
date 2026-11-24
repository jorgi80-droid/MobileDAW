// Interactive tutorial (guided tour): every control of the app, chapter by chapter, spotlighted on the real screen with what it does and how
// to use it FL Studio Mobile style (tap / double tap / long press / swipe). Practice steps wait for the user to do the thing (tap Play, add a
// track, draw a clip, tap steps...) before going on; any step can be skipped. A showcase chapter opens "Neon Horizon", a 2-minute progressive
// house song made with the built-in instruments (demos/progressive-house.mdaw, tools/make-proghouse.mjs), and takes it apart track by track
// while it plays. Animated: the card springs in, the spotlight pulses and glides, an animated finger shows the gesture, every chapter opens
// with a splash, a live timeline follows the song's sections, success bursts and a confetti finale (all off with "reduce motion").
// Opened from Menu -> Tutorial interaktif, and offered once on the first start. The spotlight leaves the control usable: four blockers
// around the hole catch every other tap.
import * as P from './project.js';
import * as T from './timeline.js';
import { prefs, savePrefs } from './prefs.js';
import { h, modal, toast } from './ui.js';

const $ = (s) => document.querySelector(s);
const vis = (s) => { const e = $(s); return !!(e && !e.hidden && e.getClientRects().length); };
const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
const arrRect = (k, i) => () => {
  const ti = i ?? Math.max(0, P.state.sel.track || 0);
  if (!cur || cur.shown !== cur.k) { if (k === 'addTrack') T.revealRow(T.addRowIndex()); else if (k !== 'ruler' && k !== 'clips' && k !== 'header') T.revealRow(ti); if (cur) cur.shown = cur.k; }   // once per step: scroll it into view
  return T.tutorialRects(ti)[k] || null;
};
const view = (v) => () => { const b = $(`[data-view="${v}"]`); if (b && !b.classList.contains('on')) b.click(); };
const tab = (t) => () => { const b = $(`#dtabs [data-tab="${t}"]`); if (b && !b.classList.contains('on')) b.click(); };
const browserOff = () => { if (vis('#browser')) $('#btn-browser').click(); };
const drumIdx = () => { for (let i = P.state.tracks.length - 1; i >= 0; i--) if (P.state.tracks[i].kind === 'drum') return i; return -1; };
const firstCard = () => $('#dbody .card') || $('#dbody');
let mark = {};                                           // values remembered by a step for its check (track counts, ...)

// ---- the showcase song helpers
const BAR = 4 * P.PPQ;
const idx = (name) => P.state.tracks.findIndex((t) => t.name === name);
const isShow = () => /Neon Horizon/.test(P.state.projectName || '');
const lane = (name) => () => { const i = idx(name); if (i < 0) return null; if (cur && cur.shown !== cur.k) { T.revealRow(i); cur.shown = cur.k; } return T.tutorialRects(i).lane; };
const head = (name, part) => () => { const i = idx(name); if (i < 0) return null; if (cur && cur.shown !== cur.k) { T.revealRow(i); cur.shown = cur.k; } return T.tutorialRects(i)[part]; };
const sel = (name) => () => { view('arr')(); const i = idx(name); if (i >= 0) { P.selectTrack(i); tab('dev')(); } };
const card = (name) => () => { const c = [...document.querySelectorAll('#dbody .card')].find((x) => (x.textContent || '').slice(0, 80).includes(name)) || firstCard(); if (c && cur && cur.shown !== cur.k) { c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); cur.shown = cur.k; } return c; };
const playFrom = (b) => () => { P.seekTo((b - 1) * BAR); if (!P.state.playing) P.togglePlay(); };
const stopPlay = () => { if (P.state.playing) P.togglePlay(); };
const soloOnly = (name) => () => { P.state.tracks.forEach((t, i) => { if (t.solo && t.name !== name) P.toggleSolo(i); }); const i = idx(name); if (i >= 0 && !P.state.tracks[i].solo) P.toggleSolo(i); };
const unsoloAll = () => P.state.tracks.forEach((t, i) => { if (t.solo) P.toggleSolo(i); });
async function openShowcase() {
  if (isShow()) return;
  const D = await import('./demos.js'), d = D.DEMOS.find((x) => x.id === 'neon-horizon');
  stopPlay(); await D.openDemo(d);
  view('arr')(); browserOff(); T.fitNow && T.fitNow();
}

// ---- the chapters. A step: t title, x text (what it is + how to use it), el selector / rect function, pre() before it shows,
// want() = a practice step, done when it returns true (hint = what to do).
export const CHAPTERS = [
  { id: 'show', name: 'Showcase: Progressive House 2 menit', ic: '\u266b', steps: [
    { t: 'Neon Horizon \u2014 produksi progressive house dibongkar', x: 'Lagu progressive house orisinal 2:00 (128 BPM, F minor, 64 bar, format radio edit) yang diproduksi seperti rilisan label: 16 track, dua bus, 6 lane otomasi, dan master yang diukur sampai -8,3 LUFS. Kita buka proyeknya, putar, lalu bongkar keputusan produksinya satu per satu.',
      tips: ['Proyekmu yang sekarang tidak hilang: autosave menyimpannya, dan kamu bisa \u201cSimpan\u201d dulu lewat tombol di bawah.', 'Semua langkah bisa diulang (Kembali) atau dilewati. Langkah \u201cCoba\u201d menunggu kamu melakukannya sendiri.', 'Pakai headphone atau speaker yang punya bass: sub bass di 35\u201352 Hz dan sidechain-nya baru terasa di sana.'],
      acts: [{ label: 'Simpan proyekku dulu', when: async () => (await import('./quicksave.js')).isDirty(), fn: async () => (await import('./quicksave.js')).quickSave() }] },
    { t: 'Membuka proyek showcase', el: '#arr', pre: openShowcase, x: 'Terbuka: 16 track (drum dipisah per peran: Kick, Claps, Hats, Percussion, Cymbals; Sub Bass + Mid Bass; Chord Stabs, Pad, Atmosphere, Pluck Arp, Lead, Lead Layer, Riser; FX dan Noise Riser), 6 lane otomasi, empat track efek (Reverb, Delay, Drum Bus, Music Bus) dan rantai Master.',
      tips: ['Jendela progres tadi menyalin 16 sample (drum CC0 dari Stargate DAW sample pack + FX transisi yang disintesis khusus) ke Samples/Demo lalu memuat semuanya.', 'Memisahkan drum per peran (bukan satu track drum) adalah standar studio: tiap elemen punya EQ, level dan bus sendiri.', 'Lagu ini dibuat ulang oleh tools/make-proghouse.mjs dengan API proyek MobileDAW \u2014 semua yang kamu dengar bisa kamu ubah.'] },
    { t: 'Dengarkan dulu', el: '#btn-play', live: true, x: 'Putar dari awal atau langsung ke Drop. Peta lagu di kartu ini mengikuti lagu secara langsung. Perhatikan kontras energi: Intro sekitar -9 LUFS, Breakdown -10, Drop -7,7 \u2014 drop terasa \u201cmeledak\u201d karena benar-benar lebih padat dan lebih keras.',
      tips: ['Radio edit 2 menit memadatkan struktur club mix 6\u20137 menit: setiap bagian 8 atau 16 bar, dan setiap 8 bar ada perubahan.', 'Transisi antar-bagian selalu \u201cdiumumkan\u201d: reverse crash, fill snare, kick yang berhenti sebentar, atau downlifter.'],
      acts: [{ label: '\u25b6 Dari awal', fn: playFrom(1) }, { label: '\u25b6 Ke Drop', go: true, fn: playFrom(33) }, { label: '\u25a0 Stop', fn: stopPlay }] },
    { t: 'Struktur lagu (marker)', el: arrRect('ruler'), live: true, gest: 'tap', x: 'Intro (1) kick + hat + pad bersaring \u00b7 Build (9) sub + rolling bass + clap \u00b7 Groove (17) stab, arp, perkusi \u00b7 Breakdown (25) tanpa kick, melodi diperkenalkan \u00b7 build-up (29\u201332) kick roll, snare roll, dua riser, high-pass di Music Bus, lalu 1 ketukan hening \u00b7 Drop (33) semua masuk dengan crash, impact dan sub drop \u00b7 Drop B (49) hook naik satu oktaf + ride + bongo \u00b7 Outro (57) dikupas, diakhiri pukulan terakhir.',
      tips: ['Satu ketukan hening sebelum Drop (bar 32 ketukan 4) adalah trik paling efektif untuk membuat Drop terasa besar.', 'Kick berhenti di ketukan terakhir bar 16, 48 dan 56, dan dua ketukan di bar 24: telinga mendengar \u201cakhir frasa\u201d sebelum bagian baru.'],
      acts: [{ label: 'Intro', fn: playFrom(1) }, { label: 'Build-up', fn: playFrom(29) }, { label: 'Drop', go: true, fn: playFrom(33) }, { label: 'Drop B', fn: playFrom(49) }] },
    { t: 'Kick + gain staging', el: lane('Kick'), pre: sel('Kick'), gest: 'dtap', live: true, x: 'Kick four-on-the-floor dari sample \u201cNH Kick\u201d (badannya sekitar 64 Hz = nada C, kuint dari F minor, jadi selaras dengan bass). EQ: low cut 30 Hz, -3 dB di 300 Hz (kotak), +2,5 dB di 4,2 kHz (klik). Kick sengaja tidak paling keras: di progressive house, drop dibawa oleh bass dan synth.',
      tips: ['Diukur sebelum master: tanpa kick yang dominan, Drop 2,5 LU lebih keras dari Intro. Saat kick terlalu keras, semua bagian terdengar sama kerasnya.', 'Kick tetap di track sendiri karena dialah sumber sidechain untuk Sub Bass dan Music Bus.', 'Ketuk-ganda klipnya: kick roll di bar 31\u201332 makin rapat (1/8 lalu 1/16) dan berhenti di ketukan terakhir.'],
      acts: [{ label: 'Solo Kick', fn: soloOnly('Kick') }, { label: 'Lepas solo', fn: unsoloAll }, { label: '\u25b6 Kick roll', go: true, fn: playFrom(30) }] },
    { t: 'Drum: clap berlapis, hat, perkusi', el: lane('Claps'), pre: sel('Claps'), live: true, x: 'Claps = clap 909 + lapisan snare (velocity 55%) di ketukan 2 dan 4, ditambah fill di akhir setiap 8 bar dan snare roll di build-up. Hats: 16-an dengan aksen offbeat dan kurva velocity \u201cmanusiawi\u201d; open hat dan closed hat di cut group yang sama sehingga saling memotong seperti drum asli. Percussion: shaker 16-an, rim ghost, bongo di Drop B.',
      tips: ['Melapis clap dengan snare memberi \u201cbadan\u201d (200 Hz) sekaligus \u201cretakan\u201d (5 kHz) \u2014 dua sample terdengar seperti satu suara yang lebih tebal.', 'Shaker dipan sedikit ke kanan, rim dan bongo ke kiri: drum terasa lebar tanpa mengganggu kick dan clap di tengah.', 'Semua drum kecuali kick masuk ke Drum Bus (Glue 4:1 + saturasi ringan) supaya terdengar sebagai satu kit.'],
      acts: [{ label: '\u25b6 Snare roll', go: true, fn: playFrom(29) }, { label: 'Solo Claps', fn: soloOnly('Claps') }, { label: 'Lepas solo', fn: unsoloAll }] },
    { t: 'Sub + Mid Bass, sidechain', el: card('Autoduck'), pre: sel('Sub Bass'), live: true, x: 'Bass dibagi dua seperti di studio: Sub Bass (MiniSynth \u201cTriangle Sub\u201d, mono, 8-an offbeat di not dasar akor) memiliki frekuensi di bawah 100 Hz, Mid Bass (\u201cRound Saw Bass\u201d, 16-an bergulir root\u2013oktaf\u2013root) di-high-pass di 80 Hz untuk tekstur. Kartu Autoduck yang disorot adalah sidechain Sub: sumbernya Kick, turun 20 dB lalu kembali dalam 140 ms.',
      tips: ['Sub dan kick hidup di frekuensi yang sama: sidechain memberi giliran \u2014 kick dulu, lalu sub mengisi celah offbeat. Itulah \u201cpumping\u201d progressive house.', 'Mid Bass, chord, pad, arp dan lead dikirim ke Music Bus yang punya satu Autoduck untuk semuanya: seluruh musik bernapas bersama kick.', 'Not terakhir setiap 2 bar di Mid Bass mengarah ke root akor berikutnya (approach note), membuat bass terasa bergerak.'],
      acts: [{ label: '\u25b6 Drop', go: true, fn: playFrom(33) }, { label: 'Solo Sub', fn: soloOnly('Sub Bass') }, { label: 'Lepas solo', fn: unsoloAll }] },
    { t: 'Harmoni: Fm9 \u2013 Dbmaj7 \u2013 Ab(add9) \u2013 Eb', el: lane('Chord Stabs'), pre: sel('Chord Stabs'), live: true, x: 'Akor i\u2013VI\u2013III\u2013VII (dua bar per akor), disuarakan rapat dengan nada C / Eb di atas yang terus bertahan \u2014 \u201cpedal tone\u201d yang memberi warna melankolis khas progressive house. Chord Stabs (GMS \u201cWide Chord\u201d) memukul di 16-an ke-3, 7, 11 dan 14: sinkopasi yang mengisi celah antara kick.',
      tips: ['Akor Eb dimulai sebagai sus4 (Ab di atas) lalu turun ke G di bar kedua: ketegangan kecil yang membawa kembali ke Fm.', 'Pad (SuperSaw) memainkan voicing yang sama panjang; Atmosphere menambah oktaf di atas dengan stereo lebar (160%).', 'EQ: low cut 250 Hz pada stab dan 220 Hz pada pad \u2014 ruang bawah milik bass.'] },
    { t: 'Arp + otomasi filter', el: lane('Auto: Pluck Arp \u2022 Auto Filter Freq'), pre: () => { view('arr')(); }, gest: 'drag', live: true, x: 'Pluck Arp memainkan nada voicing dalam pola 16-an naik-turun, lewat Delay 3/16 (dotted eighth). Lane otomasi ini membuka filternya dari 500 Hz ke 7 kHz selama Groove, menutup di awal Breakdown, lalu menyapu ke 12 kHz menjelang Drop. Pad punya lane serupa, dan Music Bus punya high-pass yang naik ke 900 Hz di build-up lalu terbuka seketika di Drop.',
      tips: ['High-pass di Music Bus saat build-up menghilangkan bass sedikit demi sedikit; saat Drop semuanya kembali sekaligus \u2014 kontras yang membuat Drop terasa berat.', 'Seret titik di lane untuk mengubah kurva; ketuk-ganda untuk menambah titik.'] },
    { t: 'Hook: satu ritme, empat akor', el: lane('Lead'), pre: sel('Lead'), gest: 'dtap', live: true, x: 'Hook memakai satu ritme 2 bar (panjang\u2013pendek, sinkop di 16-an ke-12) yang diulang di setiap akor dengan nada yang menyesuaikan \u2014 teknik \u201ccall and answer\u201d yang membuat melodi mudah diingat. Lead (SuperSaw \u201cAnthem Lead\u201d) dilapis Lead Layer (GMS \u201cBell Pluck\u201d) satu oktaf di atas untuk definisi. Di Drop B keduanya naik satu oktaf.',
      tips: ['Di Breakdown hook diperkenalkan pelan oleh bell saja; lead supersaw baru masuk di build-up dengan velocity rendah \u2014 penonton sudah hafal hooknya saat Drop.', 'Lead dibuat lebih pelan dari kick (sekitar -19 dB RMS): lapisan bell yang memberi kejelasan, bukan volume.'],
      acts: [{ label: '\u25b6 Breakdown', fn: playFrom(25) }, { label: '\u25b6 Drop B', go: true, fn: playFrom(49) }] },
    { t: 'Transisi: riser, impact, sub drop', el: lane('FX'), pre: () => { view('arr')(); }, live: true, x: 'Track FX berisi efek transisi yang disintesis khusus: reverse crash yang membesar tepat ke bar 9, 17, 33 dan 49; impact + sub drop (sinus 90 \u2192 32 Hz) di awal Drop dan Drop B; downlifter di awal Breakdown dan Outro. Di build-up, Noise Riser (white noise, filter 250 Hz \u2192 18 kHz) dan synth Riser (pitch naik satu oktaf) bekerja bersama snare roll.',
      tips: ['Reverse crash diletakkan sehingga ujungnya jatuh tepat di ketukan pertama bagian baru \u2014 itu yang membuat transisi terasa \u201ctersedot\u201d masuk.', 'Sub drop menambah berat di Drop tanpa menambah puncak: frekuensinya turun di bawah kick.'],
      acts: [{ label: '\u25b6 Build-up', go: true, fn: playFrom(29) }] },
    { t: 'Bus dan efek bersama', el: head('Lead', 'sa'), pre: sel('Lead'), x: 'Return A = Reverb hall (panjang, gelap, low cut 300 Hz), B = Delay ping-pong 3/16. Drum Bus: Glue Compressor 4:1, attack 3 ms + saturasi analog 50%. Music Bus: Autoduck dari Kick, Glue 2:1, high-pass otomatis, lebar 115%. Tombol output (\u2192) di header track menentukan bus tujuan.',
      tips: ['Bus = memproses banyak track sebagai satu kesatuan. Itu yang membuat mix terdengar \u201clengket\u201d, bukan tumpukan suara terpisah.', 'Send = efek paralel (suara asli tetap), insert = efek seri. Reverb dan delay hampir selalu lewat send.'] },
    { t: 'Mastering: EQ \u2192 Glue \u2192 Clipper \u2192 Limiter', el: '#view-mix', pre: view('mix'), x: 'Master: EQ Eight (+1,5 dB hangat di 130 Hz, -2 dB kotak di 500 Hz, -2 dB di atas 8,5 kHz), Glue 2:1 yang hanya menyentuh puncak, Saturator sebagai soft clipper (memotong puncak kick + bass), lalu Limiter (+5 dB ke ceiling -1,3 dB). Hasil terukur: -8,3 LUFS integrated, true peak -1,2 dBTP, PLR 7,1 dB, Drop -7,7 LUFS vs Intro -9,1.',
      tips: ['Clipper sebelum limiter: puncak transien dipotong singkat oleh clipper (oversampled, tanpa aliasing) sehingga limiter tidak perlu menekan seluruh drop. Tanpa clipper, drop kehilangan 2\u20133 dB kekerasan.', 'True peak di bawah -1 dBTP memastikan lagu tidak pecah setelah dikonversi ke MP3 / AAC oleh platform streaming.', 'Keseimbangan spektrum drop diukur per oktaf dan diarahkan ke kemiringan rilisan EDM: 63 Hz paling kuat, lalu turun halus sampai 16 kHz.'] },
    { t: 'Coba: matikan Lead', el: head('Lead', 'mute'), pre: () => { view('arr')(); playFrom(33)(); }, gest: 'tap', live: true, x: 'Saat Drop berbunyi, ketuk tombol nomor track Lead untuk membisukannya. Dengarkan: Lead Layer dan Chord Stabs masih membawa harmoni, tapi hook kehilangan ketebalannya.', want: () => { const i = idx('Lead'); return i >= 0 && P.state.tracks[i].mute; }, hint: 'Coba: ketuk tombol nomor track Lead (mute).' },
    { t: 'Coba: nyalakan lagi', el: head('Lead', 'mute'), gest: 'tap', live: true, x: 'Ketuk lagi untuk menyalakannya. Mute dan Solo adalah alat utama saat mixing: bandingkan, dengarkan, putuskan.', want: () => { const i = idx('Lead'); return i >= 0 && !P.state.tracks[i].mute; }, hint: 'Coba: ketuk tombol yang sama.' },
    { t: 'Remix lagu ini!', x: 'Showcase selesai. Ide: ganti preset Lead (tahan judul kartu \u2192 Preset), turunkan tempo ke 124 BPM untuk nuansa deep, ganti sample kick di pad Kick, gambar ulang kurva filter Pad, atau tulis hook-mu sendiri dengan ritme yang sama. Simpan dengan nama baru lewat Menu \u2192 Simpan.', finale: true, pre: () => { stopPlay(); unsoloAll(); },
      tips: ['Semua sample di Samples/Demo berlisensi CC0: boleh dipakai di lagumu sendiri, dijual, atau dibagikan.', 'Bab berikutnya di daftar tutorial mengenalkan setiap tombol aplikasi satu per satu.'] },
  ] },
  { id: 'top', name: 'Bar kontrol (atas)', ic: '\u25b6', steps: [
    { t: 'Selamat datang di MobileDAW', x: 'Tutorial ini menunjuk setiap tombol di layar yang sebenarnya. Ketuk Lanjut untuk pindah, Kembali untuk mundur, atau Lewati kapan saja. Langkah bertanda “Coba” menunggu kamu melakukannya langsung.', pre: () => { view('arr')(); browserOff(); } },
    { t: 'Browser', el: '#btn-browser', x: 'Membuka pustaka: Sample, Instrumen, Efek, Preset, Proyek dan demo. Seret sample ke arrangement untuk membuat klip audio, atau ketuk instrumen / efek untuk memasangnya di track terpilih.', want: () => vis('#browser'), hint: 'Coba: ketuk tombol Browser.' },
    { t: 'Tutup browser', el: '#btn-browser', x: 'Ketuk lagi tombol yang sama untuk menutupnya. Browser juga tertutup sendiri setelah kamu memilih sesuatu.', want: () => !vis('#browser'), hint: 'Coba: ketuk Browser sekali lagi.' },
    { t: 'Tempo (BPM)', el: '#rd-bpm', gest: 'drag', tips: ['House 120\u2013128, techno 125\u2013135, hip hop 80\u201395, drum & bass 170\u2013175 BPM.', 'Klip audio yang di-warp mengikuti tempo baru otomatis.'], x: 'Seret ke atas / bawah untuk mengubah tempo. Ketuk untuk jendela Tempo: ketik angka, Tap Tempo, birama dan Follow.' },
    { t: 'Birama', el: '#rd-sig2', x: 'Time signature lagu (4/4, 3/4, 6/8...). Ketuk untuk mengubahnya; perubahan per bar bisa dibuat dari ruler.' },
    { t: 'Urungkan / Ulangi', el: '#btn-undo', x: 'Undo dan Redo untuk semua edit: klip, not, parameter, mixer. Riwayatnya tetap selama proyek terbuka.' },
    { t: 'Posisi lagu', el: '#rd-pos2', x: 'Posisi playhead dalam bar . ketukan . sixteenth. Ketuk ruler di arrangement untuk memindahkannya.' },
    { t: 'Ke awal', el: '#btn-rew', x: 'Mengembalikan playhead ke awal lagu (atau ke awal loop).' },
    { t: 'Play / pause', el: '#btn-play', gest: 'tap', x: 'Memutar lagu dari posisi playhead. Ketuk lagi untuk berhenti.', want: () => P.state.playing, hint: 'Coba: ketuk Play.' },
    { t: 'Berhenti', el: '#btn-play', x: 'Ketuk sekali lagi untuk berhenti. Saat berhenti, ketuk Ke awal untuk mulai dari awal lagi.', want: () => !P.state.playing, hint: 'Coba: ketuk Play lagi untuk berhenti.' },
    { t: 'Rekam', el: '#btn-rec', tips: ['Aktifkan count-in 1\u20132 bar di Pengaturan agar sempat bersiap.', 'Setiap rekaman ulang di tempat yang sama menjadi take baru; yang terakhir yang berbunyi.'], x: 'Merekam ke track yang tombol Arm-nya menyala: not dari keyboard / pad / controller MIDI, atau audio dari mikrofon di track audio. Count-in dan metronom diatur di Pengaturan.' },
    { t: 'Metronom', el: '#btn-metro', x: 'Klik ketukan saat memutar dan merekam. Levelnya di Pengaturan.' },
    { t: 'Loop', el: '.lvloop', x: 'Menyalakan loop arrangement. Kotak kiri = awal loop, kanan = panjangnya; seret di ruler untuk memilih rentang lalu pakai menu “Loop”.' },
    { t: 'FPS dan CPU', el: '.perf', x: 'Kelancaran layar (frame per detik) dan beban mesin audio. Kalau CPU sering penuh, naikkan buffer di Pengaturan → Performa atau bekukan (freeze) track berat.' },
    { t: 'Arrange / Mixer', el: '.seg', x: 'Berpindah antara arrangement (playlist) dan Mixer.', want: () => vis('#view-mix'), hint: 'Coba: ketuk Mixer.' },
    { t: 'Mixer', el: '#view-mix', x: 'Satu strip per track: fader volume, pan, send A/B ke track efek, mute / solo, meter, dan Master. Tahan fader atau knob untuk otomasi, MIDI CC, atau Nilai persis.', pre: view('mix') },
    { t: 'Kembali ke Arrange', el: '.seg', x: 'Ketuk Arrange untuk kembali.', want: () => vis('#view-arr'), hint: 'Coba: ketuk Arrange.' },
    { t: 'Menu proyek', el: '#btn-menu', gest: 'swipe', tips: ['Simpan cepat membuat cadangan otomatis versi sebelumnya (Browser \u2192 Proyek \u2192 Cadangan).', 'Impor FLM membaca tempo, klip, stretch, pitch, efek dan instrumen FL Studio Mobile.'], x: 'Simpan (geser baris “Simpan…” ke kanan = Simpan cepat, seperti FL Studio Mobile), buka proyek / demo, proyek baru, impor proyek FL Studio Mobile (.flm / zip), ekspor WAV / MP3 / stem / MIDI / ZIP, tempo, nama proyek, Pengaturan dan tutorial ini.' },
  ] },
  { id: 'arr', name: 'Arrangement (playlist)', ic: '\u25a4', steps: [
    { t: 'Ruler', el: arrRect('ruler'), x: 'Ketuk = pindahkan playhead. Seret = pilih rentang waktu, lalu menu rentang: Insert / Duplicate / Delete / Trim / Loop. Penanda (marker) dan perubahan birama juga di sini.', pre: () => { view('arr')(); browserOff(); } },
    { t: 'Area klip', el: arrRect('clips'), gest: 'dtap', tips: ['Snap mengikuti zoom; tahan sambil menyeret untuk geser bebas.', 'Seret tepi kanan bawah klip audio untuk stretch (mengikuti tempo).'], x: 'Gestur FL Studio Mobile: ketuk-ganda ruang kosong = klip baru 1 bar; ketuk klip = pilih dan tampilkan kontrolnya; ketuk-ganda klip = buka editornya (piano roll / step / audio); tahan = menu klip (salin, potong, duplikat, ganti nama, warna...). Seret tepi klip untuk panjangnya, jepit dua jari untuk zoom, geser untuk menggulir.' },
    { t: 'Kolom header track', el: arrRect('header'), x: 'Setiap baris adalah satu track (channel). Ketuk header = pilih track dan tampilkan device-nya; ketuk-ganda = lipat / buka; seret tepi kirinya untuk melebarkan kolom.' },
    { t: 'Tambah track', el: arrRect('addTrack'), gest: 'tap', x: 'Menambah track: synth (MIDI, untuk instrumen), drum (step sequencer), audio (sample / rekaman), atau FX track untuk routing dan grup. Track otomasi dibuat dengan menahan sebuah kontrol.', pre: () => { mark.n = P.state.tracks.length; }, want: () => P.state.tracks.length > mark.n, hint: 'Coba: ketuk “+ Track” lalu pilih jenis track.' },
    { t: 'Nama track', el: arrRect('title'), x: 'Ketuk = pilih track. Tahan = menu track: ganti nama, warna, duplikat, hapus, freeze, simpan / impor MIDI, template drum.' },
    { t: 'Mute', el: arrRect('mute'), x: 'Membisukan track (nomor track menyala = aktif).' },
    { t: 'Solo', el: arrRect('solo'), x: 'Hanya track ini (dan track solo lain) yang berbunyi.' },
    { t: 'Arm (rekam)', el: arrRect('arm'), x: 'Track yang di-arm menerima rekaman saat tombol Rekam ditekan.' },
    { t: 'Volume dan Pan', el: arrRect('vol'), gest: 'drag', tips: ['Mulai mixing dari kick dan bass, baru elemen lain relatif terhadapnya.', 'Pan elemen pendukung (hat, pluck) sedikit ke kiri / kanan untuk mix yang lebar; kick, bass dan lead tetap di tengah.'], x: 'Seret ke atas / bawah untuk volume (dB) dan pan di sebelahnya. Ketuk-ganda = kembali ke 0 dB / tengah. Tahan = otomasi, MIDI CC, atau Nilai persis.' },
    { t: 'Send A / B', el: arrRect('sa'), x: 'Jumlah sinyal yang dikirim ke track efek (return) A dan B, misalnya reverb dan delay bersama.' },
  ] },
  { id: 'panel', name: 'Panel bawah: device dan keyboard', ic: '\u2699', steps: [
    { t: 'Tab Device', el: '#dtabs [data-tab="dev"]', x: 'Rantai device track terpilih: instrumen lalu efek, kiri ke kanan seperti rack FL Studio Mobile. Tambah efek dari Browser → Efek.', pre: () => { view('arr')(); tab('dev')(); } },
    { t: 'Kartu device', el: firstCard, gest: 'hold', x: 'Setiap kartu satu modul. Tombol judul: ⇄ nyala / mati (bypass), ⧉ jendela mengambang, ⋯ menu (preset, reset, hapus, pindah), ▾ lipat. Knob: seret naik / turun (dua jari = halus), ketuk-ganda = nilai awal, tahan = Nilai persis (Fine tune), otomasi, MIDI CC.' },
    { t: 'Tab Keys', el: '#dtabs [data-tab="keys"]', x: 'Keyboard untuk memainkan instrumen track terpilih, atau pad untuk track drum. Ada pitch bend dan mod wheel, akor, strum, dan skala.', want: () => { const b = $('#dtabs [data-tab="keys"]'); return !!(b && b.classList.contains('on')); }, hint: 'Coba: ketuk Keys.' },
    { t: 'Ukuran panel', el: '#dtabs', x: 'Seret bilah tab ini ke atas / bawah untuk mengubah tinggi panel. Tombol di kanan: perbesar penuh atau tutup panel.' },
    { t: 'Kembali ke Device', el: '#dtabs [data-tab="dev"]', x: 'Ketuk Device untuk kembali ke rantai device.', want: () => { const b = $('#dtabs [data-tab="dev"]'); return !!(b && b.classList.contains('on')); }, hint: 'Coba: ketuk Device.' },
  ] },
  { id: 'beat', name: 'Latihan: beat pertamamu', ic: '\u25cf', steps: [
    { t: 'Buat beat dalam 6 langkah', x: 'Kita membuat pola drum dan memutarnya. Setiap langkah menunggu kamu melakukannya.', pre: () => { view('arr')(); browserOff(); tab('dev')(); } },
    { t: '1. Track drum', el: arrRect('addTrack'), x: 'Ketuk “+ Track” lalu pilih “Track drum (step sequencer)”.', pre: () => { mark.d = P.state.tracks.filter((t) => t.kind === 'drum').length; }, want: () => P.state.tracks.filter((t) => t.kind === 'drum').length > mark.d, hint: 'Coba: + Track → Track drum.' },
    { t: '2. Klip pola', gest: 'dtap', el: () => { const i = drumIdx(); if (i < 0) return null; if (cur && cur.shown !== cur.k) { T.revealRow(i); cur.shown = cur.k; } return T.tutorialRects(i).lane; }, x: 'Ketuk-ganda di lane track drum ini untuk membuat klip 1 bar.', want: () => { const i = drumIdx(); return i >= 0 && P.state.tracks[i].clips.length > 0; }, hint: 'Coba: ketuk-ganda di lane yang disorot.' },
    { t: '3. Buka editor step', gest: 'dtap', el: () => { const i = drumIdx(); return i >= 0 ? T.tutorialRects(i).lane : null; }, x: 'Ketuk-ganda klip yang baru dibuat untuk membuka editor step.', want: () => vis('#btn-edclose'), hint: 'Coba: ketuk-ganda klipnya.' },
    { t: '4. Isi step', el: '#dbody', gest: 'tap', tips: ['Kick di 1, 5, 9, 13 = four-on-the-floor; clap di 5 dan 13; hat di 3, 7, 11, 15 = offbeat.', 'Tahan sebuah step untuk mengatur velocity dan pitch-nya.'], x: 'Ketuk kotak-kotak step untuk menaruh pukulan: misalnya kick di 1, 5, 9, 13 dan snare di 5 dan 13. Seret untuk melukis beberapa sekaligus.', want: () => { const i = drumIdx(); return i >= 0 && P.state.tracks[i].clips.some((c) => (c.notes || []).length >= 3); }, hint: 'Coba: ketuk minimal 3 step.' },
    { t: '5. Putar', el: '#btn-play', x: 'Tekan Play dan dengarkan polanya berulang.', want: () => P.state.playing, hint: 'Coba: ketuk Play.' },
    { t: '6. Simpan', el: '#btn-menu', x: 'Hentikan pemutaran, lalu buka Menu dan geser baris “Simpan…” ke kanan untuk Simpan cepat (atau ketuk untuk memberi nama). Selamat, beat pertamamu jadi!' },
  ] },
  { id: 'flm', name: 'Alur FL Studio Mobile', ic: '\u2605', steps: [
    { t: 'Impor proyek FL Studio Mobile', el: '#btn-menu', x: 'Menu → Impor → Proyek FLM: pilih file .flm atau ZIP (proyek + folder My Samples). Klip audio, stretch, pitch, level, pan, efek FLM dan instrumen (DirectWave, GMS, MiniSynth, SuperSaw, 3x Osc, Slicer) ikut terbaca. Jendela progres menunjukkan sample yang dimuat dan dirender.' },
    { t: 'DirectWave: WAV, MP3, DWP, multi-sample', el: firstCard, x: 'Di track DirectWave, ketuk tombol Zona pada layarnya: Muat WAV / MP3 / program DWP, atau “Buat dari sample” untuk memetakan banyak file sekaligus menurut namanya (mis. Piano_C4_v64.wav = nada C4, layer velocity sampai 64).' },
    { t: 'CTRL dan Nilai persis', el: firstCard, x: 'Seperti tombol CTRL di FL Studio Mobile: tahan kontrol mana pun untuk Nilai persis (ketik angka), membuat track otomasi, menautkan ke track otomasi terpilih, atau menghubungkan ke knob controller MIDI.' },
    { t: 'Ekspor', el: '#btn-menu', x: 'Menu → Ekspor → Audio: WAV 16 / 24 / 32 bit atau MP3, seluruh lagu / loop / pilihan, stem per track, sample rate, normalisasi. Juga MIDI, proyek .mdaw, dan ZIP berisi proyek + sample.' },
    { t: 'Selesai', finale: true, x: 'Kamu sudah mengenal semua bagian utama. Tutorial ini selalu bisa dibuka lagi dari Menu → Tutorial interaktif, mulai dari bab mana pun.' },
  ] },
];

// ---------------------------------------------------------------- runner
let cur = null;
export const isRunning = () => !!cur;
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
// chapterId: start there (and go on through the next chapters); only: that chapter alone
export function startTutorial(chapterId, only = false) {
  stopTutorial();
  const steps = [], from = Math.max(0, CHAPTERS.findIndex((c) => c.id === chapterId));
  const list = chapterId ? (only ? [CHAPTERS[from]] : CHAPTERS.slice(from)) : CHAPTERS.filter((c) => c.id !== 'show');
  list.forEach((c) => c.steps.forEach((s, k) => steps.push({ ...s, ch: c.name, ic: c.ic || '•', first: k === 0, chN: CHAPTERS.indexOf(c) + 1 })));
  const root = h('div', { class: 'tut' + (reduced() ? ' calm' : '') }), blk = [0, 1, 2, 3].map(() => h('div', { class: 'tut-blk' })), ring = h('div', { class: 'tut-ring' });
  const card = h('div', { class: 'tut-card', role: 'dialog' }), g = h('div', { class: 'tut-g' }, h('i'), h('b'));
  root.append(...blk, ring, g, card); (document.getElementById('layer') || document.body).before(root);   // in #layer's stacking context, under it: menus and dialogs opened during a step stay on top
  cur = { steps, k: -1, root, blk, ring, card, g, timer: 0, doneAt: 0, live: null };
  show(0);
  cur.timer = setInterval(tick, 200);
  return cur;
}
export function stopTutorial(finished) {
  if (!cur) return;
  clearInterval(cur.timer); const r = cur.root; cur = null;
  r.classList.add('out'); setTimeout(() => r.remove(), reduced() ? 0 : 220);
  if (finished !== undefined) { prefs.tutorialSeen = true; savePrefs(); }
}
function target(s) {
  if (!s.el) return null;
  let r = null;
  try { r = typeof s.el === 'string' ? rectOf($(s.el)) : (() => { const v = s.el(); return v && v.getBoundingClientRect ? rectOf(v) : v; })(); } catch (_) { r = null; }
  return r && r.width > 0 && r.height > 0 ? r : null;
}
function place(r) {
  const { blk, ring, card, g } = cur, W = innerWidth, H = innerHeight, pad = 4, s = cur.steps[cur.k] || {};
  if (!r) { blk[0].style.cssText = `left:0;top:0;width:${W}px;height:${H}px`; for (let k = 1; k < 4; k++) blk[k].style.cssText = 'display:none'; ring.style.display = 'none'; g.style.display = 'none'; }
  else {
    const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad), x2 = Math.min(W, r.left + r.width + pad), y2 = Math.min(H, r.top + r.height + pad);
    blk[0].style.cssText = `left:0;top:0;width:${W}px;height:${y}px`; blk[1].style.cssText = `left:0;top:${y2}px;width:${W}px;height:${H - y2}px`;
    blk[2].style.cssText = `left:0;top:${y}px;width:${x}px;height:${y2 - y}px`; blk[3].style.cssText = `left:${x2}px;top:${y}px;width:${W - x2}px;height:${y2 - y}px`;
    ring.style.cssText = `display:block;left:${x}px;top:${y}px;width:${x2 - x}px;height:${y2 - y}px`;
    // the animated finger: the gesture this control takes, at its centre (in its left part for a wide target)
    if (s.gest && !cur.doneAt) { const gx = r.width > 220 ? r.left + Math.min(140, r.width * 0.25) : r.left + r.width / 2, gy = r.top + r.height / 2; g.className = 'tut-g ' + s.gest; g.style.cssText = `display:block;left:${gx}px;top:${gy}px`; } else g.style.display = 'none';
  }
  const cw = Math.min(s.live || s.tips ? 400 : 360, W - 16); card.style.maxHeight = (H - 16) + 'px'; const ch = card.offsetHeight || 160; let maxH = H - 16;
  let left = r ? r.left + r.width / 2 - cw / 2 : (W - cw) / 2, top = r ? (r.top + r.height + 12 + ch < H ? r.top + r.height + 12 : r.top - 12 - ch) : (H - ch) / 2;
  if (r && (top < 8 || (top + ch > H - 8))) {                       // no room above or below: beside the target (the wider side), else at the far edge
    const lw = r.left - 12, rw = W - (r.left + r.width) - 12;
    if (Math.max(lw, rw) >= cw) { left = lw >= rw ? r.left - 12 - cw : r.left + r.width + 12; top = Math.max(8, Math.min(H - ch - 8, r.top + r.height / 2 - ch / 2)); }
    else {                                                           // a short screen: the larger gap above / below the target, the card scrolls inside it
      const up = r.top - 20, dn = H - (r.top + r.height) - 20;
      if (Math.max(up, dn) >= 110) { maxH = Math.max(up, dn); top = dn >= up ? r.top + r.height + 12 : Math.max(8, r.top - 12 - Math.min(ch, maxH)); }
      else top = Math.max(8, Math.min(H - ch - 8, r.top < H / 2 ? H - ch - 12 : 12));
    }
  }
  left = Math.max(8, Math.min(W - cw - 8, left));
  card.style.left = left + 'px'; card.style.top = Math.max(8, top) + 'px'; card.style.width = cw + 'px'; card.style.maxHeight = maxH + 'px';
}
// the live song map: the markers as coloured sections, a playhead that follows the song, the section under it lit
function liveMap() {
  const ms = [...(P.state.markers || [])].sort((a, b) => a.t - b.t); if (!ms.length) return null;
  const end = Math.max(ms[ms.length - 1].t + 8 * BAR, ...P.state.tracks.flatMap((t) => t.clips.map((c) => c.start + c.len)));
  const segs = ms.map((m, k) => ({ m, a: m.t, b: k + 1 < ms.length ? ms[k + 1].t : end }));
  const bar = h('div', { class: 'tut-map' }, ...segs.map((q) => { const e = h('button', { class: 'tut-seg', title: q.m.name, onclick: () => { P.seekTo(q.a); if (!P.state.playing) P.togglePlay(); } }, h('span', {}, q.m.name)); e.style.flex = String(Math.max(1, q.b - q.a)); e.style.setProperty('--c', q.m.color || '#888'); return e; }), h('i', { class: 'tut-ph' }));
  const eq = h('div', { class: 'tut-eq' }, ...[0, 1, 2, 3, 4, 5, 6].map(() => h('i')));
  const info = h('div', { class: 'tut-now' }, eq, h('b', {}, ''), h('span', {}, ''));
  const wrap = h('div', { class: 'tut-live' }, info, bar);
  const upd = () => {
    const pos = P.state.pos || 0, k = Math.max(0, segs.findIndex((q) => pos >= q.a && pos < q.b));
    bar.querySelector('.tut-ph').style.left = Math.min(100, pos / end * 100) + '%';
    [...bar.querySelectorAll('.tut-seg')].forEach((e, j) => e.classList.toggle('on', j === k));
    info.querySelector('b').textContent = P.state.playing ? '▶ ' + segs[k].m.name : '■ ' + segs[k].m.name;
    info.querySelector('span').textContent = 'bar ' + (Math.floor(pos / BAR) + 1) + ' / ' + Math.round(end / BAR);
    wrap.classList.toggle('play', !!P.state.playing);
  };
  upd(); return { el: wrap, upd };
}
function burst(host, n = 14) {                          // a small confetti burst out of `host` (success)
  if (reduced()) return;
  const cols = ['#ffad56', '#5ac878', '#4fd1ff', '#ff6fb5', '#ffe066', '#b28dff'];
  for (let k = 0; k < n; k++) { const p = h('i', { class: 'tut-cf' }); const a = (k / n) * Math.PI * 2, d = 50 + (k * 37) % 40; p.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 20}px;background:${cols[k % cols.length]};animation-delay:${(k % 4) * 15}ms`; host.append(p); setTimeout(() => p.remove(), 900); }
}
function rain() {                                       // the finale: confetti falling over the whole screen
  if (reduced() || !cur) return;
  const cols = ['#ffad56', '#5ac878', '#4fd1ff', '#ff6fb5', '#ffe066', '#b28dff'], box = h('div', { class: 'tut-rain' });
  for (let k = 0; k < 60; k++) { const p = h('i'); p.style.cssText = `left:${(k * 53) % 100}%;background:${cols[k % 6]};animation-delay:${(k % 12) * 90}ms;animation-duration:${1600 + (k * 71) % 1200}ms;--r:${(k * 47) % 360}deg`; box.append(p); }
  cur.root.append(box); setTimeout(() => box.remove(), 3200);
}
async function show(k) {
  if (!cur) return;
  const s = cur.steps[k]; if (!s) { stopTutorial(true); return; }
  const back = k < cur.k; cur.k = k; cur.doneAt = 0; cur.live = null; cur.shown = -1;
  const n = cur.steps.length;
  if (s.pre) {
    cur.card.classList.add('busy'); cur.card.replaceChildren(h('div', { class: 'tut-ch' }, s.ch), h('h4', {}, s.t), h('div', { class: 'tut-spin' }, h('i'), 'Menyiapkan…'));
    place(target(s));
    try { await s.pre(); } catch (e) { toast((e && e.message) || 'Langkah ini tidak bisa disiapkan.', 3500); }
    if (!cur || cur.k !== k) return;
    cur.card.classList.remove('busy'); cur.shown = -1;   // the target is looked up (and scrolled into view) again now that it exists
  }
  const want = !!s.want;
  const next = h('button', { class: 'b go tut-next', onclick: () => show(k + 1) }, k + 1 >= n ? 'Selesai' : 'Lanjut ›');
  if (want) next.disabled = true;
  const acts = [];
  for (const a of s.acts || []) { if (a.when && !(await a.when())) continue; acts.push(h('button', { class: 'b' + (a.go ? ' go' : ''), onclick: async () => { try { await a.fn(); } catch (_) { /* keep the tour going */ } } }, a.label)); }
  const live = s.live ? liveMap() : null; cur.live = live;
  const tips = s.tips && s.tips.length ? h('details', { class: 'tut-tips' }, h('summary', {}, 'Detail & tips'), h('ul', {}, ...s.tips.map((t) => h('li', {}, t)))) : null;
  if (tips) tips.open = /Showcase/.test(s.ch || '') && !s.live;   // the showcase explains in full; a step with the live map keeps the card short
  const prog = h('div', { class: 'tut-prog' }, h('i')); 
  cur.card.replaceChildren(...[
    s.first ? h('div', { class: 'tut-splash' }, h('div', { class: 'tut-ic' }, s.ic), h('div', {}, h('small', {}, 'Bab ' + s.chN), h('strong', {}, s.ch)), h('div', { class: 'tut-eq big' }, ...[0, 1, 2, 3, 4].map(() => h('i')))) : null,
    prog,
    h('div', { class: 'tut-ch' }, s.ch + '  •  ' + (k + 1) + ' / ' + n),
    h('h4', {}, s.t), h('p', {}, s.x),
    live ? live.el : null,
    tips,
    want ? h('div', { class: 'tut-try' }, h('i', { class: 'tut-dot' }), s.hint || 'Coba sekarang.') : null,
    acts.length ? h('div', { class: 'tut-xacts' }, ...acts) : null,
    h('div', { class: 'tut-acts' },
      h('button', { class: 'b tut-skip', onclick: () => stopTutorial(false) }, 'Tutup'),
      h('span', { style: 'flex:1' }),
      k > 0 ? h('button', { class: 'b', onclick: () => show(k - 1) }, '‹ Kembali') : null,
      want ? h('button', { class: 'b', onclick: () => show(k + 1) }, 'Lewati') : null,
      next)].filter(Boolean));
  cur.card.classList.remove('in', 'back'); void cur.card.offsetWidth; cur.card.classList.add('in'); if (back) cur.card.classList.add('back');
  requestAnimationFrame(() => { if (cur) prog.firstChild.style.width = ((k + 1) / n * 100) + '%'; });
  cur.ring.classList.remove('pop'); void cur.ring.offsetWidth; cur.ring.classList.add('pop');
  cur.next = next; cur.want = want;
  place(target(s)); requestAnimationFrame(() => cur && place(target(s)));
  if (s.finale) setTimeout(rain, 250);
}
function tick() {
  if (!cur || cur.k < 0) return;
  const s = cur.steps[cur.k];
  if (cur.card.classList.contains('busy')) return;
  place(target(s));
  if (cur.live) cur.live.upd();
  if (cur.want && !cur.doneAt && s.want && (() => { try { return s.want(); } catch (_) { return false; } })()) {
    cur.doneAt = Date.now(); cur.next.disabled = false; cur.card.classList.add('ok'); cur.g.style.display = 'none';
    const tr = cur.card.querySelector('.tut-try'); if (tr) tr.textContent = '✓ Berhasil!';
    burst(cur.card);
    const k = cur.k; setTimeout(() => { if (cur && cur.k === k) { cur.card.classList.remove('ok'); show(k + 1); } }, 900);
  }
}

// Menu -> Tutorial interaktif: the showcase, start from the beginning, or one chapter
export function tutorialMenu() {
  const sh = CHAPTERS[0];
  const list = h('div', { class: 'tut-list' },
    h('button', { class: 'b tut-hero', onclick: () => { close(); startTutorial('show', true); } }, h('span', { class: 'tut-eq big' }, ...[0, 1, 2, 3, 4].map(() => h('i'))), h('div', {}, h('strong', {}, sh.name), h('small', {}, 'Neon Horizon • 128 BPM • F minor • ' + sh.steps.length + ' langkah • putar dan bongkar lagu jadi'))),
    ...CHAPTERS.slice(1).map((c, k) => h('button', { class: 'b', onclick: () => { close(); startTutorial(c.id, true); } }, h('span', { class: 'tut-li' }, c.ic || '•'), (k + 1) + '. ' + c.name + '  (' + c.steps.length + ' langkah)')));
  const close = modal('Tutorial interaktif', h('div', {}, h('div', { class: 'hint', style: 'margin-bottom:8px' }, 'Setiap langkah menyorot tombol di layar dan menjelaskan cara memakainya. Langkah “Coba” menunggu kamu melakukannya langsung.'), list),
    [{ label: 'Tutup' }, { label: 'Semua bab dari awal', go: true, fn: () => startTutorial() }]);
}
// first start: a small offer at the bottom (never while automated tests drive the page)
export function offerTutorial() {
  if (prefs.tutorialSeen || navigator.webdriver) return;
  const chip = h('div', { class: 'tut-offer' }, h('span', { class: 'tut-eq' }, ...[0, 1, 2, 3].map(() => h('i'))), h('span', {}, 'Baru di MobileDAW?'),
    h('button', { class: 'b go', onclick: () => { chip.remove(); startTutorial('show', true); } }, 'Tonton showcase'),
    h('button', { class: 'b', onclick: () => { chip.remove(); startTutorial(); } }, 'Tutorial tombol'),
    h('button', { class: 'b', onclick: () => { chip.remove(); prefs.tutorialSeen = true; savePrefs(); } }, 'Nanti'));
  document.body.append(chip);
}
