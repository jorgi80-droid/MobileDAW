// Android host of the C++ engine: Oboe output stream + JNI for NativeEnginePlugin.java.
// Threads: the bridge thread (plugin calls) parses and prepares commands (allocation allowed) and pushes them into a lock-free queue;
// the Oboe audio thread applies them and renders - no allocation, no locks, no logging there. Deleting happens on the bridge / poll
// thread (retire queues). Denormals are flushed on the audio thread; a NaN / runaway block is muted like js/engine/worklet.js v73 does.
#include <android/log.h>
#include <jni.h>
#include <oboe/Oboe.h>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "commands.h"

using namespace mdaw;
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "MobileDAW", __VA_ARGS__)

namespace {

// ---- single producer / single consumer ring of pointers
template <class T, int N>
class Spsc {
 public:
  bool push(T v) { int h = head.load(std::memory_order_relaxed), nx = (h + 1) % N; if (nx == tail.load(std::memory_order_acquire)) return false; buf[h] = v; head.store(nx, std::memory_order_release); return true; }
  bool pop(T& v) { int t = tail.load(std::memory_order_relaxed); if (t == head.load(std::memory_order_acquire)) return false; v = buf[t]; tail.store((t + 1) % N, std::memory_order_release); return true; }
 private:
  T buf[N]; std::atomic<int> head{ 0 }, tail{ 0 };
};

void flushDenormals() {
#if defined(__aarch64__)
  uint64_t fpcr; asm volatile("mrs %0, fpcr" : "=r"(fpcr)); asm volatile("msr fpcr, %0" ::"r"(fpcr | (1ULL << 24)));   // FZ
#elif defined(__arm__)
  uint32_t fpscr; asm volatile("vmrs %0, fpscr" : "=r"(fpscr)); asm volatile("vmsr fpscr, %0" ::"r"(fpscr | (1U << 24)));
#elif defined(__x86_64__) || defined(__i386__)
  uint32_t csr; asm volatile("stmxcsr %0" : "=m"(csr)); csr |= 0x8040; asm volatile("ldmxcsr %0" ::"m"(csr));   // FTZ + DAZ
#endif
}

std::mutex hostLock;                   // serialises plugin calls and stream open / close (never taken by the audio thread)

constexpr int NSNAP = 7 + NSTRIPS * 2;   // pos, playing, cin, cpu (per mille), xruns, bad blocks, meters, PDC output latency (frames)
constexpr int HBUCKETS = 400;            // block cost histogram in 0.5 % steps of the block budget (0..200 %)

class Host : public oboe::AudioStreamDataCallback, public oboe::AudioStreamErrorCallback {
 public:
  explicit Host(double sr) : eng(sr), rate(sr) { eng.onError = &Host::onEngineError; eng.errCtx = this; }
  Engine eng;
  double rate;
  Spsc<Cmd*, 8192> cmds;               // bridge -> audio
  Spsc<Cmd*, 8192> spent;              // audio -> bridge (deleted there)
  std::shared_ptr<oboe::AudioStream> stream;
  std::unique_ptr<oboe::LatencyTuner> tuner;   // starts at the smallest buffer and grows it only when underruns happen
  std::atomic<bool> wantActive{ false };
  std::mutex streamLock;               // open / close only (never taken by the audio thread)

  // snapshots written by the audio thread ~30 times per second
  double snap[2][NSNAP] = {}; std::atomic<int> snapIdx{ 0 }; int snapFrames = 0;
  // statistics (audio thread writes, readers tolerate a slightly stale view)
  std::atomic<uint64_t> blocks{ 0 }; std::atomic<uint64_t> hist[HBUCKETS] = {}; double sumCost = 0, maxCost = 0; std::atomic<int64_t> badBlocks{ 0 };
  double cpuWin = 0, cpuBusy = 0, cpuNow = 0; int bad = 0; bool ftz = false;
  // engine errors: a tiny ring of codes (kind, strip, dev), messages are fixed strings
  Spsc<int64_t, 64> errs;

  static void onEngineError(void* ctx, int kind, int strip, int dev, const char*) {
    auto* h = static_cast<Host*>(ctx); h->errs.push(((int64_t)kind << 32) | ((int64_t)(strip & 0xffff) << 16) | (dev & 0xffff));
  }

