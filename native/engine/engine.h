// The audio engine: port of js/engine/core.js (the JS engine is the reference, see jsmath.h for the numeric rules).
// Threading: everything that allocates is built before it reaches the engine (NoteData, ClipData, ... and instruments / devices are
// constructed by commands.cpp on the UI / bridge thread). The Engine methods run on the audio thread and only swap pointers; whatever
// they replace goes to the retire queue and is deleted later on a non-audio thread. render() never allocates, never locks.
#pragma once
#include <array>
#include <cstring>
#include <atomic>
#include <cstdint>
#include <vector>
#include "jsmath.h"
#include "meter.h"
#include "tmap.h"
#include "units.h"
#include "pdc.h"

namespace mdaw {

constexpr int PPQ = 960, MAX_TRACKS = 64, MASTER = 64, RET0 = 65, NFX = 8, NSTRIPS = RET0 + NFX, MAX_DEV = 16;
constexpr double TAIL_SECONDS = 2;
constexpr int RACK_MAX_REMOVED = 8 * 16 + 1;


struct NoteData {                     // trackNotes: events sorted (offs before ons) + note list for catch-up
  int n = 0;
  std::vector<double> tick; std::vector<uint8_t> p; std::vector<float> v; std::vector<uint8_t> on; std::vector<float> pan;
  std::vector<std::array<double, 5>> notes;   // [start, end, pitch, vel, pan]
};
struct Clip { double start, len; int sample; double gain, offset, fadeIn, fadeOut; };
struct ClipData { std::vector<Clip> c; };
struct CCLane { std::vector<double> t, v; };
struct CCData { CCLane* lane[4] = {}; ~CCData() { for (auto* l : lane) delete l; } };
struct Lane { int kind, track, dev, param; std::vector<std::pair<double, double>> pts; double last; };
struct LaneData { std::vector<Lane> lanes; };

// Single-producer (audio thread) / single-consumer (UI thread) queue of objects to delete.
class Retire {
 public:
  struct Item { void* p; void (*del)(void*); };
  template <class T> void put(T* p) { if (p) push({ p, [](void* q) { delete static_cast<T*>(q); } }); }
  void drain();                       // call on a non-audio thread
  bool immediate = false;             // host / tests: delete right away
 private:
  void push(Item it);
  static constexpr int N = 4096;
  Item q[N];
  std::atomic<int> head{ 0 }, tail{ 0 };
};

struct PreEv { int p; double v; bool on; };

struct Strip {
  Instrument* inst = nullptr;
  NoteData* ev = nullptr;             // JS s.ev (null when there are no events) + s.notes
  ClipData* clips = nullptr;
  Device* dev[MAX_DEV] = {}; int ndev = 0;
  double vol = 0.85, pan = 0, gl = 0, gr = 0, send[2] = { 0, 0 }; int out = -1; bool mute = false, solo = false;
  double mg = 1, sg0 = 0, sg1 = 0;   // core.js: mute / solo fade, smoothed send levels
  double silent = 0; bool wasAudible = true; double pitch = 0, bend = 0;
  CCData* ccl = nullptr; double ccG = 1, ccP = 0;
  uint8_t tpMap[128]; bool active = false;
  PreEv pre[64]; int npre = 0;
  float bufL[BLOCK], bufR[BLOCK];
  double peakL = 0, peakR = 0;
  int32_t sevT[512]; uint8_t sevP[512]; float sevV[512]; uint8_t sevOn[512]; float sevPn[512];
  double nPan = 0;
  int lat = 0, pd = 0; PdcLine pdl;   // PDC: chain latency, compensation delay, its ring (storage owned by the engine)
  void init(double v);
};

class Engine {
 public:
  explicit Engine(double sr = 48000);
  ~Engine();
  Retire retire;
  Bank bank;
  double sr;
  float sc[NSTRIPS] = {};
  Strip s[NSTRIPS];
  bool playing = false, catchUp = false; double pos = 0, bpm = 120; bool loopOn = false; double loopS = 0, loopE = PPQ * 4;
  TempoMap* tm; bool tmOn = false; double curBpm = 120, beatT = PPQ, barBeats = 4; MeterMap* mm; double cinN = 4;
  bool metro = false; double metroVol = 1, clickIdx = 1e9, clickOff = 0, clickF = 1000;
  double cin = 0, cinBf = 0, cinNext = 0, cinPos = 0, cinBeat = 0;
  float mixL[BLOCK], mixR[BLOCK], scrL[BLOCK], scrR[BLOCK], zL[BLOCK], zR[BLOCK]; bool noDirect = false;
  float retL[NFX][BLOCK], retR[NFX][BLOCK]; bool retActive[NFX] = {};
  LaneData* lanes = nullptr;
  double tailFrames;
  bool tl = false;
  Device* lim = nullptr; bool limOn = true; double mgK = 0;   // core.js: master safety limiter (the Limiter device) at the output stage
  bool pdcOn = true; int pdcMt = 0, pdcMr = 0, pdcClk = 0, pdcOut = 0; double ck[BLOCK] = {}; ClickLine ckl;   // core.js PDC
  float* pdcMem = nullptr; double* ckMem = nullptr;
  // set by the owner to see engine faults (instrument / device switched off): kind 0 = engine, 1 = instrument, 2 = device
  void (*onError)(void* ctx, int kind, int strip, int dev, const char* msg) = nullptr; void* errCtx = nullptr;

