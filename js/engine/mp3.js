// Encoder MP3 lokal (MPEG-1 Layer III, CBR, 32/44,1/48 kHz, mono/stereo, joint stereo M/S). Tanpa dependensi.
// Pemakaian bertahap: const e = new Mp3Encoder(sr, kanal, kbps); frames = e.encode(L, R, n) ... e.finish().
// Bit reservoir: frame yang noisenya sudah di bawah ambang memakai lebih sedikit bit, sisanya (maks. 511 byte) dipakai frame berikut yang
// lebih sulit (main_data_begin). Kuantisasi: global_gain per granule + scalefactor per band
// (outer loop ISO 11172-3): noise tiap scalefactor band dibentuk di bawah ambang masking sederhana (spreading per Bark dari energi band),
// jadi noise pengkodean ditempatkan di tempat yang tertutup musiknya (kualitas setara LAME di 256 - 320 kbps, lihat tools/mp3-quality-test.mjs).
import { WIN257, HUFF, QUAD_A, QUAD_B } from './mp3tables.js';

const SFB = {
  44100: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576],
  48000: [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576],
  32000: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576],
};
const SR_IDX = { 44100: 0, 48000: 1, 32000: 2 };
export const MP3_BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
export const MP3_RATES = [32000, 44100, 48000];
export const mp3Rate = (sr) => (SR_IDX[sr] !== undefined ? sr : sr % 44100 === 0 ? 44100 : 48000);

// ---------------------------------------------------------------- konstanta (dihitung sekali)
const CWIN = new Float64Array(512);   // jendela analisis polyphase C = D / 32
for (let i = 0; i <= 256; i++) CWIN[i] = WIN257[i] / 65536 / 32;
for (let i = 1; i <= 256; i++) CWIN[512 - i] = (i & 63 ? -WIN257[i] : WIN257[i]) / 65536 / 32;
const MAT = new Float64Array(32 * 64);
for (let k = 0; k < 32; k++) for (let i = 0; i < 64; i++) MAT[k * 64 + i] = Math.cos((2 * k + 1) * (i - 16) * Math.PI / 64);
const MDCT = new Float64Array(18 * 36), MWIN = new Float64Array(36);
for (let n = 0; n < 36; n++) { MWIN[n] = Math.sin(Math.PI / 36 * (n + 0.5)); for (let k = 0; k < 18; k++) MDCT[k * 36 + n] = Math.cos(Math.PI / 72 * (2 * n + 1 + 18) * (2 * k + 1)); }
const CS = new Float64Array(8), CA = new Float64Array(8);
[-0.6, -0.535, -0.33, -0.185, -0.095, -0.041, -0.0142, -0.0037].forEach((c, i) => { const q = Math.sqrt(1 + c * c); CS[i] = 1 / q; CA[i] = c / q; });
const MDCT_GAIN = 1 / 9;   // hasil kalibrasi terhadap decoder referensi