  oboe::DataCallbackResult onAudioReady(oboe::AudioStream* s, void* data, int32_t frames) override {
    if (!ftz) { flushDenormals(); ftz = true; }
    if (tuner) tuner->tune();
    auto t0 = std::chrono::steady_clock::now();
    Cmd* c;
    while (cmds.pop(c)) { apply(eng, *c); if (!spent.push(c)) { /* full: leak instead of freeing here */ } }
    float* out = static_cast<float*>(data);
    int done = 0;
    while (done < frames) {
      int n = frames - done < 512 ? frames - done : 512;
      eng.render(L, R, n);
      bool ok = true;
      for (int i = 0; i < n; i++) { float v = L[i] + R[i]; if (!(v > -64 && v < 64)) { ok = false; break; } }
      if (!ok) { std::memset(L, 0, sizeof(float) * n); std::memset(R, 0, sizeof(float) * n); badBlocks++; if (++bad >= 3) { bad = 0; eng.panic(); } } else bad = 0;
      for (int i = 0; i < n; i++) { out[(done + i) * 2] = L[i]; out[(done + i) * 2 + 1] = R[i]; }
      done += n;
    }
    double cost = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count(), budget = frames / rate;
    double share = cost / budget;
    int b = (int)(share * 200); if (b >= HBUCKETS) b = HBUCKETS - 1; if (b < 0) b = 0;
    hist[b].fetch_add(1, std::memory_order_relaxed); blocks.fetch_add(1, std::memory_order_relaxed); sumCost += share; if (share > maxCost) maxCost = share;
    cpuBusy += cost; cpuWin += budget; if (cpuWin >= 0.5) { cpuNow = cpuBusy / cpuWin; cpuBusy = 0; cpuWin = 0; }
    snapFrames += frames;
    if (snapFrames >= rate / 30) {
      snapFrames = 0;
      int w = snapIdx.load(std::memory_order_relaxed) ^ 1; double* o = snap[w];
      o[0] = eng.tickPos(); o[1] = eng.playing ? 1 : 0; o[2] = eng.cin > 0 ? 1 : 0; o[3] = std::round(std::fmin(1.5, cpuNow) * 1000);
      o[4] = s->getXRunCount().value(); o[5] = (double)badBlocks.load();
      int32_t m[NSTRIPS * 2]; eng.fillMeters(m); for (int i = 0; i < NSTRIPS * 2; i++) o[6 + i] = m[i];
      o[6 + NSTRIPS * 2] = eng.pdcOut;
      snapIdx.store(w, std::memory_order_release);
    }
    return oboe::DataCallbackResult::Continue;
  }

  void onErrorAfterClose(oboe::AudioStream*, oboe::Result r) override {   // device change (headphones, BT): reopen on this (non-audio) thread
    LOGI("stream closed: %s", oboe::convertToText(r));
    std::lock_guard<std::mutex> g(hostLock);
    running = false;
    if (wantActive.load()) running = open();
  }
  bool running = false;                // the audio callback may run (stream started); changed only under hostLock
  // Commands while no stream runs: nobody drains the queue, so they are applied right here (no audio thread exists then).
  void submit(Cmd* c) {
    if (!running) { drainQueue(); apply(eng, *c); delete c; eng.retire.drain(); return; }
    while (!cmds.push(c)) { collect(); std::this_thread::yield(); }
  }
  void drainQueue() { Cmd* c; while (cmds.pop(c)) { apply(eng, *c); delete c; } collect(); }