  // ---- commands (audio thread; prepared objects are taken over)
  void play();
  void stop();
  void playCountIn(double beats);
  void seek(double tick);
  void tempo(double b);
  void tempoMap(bool on, TempoMap* prepared);
  void setSig(double beatT, double beats, MeterMap* prepared);
  void setMeter(MeterMap* prepared);
  void loop(bool on, double s0, double e0) { loopOn = on; loopS = s0; loopE = e0; }
  void setMetro(bool on) { metro = on; }
  void setMetroVol(double v);
  void masterLimit(bool on) { limOn = on; }
  void setPdc(bool on) { pdcOn = on; }
  void pdcPlan();
  int pdcLatency() { pdcPlan(); return pdcOut; }
  void trackLoad(bool on) { tl = on; }
  void trackVol(int t, double v) { if (ok(t)) s[t].vol = jsMax(0, v); }
  void trackPan(int t, double v) { if (ok(t)) s[t].pan = clamp(v, -1, 1); }
  void trackMute(int t, bool m) { if (ok(t)) s[t].mute = m; }
  void trackSolo(int t, bool m) { if (ok(t)) s[t].solo = m; }
  void trackSend(int t, int k, double v) { if (ok(t) && t < MASTER && (k == 0 || k == 1)) s[t].send[k] = clamp(v, 0, 1.5); }
  void trackOut(int t, double k);
  void trackInst(int t, Instrument* prepared);
  void setPitch(int t, double v);
  void instParam(int t, int i, double v);
  void resetTrack(int t);
  void insertDevice(int t, double index, Device* prepared);
  void removeDevice(int t, int i);
  void devParam(int t, int d, int p, double v) { if (ok(t) && d >= 0 && d < s[t].ndev) s[t].dev[d]->setParam(p, v); }
  void rackCmd(int t, double d, int op, double c, double j, double a, double b, Device* prepared);
  void devBypass(int t, int d, bool b) { if (ok(t) && d >= 0 && d < s[t].ndev) s[t].dev[d]->bypass = b; }
  void bend(int t, double st);
  void preview(int t, int pitch, double vel, bool on);
  void trackNotes(int t, NoteData* prepared);
  void trackCC(int t, CCData* prepared);
  void trackClips(int t, ClipData* prepared);
  void automation(LaneData* prepared);
  void loadSample(int id, Sample* prepared);
  void loadSoundFont(int id, SoundFont* prepared);
  void panic();

  // ---- read-outs
  void fillMeters(int32_t* m) const;   // 2 * NSTRIPS peaks * 1000
  void fillLoad(int32_t* out) const;    // 2 * MAX_TRACKS: voices, load per mille (load not measured here: 0)
  double tickPos() const { return f2t(pos); }
  int devOut(int t, int d, float* out) {
    if (d >= 1000 && d < 2000 && ok(t)) { int q = d - 1000, r = q >> 8; Device* x = r < s[t].ndev && s[t].dev[r]->isRack ? s[t].dev[r]->sub((q >> 4) & 15, q & 15) : nullptr; return x ? x->readOut(out) : 0; }   // a device inside a rack
    return ok(t) && d >= 0 && d < s[t].ndev ? s[t].dev[d]->readOut(out) : 0;
  }

  // ---- rendering
  void render(float* oL, float* oR, int frames);

  double t2f(double tk) const { return tmOn ? tm->tickToSec(tk) * sr : tk * sr * 60 / (bpm * PPQ); }
  double f2t(double f) const { return tmOn ? tm->secToTick(f / sr) : f * bpm * PPQ / (sr * 60); }

 private:
  bool ok(int t) const { return t >= 0 && t < NSTRIPS; }
  void err(int kind, int strip, int dev, const char* msg) { if (onError) onError(errCtx, kind, strip, dev, msg); }
  void devTempo(double b);
  void ccReset(Strip& st, int t);
  static double ccAt(const CCLane& l, double tick);
  void applyCC(Strip& st, int idx, double tick);
  void bendNew(Strip& st);
  void runDev(int strip, int di, Device* d, float* L, float* R, int n);
  void runChain(Strip& st, int strip, float* L, float* R, int n);
  bool midiFx = false;                // core.js midiScan: some device listens to notes (Spectral Resonator in MIDI mode)
  void midiScan();
  void midiTo(int src, int p, double v);
  void applyMod(Device* m);
  void runMods(Strip& st, int n);
  static int chainLat(const Strip& st) { int l = 0; for (int i = 0; i < st.ndev; i++) if (!st.dev[i]->bypass) l += st.dev[i]->lat(); return l; }
  double spt() const { return sr * 60 / (bpm * PPQ); }
  static void balance(float* L, float* R, int a, int b, double pan);
  void cinChunk(int n);
  void applyAuto(double tick);
  void chunk(int n, double spt);
  void track(Strip& st, int idx, double pos, int n, double spt, bool anySolo);
  void ret(int k, int n);
  void click(int n, double pos, double spt);
  void clearStrip(Strip& st);
};

}  // namespace mdaw
