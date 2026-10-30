// Engine commands as text: one line per command, the same names and arguments the AudioWorklet receives ({ c, a } in js/engine/worklet.js).
//   line   = name arg*
//   arg    = number (JS shortest form, also nan / inf / -inf) | u (null / undefined) | [count v v ...] (array) | @offset:length (float32 data in a side buffer)
// prepare() parses a line and builds everything that allocates (note lists, instruments, devices, samples) - call it on a non-audio thread.
// apply() hands the result to the engine without allocating - call it on the audio thread (or right away in the host / tests).
#pragma once
#include <string>
#include <vector>
#include "engine.h"

namespace mdaw {

struct Arg {
  enum Kind { Num, Undef, Arr, F32 } kind = Undef;
  double num = 0;
  std::vector<double> arr;
  const float* f32 = nullptr; int len = 0;
  double n() const { return kind == Num ? num : NAN; }   // JS: undefined -> NaN in arithmetic
  bool truthy() const { return kind == Num ? (num == num && num != 0) : kind != Undef; }   // !!x
};

struct Cmd {
  int op = -1;
  double a[4] = { 0, 0, 0, 0 };
  void* p = nullptr;                  // prepared object (taken over by apply; deleted if the command is dropped)
  void (*del)(void*) = nullptr;
  std::string error;                  // set when the command cannot run here (e.g. "unsupported inst 7")
  ~Cmd() { if (p && del) del(p); }
};

bool parseLine(const std::string& line, std::string& name, std::vector<Arg>& args, const float* blob, size_t blobLen);
// eng is only read (sample rate, bank / sidechain pointers): safe to call while the audio thread renders
bool prepare(const std::string& name, const std::vector<Arg>& args, const Engine& eng, Cmd& out);
void apply(Engine& e, Cmd& c);
// true when every instrument / device type in the line is ported (used to decide Web vs Native for a project)
bool supported(const std::string& name, const std::vector<Arg>& args);

}  // namespace mdaw