  bool open() {                        // caller holds hostLock
    std::lock_guard<std::mutex> g(streamLock);
    if (stream) { stream->close(); stream.reset(); }
    tuner.reset();
    oboe::AudioStreamBuilder b;
    b.setDirection(oboe::Direction::Output)->setPerformanceMode(oboe::PerformanceMode::LowLatency)->setSharingMode(oboe::SharingMode::Exclusive)
      ->setFormat(oboe::AudioFormat::Float)->setChannelCount(2)->setSampleRate((int)rate)->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium)
      ->setUsage(oboe::Usage::Media)->setContentType(oboe::ContentType::Music)->setDataCallback(this)->setErrorCallback(this);
    oboe::Result r = b.openStream(stream);
    if (r != oboe::Result::OK) { LOGI("openStream failed: %s", oboe::convertToText(r)); stream.reset(); return false; }
    tuner = std::make_unique<oboe::LatencyTuner>(*stream);           // created before the stream starts: the callback only reads it
    r = stream->requestStart();
    if (r != oboe::Result::OK) { LOGI("requestStart failed: %s", oboe::convertToText(r)); return false; }
    LOGI("stream: %d Hz, burst %d, buffer %d, exclusive %d", stream->getSampleRate(), stream->getFramesPerBurst(), stream->getBufferSizeInFrames(), stream->getSharingMode() == oboe::SharingMode::Exclusive);
    return true;
  }
  void close() { std::lock_guard<std::mutex> g(streamLock); if (stream) { stream->stop(); stream->close(); stream.reset(); } tuner.reset(); }

  void collect() {                     // bridge / poll thread: free what the audio thread is done with
    Cmd* c; while (spent.pop(c)) delete c;
    eng.retire.drain();
  }

  float L[512], R[512];
};

Host* host = nullptr;
std::map<int, std::pair<std::vector<float>, std::vector<float>>> pendingSamples;

std::string str(JNIEnv* env, jstring s) { const char* c = env->GetStringUTFChars(s, nullptr); std::string r(c); env->ReleaseStringUTFChars(s, c); return r; }

}  // namespace

