// Encoder MP3 lokal (MPEG-1 Layer III, CBR, 32/44,1/48 kHz, mono/stereo, joint stereo M/S). Tanpa dependensi.
// Pemakaian bertahap: const e = new Mp3Encoder(sr, kanal, kbps); frames = e.encode(L, R, n) ... e.finish().
// Tiap frame berdiri sendiri (tanpa bit reservoir) agar sederhana dan aman; kuantisasi memakai satu global_gain per granule.
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
  }

  // sampel float -1..1; R boleh null bila mono. Mengembalikan daftar Uint8Array (frame yang selesai).
  encode(L, R, n = L.length) {
    this._push(L, R, n); const out = [];
    while (this.qe - this.qs >= 1152) out.push(this._frame());
    if (this.qs > (1 << 15)) { for (let c = 0; c < 2; c++) this.q[c].copyWithin(0, this.qs, this.qe); this.qe -= this.qs; this.qs = 0; }
    return out;
  }
  finish() { const pad = 1152 + 1105, z = new Float32Array(pad), out = this.encode(z, z, pad); return out.concat(this.encode(new Float32Array(1152), new Float32Array(1152), 1152)); }
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

  // cari global_gain terkecil yang muat dalam budget; isi ix dan info
  _quant(xr, budget, info) {
    const a34 = this.a34, ix = this.ix; let any = false;
    for (let i = 0; i < 576; i++) { const v = Math.abs(xr[i]); a34[i] = Math.pow(v, 0.75); if (v > 1e-9) any = true; }
    if (!any) { ix.fill(0); info.gg = 210; analyse(ix, this.sfb, info, false); info.r0 = 0; info.r1 = 0; info.t0 = info.t1 = info.t2 = 0; info.big = 0; info.cnt = 0; info.bits = 0; info.c1 = 0; return; }
    const fill = (gg) => { const sc = Math.pow(2, -0.1875 * (gg - 210)); let mx = 0; for (let i = 0; i < 576; i++) { const v = Math.floor(a34[i] * sc + 0.4054); ix[i] = v; if (v > mx) mx = v; } return mx; };
    let lo = 0, hi = 255;
    while (lo < hi) {
      const mid = (lo + hi) >> 1, mx = fill(mid);
      const bits = mx > 8206 ? Infinity : analyse(ix, this.sfb, info, false);
      if (bits <= budget) hi = mid; else lo = mid + 1;
    }
    fill(lo); info.gg = lo;
    analyse(ix, this.sfb, info, true);
    if (info.bits > budget) { for (let g = lo + 1; g < 256 && info.bits > budget; g++) { fill(g); info.gg = g; analyse(ix, this.sfb, info, true); } }
  }

  _frame() {
    const nch = this.nch, sr = this.sr, kbps = this.kbps, fbytes = 144000 * kbps / sr;
    this.diff += fbytes - Math.floor(fbytes); let pad = 0; if (this.diff >= 1) { pad = 1; this.diff -= 1; }
    const size = Math.floor(fbytes) + pad, side = nch === 2 ? 32 : 17, avail = (size - 4 - side) * 8;
    const g = [[], []], s0 = this.qs; let ms = false;
    for (let gr = 0; gr < 2; gr++) for (let c = 0; c < nch; c++) this._analyse(c, s0 + gr * 576, this.xr[gr][c]);
    if (nch === 2) {
      let eM = 0, eS = 0, eL = 0, eR = 0;
      for (let gr = 0; gr < 2; gr++) { const L = this.xr[gr][0], R = this.xr[gr][1]; for (let i = 0; i < 576; i++) { const m = L[i] + R[i], s = L[i] - R[i]; eM += m * m; eS += s * s; eL += L[i] * L[i]; eR += R[i] * R[i]; } }
      ms = eS < 0.35 * eM && eM > 1e-9 && Math.min(eL, eR) > 0.02 * Math.max(eL, eR) * 0 + 0;   // sisi kecil -> M/S hemat bit
      if (ms) for (let gr = 0; gr < 2; gr++) { const L = this.xr[gr][0], R = this.xr[gr][1]; for (let i = 0; i < 576; i++) { const m = (L[i] + R[i]) * Math.SQRT1_2, s = (L[i] - R[i]) * Math.SQRT1_2; L[i] = m; R[i] = s; } }
    }
    const wts = nch === 2 ? (ms ? [0.62, 0.38] : [0.5, 0.5]) : [1];
    let remain = avail, wleft = 2 * wts.reduce((a, b) => a + b, 0);
    const blocks = [];
    for (let gr = 0; gr < 2; gr++) for (let c = 0; c < nch; c++) {
      const budget = Math.min(4095, Math.floor(remain * wts[c] / wleft)), info = { ixs: null };
      this._quant(this.xr[gr][c], budget, info);
      info.ixs = this.tmpIx[gr * 2 + c]; info.ixs.set(this.ix);
      info.neg = this.xr[gr][c]; info.sgn = new Uint8Array(576); for (let i = 0; i < 576; i++) info.sgn[i] = this.xr[gr][c][i] < 0 ? 1 : 0;
      remain -= info.bits; wleft -= wts[c]; blocks.push(info);
    }
    // ---- tulis frame
    const bw = new BitWriter(size), sfbT = this.sfb;
    bw.put(0xFFF, 12); bw.put(1, 1); bw.put(1, 2); bw.put(1, 1);                // sync, MPEG-1, layer III, tanpa CRC
    bw.put(MP3_BITRATES.indexOf(kbps) + 1, 4); bw.put(SR_IDX[sr], 2); bw.put(pad, 1); bw.put(0, 1);
    bw.put(nch === 1 ? 3 : 1, 2); bw.put(ms ? 2 : 0, 2); bw.put(0, 1); bw.put(0, 1); bw.put(0, 2);
    bw.put(0, 9); bw.put(0, nch === 2 ? 3 : 5); for (let c = 0; c < nch; c++) bw.put(0, 4);
    for (const b of blocks) {
      bw.put(b.bits, 12); bw.put(b.big, 9); bw.put(b.gg, 8); bw.put(0, 4); bw.put(0, 1);
      bw.put(b.t0, 5); bw.put(b.t1, 5); bw.put(b.t2, 5); bw.put(b.r0, 4); bw.put(b.r1, 3); bw.put(0, 1); bw.put(0, 1); bw.put(b.c1, 1);
    }
    for (const b of blocks) {
      const ix = b.ixs, sg = b.sgn, bigEnd = b.big * 2;
      const regs = [[0, b.e1, b.t0], [b.e1, b.e2, b.t1], [b.e2, bigEnd, b.t2]];
      for (const [a, e, t] of regs) {
        if (!t || e <= a) continue;
        const s = TSEL[t], T = HT[s.h], xs = T.x, lb = s.lb;
        for (let i = a; i < e; i += 2) {
          let x = ix[i], y = ix[i + 1], ex = 0, ey = 0;
          if (lb) { if (x > 14) { ex = x - 15; x = 15; } if (y > 14) { ey = y - 15; y = 15; } }
          const k = x * xs + y; bw.put(T.code[k], T.len[k]);
          if (lb && x === 15) bw.put(ex, lb); if (x) bw.put(sg[i], 1);
          if (lb && y === 15) bw.put(ey, lb); if (y) bw.put(sg[i + 1], 1);
        }
      }
      const Q = b.c1 ? QB : QA;
      for (let i = bigEnd; i < bigEnd + b.cnt * 4; i += 4) {
        const v = ix[i], w = ix[i + 1], x = ix[i + 2], y = ix[i + 3], k = (v << 3) | (w << 2) | (x << 1) | y;
        bw.put(Q.code[k], Q.len[k]); if (v) bw.put(sg[i], 1); if (w) bw.put(sg[i + 1], 1); if (x) bw.put(sg[i + 2], 1); if (y) bw.put(sg[i + 3], 1);
      }
    }
    this.qs += 1152; this.frames++; this.total += size;
    return bw.b;
  }
}

// Resampler jendela-sinc untuk laju yang tidak didukung MP3 (mis. 96 kHz -> 48 kHz); bertahap per potongan.
export class Resampler {
  constructor(from, to) { this.step = from / to; this.pos = 0; this.hist = new Float32Array(0); this.taps = 16; this.fc = Math.min(1, to / from) * 0.97; }
  process(x) {
    const buf = new Float32Array(this.hist.length + x.length); buf.set(this.hist); buf.set(x, this.hist.length);
    const T = this.taps, out = []; let p = this.pos;
    while (p + T < buf.length) {
      const c = Math.floor(p), f = p - c; let s = 0;
      for (let k = -T + 1; k <= T; k++) { const i = c + k; if (i < 0) continue; const d = k - f, a = Math.PI * d * this.fc, sinc = Math.abs(a) < 1e-9 ? 1 : Math.sin(a) / a, w = 0.5 + 0.5 * Math.cos(Math.PI * d / T); s += buf[i] * sinc * w * this.fc; }
      out.push(s); p += this.step;
    }
    const keep = Math.max(0, Math.floor(p) - T); this.hist = buf.slice(keep); this.pos = p - keep;
    return Float32Array.from(out);
  }
}

export function concatBytes(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