// tabel Huffman -> larik bertipe; id tabel_select -> { h: id tabel dasar, lb: linbits, max }
const HT = {};
for (const id of Object.keys(HUFF)) HT[id] = { x: HUFF[id].x, len: Uint8Array.from(HUFF[id].len), code: Uint16Array.from(HUFF[id].code) };
const TSEL = [];   // indeks = nomor tabel pada side info
const LB16 = [1, 2, 3, 4, 6, 8, 10, 13], LB24 = [4, 5, 6, 7, 8, 9, 11, 13];
for (const t of [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15]) TSEL[t] = { h: t, lb: 0, max: HT[t].x - 1 };
for (let k = 0; k < 8; k++) { TSEL[16 + k] = { h: 16, lb: LB16[k], max: 15 + (1 << LB16[k]) - 1 }; TSEL[24 + k] = { h: 24, lb: LB24[k], max: 15 + (1 << LB24[k]) - 1 }; }
const CANDS = [[0], [1], [2, 3], [5, 6], [7, 8, 9], [7, 8, 9], [10, 11, 12], [10, 11, 12], [13, 15]];   // por indeks nilai maksimum 0..8 (di atas 7 -> 13/15 sampai 15)
const ESC_CANDS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const P43 = Float64Array.from({ length: 8208 }, (_, i) => Math.pow(i, 4 / 3));
const SLEN1 = [0, 0, 0, 0, 3, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4], SLEN2 = [0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 3, 1, 2, 3, 2, 3];
// scalefac_compress terkecil yang memuat scalefactor sfb 0-10 (slen1) dan 11-20 (slen2); bits = panjang part2
function sfCompress(sf) {
  let m1 = 0, m2 = 0; for (let b = 0; b < 11; b++) if (sf[b] > m1) m1 = sf[b]; for (let b = 11; b < 21; b++) if (sf[b] > m2) m2 = sf[b];
  let c = 0, bits = Infinity; for (let k = 0; k < 16; k++) { if ((1 << SLEN1[k]) - 1 < m1 || (1 << SLEN2[k]) - 1 < m2) continue; const n = 11 * SLEN1[k] + 10 * SLEN2[k]; if (n < bits) { bits = n; c = k; } }
  return { c, bits };
}
const QA = { len: Uint8Array.from(QUAD_A.len), code: Uint8Array.from(QUAD_A.code) }, QB = { len: Uint8Array.from(QUAD_B.len), code: Uint8Array.from(QUAD_B.code) };

class BitWriter {
  constructor(n) { this.b = new Uint8Array(n); this.p = 0; }
  put(v, n) { while (n > 0) { const byte = this.p >> 3, free = 8 - (this.p & 7), take = Math.min(free, n), sh = n - take; this.b[byte] |= ((v >>> sh) & ((1 << take) - 1)) << (free - take); this.p += take; n -= take; } }
}

// bit untuk satu region pasangan [a,b) dengan tabel t (nomor side info); Infinity bila nilai tak muat
function regionBits(ix, a, b, t) {
  if (t === 0) return 0;
  const s = TSEL[t], T = HT[s.h], xs = T.x, len = T.len, lb = s.lb; let bits = 0;
  for (let i = a; i < b; i += 2) {
    let x = ix[i], y = ix[i + 1];
    if (lb) { if (x > 14) { x = 15; bits += lb; } if (y > 14) { y = 15; bits += lb; } }
    else if (x >= xs || y >= xs) return Infinity;
    bits += len[x * xs + y] + (x > 0 ? 1 : 0) + (y > 0 ? 1 : 0);
  }
  return bits;
}
function bestTable(ix, a, b) {
  if (b <= a) return { t: 0, bits: 0 };
  let m = 0; for (let i = a; i < b; i++) if (ix[i] > m) m = ix[i];
  if (m === 0) return { t: 0, bits: 0 };
  const list = m <= 15 ? CANDS[Math.min(m, 8)] : ESC_CANDS;
  let best = { t: 0, bits: Infinity };
  for (const t of list) { if (t && TSEL[t].max < m) continue; const bt = regionBits(ix, a, b, t); if (bt < best.bits) best = { t, bits: bt }; }
  return best;
}
function quadBits(ix, from, to, T) { let bits = 0; for (let i = from; i < to; i += 4) { const v = ix[i], w = ix[i + 1], x = ix[i + 2], y = ix[i + 3]; bits += T.len[(v << 3) | (w << 2) | (x << 1) | y] + v + w + x + y; } return bits; }

