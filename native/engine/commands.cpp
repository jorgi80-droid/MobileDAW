#include "commands.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>
#include <mutex>
#include <unordered_map>
#include "inst_classic.h"
#include "live.h"

namespace mdaw {

enum Op {
  PLAY, STOP, PLAYCOUNTIN, SEEK, TEMPO, TEMPOMAP, SETSIG, SETMETER, LOOP, SETMETRO, SETMETROVOL, MASTERLIMIT, SETPDC, TRACKLOAD,
  TRACKVOL, TRACKPAN, TRACKWIDTH, TRACKINVERT, TRACKMUTE, TRACKSOLO, TRACKSEND, TRACKOUT, TRACKINST, INSTPARAM, RESETTRACK,
  INSERTDEVICE, REMOVEDEVICE, DEVPARAM, DEVBYPASS, RACKCMD, SOUNDFONT, PREVIEW, BEND, TRACKNOTES, TRACKCLIPS, TRACKCC, AUTOMATION, SAMPLE, PANIC
};
static const std::unordered_map<std::string, int> OPS = {
  { "play", PLAY }, { "stop", STOP }, { "playCountIn", PLAYCOUNTIN }, { "seek", SEEK }, { "tempo", TEMPO }, { "tempoMap", TEMPOMAP },
  { "setSig", SETSIG }, { "setMeter", SETMETER }, { "loop", LOOP }, { "setMetro", SETMETRO }, { "setMetroVol", SETMETROVOL }, { "masterLimit", MASTERLIMIT }, { "setPdc", SETPDC }, { "trackLoad", TRACKLOAD },
  { "trackVol", TRACKVOL }, { "trackPan", TRACKPAN }, { "trackWidth", TRACKWIDTH }, { "trackInvert", TRACKINVERT }, { "trackMute", TRACKMUTE }, { "trackSolo", TRACKSOLO }, { "trackSend", TRACKSEND },
  { "trackOut", TRACKOUT }, { "trackInst", TRACKINST }, { "instParam", INSTPARAM }, { "resetTrack", RESETTRACK }, { "insertDevice", INSERTDEVICE },
  { "removeDevice", REMOVEDEVICE }, { "devParam", DEVPARAM }, { "devBypass", DEVBYPASS }, { "rackCmd", RACKCMD }, { "sf", SOUNDFONT }, { "preview", PREVIEW }, { "bend", BEND },
  { "trackNotes", TRACKNOTES }, { "trackClips", TRACKCLIPS }, { "trackCC", TRACKCC }, { "automation", AUTOMATION }, { "sample", SAMPLE }, { "panic", PANIC },
};

// ---------------------------------------------------------------- parsing
bool parseLine(const std::string& line, std::string& name, std::vector<Arg>& args, const float* blob, size_t blobLen) {
  args.clear(); name.clear();
  const char* p = line.c_str();
  auto ws = [&]() { while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++; };
  auto num = [&](double& v) -> bool {
    if (!std::strncmp(p, "nan", 3)) { v = NAN; p += 3; return true; }
    if (!std::strncmp(p, "inf", 3)) { v = INFINITY; p += 3; return true; }
    if (!std::strncmp(p, "-inf", 4)) { v = -INFINITY; p += 4; return true; }
    char* e; v = std::strtod(p, &e); if (e == p) return false; p = e; return true;
  };
  ws(); while (*p && *p != ' ') name += *p++;
  if (name.empty()) return false;
  for (;;) {
    ws(); if (!*p) break;
    Arg a;
    if (*p == 'u') { a.kind = Arg::Undef; p++; }
    else if (*p == '[') {
      p++; ws(); double cnt; if (!num(cnt) || cnt < 0) return false;
      a.kind = Arg::Arr; a.arr.resize((size_t)cnt);
      for (size_t i = 0; i < a.arr.size(); i++) { ws(); if (!num(a.arr[i])) return false; }
      ws(); if (*p != ']') return false; p++;
    } else if (*p == '@') {
      p++; char* e; unsigned long long off = std::strtoull(p, &e, 10); if (*e != ':') return false; p = e + 1;
      unsigned long long len = std::strtoull(p, &e, 10); p = e;
      if (!blob || off + len > blobLen) return false;
      a.kind = Arg::F32; a.f32 = blob + off; a.len = (int)len;
    } else { a.kind = Arg::Num; if (!num(a.num)) return false; }
    args.push_back(std::move(a));
  }
  return true;
}

// ---------------------------------------------------------------- preparation (allocates; not on the audio thread)
static const Arg NONE;
static const Arg& at(const std::vector<Arg>& a, size_t i) { return i < a.size() ? a[i] : NONE; }
template <class T> static void take(Cmd& c, T* p) { c.p = p; c.del = [](void* q) { delete static_cast<T*>(q); }; }
static double arrAt(const Arg& a, size_t i) { return i < a.arr.size() ? a.arr[i] : NAN; }   // flat[i] (undefined -> NaN)
static int count(const Arg& a, const Arg& n, int stride) {   // n entries, never more than the array holds
  double want = n.kind == Arg::Num ? n.num : 0; double have = std::floor((double)a.arr.size() / stride);
  return (int)std::max(0.0, std::min(want == want ? want : 0, have));
}

static NoteData* prepNotes(const Arg& flat, const Arg& nArg, int stride) {
  int n = count(flat, nArg, stride);
  struct Ev { double t, on, p, v, pan; };
  std::vector<Ev> ev; ev.reserve(n * 2);
  auto* d = new NoteData();
  for (int i = 0; i < n; i++) {
    size_t b = (size_t)i * stride; double st = arrAt(flat, b), ln = arrAt(flat, b + 1), pv = stride > 4 ? arrAt(flat, b + 4) : 0;
    double pn = (pv == pv && pv != 0) ? pv : 0;
    ev.push_back({ st, 1, arrAt(flat, b + 2), arrAt(flat, b + 3), pn });
    ev.push_back({ st + jsMax(ln, 1), 0, arrAt(flat, b + 2), 0, 0 });
    d->notes.push_back({ st, st + jsMax(ln, 1), arrAt(flat, b + 2), arrAt(flat, b + 3), pn });
  }
  std::stable_sort(ev.begin(), ev.end(), [](const Ev& a, const Ev& b) { return a.t < b.t || (a.t == b.t && a.on < b.on); });
  int m = (int)ev.size(); d->n = m;
  d->tick.resize(m); d->p.resize(m); d->v.resize(m); d->on.resize(m); d->pan.resize(m);
  for (int i = 0; i < m; i++) { d->tick[i] = ev[i].t; d->on[i] = (uint8_t)ev[i].on; d->p[i] = (uint8_t)(uint32_t)toInt32(ev[i].p); d->v[i] = (float)ev[i].v; d->pan[i] = (float)ev[i].pan; }
  return d;
}

static ClipData* prepClips(const Arg& flat, const Arg& nArg, int stride) {
  int n = count(flat, nArg, stride);
  auto* d = new ClipData();
  for (int i = 0; i < n; i++) {
    size_t b = (size_t)i * stride;
    d->c.push_back({ arrAt(flat, b), arrAt(flat, b + 1), toInt32(arrAt(flat, b + 2)), arrAt(flat, b + 3),
                     stride > 4 ? arrAt(flat, b + 4) : 0, stride > 5 ? arrAt(flat, b + 5) : 0, stride > 6 ? arrAt(flat, b + 6) : 0 });
  }
  std::stable_sort(d->c.begin(), d->c.end(), [](const Clip& a, const Clip& b) { return a.start < b.start; });
  return d;
}

static CCData* prepCC(const Arg& flat, const Arg& nArg) {
  int n = count(flat, nArg, 3);
  std::vector<std::pair<double, double>> by[4];
  for (int i = 0; i < n; i++) { int k = toInt32(arrAt(flat, i * 3 + 1)); if (k >= 0 && k < 4) by[k].push_back({ arrAt(flat, i * 3), arrAt(flat, i * 3 + 2) }); }
  auto* d = new CCData(); bool any = false;
  for (int k = 0; k < 4; k++) {
    if (by[k].empty()) continue;
    std::stable_sort(by[k].begin(), by[k].end(), [](const std::pair<double, double>& x, const std::pair<double, double>& y) { return x.first < y.first; });
    auto* l = new CCLane(); for (auto& q : by[k]) { l->t.push_back(q.first); l->v.push_back(q.second); }
    d->lane[k] = l; any = true;
  }
  if (!any) { delete d; return nullptr; }
  return d;
}

static LaneData* prepLanes(const Arg& flat, const Arg& cnt) {
  int count0 = cnt.kind == Arg::Num ? (int)cnt.num : (int)flat.arr.size();
  int total = std::min(count0, (int)flat.arr.size());
  auto* d = new LaneData();
  for (int i = 0; i + 5 <= total;) {
    Lane l{ toInt32(flat.arr[i]), toInt32(flat.arr[i + 1]), toInt32(flat.arr[i + 2]), toInt32(flat.arr[i + 3]), {}, NAN };
    int n = toInt32(flat.arr[i + 4]); i += 5;
    for (int k = 0; k < n && i + 2 <= total; k++, i += 2) l.pts.push_back({ flat.arr[i], flat.arr[i + 1] });
    std::stable_sort(l.pts.begin(), l.pts.end(), [](const std::pair<double, double>& x, const std::pair<double, double>& y) { return x.first < y.first; });
    if (!l.pts.empty()) d->lanes.push_back(std::move(l));
  }
  return d;
}

// SoundFont sample data staged by the Android bridge (it arrives through the sample channel, too large for a text command)
static std::mutex sfMu; static std::map<int, std::vector<float>> sfStaged;
void stageSoundFont(int id, std::vector<float>&& data) { std::lock_guard<std::mutex> g(sfMu); sfStaged[id] = std::move(data); }
bool takeStagedSoundFont(int id, std::vector<float>& out) { std::lock_guard<std::mutex> g(sfMu); auto it = sfStaged.find(id); if (it == sfStaged.end()) return false; out = std::move(it->second); sfStaged.erase(it); return true; }

bool supported(const std::string& name, const std::vector<Arg>& a) {
  if (name == "trackInst") { int ty = toInt32(at(a, 1).n()); return instPorted(ty) || at(a, 0).n() >= MASTER; }
  if (name == "insertDevice") return devPorted(toInt32(at(a, 2).n()));
  return true;
}

// instrument type per track as the command stream set it (prepare runs in command order): lets prepare build Wavetable frame sets
// (live.cpp wtEnsure) here, off the audio thread, before the instParam that selects them reaches the engine
static int trackType[NSTRIPS] = {};
bool prepare(const std::string& name, const std::vector<Arg>& a, const Engine& eng, Cmd& c) {
  auto it = OPS.find(name);
  if (it == OPS.end()) { c.error = "unknown command " + name; return false; }
  c.op = it->second;
  auto N = [&](size_t i) { return at(a, i).n(); };
  auto B = [&](size_t i) { return at(a, i).truthy() ? 1.0 : 0.0; };
  switch (c.op) {
    case PLAYCOUNTIN: case SEEK: case TEMPO: case SETMETROVOL: c.a[0] = N(0); break;
    case RESETTRACK: { c.a[0] = N(0); int t = toInt32(N(0)); if (t >= 0 && t < NSTRIPS) trackType[t] = 0; break; }
    case SETMETRO: case MASTERLIMIT: case SETPDC: case TRACKLOAD: c.a[0] = B(0); break;
    case LOOP: c.a[0] = B(0); c.a[1] = N(1); c.a[2] = N(2); break;
    case TRACKVOL: case TRACKPAN: case TRACKWIDTH: case TRACKINVERT: case TRACKOUT: case BEND: c.a[0] = N(0); c.a[1] = N(1); break;
    case TRACKMUTE: case TRACKSOLO: c.a[0] = N(0); c.a[1] = B(1); break;
    case TRACKSEND: c.a[0] = N(0); c.a[1] = N(1); c.a[2] = N(2); break;
    case INSTPARAM: {
      c.a[0] = N(0); c.a[1] = N(1); c.a[2] = N(2);
      int t = toInt32(N(0)), i = toInt32(N(1)); if (t >= 0 && t < MASTER && trackType[t] == 11 && (i == 0 || i == 9)) wtEnsure((int)clamp(jsRound(N(2)), 0, WT_COUNT - 1));
      break;
    }
    case DEVPARAM: c.a[0] = N(0); c.a[1] = N(1); c.a[2] = N(2); c.a[3] = N(3); break;
    case DEVBYPASS: c.a[0] = N(0); c.a[1] = N(1); c.a[2] = B(2); break;
    case REMOVEDEVICE: c.a[0] = N(0); c.a[1] = N(1); break;
    case SOUNDFONT: {           // sf id data(@f32 | u = staged by the bridge) [rates] [zones: 18 numbers each] [zone count per preset]
      c.a[0] = N(0); int id = toInt32(N(0));
      const Arg& d = at(a, 1); const Arg& rt = at(a, 2); const Arg& zs = at(a, 3); const Arg& cnt = at(a, 4);
      auto* sf = new SoundFont();
      if (d.kind == Arg::F32) { sf->n = d.len; sf->data = new float[d.len]; std::memcpy(sf->data, d.f32, sizeof(float) * d.len); }
      else { std::vector<float> st; if (takeStagedSoundFont(id, st)) { sf->n = (int)st.size(); sf->data = new float[st.size()]; std::memcpy(sf->data, st.data(), sizeof(float) * st.size()); } }
      if (!sf->data) { delete sf; c.error = "soundfont without data"; return false; }
      if (rt.kind == Arg::Arr) sf->rate = rt.arr;
      if (zs.kind == Arg::Arr && cnt.kind == Arg::Arr) {
        size_t z = 0;
        for (double k : cnt.arr) {
          std::vector<SfZone> pz;
          for (int q = 0; q < (int)k && (z + 1) * SF_ZONE_FIELDS <= zs.arr.size(); q++, z++) { SfZone o; double* f = &o.lo; for (int j = 0; j < SF_ZONE_FIELDS; j++) f[j] = zs.arr[z * SF_ZONE_FIELDS + j]; pz.push_back(o); }
          sf->presets.push_back(std::move(pz));
        }
      }
      take(c, sf); break;
    }
    case RACKCMD: {             // t, d, op, c, j, a, b; op 1 = insert device type a (built here); op 5 / 6 / 7 = Instrument Rack / Drum Rack chains (not ported)
      for (int k = 0; k < 7; k++) c.a[k] = N(k);
      int op = toInt32(N(2));
      if (op >= 8 || (op >= 5 && N(1) >= 0)) { c.error = "unsupported rack " + std::to_string(op); break; }   // ops 5..7 only exist for the track instrument (Instrument Rack / Drum Sampler pads)
      if (op == 1) { int ty = toInt32(N(5)); Device* d = makeDevice(ty, eng.sr, const_cast<float*>(eng.sc)); if (!d) c.error = "unsupported device " + std::to_string(ty); else take(c, d); }
      if (op == 5) { int ty = toInt32(N(5)); if (ty > 0 && ty != 3) { Instrument* in = makeInstrument(ty, eng.sr, const_cast<Bank*>(&eng.bank)); if (!in) c.error = "unsupported inst " + std::to_string(ty); else { c.p2 = in; c.del2 = [](void* q) { delete static_cast<Instrument*>(q); }; } } }
      break;
    }
    case PREVIEW: c.a[0] = N(0); c.a[1] = toInt32(N(1)); c.a[2] = N(2); c.a[3] = B(3); break;
    case TEMPOMAP: {
      c.a[0] = B(0); auto* tm = new TempoMap(); const Arg& f = at(a, 1);
      tm->set(f.kind == Arg::Arr ? f.arr.data() : nullptr, f.kind == Arg::Arr ? (int)f.arr.size() : 0); take(c, tm); break;
    }
    case SETSIG: {
      c.a[0] = N(0); c.a[1] = N(1);
      double bt = jsMax(120, toInt32(N(0))), nb = jsMax(1, toInt32(N(1)));
      const double f[3] = { 0, nb, jsRound(4 * PPQ / bt) };
      auto* mm = new MeterMap(); mm->set(f, 3); take(c, mm); break;
    }
    case SETMETER: { const Arg& f = at(a, 0); auto* mm = new MeterMap(); mm->set(f.arr.data(), (int)f.arr.size()); take(c, mm); break; }
    case TRACKINST: {
      c.a[0] = N(0); c.a[1] = N(1);
      int t = toInt32(N(0)), ty = toInt32(N(1));
      if (t < 0 || t >= MASTER) break;
      trackType[t] = ty; if (ty == 11) { wtEnsure(0); wtEnsure(4); }   // the Wavetable's default tables
      if (!instPorted(ty)) { c.error = "unsupported inst " + std::to_string(ty); }
      Instrument* inst = makeInstrument(ty, eng.sr, const_cast<Bank*>(&eng.bank));
      if (inst) take(c, inst);
      break;
    }
    case INSERTDEVICE: {
      c.a[0] = N(0); c.a[1] = N(1); int ty = toInt32(N(2)); c.a[2] = ty;
      Device* d = makeDevice(ty, eng.sr, const_cast<float*>(eng.sc));
      if (!d) { if (!devPorted(ty)) c.error = "unsupported device " + std::to_string(ty); }
      else take(c, d);
      break;
    }
    case TRACKNOTES: { c.a[0] = N(0); int stride = at(a, 3).kind == Arg::Num ? (int)at(a, 3).num : 5; take(c, prepNotes(at(a, 1), at(a, 2), stride)); break; }
    case TRACKCLIPS: { c.a[0] = N(0); int stride = at(a, 3).kind == Arg::Num ? (int)at(a, 3).num : 7; take(c, prepClips(at(a, 1), at(a, 2), stride)); break; }
    case TRACKCC: { c.a[0] = N(0); CCData* d = prepCC(at(a, 1), at(a, 2)); if (d) take(c, d); break; }
    case AUTOMATION: take(c, prepLanes(at(a, 0), at(a, 1))); break;
    case SAMPLE: {               // sample id @l [@r]
      c.a[0] = N(0); const Arg& l = at(a, 1); const Arg& r = at(a, 2);
      if (l.kind != Arg::F32) { c.error = "sample without data"; return false; }
      auto* s = new Sample(); s->frames = l.len; s->rate = eng.sr;
      s->l = new float[l.len]; std::memcpy(s->l, l.f32, sizeof(float) * l.len);
      if (r.kind == Arg::F32 && r.len == l.len) { s->r = new float[r.len]; std::memcpy(s->r, r.f32, sizeof(float) * r.len); } else s->r = s->l;
      take(c, s); break;
    }
    default: break;
  }
  return c.error.empty();
}

// ---------------------------------------------------------------- applying (audio thread: no allocation)
template <class T> static T* give(Cmd& c) { T* p = static_cast<T*>(c.p); c.p = nullptr; c.del = nullptr; return p; }

void apply(Engine& e, Cmd& c) {
  const double* a = c.a;
  int t = toInt32(a[0]);
  switch (c.op) {
    case PLAY: e.play(); break;
    case STOP: e.stop(); break;
    case PANIC: e.panic(); break;
    case PLAYCOUNTIN: e.playCountIn(a[0]); break;
    case SEEK: e.seek(a[0]); break;
    case TEMPO: e.tempo(a[0]); break;
    case TEMPOMAP: e.tempoMap(a[0] != 0, give<TempoMap>(c)); break;
    case SETSIG: e.setSig(a[0], a[1], give<MeterMap>(c)); break;
    case SETMETER: e.setMeter(give<MeterMap>(c)); break;
    case LOOP: e.loop(a[0] != 0, a[1], a[2]); break;
    case SETMETRO: e.setMetro(a[0] != 0); break;
    case SETMETROVOL: e.setMetroVol(a[0]); break;
    case MASTERLIMIT: e.masterLimit(a[0] != 0); break;
    case SETPDC: e.setPdc(a[0] != 0); break;
    case TRACKLOAD: e.trackLoad(a[0] != 0); break;
    case TRACKVOL: e.trackVol(t, a[1]); break;
    case TRACKPAN: e.trackPan(t, a[1]); break;
    case TRACKWIDTH: e.trackWidth(t, a[1]); break;
    case TRACKINVERT: e.trackInvert(t, a[1]); break;
    case TRACKMUTE: e.trackMute(t, a[1] != 0); break;
    case TRACKSOLO: e.trackSolo(t, a[1] != 0); break;
    case TRACKSEND: { double k = a[1]; if (k == 0 || k == 1) e.trackSend(t, (int)k, a[2]); break; }
    case TRACKOUT: e.trackOut(t, a[1]); break;
    case TRACKINST: if (t >= 0 && t < MASTER) e.trackInst(t, give<Instrument>(c)); break;
    case INSTPARAM: e.instParam(t, toInt32(a[1]), a[2]); break;
    case RESETTRACK: e.resetTrack(t); break;
    case INSERTDEVICE: { Device* d = give<Device>(c); if (d) e.insertDevice(t, a[1], d); break; }
    case REMOVEDEVICE: e.removeDevice(t, toInt32(a[1])); break;
    case DEVPARAM: e.devParam(t, toInt32(a[1]), toInt32(a[2]), a[3]); break;
    case DEVBYPASS: e.devBypass(t, toInt32(a[1]), a[2] != 0); break;
    case SOUNDFONT: e.loadSoundFont(toInt32(a[0]), give<SoundFont>(c)); break;
    case RACKCMD: { Instrument* in = static_cast<Instrument*>(c.p2); c.p2 = nullptr; c.del2 = nullptr; e.rackCmd(t, a[1], toInt32(a[2]), a[3], a[4], a[5], a[6], give<Device>(c), in); break; }
    case PREVIEW: e.preview(t, (int)a[1], a[2], a[3] != 0); break;
    case BEND: e.bend(t, a[1]); break;
    case TRACKNOTES: e.trackNotes(t, give<NoteData>(c)); break;
    case TRACKCLIPS: e.trackClips(t, give<ClipData>(c)); break;
    case TRACKCC: e.trackCC(t, c.p ? give<CCData>(c) : nullptr); break;
    case AUTOMATION: e.automation(give<LaneData>(c)); break;
    case SAMPLE: e.loadSample(t, give<Sample>(c)); break;
    default: break;
  }
}

}  // namespace mdaw
