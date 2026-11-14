// See hdnfx.h. Port of Honeydew crates/audio/src/note_effects.rs and the Arpeggiator of sequencer.rs.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdnfx.h"
#include <cmath>
#include <map>
#include <deque>
#include <set>
#include <algorithm>
#include <limits>
#include <cstring>

namespace mdaw {
namespace {

// Honeydew's NoteEffectError / SequencerError: set where Rust returns an error (no exceptions: the WebAssembly build has none); the notes
// then stay as they came
static bool failed = false;
struct Ev { double beat; bool on; int pitch; int vel; float pan; };

static double remEuclid(double a, double b) { double r = std::fmod(a, b); return r < 0 ? r + std::fabs(b) : r; }
static long long remEuclidI(long long a, long long b) { long long r = a % b; return r < 0 ? r + b : r; }
static int menu(float v, int n) { float x = std::min(std::max(v, 0.0f), 1.0f) * (float)(n - 1); return (int)std::round(x); }

// ---------------- sequencer.rs: sort_note_events, rhythm_hit, swing ----------------
static void sortNoteEvents(std::vector<Ev>& ev) {
  std::vector<Ev> offs, ons;
  for (auto& e : ev) (e.on ? ons : offs).push_back(e);
  auto by = [](const Ev& a, const Ev& b) { return a.beat < b.beat; };
  std::stable_sort(offs.begin(), offs.end(), by); std::stable_sort(ons.begin(), ons.end(), by);
  ev.clear(); size_t j = 0;
  for (auto& off : offs) { while (j < ons.size() && ons[j].beat < off.beat) ev.push_back(ons[j++]); ev.push_back(off); }
  while (j < ons.size()) ev.push_back(ons[j++]);
}
static const char* RHYTHMS[21] = { "10", "101", "1001", "1011", "10101", "100101", "100110", "101011", "1001010", "1001011", "1001101", "1010101",
  "1011011", "10001011", "10001101", "10010010", "10010110", "10010111", "10011010", "10101011", "10101101" };
static bool rhythmHit(int rhythm, double rotation, uint64_t step) {
  if (!(rotation >= 0 && rotation <= 1)) { failed = true; return false; }
  if (rhythm == 0) return true;
  if (rhythm - 1 >= 21) { failed = true; return false; }
  const char* m = RHYTHMS[rhythm - 1]; long long len = (long long)std::strlen(m);
  long long shift = (long long)std::round((2.0 * rotation - 1.0) * (double)(len - 1));
  size_t idx = (size_t)remEuclidI((long long)(step % (uint64_t)len) - shift, len);
  return m[idx] == '1';
}
enum SwingRate { EIGHTH, SIXTEENTH };
static double swingDelay(double beat, double interval, double amount, SwingRate rate) {
  double r = rate == EIGHTH ? 0.5 : 0.25, ph = remEuclid(beat, 2.0 * r);
  return ph < r ? 0.0 : ((2.0 * r - ph) / r) * std::min(interval / 2.0, amount * r / 2.0);
}

// ---------------- the Arpeggiator ----------------
enum Mode { AS_PLAYED, CHORD, UP, DOWN, UP_DOWN, DOWN_UP, OUTWARD, INWARD, ANCHOR, BASS_UP, BASS_UP_DOWN, TREBLE_DOWN, TREBLE_DOWN_UP, JUMP_UP, JUMP_DOWN,
  JUMP_UP_DOWN, SUPERSAW, CASCADE_UP, CASCADE_DOWN, CASCADE_UP_DOWN, RANDOM, RANDOM_NO_REPEAT, RANDOM_ONCE, RANDOM_WALK };
static bool isRandom(int m) { return m == RANDOM || m == RANDOM_NO_REPEAT || m == RANDOM_ONCE || m == RANDOM_WALK; }
struct Held { int pitch; int vel; float pan; };

static void cascade(std::vector<size_t>& idx, size_t len, bool up, bool first) {
  long long i = up ? 0 : (long long)len - 1; const int d[3] = { up ? 1 : -1, up ? 1 : -1, up ? -1 : 1 };
  if (first) idx.push_back((size_t)i);
  int ph = 0;
  for (;;) { i += d[ph]; if (i < 0 || i >= (long long)len) break; idx.push_back((size_t)i); ph = (ph + 1) % 3; }
}
static void orderedNotes(int mode, const std::vector<Held>& held, int range, int startNote, std::vector<Held>& notes) {
  if (range < 1 || range > 4 || startNote < -8 || startNote > 8 || isRandom(mode)) { failed = true; return; }
  std::vector<Held> ex; std::vector<size_t> idx; notes.clear(); bool seen[128] = {};
  for (auto& h : held) {
    if (h.pitch < 0 || h.pitch > 127) { failed = true; return; }
    for (int o = 0; o < range; o++) { int s = h.pitch + o * 12; if (s <= 127 && !seen[s]) { seen[s] = true; ex.push_back({ s, h.vel, h.pan }); } }
  }
  if (ex.empty()) return;
  if (mode == AS_PLAYED) { notes = ex; return; }
  std::sort(ex.begin(), ex.end(), [](const Held& a, const Held& b) { return a.pitch < b.pitch; });
  size_t n = ex.size();
  if (mode == SUPERSAW) {
    if (n == 1) { notes = ex; return; }
    size_t r = (size_t)range, groups = n == 2 ? r / (r % 2 == 0 ? 2 : 1) : (n - 2) * r, divisor = n == 2 ? 1 : 3 * n - 6, counter = 0;
    for (size_t g = 0; g < groups; g++) {
      size_t j = n == 2 ? 1 : 2 + g % (n - 2); const size_t ids[4] = { 0, 1, j - 1, j };
      for (size_t index : ids) {
        Held h = ex[index]; int tr = 0;
        if (index != 0) { size_t oct = (counter / divisor) % r; counter++; tr = (int)(oct * 12); }
        if (h.pitch + tr <= 127) notes.push_back({ h.pitch + tr, h.vel, h.pan });
      }
    }
    return;
  }
  if (mode == ANCHOR) {
    size_t i = (size_t)remEuclidI(startNote, (long long)n); Held h = ex[i];
    for (int o = 0; o < range; o++) if (h.pitch + o * 12 <= 127) notes.push_back({ h.pitch + o * 12, h.vel, h.pan });
    return;
  }
  switch (mode) {
    case CHORD: case UP: for (size_t i = 0; i < n; i++) idx.push_back(i); break;
    case DOWN: for (size_t i = n; i-- > 0;) idx.push_back(i); break;
    case UP_DOWN: for (size_t i = 0; i < n; i++) idx.push_back(i); for (size_t i = n >= 1 ? n - 1 : 0; i-- > 1;) idx.push_back(i); break;
    case DOWN_UP: for (size_t i = n; i-- > 0;) idx.push_back(i); for (size_t i = 1; i + 1 < n; i++) idx.push_back(i); break;
    case OUTWARD: {
      long long l = ((long long)n - 1) / 2; size_t r = n / 2;
      while (l >= 0 || r < n) { if (l >= 0) idx.push_back((size_t)l); if (r < n && (long long)r != l) idx.push_back(r); l--; r++; }
      break;
    }
    case INWARD: {
      size_t l = 0, r = n - 1;
      while (l <= r) { idx.push_back(l); if (l != r) idx.push_back(r); l++; r = r > 0 ? r - 1 : 0; }
      break;
    }
    case BASS_UP: if (n == 1) idx.push_back(0); else for (size_t i = 1; i < n; i++) { idx.push_back(0); idx.push_back(i); } break;
    case BASS_UP_DOWN:
      if (n == 1) idx.push_back(0);
      else { for (size_t i = 1; i < n; i++) { idx.push_back(0); idx.push_back(i); } for (size_t i = n >= 1 ? n - 1 : 0; i-- > 2;) { idx.push_back(0); idx.push_back(i); } }
      break;
    case TREBLE_DOWN: if (n == 1) idx.push_back(0); else for (size_t i = n - 1; i-- > 0;) { idx.push_back(n - 1); idx.push_back(i); } break;
    case TREBLE_DOWN_UP:
      if (n == 1) idx.push_back(0);
      else { for (size_t i = n - 1; i-- > 0;) { idx.push_back(n - 1); idx.push_back(i); } for (size_t i = 1; i + 2 < n; i++) { idx.push_back(n - 1); idx.push_back(i); } }
      break;
    case JUMP_UP: for (size_t i = 0; i < n; i += 2) idx.push_back(i); for (size_t i = 1; i < n; i += 2) idx.push_back(i); break;
    case JUMP_DOWN: { std::vector<size_t> rv; for (size_t i = n; i-- > 0;) rv.push_back(i); for (size_t i = 0; i < rv.size(); i += 2) idx.push_back(rv[i]); for (size_t i = 1; i < rv.size(); i += 2) idx.push_back(rv[i]); break; }
    case JUMP_UP_DOWN: {
      for (size_t i = 0; i < n; i += 2) idx.push_back(i); for (size_t i = 1; i < n; i += 2) idx.push_back(i);
      std::vector<size_t> rv; for (size_t i = n; i-- > 0;) rv.push_back(i); for (size_t i = 0; i < rv.size(); i += 2) idx.push_back(rv[i]); for (size_t i = 1; i < rv.size(); i += 2) idx.push_back(rv[i]);
      break;
    }
    case CASCADE_UP: cascade(idx, n, true, true); break;
    case CASCADE_DOWN: cascade(idx, n, false, true); break;
    case CASCADE_UP_DOWN: cascade(idx, n, true, true); cascade(idx, n, false, false); break;
    default: { failed = true; return; }
  }
  for (size_t i : idx) notes.push_back(ex[i]);
}

struct EngineSettings { bool enabled = true; int mode = AS_PLAYED, rhythm = 0; double rotation = 0.5; int rateMul = 6; double gate = 0.5, velAdj = 0; int octShift = 0, range = 1, startNote = 0, repeats = -1; bool retrigNotes = false; double retrigBeats = -1; int retrigIndex = 0; };
struct ArpSettings { bool sync = true; int syncRate = 2; double freeMs = 250, swing = 0; SwingRate swingRate = EIGHTH; bool latch = false; double bar = 4; EngineSettings e[2]; };
static double retrigBeats(int index, double bar) {
  switch (index) { case 2: return 0.5; case 3: return 1; case 4: return 1.5; case 5: return 2; case 6: return 3; case 7: return bar; case 8: return 2 * bar; case 9: return 3 * bar; case 10: return 4 * bar; case 11: return 8 * bar; default: return -1; }
}
static double stepInterval(const ArpSettings& s, int engine, double tempo) {
  static const double RATES[8] = { 0.25, 1.0 / 3.0, 0.5, 2.0 / 3.0, 1.0, 4.0 / 3.0, 2.0, 4.0 };
  static const double MUL[15] = { 1.0 / 8.0, 1.0 / 6.0, 0.25, 1.0 / 3.0, 0.5, 2.0 / 3.0, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0 };
  const EngineSettings& e = s.e[engine];
  if (e.rateMul < 0 || e.rateMul > 14 || !(tempo > 0) || !std::isfinite(tempo)) { failed = true; return 1.0; }
  double base;
  if (s.sync) { if (s.syncRate < 0 || s.syncRate > 7) { failed = true; return 1.0; } base = RATES[s.syncRate]; }
  else { if (!(s.freeMs >= 50 && s.freeMs <= 1000)) { failed = true; return 1.0; } base = s.freeMs * tempo / 60000.0; }
  return base * MUL[e.rateMul];
}
static void validate(const ArpSettings& s, double tempo) {
  if (!(s.swing >= 0 && s.swing <= 1) || !(s.bar > 0)) { failed = true; return; }
  for (int i = 0; i < 2; i++) {
    const EngineSettings& e = s.e[i]; stepInterval(s, i, tempo);
    if (!(e.rotation >= 0 && e.rotation <= 1) || !(e.gate >= 0.1 && e.gate <= 1) || !(e.velAdj >= -1 && e.velAdj <= 1) || e.octShift < -3 || e.octShift > 3 ||
        e.range < 1 || e.range > 4 || e.startNote < -8 || e.startNote > 8 || (e.retrigNotes && e.retrigBeats >= 0) || e.repeats == 0 || e.repeats > 16) { failed = true; return; }
    rhythmHit(e.rhythm, e.rotation, 0);
  }
}

struct ArpEv { double beat; int engine; bool on; int pitch; int vel; float pan; };
static bool arpLess(const ArpEv& a, const ArpEv& b) {      // arp_order (for a stable sort)
  if (a.beat != b.beat) return a.beat < b.beat;
  bool ao = a.on, bo = b.on; if (ao != bo) return !ao;       // off first
  return a.engine < b.engine;
}

struct EngineState {
  std::vector<Held> held; bool hasOrigin = false; double origin = 0; uint64_t nextStep = 0; size_t pitchIndex = 0; uint64_t cycles = 0;
  std::vector<ArpEv> pending; uint64_t rs = 1; int randomMode = -1; std::vector<int> randomSource; std::vector<size_t> bag; size_t cursor = 0;
  bool hasLast = false; int lastPitch = 0; int direction = 0; std::vector<Held> notes;
  void resetSequence(double beat) { hasOrigin = true; origin = beat; nextStep = 0; pitchIndex = 0; cycles = 0; cursor = 0; hasLast = false; direction = 0; }
  void input(const Ev& e, bool latch, const EngineSettings& c) {
    if (e.on) {
      held.erase(std::remove_if(held.begin(), held.end(), [&](const Held& h) { return h.pitch == e.pitch; }), held.end());
      held.push_back({ e.pitch, e.vel, e.pan });
      if (!hasOrigin || c.retrigNotes) resetSequence(e.beat);
    } else if (!latch) {
      held.erase(std::remove_if(held.begin(), held.end(), [&](const Held& h) { return h.pitch == e.pitch; }), held.end());
      if (held.empty()) { hasOrigin = false; pitchIndex = 0; cycles = 0; cursor = 0; hasLast = false; direction = 0; randomSource.clear(); bag.clear(); randomMode = -1; }
      else if (c.retrigNotes) resetSequence(e.beat);
    }
  }
  uint64_t rnd() { rs = rs * 48271 % 2147483647ULL; return rs; }
  size_t below(size_t count) {
    uint64_t span = 2147483646ULL, bucket = span / count;
    for (;;) { uint64_t v = rnd() - 1; if (v < bucket * count) return (size_t)(v / bucket); }
  }
  void shuffle() { for (size_t i = bag.size(); i-- > 1;) { size_t s = below(i + 1); std::swap(bag[i], bag[s]); } }
  Held randomSelect(int mode, const std::vector<Held>& ns) {
    bool same = randomSource.size() == ns.size(); if (same) for (size_t i = 0; i < ns.size(); i++) if (randomSource[i] != ns[i].pitch) { same = false; break; }
    if (randomMode != mode || !same) {
      if (randomMode != mode) { hasLast = false; direction = 0; } else if (mode == RANDOM_WALK) direction = 0;
      bag.clear(); for (size_t i = 0; i < ns.size(); i++) bag.push_back(i); cursor = 0;
      if (mode == RANDOM_ONCE) shuffle();
      if (hasLast) { bool any = false; for (auto& n : ns) if (n.pitch == lastPitch) any = true; if (!any) hasLast = false; }
      randomSource.clear(); for (auto& n : ns) randomSource.push_back(n.pitch); randomMode = mode;
    }
    size_t len = ns.size(), index = 0;
    if (mode == RANDOM) index = below(len);
    else if (mode == RANDOM_NO_REPEAT) {
      if (cursor == 0 || cursor >= len) {
        shuffle();
        if (len > 1 && hasLast && ns[bag[0]].pitch == lastPitch) { for (size_t i = 1; i < len; i++) if (ns[bag[i]].pitch != lastPitch) { std::swap(bag[0], bag[i]); break; } }
        cursor = 0;
      }
      index = bag[cursor++];
    } else if (mode == RANDOM_ONCE) { index = bag[cursor]; cursor = (cursor + 1) % len; }
    else {   // RANDOM_WALK
      long long prev = -1; if (hasLast) for (size_t i = 0; i < len; i++) if (ns[i].pitch == lastPitch) { prev = (long long)i; break; }
      if (len < 2) index = 0;
      else if (prev >= 0) {
        if (direction == 0) direction = below(2) == 0 ? -1 : 1;
        if (prev == 0) direction = 1; else if (prev == (long long)len - 1) direction = -1;
        long long d = direction; std::pair<size_t, int> ch[3]; int cnt = 0;
        const long long del[3] = { d, -d, 2 * d }; const int w[3] = { 50, 30, 20 };
        for (int k = 0; k < 3; k++) { long long c = prev + del[k]; if (c >= 0 && c < (long long)len) ch[cnt++] = { (size_t)c, w[k] }; }
        int total = 0; for (int k = 0; k < cnt; k++) total += ch[k].second;
        size_t draw = below((size_t)total) + 1, sel = (size_t)prev;
        for (int k = 0; k < cnt; k++) { if (draw <= (size_t)ch[k].second) { sel = ch[k].first; break; } draw -= ch[k].second; }
        direction = (long long)sel < prev ? -1 : 1; index = sel;
      } else { index = below(len); direction = below(2) == 0 ? -1 : 1; }
    }
    hasLast = true; lastPitch = ns[index].pitch; return ns[index];
  }
  void scheduleUntil(double limit, bool inclusive, int engine, const EngineSettings& c, double interval, double bar, double swing, SwingRate swr, double blockStart) {
    if (!hasOrigin) return;
    for (;;) {
      double beat = origin + (double)nextStep * interval; bool hasB = c.retrigBeats >= 0; double boundary = 0;
      if (hasB) { double period = std::max(c.retrigBeats, interval); boundary = std::ceil(std::max(origin, blockStart) / period) * period; if (boundary <= origin + 1e-9) boundary += period; }
      double next = hasB ? std::min(boundary, beat) : beat;
      if (next > limit || (!inclusive && next >= limit)) break;
      if (hasB && boundary <= beat + 1e-9) { resetSequence(boundary); continue; }
      nextStep++;
      if (!c.enabled || held.empty() || !rhythmHit(c.rhythm, c.rotation, nextStep - 1) || (c.repeats > 0 && cycles >= (uint64_t)c.repeats)) continue;
      bool rm = isRandom(c.mode);
      orderedNotes(rm ? UP : c.mode, held, c.range, c.startNote, notes);
      if (notes.empty()) continue;
      size_t cycleLen = c.mode == CHORD ? 1 : notes.size();
      std::vector<Held> sel;
      if (rm) sel.push_back(randomSelect(c.mode, notes));
      else if (c.mode == CHORD) sel = notes;
      else { long long sn = c.mode == ANCHOR ? 0 : c.startNote; sel.push_back(notes[(size_t)remEuclidI((long long)pitchIndex + sn, (long long)cycleLen)]); }
      double onBeat = beat + swingDelay(beat, interval, swing, swr);
      for (auto& h : sel) {
        int pitch = h.pitch + c.octShift * 12; double v = std::round((double)h.vel * (1.0 + c.velAdj)); int vel = (int)std::min(std::max(v, 0.0), 255.0);
        pending.push_back({ onBeat, engine, true, pitch, vel, h.pan });
        pending.push_back({ onBeat + interval * c.gate, engine, false, pitch, 0, h.pan });
      }
      pitchIndex = (pitchIndex + 1) % cycleLen; if (pitchIndex == 0) cycles++;
    }
  }
};

struct Arpeggiator {
  ArpSettings s; EngineState e[2]; bool hasEnd = false; double endBeat = 0;
  Arpeggiator(const ArpSettings& st, uint64_t seed) : s(st) {
    for (int i = 0; i < 2; i++) { uint64_t r = (seed + (uint64_t)i) % 2147483647ULL; e[i].rs = r == 0 ? 1 : r; }
  }
  std::vector<ArpEv> processBlock(double start, double end, double tempo, const std::vector<Ev>& input) {
    std::vector<ArpEv> result;
    if (!(end > start) || (hasEnd && std::fabs(endBeat - start) > 1e-9)) { failed = true; return {}; }
    validate(s, tempo); if (failed) return result;
    for (int engine = 0; engine < 2; engine++) {
      const EngineSettings& c = s.e[engine]; double interval = stepInterval(s, engine, tempo); EngineState& st = e[engine];
      if (st.hasOrigin) {
        while (st.origin + (double)st.nextStep * interval < start) st.nextStep++;
        while (st.nextStep > 0 && st.origin + (double)(st.nextStep - 1) * interval >= start) st.nextStep--;
      }
      size_t cur = 0;
      while (cur < input.size()) {
        double beat = input[cur].beat;
        st.scheduleUntil(beat, false, engine, c, interval, s.bar, s.swing, s.swingRate, start);
        while (cur < input.size() && input[cur].beat == beat) st.input(input[cur++], s.latch, c);
        st.scheduleUntil(beat, true, engine, c, interval, s.bar, s.swing, s.swingRate, start);
      }
      st.scheduleUntil(end, false, engine, c, interval, s.bar, s.swing, s.swingRate, start);
      std::vector<ArpEv> keep;
      for (auto& ev : st.pending) (ev.beat < end ? result : keep).push_back(ev);
      st.pending.swap(keep);
    }
    hasEnd = true; endBeat = end;
    std::stable_sort(result.begin(), result.end(), arpLess);
    return result;
  }
};

static ArpSettings arpSettings(const std::vector<float>& p, double bar) {
  ArpSettings s; s.e[1].enabled = false;
  s.sync = p[3] > 0.5f; s.syncRate = menu(p[1], 8); s.freeMs = 50.0 + (double)p[2] * 950.0; s.swing = (double)p[4];
  s.swingRate = p[5] >= 0.5f ? SIXTEENTH : EIGHTH; s.latch = p[6] > 0.5f; s.bar = bar;
  for (int k = 0; k < 2; k++) {
    int base = k == 0 ? 9 : 20; EngineSettings& e = s.e[k];
    e.enabled = p[base + 10] > 0.5f; e.mode = menu(p[base + 1], 24);
    e.gate = std::min((10.2 + 90.0 * (double)p[base]) / 100.0, 1.0);
    e.range = 1 + menu(p[base + 2], 4); e.octShift = menu(p[base + 3], 7) - 3; e.startNote = menu(p[base + 4], 17) - 8;
    e.rhythm = menu(p[base + 5], 22); e.rotation = (double)p[base + 6];
    int rep = menu(p[base + 8], 17); e.repeats = rep == 0 ? -1 : rep;
    int ri = menu(p[base + 9], 12); if (ri > 11) { failed = true; return s; } e.retrigNotes = ri == 1; e.retrigBeats = retrigBeats(ri, bar); e.retrigIndex = ri;
    e.rateMul = (size_t)(31 + k) < p.size() ? menu(p[31 + k], 15) : 6;
    e.velAdj = ((double)p[7 + k] - 0.5) * 2.0;
  }
  return s;
}

// ---------------- note_effects.rs ----------------
static std::vector<NfxNote> pairEvents(const std::vector<Ev>& events, bool lenient = false) {
  std::map<int, std::deque<size_t>> held; std::vector<NfxNote> notes;
  for (auto& e : events) {
    if (e.on && e.vel > 0) { held[e.pitch].push_back(notes.size()); notes.push_back({ e.beat, NAN, e.pitch, e.vel, e.pan }); }
    else {
      auto it = held.find(e.pitch); if (it == held.end() || it->second.empty()) { if (lenient) continue; { failed = true; return {}; } }
      size_t i = it->second.front(); it->second.pop_front();
      if (e.beat <= notes[i].start) { if (lenient) { notes[i].end = notes[i].start; continue; } { failed = true; return {}; } }
      notes[i].end = e.beat;
    }
  }
  if (!lenient) for (auto& kv : held) if (!kv.second.empty()) { failed = true; return {}; }
  return notes;
}
static std::vector<Ev> eventsFromNotes(const std::vector<NfxNote>& notes) {
  std::vector<Ev> ev; ev.reserve(notes.size() * 2);
  for (auto& n : notes) { if (n.velocity > 0) ev.push_back({ n.start, true, n.pitch, n.velocity, n.pan }); ev.push_back({ n.end, false, n.pitch, 0, n.pan }); }
  sortNoteEvents(ev); return ev;
}

struct Random {
  uint64_t s;
  Random(int32_t instance, size_t index) { s = ((uint64_t)(int64_t)instance * 0x9e3779b97f4a7c15ULL) ^ ((uint64_t)index * 0xbf58476d1ce4e5b9ULL) ^ 0x94d049bb133111ebULL; }
  double unit() { s ^= s >> 12; s ^= s << 25; s ^= s >> 27; return (double)((s * 0x2545f4914f6cdd1dULL) >> 11) / (double)(1ULL << 53); }
  double sgn() { return 2.0 * unit() - 1.0; }
  int integer(int mn, int mx) { return mn + (int)(int16_t)(unit() * (double)(mx - mn + 1)); }
};

static void transposeNote(const std::vector<float>& p, NfxNote n, std::vector<NfxNote>& out) {
  int oct = (int)std::round(8.0f * p[1] - 4.0f), semi = (int)std::round(24.0f * p[2] - 12.0f), pitch = n.pitch + oct * 12 + semi;
  if (pitch >= 0 && pitch <= 127) { n.pitch = pitch; out.push_back(n); }
}
static const double TIME_BEATS = 0.25;
static void randomize(const NfxModule& m, const std::vector<float>& p, NfxNote n, size_t index, std::vector<NfxNote>& out) {
  Random r(m.instance, index);
  int range = (int)std::round(24.0f * p[1]), pitch = n.pitch + r.integer(-range, range);
  int vel = (int)std::min(std::max(std::round((double)n.velocity * (1.0 + r.sgn() * (double)p[2])), 1.0), 255.0);
  bool plays = r.unit() < (double)p[4];
  float pan = (float)std::min(std::max((double)n.pan + r.sgn() * (double)p[3], 0.0), 1.0);
  double far = (double)p[5] * TIME_BEATS, start = n.start, end = n.end;
  if (far > 0) {
    double bias = 2.0 * (double)p[6] - 1.0, lo = -1.0 + std::max(bias, 0.0), hi = 1.0 + std::min(bias, 0.0);
    double off = std::max(far * (lo + r.unit() * (hi - lo)), -n.start); start = n.start + off; end = std::max(n.end + off, start);
  }
  if (plays) out.push_back({ start, end, std::min(std::max(pitch, 0), 127), vel, pan });
}
static void scaleNote(const std::vector<float>& p, NfxNote n, std::vector<NfxNote>& out) {
  auto allowed = [&](int pitch) { return p[4 + (size_t)remEuclidI(pitch, 12)] > 0.5f; };
  if (allowed(n.pitch)) { out.push_back(n); return; }
  if (p[3] > 0.5f) for (int d = 1; d <= 127; d++) for (int pitch : { n.pitch - d, n.pitch + d }) if (pitch >= 0 && pitch <= 127 && allowed(pitch)) { n.pitch = pitch; out.push_back(n); return; }
}

struct Clock {
  double sr, tempo; uint64_t block;
  uint64_t frame(double beat) const { double f = std::ceil(beat * 60.0 * sr / tempo); return f > 0 ? (uint64_t)f : 0; }
  double beat(double frame) const { return (frame - 0.5) * tempo / (60.0 * sr); }
  double frames(float beats) const { return std::trunc((double)beats * (60.0 * sr) / tempo); }
};
struct InputKeys {
  std::map<int, std::vector<std::pair<uint64_t, uint64_t>>> keys;
  void build(const std::vector<NfxNote>& notes, const Clock& c) {
    for (auto& n : notes) if (n.velocity > 0) keys[n.pitch].push_back({ c.frame(n.start), c.frame(n.end) });
    for (auto& kv : keys) { std::sort(kv.second.begin(), kv.second.end()); uint64_t latest = 0; for (auto& x : kv.second) { latest = std::max(latest, x.second); x.second = latest; } }
  }
  bool collides(int key, uint64_t frame) const {
    auto it = keys.find(key); if (it == keys.end()) return false; const auto& l = it->second;
    size_t near = (size_t)(std::partition_point(l.begin(), l.end(), [&](const std::pair<uint64_t, uint64_t>& x) { return x.first + 1 < frame; }) - l.begin());
    size_t started = (size_t)(std::partition_point(l.begin(), l.end(), [&](const std::pair<uint64_t, uint64_t>& x) { return x.first <= frame; }) - l.begin());
    return (near < l.size() && l[near].first <= frame + 1) || (started > 0 && l[started - 1].second > frame);
  }
};
static float velFraction(float v) { return v < 0.5f ? -0.9f * (1.0f - 2.0f * v) : 2.0f * v - 1.0f; }
static double powi(double x, uint32_t n) { double r = 1.0; for (;;) { if (n & 1) r *= x; n /= 2; if (n == 0) return r; x *= x; } }
static const float SYNC_ITEMS[10] = { 0.125f, 0.25f, 0.375f, 0.5f, 0.75f, 1.0f, 2.0f, 3.0f, 4.0f, 8.0f };

static void echo(const NfxModule& m, const std::vector<float>& p, NfxNote note, size_t index, double stop, const InputKeys& input, const Clock& clock, std::vector<NfxNote>& out) {
  out.push_back(note);
  uint32_t repeats = (uint32_t)std::round(32.0f * p[1]);
  auto bts = [](float v) { return std::fma(7.96875f, v * v, 0.03125f); };
  float beats;
  if (p[4] > 0.5f) { float b = bts(p[3]); beats = SYNC_ITEMS[0]; float bd = std::fabs(SYNC_ITEMS[0] - b); for (int i = 1; i < 10; i++) { float d = std::fabs(SYNC_ITEMS[i] - b); if (d < bd) { bd = d; beats = SYNC_ITEMS[i]; } } }
  else beats = bts(p[2]);
  double delay = clock.frames(beats), timeDrift = (double)std::min(std::max(0.6f * p[9] + 0.7f, 0.7f), 1.3f);
  float lengthDrift = p[10] <= 0.5f ? p[10] + 0.5f : 2.0f * p[10];
  double tick = std::trunc(clock.sr * 0.46875 / clock.tempo);
  int keyDrift = (int)std::round(24.0f * p[8] - 12.0f); float velDrift = 1.0f + velFraction(p[7]), panDrift = p[13] - 0.5f;
  Random rnd(m.instance, index);
  int key = std::min(std::max(note.pitch + (int)std::round(48.0f * p[5] - 24.0f), 0), 127);
  float vel = std::min(std::max((float)note.velocity / 255.0f + velFraction(p[6]), 0.0f), 1.0f);
  float pan = std::min(std::max(2.0f * note.pan - 1.0f + 2.0f * p[12] - 1.0f, -1.0f), 1.0f);
  uint64_t on = clock.frame(note.start), off = clock.frame(note.end), stopFrame = std::isinf(stop) ? UINT64_MAX : clock.frame(stop), block = clock.block;
  uint64_t t = on + (uint64_t)delay; if (t < (on / block + 1) * block) t += block - on % block;
  uint64_t processed = t / block; bool sounds = true; float gap = (float)delay, previous = 0.0f;
  for (uint32_t k = 1; k <= repeats; k++) {
    if (t >= stopFrame) return;
    key = std::min(std::max(key + keyDrift, 0), 127);
    vel = std::min(std::max(vel * velDrift, 0.0f), 1.0f);
    if (k > 1) pan = std::min(std::max(pan + panDrift, -1.0f), 1.0f);
    float prev = k == 1 ? (off > t ? gap : (float)(off - on)) : previous;
    float length = std::max(std::min(std::trunc(std::fma(lengthDrift, prev, 0.5f)), std::trunc(gap)), 0.0f);
    bool last = k == repeats || vel <= 1.0f / 127.0f || (double)length < tick;
    bool hasNext = !last; float g = 0;
    if (hasNext) {
      g = (float)(powi(timeDrift, k + 1) * delay);
      if (p[11] > 0.0f) g = std::max(std::fma(p[11], (float)rnd.sgn(), 1.0f) * g, 0.0f);
      length = std::min(length, std::max(std::trunc(g), 1.0f) - 1.0f);
    }
    double quarter = length == 0.0f ? 0.25 : 0.0;
    double end = std::min(clock.beat((double)t + (double)length + quarter), stop);
    float emitted = (p[14] > 0.5f && k % 2 == 0) ? -pan : pan, epan = (emitted + 1.0f) / 2.0f;
    bool col = input.collides(key, t);
    if (!col && !sounds) out.push_back({ end, end, key, 0, epan });
    else if (!col && vel > 0.0f) out.push_back({ clock.beat((double)t), end, key, (int)std::max(std::round(vel * 255.0f), 1.0f), epan });
    previous = length;
    if (!hasNext) return;
    uint64_t following = (processed + 1) * block;
    sounds = (double)t + (double)g >= (double)following;
    if (sounds) { t += (uint64_t)std::floor(g); processed = t / block; } else { t += (uint64_t)std::ceil(g); processed++; }
    gap = g;
  }
}

static std::vector<NfxNote> sortedByStart(std::vector<NfxNote> notes) {
  std::stable_sort(notes.begin(), notes.end(), [](const NfxNote& a, const NfxNote& b) { return a.start < b.start; });
  return notes;
}

static std::vector<Ev> arpeggiate(const NfxModule& m, const std::vector<Ev>& events, double startBeat, double endBeat, double tempo, double bar) {
  ArpSettings first = arpSettings(m.p, bar); if (failed) return {};
  double maxInt = std::max(stepInterval(first, 0, tempo), stepInterval(first, 1, tempo));
  double last = events.empty() ? endBeat : events.back().beat;
  double horizon = first.latch ? std::max(endBeat, last) : std::max(endBeat, last + maxInt + 1.0);
  Arpeggiator arp(first, (uint64_t)(int64_t)m.instance);
  std::vector<ArpEv> out;
  if (horizon > startBeat) { auto r = arp.processBlock(startBeat, horizon, tempo, events); out.insert(out.end(), r.begin(), r.end()); }
  arp.s.latch = false;
  std::set<int> pitches; for (auto& e : events) if (e.on) pitches.insert(e.pitch);
  std::vector<Ev> release; for (int p : pitches) release.push_back({ horizon, false, p, 0, 0.5f });
  auto r = arp.processBlock(horizon, horizon + maxInt + 1.0, tempo, release);
  for (auto& e : r) if (!e.on) out.push_back(e);
  std::vector<Ev> res;
  for (auto& e : out) if (e.pitch >= 0 && e.pitch <= 127) res.push_back({ e.beat, e.on, e.pitch, e.vel, e.pan });
  std::stable_sort(res.begin(), res.end(), [](const Ev& a, const Ev& b) { if (a.beat != b.beat) return a.beat < b.beat; return !a.on && b.on; });
  return res;
}

}  // namespace

int nfxParamCount(int type) { switch (type) { case 47: return 16; case 48: return 3; case 49: return 7; case 50: return 16; case 51: return 31; default: return 0; } }

bool nfxProcess(const std::vector<NfxModule>& mods0, double startBeat, double endBeat, double tempo, double barBeats, double sr, uint64_t block, std::vector<NfxNote>& io) {
  if (mods0.empty()) return true;
  failed = false;
  {
    std::vector<NfxModule> mods = mods0;
    for (auto& m : mods) {
      int count = nfxParamCount(m.type); if (!count) { failed = true; return false; }
      if (m.type == 49 && m.p.size() == 5) { m.p.resize(count, 0.0f); m.p[6] = 0.5f; }
      if ((int)m.p.size() < count) { failed = true; return false; }
      for (float v : m.p) if (!(v >= 0.0f && v <= 1.0f)) { failed = true; return false; }
    }
    if (!(endBeat > startBeat) || !(tempo > 0) || !(sr > 0) || block == 0) { failed = true; return false; }
    // the input as Honeydew sees it: note events in beat order (offs before ons on one beat), paired again in note-on order
    std::vector<NfxNote> notes = pairEvents(eventsFromNotes(io));
    if (failed) return false;
    const size_t MAX_NOTES = 100000;
    if (notes.size() > MAX_NOTES) { failed = true; return false; }
    for (auto& m : mods) {
      std::vector<NfxNote> gen;
      std::vector<NfxNote> sorted = sortedByStart(notes);
      if (m.type == 51) {
        std::vector<NfxNote> held;
        for (auto& n : sorted) { if (m.p[0] < 0.5f || n.velocity == 0) gen.push_back(n); else held.push_back(n); }
        auto ev = arpeggiate(m, eventsFromNotes(held), startBeat, endBeat, tempo, barBeats);
        if (failed) return false;
        auto pn = pairEvents(ev); if (failed) return false; gen.insert(gen.end(), pn.begin(), pn.end());
      } else {
        Clock clock{ sr, tempo, block }; InputKeys input; if (m.type == 47) input.build(notes, clock);
        for (size_t i = 0; i < sorted.size(); i++) {
          const NfxNote& n = sorted[i];
          if (m.p[0] < 0.5f || (n.velocity == 0 && m.type != 48 && m.type != 50)) { gen.push_back(n); continue; }
          switch (m.type) {
            case 47: echo(m, m.p, n, i, std::numeric_limits<double>::infinity(), input, clock, gen); break;
            case 48: transposeNote(m.p, n, gen); break;
            case 49: randomize(m, m.p, n, i, gen); break;
            case 50: scaleNote(m.p, n, gen); break;
          }
          if (gen.size() > MAX_NOTES) { failed = true; return false; }
        }
      }
      if (failed) return false;
      notes.swap(gen);
      if (notes.size() > MAX_NOTES) { failed = true; return false; }
    }
    // back to notes, as the engine plays the events: a note-off alone (velocity 0) ends nothing here and is left out
    std::vector<NfxNote> out; out.reserve(notes.size());
    for (auto& n : pairEvents(eventsFromNotes(notes), true)) if (n.end > n.start) out.push_back(n);
    io.swap(out);
    return true;
  }
}

}  // namespace mdaw