// ruang bit sebuah blok pada ix tertentu; mengisi info (partisi, tabel) dan mengembalikan jumlah bit
function analyse(ix, sfb, info, search) {
  let i = 576; while (i >= 2 && ix[i - 1] === 0 && ix[i - 2] === 0) i -= 2;
  const n0 = i; while (i >= 4 && ix[i - 1] <= 1 && ix[i - 2] <= 1 && ix[i - 3] <= 1 && ix[i - 4] <= 1) i -= 4;
  const big = i, cnt = n0 - i;
  let a = 0, bb = 0; if (cnt) { a = quadBits(ix, big, n0, QA); bb = quadBits(ix, big, n0, QB); }
  info.big = big >> 1; info.cnt = cnt >> 2; info.c1 = bb < a ? 1 : 0; let bits = Math.min(a, bb);
  let best = Infinity;
  const tryRegions = (r0, r1) => {
    const e1 = Math.min(sfb[r0 + 1], big), e2 = Math.min(sfb[Math.min(r0 + r1 + 2, 22)], big);
    const A = bestTable(ix, 0, e1), B = bestTable(ix, e1, e2), Cc = bestTable(ix, e2, big), tot = A.bits + B.bits + Cc.bits;
    if (tot < best) { best = tot; info.r0 = r0; info.r1 = r1; info.e1 = e1; info.e2 = e2; info.t0 = A.t; info.t1 = B.t; info.t2 = Cc.t; }
  };
  if (!search) tryRegions(7, 7 > 0 ? 5 : 0);
  else for (const r0 of [3, 5, 7, 9, 11, 13, 15]) for (const r1 of [1, 3, 5, 7]) if (r0 + r1 + 2 <= 22) tryRegions(r0, r1);
  if (!(best < Infinity)) return Infinity;
  info.bits = bits + best; return info.bits;
}

