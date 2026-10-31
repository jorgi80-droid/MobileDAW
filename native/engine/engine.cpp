// Port of js/engine/core.js. Function by function in the same order as the JS file; keep them in step when either side changes.
#include "engine.h"
#include <cmath>
#include <cstring>

namespace mdaw {

static inline uint8_t toUint8(double x) { return (uint8_t)(uint32_t)toInt32(x); }   // store into a Uint8Array

// ---------------------------------------------------------------- retire queue
void Retire::push(Item it) {
  if (immediate) { it.del(it.p); return; }
  int h = head.load(std::memory_order_relaxed), nx = (h + 1) % N;
  if (nx == tail.load(std::memory_order_acquire)) return;      // full: leak rather than free on the audio thread
  q[h] = it; head.store(nx, std::memory_order_release);
}
void Retire::drain() {
  int t = tail.load(std::memory_order_relaxed);
  while (t != head.load(std::memory_order_acquire)) { q[t].del(q[t].p); t = (t + 1) % N; tail.store(t, std::memory_order_release); }
}

void Strip::init(double v) {
  inst = nullptr; ev = nullptr; clips = nullptr; ndev = 0; for (auto& d : dev) d = nullptr;
  vol = v; pan = 0; gl = 0; gr = 0; send[0] = send[1] = 0; out = -1; mute = false; solo = false;
  silent = 0; wasAudible = true; pitch = 0; bend = 0; ccl = nullptr; ccG = 1; ccP = 0;
  for (int i = 0; i < 128; i++) tpMap[i] = (uint8_t)i;
  active = false; npre = 0; std::memset(bufL, 0, sizeof bufL); std::memset(bufR, 0, sizeof bufR); peakL = 0; peakR = 0; nPan = 0;
}

// ---------------------------------------------------------------- construction
Engine::Engine(double rate) : sr(rate) {
  tm = new TempoMap(); mm = new MeterMap();
  for (int i = 0; i < NSTRIPS; i++) s[i].init(0.85);
  s[MASTER].vol = 1;
  std::memset(mixL, 0, sizeof mixL); std::memset(mixR, 0, sizeof mixR); std::memset(scrL, 0, sizeof scrL); std::memset(scrR, 0, sizeof scrR);
  std::memset(retL, 0, sizeof retL); std::memset(retR, 0, sizeof retR);
  tailFrames = TAIL_SECONDS * sr;
  for (int k = 0; k < NFX; k++) s[RET0 + k].vol = 0.85;
  lim = makeDevice(5, sr, sc);
}
Engine::~Engine() {
  retire.immediate = true;
  delete lim; lim = nullptr;
  for (int i = 0; i < NSTRIPS; i++) clearStrip(s[i]);
  for (auto* p : bank.s) delete p;
  delete lanes; delete tm; delete mm;
  retire.drain();
}
void Engine::clearStrip(Strip& st) {
  retire.put(st.inst); retire.put(st.ev); retire.put(st.clips); retire.put(st.ccl);
  for (int i = 0; i < st.ndev; i++) retire.put(st.dev[i]);
}

// ---------------------------------------------------------------- commands
void Engine::play() { playing = true; catchUp = true; }
void Engine::stop() { playing = false; cin = 0; panic(); for (int t = 0; t < MAX_TRACKS; t++) if (s[t].ccl) ccReset(s[t], t); }
void Engine::playCountIn(double beats) {
  double b = jsMax(0, toInt32(beats)), tk = f2t(pos), bt = mm->beatLenAt(tk), bf = jsMax(1, t2f(tk + bt) - t2f(tk));
  cinN = mm->nAt(tk);
  cin = b * bf; cinBf = bf; cinNext = 0; cinPos = 0; cinBeat = 0; clickIdx = 1e9;
  playing = true; catchUp = true;
}
void Engine::cinChunk(int n) {
  double len = std::floor(0.015 * sr);
  for (int i = 0; i < n; i++) { mixL[i] = 0; mixR[i] = 0; }
  for (int i = 0; i < n; i++) {
    if (cinPos + i >= cinNext) { clickIdx = 0; clickF = std::fmod(cinBeat, cinN) == 0 ? 1500 : 1000; cinBeat++; cinNext += cinBf; }
    if (clickIdx < len) { double y = std::sin(TWO_PI * clickF * clickIdx / sr) * 0.35 * metroVol * (1 - clickIdx / len); mixL[i] += y; mixR[i] += y; clickIdx++; }
  }
  cinPos += n;
}
void Engine::seek(double tick) {
  pos = jsRound(t2f(jsMax(0, tick)));
  cin = 0; catchUp = true; panic();
  if (lanes) for (auto& l : lanes->lanes) l.last = NAN;
}
void Engine::tempo(double b) { double tick = f2t(pos); bpm = clamp(b, 20, 300); pos = jsRound(t2f(tick)); if (!tmOn) devTempo(bpm); }
void Engine::devTempo(double b) {
  curBpm = b;
  for (int t = 0; t < MAX_TRACKS; t++) { if (s[t].inst) s[t].inst->setTempo(b); for (int i = 0; i < s[t].ndev; i++) s[t].dev[i]->setTempo(b); }
}
void Engine::tempoMap(bool on, TempoMap* prepared) {
  double tick = f2t(pos);
  retire.put(tm); tm = prepared;
  tmOn = on && tm->n > 0; pos = jsRound(t2f(tick)); devTempo(tmOn ? tm->bpmAt(tick) : bpm); catchUp = true;
}
void Engine::setSig(double bt, double beats, MeterMap* prepared) {
  beatT = jsMax(120, toInt32(bt)); barBeats = jsMax(1, toInt32(beats));
  retire.put(mm); mm = prepared;
}
void Engine::setMeter(MeterMap* prepared) { retire.put(mm); mm = prepared; beatT = mm->bt[0]; barBeats = mm->n[0]; }
void Engine::setMetroVol(double v) { double x = (v == v && v != 0) ? v : 0; metroVol = jsMax(0, jsMin(2, x)); }
void Engine::trackOut(int t, double k) { if (ok(t) && t < MASTER) s[t].out = (k >= 0 && k < NFX) ? toInt32(k) : -1; }
void Engine::trackInst(int t, Instrument* inst) {
  if (!ok(t) || t >= MASTER) { retire.put(inst); return; }
  retire.put(s[t].inst);
  s[t].inst = inst;
  if (inst) { inst->setTempo(bpm); if (inst->pitchNative) inst->setParam(90, s[t].pitch); }
}
void Engine::setPitch(int t, double v) {
  if (!ok(t) || t >= MASTER) return;
  Strip& st = s[t]; double r = jsRound(v); st.pitch = clamp((r == r && r != 0) ? r : 0, -24, 24);
  if (st.inst && st.inst->pitchNative) st.inst->setParam(90, st.pitch);
}
void Engine::instParam(int t, int i, double v) { if (i == 90) { setPitch(t, v); return; } if (ok(t) && s[t].inst) s[t].inst->setParam(i, v); }
void Engine::resetTrack(int t) { if (!ok(t)) return; clearStrip(s[t]); s[t].init(t == MASTER ? 1 : 0.85); }
void Engine::insertDevice(int t, double index, Device* d) {
  if (!ok(t) || !d || s[t].ndev >= MAX_DEV) { retire.put(d); return; }
  Strip& st = s[t];
  d->setTempo(bpm);
  int at = (int)std::trunc(clamp(index, 0, st.ndev));
  for (int i = st.ndev; i > at; i--) st.dev[i] = st.dev[i - 1];
  st.dev[at] = d; st.ndev++;
}
void Engine::removeDevice(int t, int i) {
  if (!ok(t) || i < 0 || i >= s[t].ndev) return;
  Strip& st = s[t]; retire.put(st.dev[i]);
  for (int k = i; k < st.ndev - 1; k++) st.dev[k] = st.dev[k + 1];
  st.dev[--st.ndev] = nullptr;
}
void Engine::bend(int t, double st0) {
  if (!ok(t) || t >= MASTER) return;
  Strip& st = s[t]; double x = (st0 == st0 && st0 != 0) ? st0 : 0; x = clamp(x, -12, 12);
  double r = std::pow(2, (x - st.bend) / 12); st.bend = x;
  if (st.inst && st.inst->hasSetBend()) { st.inst->setBend(x); return; }
  if (st.inst && st.inst->canBend() && r != 1) st.inst->bendSounding(r);
}
void Engine::bendNew(Strip& st) { double r = std::pow(2, st.bend / 12); st.inst->bendNewest(r); }
void Engine::preview(int t, int pitch, double vel, bool on) {
  if (ok(t) && t < MASTER && s[t].inst && s[t].npre < 64) { s[t].pre[s[t].npre++] = { pitch, vel, on }; }
}
void Engine::trackNotes(int t, NoteData* d) { if (!ok(t) || t >= MASTER) { retire.put(d); return; } retire.put(s[t].ev); s[t].ev = d; }
void Engine::trackCC(int t, CCData* d) {
  if (!ok(t) || t >= MASTER) { retire.put(d); return; }
  retire.put(s[t].ccl); s[t].ccl = d;
  if (!s[t].ccl) ccReset(s[t], t);
}
void Engine::ccReset(Strip& st, int t) { st.ccG = 1; st.ccP = 0; if (st.bend) bend(t, 0); }
double Engine::ccAt(const CCLane& l, double tick) {
  int n = (int)l.t.size(); if (tick <= l.t[0]) return l.v[0]; if (tick >= l.t[n - 1]) return l.v[n - 1];
  int a = 0, b = n - 1; while (b - a > 1) { int m = (a + b) >> 1; if (l.t[m] <= tick) a = m; else b = m; }
  double d = l.t[b] - l.t[a]; return d <= 0 ? l.v[b] : l.v[a] + (l.v[b] - l.v[a]) * (tick - l.t[a]) / d;
}
void Engine::applyCC(Strip& st, int idx, double tick) {
  CCData* c = st.ccl;
  if (c->lane[0]) { double v = clamp(ccAt(*c->lane[0], tick), -1, 1) * 2; if (std::fabs(v - st.bend) > 1e-4) bend(idx, v); }
  double g = 1; if (c->lane[1]) g *= clamp(ccAt(*c->lane[1], tick) / 127, 0, 1); if (c->lane[3]) g *= clamp(ccAt(*c->lane[3], tick) / 127, 0, 1);
  st.ccG = g; st.ccP = c->lane[2] ? clamp((ccAt(*c->lane[2], tick) - 64) / 63, -1, 1) : 0;
}
void Engine::trackClips(int t, ClipData* d) { if (!ok(t) || t >= MASTER) { retire.put(d); return; } retire.put(s[t].clips); s[t].clips = d; }
void Engine::automation(LaneData* d) { retire.put(lanes); lanes = d; }
void Engine::loadSample(int id, Sample* smp) { if (id >= 0 && id < 256) { retire.put(bank.s[id]); bank.s[id] = smp; } else retire.put(smp); }

void Engine::runDev(int strip, int di, Device* d, float* L, float* R, int n) {
  d->process(L, R, n);
  double x = (double)L[0] + L[n - 1] + R[n - 1];
  if (!(x > -1e6 && x < 1e6)) { d->bypass = true; for (int i = 0; i < n; i++) { L[i] = 0; R[i] = 0; } err(2, strip, di, "nilai tidak valid (NaN/tak hingga)"); }
}
void Engine::runChain(Strip& st, int strip, float* L, float* R, int n) {
  for (int i = 0; i < st.ndev; i++) if (!st.dev[i]->bypass) { if (st.dev[i]->hasTr) st.dev[i]->tr(playing, f2t(pos) / PPQ); runDev(strip, i, st.dev[i], L, R, n); }
}
void Engine::balance(float* L, float* R, int a, int b, double pan) {
  if (!pan) return;
  double gl = pan > 0 ? 1 - pan : 1, gr = pan < 0 ? 1 + pan : 1;
  for (int k = a; k < b; k++) { L[k] = (float)(L[k] * gl); R[k] = (float)(R[k] * gr); }
}
void Engine::panic() {
  for (int t = 0; t < MAX_TRACKS; t++) s[t].nPan = 0;
  for (int t = 0; t < MAX_TRACKS; t++) if (s[t].inst) s[t].inst->allOff();
}

// ---------------------------------------------------------------- read-outs
void Engine::fillMeters(int32_t* m) const { for (int i = 0; i < NSTRIPS; i++) { m[i * 2] = (int32_t)jsRound(s[i].peakL * 1000); m[i * 2 + 1] = (int32_t)jsRound(s[i].peakR * 1000); } }
void Engine::fillLoad(int32_t* out) const { for (int t = 0; t < MAX_TRACKS; t++) { out[t * 2] = s[t].inst ? s[t].inst->voicesOn() : 0; out[t * 2 + 1] = 0; } }

// ---------------------------------------------------------------- rendering
void Engine::render(float* oL, float* oR, int frames) {
  int done = 0;
  while (done < frames) {
    int n = frames - done < BLOCK ? frames - done : BLOCK;
    if (playing && cin > 0) {
      n = (int)jsMin(n, jsMax(1, std::ceil(cin)));
      cinChunk(n);
      if (limOn && lim) lim->process(mixL, mixR, n);
      for (int i = 0; i < n; i++) { oL[done + i] = mixL[i]; oR[done + i] = mixR[i]; }
      cin -= n; done += n; continue;
    }
    double sp = spt();
    if (playing && loopOn) {
      double le = std::ceil(t2f(loopE)), left = le - pos;
      if (left > 0) n = (int)jsMin(n, jsMax(1, std::ceil(left)));
    }
    chunk(n, sp);
    if (limOn && lim) { for (int i = 0; i < n; i++) { if (!(mixL[i] == mixL[i])) mixL[i] = 0; if (!(mixR[i] == mixR[i])) mixR[i] = 0; } lim->process(mixL, mixR, n); }
    for (int i = 0; i < n; i++) {
      float l = mixL[i], r = mixR[i]; if (!(l == l)) l = 0; if (!(r == r)) r = 0;
      oL[done + i] = l > 1 ? 1 : l < -1 ? -1 : l; oR[done + i] = r > 1 ? 1 : r < -1 ? -1 : r;
    }
    if (playing) {
      if (std::fmod(pos, 1) != 0) pos = jsRound(pos);
      double before = pos; pos += n;
      if (loopOn) { double le = std::ceil(t2f(loopE)); if (pos >= le && before < le) { pos = std::ceil(t2f(loopS)); catchUp = true; panic(); } }
    }
    done += n;
  }
}

void Engine::applyAuto(double tick) {
  for (auto& l : lanes->lanes) {
    auto& p = l.pts; double v;
    if (tick <= p[0].first) v = p[0].second;
    else if (tick >= p.back().first) v = p.back().second;
    else {
      size_t k = 1; while (k < p.size() && p[k].first < tick) k++;
      auto& a = p[k - 1]; auto& b = p[k]; double spn = b.first - a.first;
      v = spn <= 0 ? b.second : a.second + (b.second - a.second) * (tick - a.first) / spn;
    }
    if (l.last == l.last && std::fabs(v - l.last) < 1e-6) continue;
    l.last = v;
    if (l.track < 0 || l.track >= NSTRIPS) continue;
    Strip& st = s[l.track];
    switch (l.kind) {
      case 0: st.vol = jsMax(0, v); break;
      case 1: st.pan = clamp(v, -1, 1); break;
      case 2: if (l.track < MASTER) st.send[0] = clamp(v, 0, 1.5); break;
      case 3: if (l.track < MASTER) st.send[1] = clamp(v, 0, 1.5); break;
      case 4: if (l.dev >= 0 && l.dev < st.ndev) st.dev[l.dev]->setParam(l.param, v); break;
      case 5: if (l.param == 90) setPitch(l.track, v); else if (st.inst) st.inst->setParam(l.param, v); break;
    }
  }
}

void Engine::chunk(int n, double sp) {
  double p0 = pos;
  if (tmOn && playing) { double bn = tm->bpmAt(f2t(p0)); if (std::fabs(bn - curBpm) > 0.02) devTempo(bn); }
  if (playing && lanes && !lanes->lanes.empty()) applyAuto(f2t(p0));
  bool anySolo = false;
  for (int t = 0; t < MAX_TRACKS; t++) if (s[t].solo) { anySolo = true; break; }
  for (int i = 0; i < n; i++) { mixL[i] = 0; mixR[i] = 0; }
  for (int k = 0; k < NFX; k++) { for (int i = 0; i < n; i++) { retL[k][i] = 0; retR[k][i] = 0; } retActive[k] = false; }
  for (int t = 0; t < MAX_TRACKS; t++) track(s[t], t, p0, n, sp, anySolo);
  catchUp = false;
  for (int k = 0; k < NFX; k++) ret(k, n);
  Strip& m = s[MASTER];
  runChain(m, MASTER, mixL, mixR, n);
  double pl = 0, pr = 0;
  for (int i = 0; i < n; i++) {
    m.gl += (m.vol - m.gl) * 0.0021; mixL[i] = (float)(mixL[i] * m.gl); mixR[i] = (float)(mixR[i] * m.gl);
    double a = std::fabs(mixL[i]), b = std::fabs(mixR[i]); if (a > pl) pl = a; if (b > pr) pr = b;
  }
  m.peakL = jsMax(pl, m.peakL * 0.995); m.peakR = jsMax(pr, m.peakR * 0.995);
  if (metro && playing) click(n, p0, sp);
}

void Engine::track(Strip& st, int idx, double p0, int n, double sp, bool anySolo) {
  (void)sp;
  bool audible = !st.mute && (!anySolo || st.solo);
  st.active = false;
  if (!audible) {
    if (st.wasAudible) { if (st.inst) st.inst->allOff(); st.wasAudible = false; st.silent = tailFrames + 1; }
    sc[idx] = 0; st.peakL *= 0.99; st.peakR *= 0.99; st.npre = 0; return;
  }
  st.wasAudible = true;
  bool hasClips = st.clips && !st.clips->c.empty();
  if (!st.inst && !hasClips) { sc[idx] = 0; st.peakL *= 0.99; st.peakR *= 0.99; return; }
  float* L = st.bufL; float* R = st.bufR;
  for (int i = 0; i < n; i++) { L[i] = 0; R[i] = 0; }
  bool active = false;
  if (playing && st.ccl) applyCC(st, idx, f2t(p0));
  if (st.inst) {
    int ne = 0;
    int32_t* eo = st.sevT; uint8_t* ep = st.sevP; float* ev = st.sevV; uint8_t* eon = st.sevOn; float* epn = st.sevPn;
    for (int k = 0; k < st.npre; k++) if (ne < 512) { const PreEv& q = st.pre[k]; eo[ne] = 0; ep[ne] = toUint8(q.p); ev[ne] = (float)q.v; eon[ne] = q.on ? 1 : 0; epn[ne] = NAN; ne++; }
    st.npre = 0;
    NoteData* E = st.ev;
    if (playing && E && E->n) {
      double lo = f2t(p0 - 1), hi = f2t(p0 + n - 1);
      int a = 0, b = E->n;
      while (a < b) { int m = (a + b) >> 1; if (E->tick[m] > lo) b = m; else a = m + 1; }
      if (catchUp) for (auto& q : E->notes) {
        if (ne >= 512) break;
        if (std::ceil(t2f(q[0])) < p0 && std::ceil(t2f(q[1])) > p0) { eo[ne] = 0; ep[ne] = toUint8(q[2]); ev[ne] = (float)q[3]; eon[ne] = 1; epn[ne] = (float)q[4]; ne++; }
      }
      for (int i = a; i < E->n && E->tick[i] <= hi && ne < 512; i++) {
        double spo = std::ceil(t2f(E->tick[i])) - p0;
        if (spo < 0 || spo >= n) continue;
        eo[ne] = (int32_t)spo; ep[ne] = E->p[i]; ev[ne] = E->v[i]; eon[ne] = E->on[i]; epn[ne] = E->on[i] ? E->pan[i] : NAN; ne++;
      }
      for (int i = 1; i < ne; i++) for (int k = i; k > 0 && eo[k] < eo[k - 1]; k--) {
        std::swap(eo[k], eo[k - 1]); std::swap(ep[k], ep[k - 1]); std::swap(ev[k], ev[k - 1]); std::swap(eon[k], eon[k - 1]); std::swap(epn[k], epn[k - 1]);
      }
    }
    double sh = st.inst->pitchNative ? 0 : st.pitch; uint8_t* tmap = st.tpMap;
    int cur = 0;
    for (int i = 0; i < ne; i++) {
      if (eo[i] > cur) { st.inst->render(L, R, cur, eo[i]); balance(L, R, cur, eo[i], st.nPan); cur = eo[i]; }
      if (eon[i]) {
        double q = clamp(ep[i] + sh, 0, 127); tmap[ep[i] & 127] = toUint8(q); st.inst->noteOn((int)q, ev[i]);
        if (st.bend && st.inst->canBend()) bendNew(st);
        if (epn[i] == epn[i]) st.nPan = epn[i];
      } else { int q = tmap[ep[i] & 127]; tmap[ep[i] & 127] = ep[i]; st.inst->noteOff(q); }
    }
    if (cur < n) { st.inst->render(L, R, cur, n); balance(L, R, cur, n, st.nPan); }
    if (st.inst->active()) active = true;
    double chk = (double)L[0] + L[n - 1] + R[n - 1];
    if (!(chk > -1e6 && chk < 1e6)) { retire.put(st.inst); st.inst = nullptr; for (int i = 0; i < n; i++) { L[i] = 0; R[i] = 0; } err(1, idx, -1, "nilai tidak valid"); }
  }
  if (playing && hasClips) {
    for (const Clip& c : st.clips->c) {
      double FI = c.fadeIn > 0 ? jsMax(2, jsRound(c.fadeIn * sr)) : 64, FO = c.fadeOut > 0 ? jsMax(2, jsRound(c.fadeOut * sr)) : 64;
      double cs = std::ceil(t2f(c.start));
      if (cs >= p0 + n) break;
      double ce = std::ceil(t2f(c.start + c.len));
      if (ce <= p0) continue;
      Sample* sm = c.sample >= 0 && c.sample < 256 ? bank.s[c.sample] : nullptr; if (!sm) continue;
      double from = jsMax(p0, cs), to = jsMin(p0 + n, ce), off = jsRound(c.offset * sr);
      const float* sl = sm->l; const float* sr2 = sm->r; double frames = sm->frames;
      for (double k = from; k < to; k++) {
        double ix = off + (k - cs); if (ix >= frames || ix < 0) { if (ix >= frames) break; continue; }
        double g = c.gain, fi = k - cs, fo = ce - 1 - k;
        if (fi < FI) g *= (fi + 1) / FI; if (fo < FO) g *= (fo + 1) / FO;
        int o = (int)(k - p0), j = (int)ix;
        L[o] = (float)(L[o] + sl[j] * g); R[o] = (float)(R[o] + sr2[j] * g);
      }
      active = true;
    }
  }
  if (active) st.silent = 0; else st.silent += n;
  if (!active && st.silent > tailFrames) { sc[idx] = 0; st.peakL *= 0.99; st.peakR *= 0.99; return; }
  runChain(st, idx, L, R, n);
  double pn = st.ccP ? clamp(st.pan + st.ccP, -1, 1) : st.pan, vg = st.vol * st.ccG, a = (pn + 1) * PI * 0.25;
  double tl = vg * std::cos(a) * 1.41421356, tr = vg * std::sin(a) * 1.41421356, s0 = st.send[0], s1 = st.send[1];
  if (s0 > 0) retActive[0] = true; if (s1 > 0) retActive[1] = true;
  int ot = st.out >= 0 && st.out < NFX ? st.out : -1;
  if (ot >= 0) retActive[ot] = true;
  float* mL = ot >= 0 ? retL[ot] : (noDirect ? scrL : mixL); float* mR = ot >= 0 ? retR[ot] : (noDirect ? scrR : mixR);
  float* r0L = retL[0]; float* r0R = retR[0]; float* r1L = retL[1]; float* r1R = retR[1];
  double pl = 0, pr = 0, scv = 0;
  for (int i = 0; i < n; i++) {
    double x = L[i], y = R[i], ax = std::fabs(x), ay = std::fabs(y);
    if (ax > scv) scv = ax; if (ay > scv) scv = ay;
    st.gl += (tl - st.gl) * 0.0021; st.gr += (tr - st.gr) * 0.0021;
    double l = x * st.gl, r = y * st.gr;
    if (std::fabs(l) > pl) pl = std::fabs(l); if (std::fabs(r) > pr) pr = std::fabs(r);
    mL[i] = (float)(mL[i] + l); mR[i] = (float)(mR[i] + r);
    if (s0 > 0) { r0L[i] = (float)(r0L[i] + l * s0); r0R[i] = (float)(r0R[i] + r * s0); }
    if (s1 > 0) { r1L[i] = (float)(r1L[i] + l * s1); r1R[i] = (float)(r1R[i] + r * s1); }
  }
  sc[idx] = (float)scv; st.active = true;
  st.peakL = jsMax(pl, st.peakL * 0.995); st.peakR = jsMax(pr, st.peakR * 0.995);
}

void Engine::ret(int k, int n) {
  Strip& st = s[RET0 + k]; float* L = retL[k]; float* R = retR[k];
  if (retActive[k]) st.silent = 0; else st.silent += n;
  if (st.silent > tailFrames) { st.peakL *= 0.995; st.peakR *= 0.995; sc[RET0 + k] = 0; return; }
  runChain(st, RET0 + k, L, R, n);
  double target = st.mute ? 0 : st.vol, a = (st.pan + 1) * PI * 0.25, tl = target * std::cos(a) * 1.41421356, tr = target * std::sin(a) * 1.41421356;
  double pl = 0, pr = 0;
  for (int i = 0; i < n; i++) {
    st.gl += (tl - st.gl) * 0.0021; st.gr += (tr - st.gr) * 0.0021;
    double l = L[i] * st.gl, r = R[i] * st.gr;
    if (std::fabs(l) > pl) pl = std::fabs(l); if (std::fabs(r) > pr) pr = std::fabs(r);
    mixL[i] = (float)(mixL[i] + l); mixR[i] = (float)(mixR[i] + r);
  }
  st.peakL = jsMax(pl, st.peakL * 0.995); st.peakR = jsMax(pr, st.peakR * 0.995);
}

void Engine::click(int n, double p0, double sp) {
  (void)sp;
  double t = mm->beatCeil(jsMax(0, f2t(p0) - 4));
  for (int q = 0; q < 4; q++) {
    double bs = std::ceil(t2f(t));
    if (bs >= p0 + n) break;
    if (bs >= p0) { clickIdx = 0; clickOff = bs - p0; clickF = mm->isDownbeat(t) ? 1500 : 1000; }
    t = mm->nextBeat(t);
  }
  double len = std::floor(0.015 * sr);
  for (int i = (int)clickOff; i < n && clickIdx < len; i++, clickIdx++) {
    double y = std::sin(TWO_PI * clickF * clickIdx / sr) * 0.35 * metroVol * (1 - clickIdx / len);
    mixL[i] = (float)(mixL[i] + y); mixR[i] = (float)(mixR[i] + y);
  }
  clickOff = 0;
}

}  // namespace mdaw