extern "C" {

// -> "sr,instTypes...;devTypes..." of the ported units
JNIEXPORT jstring JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nStart(JNIEnv* env, jclass, jint sr) {
  std::lock_guard<std::mutex> g(hostLock);
  if (!host || host->rate != sr) { if (host) { host->close(); host->collect(); delete host; } host = new Host(sr); }
  std::string out = std::to_string(sr) + ";";
  for (int t = 0; t < 32; t++) if (instPorted(t)) out += std::to_string(t) + ",";
  out += ";";
  for (int t = 0; t < 64; t++) if (devPorted(t)) out += std::to_string(t) + ",";
  return env->NewStringUTF(out.c_str());
}

// newline-separated commands; returns "" or the errors (one per line)
JNIEXPORT jstring JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nCmd(JNIEnv* env, jclass, jstring text) {
  std::lock_guard<std::mutex> g(hostLock);
  if (!host) return env->NewStringUTF("not started");
  host->collect();
  std::string all = str(env, text), errs, name; std::vector<Arg> args;
  size_t p = 0;
  while (p < all.size()) {
    size_t e = all.find('\n', p); if (e == std::string::npos) e = all.size();
    std::string line = all.substr(p, e - p); p = e + 1;
    if (line.empty()) continue;
    if (!parseLine(line, name, args, nullptr, 0)) { errs += "parse: " + line.substr(0, 60) + "\n"; continue; }
    Cmd* c = new Cmd();
    if (!prepare(name, args, host->eng, *c) && c->op < 0) { errs += c->error + "\n"; delete c; continue; }
    if (!c->error.empty()) errs += c->error + "\n";      // e.g. unsupported instrument: still applied (the track gets no instrument)
    host->submit(c);
  }
  return env->NewStringUTF(errs.c_str());
}

JNIEXPORT void JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nSampleBegin(JNIEnv*, jclass, jint id, jint frames, jboolean stereo) {
  std::lock_guard<std::mutex> g(hostLock);
  auto& s = pendingSamples[id]; s.first.assign(frames, 0.f); s.second.assign(stereo ? frames : 0, 0.f);
}
// little-endian float32 bytes for channel ch starting at frame `at`
JNIEXPORT void JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nSampleData(JNIEnv* env, jclass, jint id, jint ch, jint at, jbyteArray bytes) {
  std::lock_guard<std::mutex> g(hostLock);
  auto it = pendingSamples.find(id); if (it == pendingSamples.end()) return;
  auto& v = ch ? it->second.second : it->second.first;
  jsize n = env->GetArrayLength(bytes) / 4;
  if (at < 0 || (size_t)at + n > v.size()) return;
  env->GetByteArrayRegion(bytes, 0, n * 4, reinterpret_cast<jbyte*>(v.data() + at));
}
JNIEXPORT jboolean JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nSampleEnd(JNIEnv*, jclass, jint id) {
  std::lock_guard<std::mutex> g(hostLock);
  auto it = pendingSamples.find(id); if (it == pendingSamples.end() || !host) return false;
  if (id >= 1000 && id < 1008) { stageSoundFont(id - 1000, std::move(it->second.first)); pendingSamples.erase(it); return true; }   // SoundFont data: the `sf` command takes it
  std::vector<Arg> args(3);
  args[0].kind = Arg::Num; args[0].num = id;
  args[1].kind = Arg::F32; args[1].f32 = it->second.first.data(); args[1].len = (int)it->second.first.size();
  if (!it->second.second.empty()) { args[2].kind = Arg::F32; args[2].f32 = it->second.second.data(); args[2].len = (int)it->second.second.size(); }
  Cmd* c = new Cmd(); bool ok = prepare("sample", args, host->eng, *c);
  pendingSamples.erase(it);
  if (!ok) { delete c; return false; }
  host->submit(c);
  return true;
}

JNIEXPORT jboolean JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nActive(JNIEnv*, jclass, jboolean on) {
  std::lock_guard<std::mutex> g(hostLock);
  if (!host) return false;
  host->wantActive = on;
  if (on) { if (!host->running) host->running = host->open(); return host->running; }
  host->close(); host->running = false; host->drainQueue(); return true;
}

// snapshot: [pos, playing, cin, cpu, xruns, bad, meters..., pdc latency] -> out (NSNAP doubles). Returns false when not started.
JNIEXPORT jboolean JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nPoll(JNIEnv* env, jclass, jdoubleArray out) {
  std::lock_guard<std::mutex> g(hostLock);
  if (!host) return false;
  host->collect();
  const double* s = host->snap[host->snapIdx.load(std::memory_order_acquire)];
  env->SetDoubleArrayRegion(out, 0, NSNAP, s);
  return true;
}
// engine faults since the last call: "kind,strip,dev;..."
JNIEXPORT jstring JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nErrors(JNIEnv* env, jclass) {
  std::lock_guard<std::mutex> g(hostLock);
  std::string out; int64_t e;
  if (host) while (host->errs.pop(e)) out += std::to_string(e >> 32) + "," + std::to_string((e >> 16) & 0xffff) + "," + std::to_string((int16_t)(e & 0xffff)) + ";";
  return env->NewStringUTF(out.c_str());
}
// [blocks, mean %, p50 %, p99 %, max %, xruns, bad blocks, burst, buffer, sample rate, latency ms (-1 unknown)]
JNIEXPORT void JNICALL Java_com_mobiledaw_app_NativeEnginePlugin_nStats(JNIEnv* env, jclass, jdoubleArray out, jboolean reset) {
  std::lock_guard<std::mutex> g(hostLock);
  double o[11] = {}; for (auto& x : o) x = 0; o[10] = -1;
  if (host) {
    uint64_t n = host->blocks.load(); o[0] = (double)n;
    if (n) {
      o[1] = host->sumCost / n * 100; o[4] = host->maxCost * 100;
      uint64_t acc = 0; bool p50 = false;
      for (int b = 0; b < HBUCKETS; b++) { acc += host->hist[b].load(); if (!p50 && acc * 2 >= n) { o[2] = b * 0.5; p50 = true; } if (acc * 100 >= n * 99) { o[3] = b * 0.5; break; } }
    }
    o[6] = (double)host->badBlocks.load();
    std::lock_guard<std::mutex> sg(host->streamLock);
    if (host->stream) {
      o[5] = host->stream->getXRunCount().value(); o[7] = host->stream->getFramesPerBurst(); o[8] = host->stream->getBufferSizeInFrames(); o[9] = host->stream->getSampleRate();
      auto lat = host->stream->calculateLatencyMillis(); if (lat) o[10] = lat.value();
    }
    if (reset) { host->blocks = 0; for (auto& h : host->hist) h = 0; host->sumCost = 0; host->maxCost = 0; }
  }
  env->SetDoubleArrayRegion(out, 0, 11, o);
}

}  // extern "C"