export class Mp3Encoder {
  constructor(sr = 48000, channels = 2, kbps = 192) {
    if (SR_IDX[sr] === undefined) throw new Error('Laju sampel tidak didukung MP3: ' + sr);
    if (!MP3_BITRATES.includes(kbps)) throw new Error('Bitrate tidak valid: ' + kbps);
    this.sr = sr; this.nch = channels === 1 ? 1 : 2; this.kbps = kbps; this.sfb = SFB[sr];
    this.px = [new Float64Array(512), new Float64Array(512)];                       // buffer polyphase per kanal
    this.prev = [new Float64Array(576), new Float64Array(576)];                     // sampel subband granule sebelumnya
    this.q = [new Float32Array(1 << 16), new Float32Array(1 << 16)]; this.qs = 0; this.qe = 0;   // antrean sampel masuk
    this.diff = 0; this.frames = 0; this.total = 0;
    const cut = kbps >= 256 ? 20500 : kbps >= 192 ? 19000 : kbps >= 160 ? 18000 : kbps >= 128 ? 16500 : kbps >= 96 ? 15000 : 12000;
    this.cut = Math.min(576, Math.floor(576 * cut / (sr / 2)));
    this.ix = new Int32Array(576); this.a34 = new Float64Array(576); this.xr = [[new Float64Array(576), new Float64Array(576)], [new Float64Array(576), new Float64Array(576)]];
    this.sbuf = new Float64Array(576); this.Y = new Float64Array(64); this.S = new Float64Array(32); this.z = new Float64Array(36);
    this.tmpIx = [0, 1, 2, 3].map(() => new Int32Array(576)); this.dly = 0;
    this.maskOff = 10 ** (-(kbps >= 320 ? 24 : kbps >= 256 ? 21 : kbps >= 192 ? 18 : kbps >= 160 ? 15 : 12) / 10);   // allowed noise: masking threshold minus 12..24 dB (stricter when there are more bits)
    const bark = (f) => 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2), sfbT = this.sfb;
    const zc = Array.from({ length: 22 }, (_, b) => bark((sfbT[b] + sfbT[b + 1]) / 2 * sr / 1152));
    this.spread = new Float64Array(22 * 22); for (let j = 0; j < 22; j++) for (let k = 0; k < 22; k++) { const dz = zc[j] - zc[k]; this.spread[j * 22 + k] = 10 ** ((dz >= 0 ? -10 * dz : 27 * dz) / 10); }
    this.band = new Uint8Array(576); for (let b = 0; b < 22; b++) for (let i = sfbT[b]; i < sfbT[b + 1]; i++) this.band[i] = b;
    this.xmin = [[new Float64Array(22), new Float64Array(22)], [new Float64Array(22), new Float64Array(22)]]; this.bestIx = new Int32Array(576); this.w34 = new Float64Array(576);
    this.res = 0; this.sAbs = 0; this.pend = []; this.ms = new Uint8Array(16384); this.msBase = 0;   // bit reservoir: virtual main-data stream
  }

  // sampel float -1..1; R boleh null bila mono. Mengembalikan daftar Uint8Array (frame yang selesai).
  encode(L, R, n = L.length) {
    this._push(L, R, n); const out = [];
    while (this.qe - this.qs >= 1152) for (const f of this._frame()) out.push(f);
    if (this.qs > (1 << 15)) { for (let c = 0; c < 2; c++) this.q[c].copyWithin(0, this.qs, this.qe); this.qe -= this.qs; this.qs = 0; }
    return out;
  }
  finish() { const pad = 1152 + 1105, z = new Float32Array(pad), out = this.encode(z, z, pad); return out.concat(this.encode(new Float32Array(1152), new Float32Array(1152), 1152), this._emit(Infinity)); }
  // frames whose main-data slots are complete (no later frame can still write into them)
  _emit(upto) {
    const out = [];
    while (this.pend.length && this.pend[0].S + this.pend[0].slots <= upto) {
      const f = this.pend.shift(), b = new Uint8Array(f.hdr.length + f.slots); b.set(f.hdr); b.set(this.ms.subarray(f.S - this.msBase, f.S - this.msBase + f.slots), f.hdr.length); out.push(b);
      const drop = f.S + f.slots - this.msBase; if (drop > 8192) { this.ms.copyWithin(0, drop); this.ms.fill(0, this.ms.length - drop); this.msBase += drop; }
    }
    return out;
  }
  _push(L, R, n) {
    if (this.qe + n > this.q[0].length) { const m = Math.max(this.q[0].length * 2, this.qe + n); for (let c = 0; c < 2; c++) { const t = new Float32Array(m); t.set(this.q[c].subarray(0, this.qe)); this.q[c] = t; } }
    this.q[0].set(L.length === n ? L : L.subarray(0, n), this.qe);
    if (this.nch === 2) this.q[1].set(R ? (R.length === n ? R : R.subarray(0, n)) : L.subarray(0, n), this.qe);
    this.qe += n;
  }

  // 1 granule (576 sampel) satu kanal -> 576 koefisien MDCT (dengan butterfly alias)
  _analyse(c, start, xr) {
    const q = this.q[c], X = this.px[c], sb = this.sbuf, Y = this.Y, S = this.S;
    for (let slot = 0; slot < 18; slot++) {
      X.copyWithin(32, 0, 480);
      const o = start + slot * 32; for (let j = 0; j < 32; j++) X[31 - j] = q[o + j];
      for (let i = 0; i < 64; i++) { let s = 0; for (let j = 0; j < 8; j++) s += CWIN[i + 64 * j] * X[i + 64 * j]; Y[i] = s; }
      for (let k = 0; k < 32; k++) { let s = 0; const m = k * 64; for (let i = 0; i < 64; i++) s += MAT[m + i] * Y[i]; S[k] = (slot & 1) && (k & 1) ? -s : s; }
      for (let k = 0; k < 32; k++) sb[k * 18 + slot] = S[k];
    }
    const prev = this.prev[c], z = this.z;
    for (let k = 0; k < 32; k++) {
      for (let n = 0; n < 18; n++) { z[n] = prev[k * 18 + n] * MWIN[n]; z[18 + n] = sb[k * 18 + n] * MWIN[18 + n]; prev[k * 18 + n] = sb[k * 18 + n]; }
      for (let m = 0; m < 18; m++) { let s = 0; const t = m * 36; for (let n = 0; n < 36; n++) s += z[n] * MDCT[t + n]; xr[k * 18 + m] = s * MDCT_GAIN; }
    }
    for (let k = 1; k < 32; k++) for (let i = 0; i < 8; i++) {
      const p = 18 * k - 1 - i, r = 18 * k + i, a = xr[p], b = xr[r];
      xr[p] = a * CS[i] + b * CA[i]; xr[r] = b * CS[i] - a * CA[i];
    }
    for (let i = this.cut; i < 576; i++) xr[i] = 0;
  }

  // noise yang diizinkan per scalefactor band (energi): ambang masking dari energi band granule ini, disebar per Bark
  _mask(xr, out) {
    const sfbT = this.sfb, en = new Float64Array(22); let tot = 0;
    for (let b = 0; b < 22; b++) { let e = 0; for (let i = sfbT[b]; i < sfbT[b + 1]; i++) e += xr[i] * xr[i]; en[b] = e; tot += e; }
    const floor = Math.max(tot * 1e-10, 1e-14);
    for (let j = 0; j < 22; j++) { let t = 0; const r = j * 22; for (let k = 0; k < 22; k++) t += en[k] * this.spread[r + k]; out[j] = Math.max(t * this.maskOff, floor * (sfbT[j + 1] - sfbT[j]) / 576); }
  }

  // global_gain + scalefactor (outer loop): ulangi kuantisasi, perkuat band yang noisenya di atas xmin, simpan hasil terbaik
  _quant(xr, budget, info, xmin, save, minBits = 0) {
    const a34 = this.a34, ix = this.ix, w34 = this.w34, band = this.band, sfbT = this.sfb; let any = false;
    for (let i = 0; i < 576; i++) { const v = Math.abs(xr[i]); a34[i] = Math.pow(v, 0.75); if (v > 1e-9) any = true; }
    const sf = new Int32Array(22); info.sf = sf; info.sfc = 0; info.p2 = 0;
    if (!any) { ix.fill(0); info.gg = 210; analyse(ix, sfbT, info, false); info.r0 = 0; info.r1 = 0; info.t0 = info.t1 = info.t2 = 0; info.big = 0; info.cnt = 0; info.bits = 0; info.c1 = 0; return; }
    const fill = (gg) => { const sc = Math.pow(2, -0.1875 * (gg - 210)); let mx = 0; for (let i = 0; i < 576; i++) { const v = Math.floor(w34[i] * sc + 0.4054); ix[i] = v; if (v > mx) mx = v; } return mx; };
    const fits = (gg, room) => { const mx = fill(gg); return mx <= 8206 && analyse(ix, sfbT, info, false) <= room; };
    const noise = (gg) => {                                                      // coding noise per band against xmin (ix filled for gg)
      const step = Math.pow(2, 0.25 * (gg - 210)), amp = []; let over = 0, overDb = 0;
      for (let b = 0; b < 22; b++) {
        const g = step / Math.pow(2, 0.5 * sf[b]); let nz = 0;
        for (let i = sfbT[b]; i < sfbT[b + 1]; i++) { const d = Math.abs(xr[i]) - P43[ix[i]] * g; nz += d * d; }
        if (b < last && nz > xmin[b]) { over++; overDb += 10 * Math.log10(nz / xmin[b]); if (b < 21) amp.push(b); }
      }
      return { over, overDb, amp };
    };
    const setW = () => { for (let i = 0; i < 576; i++) { const s = sf[band[i]]; w34[i] = s ? a34[i] * Math.pow(2, 0.375 * s) : a34[i]; } };
    let last = 0; while (last < 21 && sfbT[last] < this.cut) last++;               // bands that carry audio (below the low-pass)
    setW();
    let room = budget, lo = 0, hi = 255;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (fits(mid, room)) hi = mid; else lo = mid + 1; }
    let gg = lo, best = null;
    for (let it = 0; it < 24; it++) {
      fill(gg);
      const { over, overDb, amp } = noise(gg);
      if (!best || overDb < best.overDb) { best = best || {}; best.overDb = overDb; best.gg = gg; best.sf = sf.slice(); this.bestIx.set(ix); }
      if (!over || !amp.length) break;
      let stop = false; for (const b of amp) { sf[b]++; if (sf[b] > (b < 11 ? 15 : 7)) stop = true; }
      if (stop || amp.length >= Math.min(21, last)) break;                    // scalefactor full, or every band amplified: no gain left
      const p2 = sfCompress(sf).bits; room = budget - p2;
      setW();
      while (gg < 255 && !fits(gg, room)) gg++;
    }
    sf.set(best.sf); setW();
    const { c, bits: p2 } = sfCompress(sf); info.sfc = c; info.p2 = p2; info.sf = sf; room = budget - p2;
    ix.set(this.bestIx); info.gg = best.gg;
    if (save && best.overDb === 0) {                                              // already under the mask: coarsest step that stays there -> spare bits to the reservoir
      let a = best.gg, b = 255;
      const room0 = budget - info.p2, keep = Math.max(0, minBits - info.p2);       // CBR: never save more than the reservoir can hold
      while (a < b) { const m = (a + b + 1) >> 1; fill(m); if (noise(m).over === 0 && analyse(ix, sfbT, info, false) >= Math.min(keep, room0)) a = m; else b = m - 1; }
      if (a > best.gg) { fill(a); info.gg = a; best.gg = a; } else ix.set(this.bestIx);
    }
    analyse(ix, sfbT, info, true);
    for (let g = best.gg + 1; g < 256 && info.bits > room; g++) { fill(g); info.gg = g; analyse(ix, sfbT, info, true); }
  }

  _frame() {
    const nch = this.nch, sr = this.sr, kbps = this.kbps, fbytes = 144000 * kbps / sr;
    this.diff += fbytes - Math.floor(fbytes); let pad = 0; if (this.diff >= 1) { pad = 1; this.diff -= 1; }
    const size = Math.floor(fbytes) + pad, side = nch === 2 ? 32 : 17, slots = size - 4 - side, R = this.res;
    const avail = slots * 8 + Math.floor(R * 8 * 0.75);                          // this frame's share + most of the reservoir
    const g = [[], []], s0 = this.qs; let ms = false;
    for (let gr = 0; gr < 2; gr++) for (let c = 0; c < nch; c++) { this._analyse(c, s0 + gr * 576, this.xr[gr][c]); this._mask(this.xr[gr][c], this.xmin[gr][c]); }
    if (nch === 2) {
      let eM = 0, eS = 0, eL = 0, eR = 0;
      for (let gr = 0; gr < 2; gr++) { const L = this.xr[gr][0], R = this.xr[gr][1]; for (let i = 0; i < 576; i++) { const m = L[i] + R[i], s = L[i] - R[i]; eM += m * m; eS += s * s; eL += L[i] * L[i]; eR += R[i] * R[i]; } }
      ms = eS < 0.35 * eM && eM > 1e-9 && Math.min(eL, eR) > 0.02 * Math.max(eL, eR) * 0 + 0;   // sisi kecil -> M/S hemat bit
      if (ms) for (let gr = 0; gr < 2; gr++) {
        const L = this.xr[gr][0], R = this.xr[gr][1]; for (let i = 0; i < 576; i++) { const m = (L[i] + R[i]) * Math.SQRT1_2, s = (L[i] - R[i]) * Math.SQRT1_2; L[i] = m; R[i] = s; }
        const a = this.xmin[gr][0], b = this.xmin[gr][1]; for (let k = 0; k < 22; k++) a[k] = b[k] = Math.min(a[k], b[k]);   // M/S noise lands in both L and R
      }
    }
    const wts = nch === 2 ? (ms ? [0.62, 0.38] : [0.5, 0.5]) : [1];
    let remain = avail, wleft = 2 * wts.reduce((a, b) => a + b, 0);
    const blocks = []; let must = Math.max(0, R + slots - 511) * 8;            // bytes the reservoir cannot keep must be used now
    for (let gr = 0; gr < 2; gr++) for (let c = 0; c < nch; c++) {
      const budget = Math.min(4095, Math.floor(remain * wts[c] / wleft)), info = { ixs: null };
      this._quant(this.xr[gr][c], budget, info, this.xmin[gr][c], true, Math.min(budget, Math.ceil(must * wts[c] / wleft)));
      info.ixs = this.tmpIx[gr * 2 + c]; info.ixs.set(this.ix);
      info.neg = this.xr[gr][c]; info.sgn = new Uint8Array(576); for (let i = 0; i < 576; i++) info.sgn[i] = this.xr[gr][c][i] < 0 ? 1 : 0;
      remain -= info.bits + info.p2; must -= info.bits + info.p2; wleft -= wts[c]; blocks.push(info);
    }
    // ---- header + side info (main_data_begin = reservoir bytes), main data into the virtual stream
    const used = blocks.reduce((s, b) => s + b.bits + b.p2, 0), U = Math.ceil(used / 8);
    const bw = new BitWriter(4 + side), md = new BitWriter(Math.max(1, U)), sfbT = this.sfb;
    bw.put(0xFFF, 12); bw.put(1, 1); bw.put(1, 2); bw.put(1, 1);                // sync, MPEG-1, layer III, tanpa CRC
    bw.put(MP3_BITRATES.indexOf(kbps) + 1, 4); bw.put(SR_IDX[sr], 2); bw.put(pad, 1); bw.put(0, 1);
    bw.put(nch === 1 ? 3 : 1, 2); bw.put(ms ? 2 : 0, 2); bw.put(0, 1); bw.put(0, 1); bw.put(0, 2);
    bw.put(R, 9); bw.put(0, nch === 2 ? 3 : 5); for (let c = 0; c < nch; c++) bw.put(0, 4);
    for (const b of blocks) {
      bw.put(b.bits + b.p2, 12); bw.put(b.big, 9); bw.put(b.gg, 8); bw.put(b.sfc, 4); bw.put(0, 1);
      bw.put(b.t0, 5); bw.put(b.t1, 5); bw.put(b.t2, 5); bw.put(b.r0, 4); bw.put(b.r1, 3); bw.put(0, 1); bw.put(0, 1); bw.put(b.c1, 1);
    }
    for (const b of blocks) {
      const ix = b.ixs, sg = b.sgn, bigEnd = b.big * 2, l1 = SLEN1[b.sfc], l2 = SLEN2[b.sfc];
      if (l1) for (let k = 0; k < 11; k++) md.put(b.sf[k], l1);
      if (l2) for (let k = 11; k < 21; k++) md.put(b.sf[k], l2);
      const regs = [[0, b.e1, b.t0], [b.e1, b.e2, b.t1], [b.e2, bigEnd, b.t2]];
      for (const [a, e, t] of regs) {
        if (!t || e <= a) continue;
        const s = TSEL[t], T = HT[s.h], xs = T.x, lb = s.lb;
        for (let i = a; i < e; i += 2) {
          let x = ix[i], y = ix[i + 1], ex = 0, ey = 0;
          if (lb) { if (x > 14) { ex = x - 15; x = 15; } if (y > 14) { ey = y - 15; y = 15; } }
          const k = x * xs + y; md.put(T.code[k], T.len[k]);
          if (lb && x === 15) md.put(ex, lb); if (x) md.put(sg[i], 1);
          if (lb && y === 15) md.put(ey, lb); if (y) md.put(sg[i + 1], 1);
        }
      }
      const Q = b.c1 ? QB : QA;
      for (let i = bigEnd; i < bigEnd + b.cnt * 4; i += 4) {
        const v = ix[i], w = ix[i + 1], x = ix[i + 2], y = ix[i + 3], k = (v << 3) | (w << 2) | (x << 1) | y;
        md.put(Q.code[k], Q.len[k]); if (v) md.put(sg[i], 1); if (w) md.put(sg[i + 1], 1); if (x) md.put(sg[i + 2], 1); if (y) md.put(sg[i + 3], 1);
      }
    }
    const S = this.sAbs, start = S - R;
    if (start + U - this.msBase > this.ms.length) { const t = new Uint8Array(Math.max(this.ms.length * 2, start + U - this.msBase + 4096)); t.set(this.ms); this.ms = t; }
    this.ms.set(md.b.subarray(0, U), start - this.msBase);
    this.pend.push({ hdr: bw.b, S, slots }); this.sAbs += slots;
    this.res = Math.min(511, R + slots - U);
    this.qs += 1152; this.frames++; this.total += size;
    return this._emit(this.sAbs - this.res);
  }
}

