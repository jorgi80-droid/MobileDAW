// WebAssembly host of the C++ engine: the same engine the Android app runs (native/engine), compiled with clang + wasi-libc into one
// standalone module (js/engine/mdaw.wasm) that the web AudioWorklet instantiates (js/engine/worklet-wasm.js). Single thread: commands are
// parsed, prepared and applied where they arrive (the worklet), retired objects are deleted right away.
//   mdaw_init(sr)                     create the engine
//   mdaw_text(n) / mdaw_blob(n)       buffers for a command text (bytes) and its float32 side data (frames); pointers stay valid until the next call
//   mdaw_cmd(textLen, blobLen)        run the lines in the text buffer ("@offset:length" arguments read the blob); returns the number of errors
//   mdaw_errors()                     the error text of the last mdaw_cmd (0-terminated)
//   mdaw_render(n)                    render n <= 128 frames; mdaw_out(0 / 1) = left / right
//   mdaw_poll()                       doubles: pos, playing, count-in, PDC latency, then 2 x NSTRIPS meters (x 1000)
//   mdaw_devout(strip, dev)           device read-out into mdaw_dev(); returns its length
//   mdaw_load()                       int32 voices / load per track (2 x MAX_TRACKS)
//   mdaw_supported(textLen)           1 when every instrument / device of the line in the text buffer is available
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include "../engine/commands.h"

using namespace mdaw;
#define EXPORT(name) __attribute__((export_name(#name)))

namespace {
Engine* eng = nullptr;
std::vector<char> text; std::vector<float> blob; std::string errors;
float outL[BLOCK], outR[BLOCK], dev[8192];
double poll[4 + NSTRIPS * 2]; int32_t meters[NSTRIPS * 2], load[128];
}  // namespace

extern "C" {
EXPORT(mdaw_init) void mdaw_init(double sr) { delete eng; eng = new Engine(sr); eng->retire.immediate = true; }
EXPORT(mdaw_text) char* mdaw_text(int n) { text.assign((size_t)n + 1, 0); return text.data(); }
EXPORT(mdaw_blob) float* mdaw_blob(int n) { blob.assign((size_t)n, 0.f); return blob.data(); }
EXPORT(mdaw_cmd) int mdaw_cmd(int textLen, int blobLen) {
  errors.clear();
  if (!eng) return 0;
  int bad = 0; const char* p = text.data(); const char* end = p + textLen;
  std::string name; std::vector<Arg> args;
  while (p < end) {
    const char* nl = (const char*)std::memchr(p, '\n', end - p); if (!nl) nl = end;
    std::string line(p, nl - p); p = nl + 1;
    if (line.empty()) continue;
    if (!parseLine(line, name, args, blob.data(), (size_t)blobLen)) { errors += "parse: " + line.substr(0, 60) + "\n"; bad++; continue; }
    Cmd c;
    if (!prepare(name, args, *eng, c) && c.op < 0) { errors += c.error + "\n"; bad++; continue; }
    if (!c.error.empty()) { errors += c.error + "\n"; bad++; }
    apply(*eng, c);
  }
  eng->retire.drain();
  return bad;
}
EXPORT(mdaw_errors) const char* mdaw_errors() { return errors.c_str(); }
EXPORT(mdaw_render) void mdaw_render(int n) { if (n > BLOCK) n = BLOCK; if (eng) eng->render(outL, outR, n); else { std::memset(outL, 0, sizeof outL); std::memset(outR, 0, sizeof outR); } }
EXPORT(mdaw_out) float* mdaw_out(int ch) { return ch ? outR : outL; }
EXPORT(mdaw_poll) double* mdaw_poll() {
  if (!eng) return poll;
  poll[0] = eng->tickPos(); poll[1] = eng->playing ? 1 : 0; poll[2] = eng->cin > 0 ? 1 : 0; poll[3] = eng->pdcOut;
  eng->fillMeters(meters); for (int i = 0; i < NSTRIPS * 2; i++) poll[4 + i] = meters[i];
  return poll;
}
EXPORT(mdaw_devout) int mdaw_devout(int t, int d) { return eng ? eng->devOut(t, d, dev) : 0; }
EXPORT(mdaw_dev) float* mdaw_dev() { return dev; }
EXPORT(mdaw_load) int32_t* mdaw_load() { if (eng) eng->fillLoad(load); return load; }
EXPORT(mdaw_panic) void mdaw_panic() { if (eng) eng->panic(); }
EXPORT(mdaw_pdc_latency) int mdaw_pdc_latency() { return eng ? eng->pdcLatency() : 0; }
EXPORT(mdaw_supported) int mdaw_supported(int textLen) { std::string name; std::vector<Arg> args; if (!parseLine(std::string(text.data(), textLen), name, args, nullptr, 0)) return 0; return supported(name, args) ? 1 : 0; }
}

// libc++'s operator new wants to throw std::bad_alloc; this build has no exceptions: out of memory ends the module (the worklet reports it)
#include <cstdlib>
extern "C" {
void* __cxa_allocate_exception(unsigned long) { std::abort(); }
void __cxa_throw(void*, void*, void (*)(void*)) { std::abort(); }
}