// Resampler jendela-sinc untuk laju yang tidak didukung MP3 (mis. 96 kHz -> 48 kHz); bertahap per potongan.
// Windowed-sinc sample-rate converter (streaming, chunk by chunk). Default: 16 taps per side, Hann window (MP3 path). hq: 64 taps per side,
// Kaiser window (beta 9, about -90 dB side lobes) and the pass band at 0.91 of the lower Nyquist (WAV export: no audible aliasing, flat to ~20 kHz at 44.1 kHz).
const KT_N = 4096; let KT = null;
function kaiserTable() { if (!KT) { KT = new Float64Array(KT_N + 2); const k0 = besselI0(9); for (let i = 0; i <= KT_N; i++) { const r = i / KT_N; KT[i] = besselI0(9 * Math.sqrt(Math.max(0, 1 - r * r))) / k0; } KT[KT_N + 1] = 0; } return KT; }
const besselI0 = (x) => { let sum = 1, term = 1; for (let k = 1; k < 40; k++) { term *= (x / (2 * k)) * (x / (2 * k)); sum += term; if (term < 1e-12 * sum) break; } return sum; };
export class Resampler {
  constructor(from, to, hq = false) {
    this.step = from / to; this.pos = 0; this.hist = new Float32Array(0); this.taps = hq ? 64 : 16; this.fc = Math.min(1, to / from) * (hq ? 0.91 : 0.97);
    this.kt = hq ? kaiserTable() : null;
  }
  win(d, T) {
    if (!this.kt) return 0.5 + 0.5 * Math.cos(Math.PI * d / T);
    const r = (d < 0 ? -d : d) / T * KT_N; if (r >= KT_N) return 0; const i = r | 0, f = r - i, t = this.kt; return t[i] + (t[i + 1] - t[i]) * f;
  }
  // hq: polyphase table (PH fractional phases x 2T taps of sinc * window * fc), linear interpolation between neighbouring phases
  table() {
    if (this.tb) return this.tb;
    const T = this.taps, W = 2 * T, PH = 1024, tb = new Float64Array((PH + 1) * W);
    for (let j = 0; j <= PH; j++) { const f = j / PH; for (let k = -T + 1; k <= T; k++) { const d = k - f, a = Math.PI * d * this.fc, sinc = Math.abs(a) < 1e-9 ? 1 : Math.sin(a) / a; tb[j * W + k + T - 1] = sinc * this.win(d, T) * this.fc; } }
    this.PH = PH; return (this.tb = tb);
  }
  process(x) {
    const buf = new Float32Array(this.hist.length + x.length); buf.set(this.hist); buf.set(x, this.hist.length);
    if (this.kt) return this.processHq(buf);
    const T = this.taps, out = []; let p = this.pos;
    while (p + T < buf.length) {
      const c = Math.floor(p), f = p - c; let s = 0;
      for (let k = -T + 1; k <= T; k++) { const i = c + k; if (i < 0) continue; const d = k - f, a = Math.PI * d * this.fc, sinc = Math.abs(a) < 1e-9 ? 1 : Math.sin(a) / a, w = this.win(d, T); s += buf[i] * sinc * w * this.fc; }
      out.push(s); p += this.step;
    }
    const keep = Math.max(0, Math.floor(p) - T); this.hist = buf.slice(keep); this.pos = p - keep;
    return Float32Array.from(out);
  }
  processHq(buf) {
    const T = this.taps, W = 2 * T, tb = this.table(), PH = this.PH, n = buf.length;
    let p = this.pos; const cnt = Math.max(0, Math.ceil((n - T - p) / this.step)), out = new Float32Array(cnt + 1); let o = 0;
    while (p + T < n) {
      const c = Math.floor(p), q = (p - c) * PH, j = q | 0, fr = q - j, A = j * W, Bq = A + W, i0 = c - T + 1;
      let s = 0;
      if (i0 >= 0) for (let k = 0; k < W; k++) { const h = tb[A + k] + (tb[Bq + k] - tb[A + k]) * fr; s += buf[i0 + k] * h; }
      else for (let k = 0; k < W; k++) { const i = i0 + k; if (i < 0) continue; const h = tb[A + k] + (tb[Bq + k] - tb[A + k]) * fr; s += buf[i] * h; }
      out[o++] = s; p += this.step;
    }
    const keep = Math.max(0, Math.floor(p) - T); this.hist = buf.slice(keep); this.pos = p - keep;
    return out.subarray(0, o);
  }
}

export function concatBytes(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
