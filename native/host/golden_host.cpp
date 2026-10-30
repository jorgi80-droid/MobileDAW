// Desktop host of the C++ engine for golden tests: replays a command file recorded from the JS engine (tools/golden/golden.mjs)
// and writes the rendered audio as interleaved float32. Same engine code as the Android library, no Android needed.
//   golden_host <cmds.txt> <blob.f32> <out.f32> [--lenient]   (--lenient: like the Android bridge, unsupported units are skipped, not fatal)
// cmds.txt: first line "sr <rate>", then one engine command per line (see engine/commands.h), "render <frames>" renders, "# ..." is a comment.
// Exit code 3 = the scenario uses an instrument / effect that is not ported yet (the comparison is skipped, not failed).
#include <cstdio>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include "../engine/commands.h"

using namespace mdaw;

int main(int argc, char** argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: golden_host cmds.txt blob.f32 out.f32\n"); return 2; }
  std::ifstream in(argv[1]);
  if (!in) { std::fprintf(stderr, "cannot read %s\n", argv[1]); return 2; }
  std::vector<float> blob;
  if (FILE* f = std::fopen(argv[2], "rb")) {
    std::fseek(f, 0, SEEK_END); long sz = std::ftell(f); std::fseek(f, 0, SEEK_SET);
    blob.resize(sz / 4); if (sz >= 4 && std::fread(blob.data(), 4, blob.size(), f) != blob.size()) { std::fprintf(stderr, "short blob\n"); return 2; }
    std::fclose(f);
  }
  bool lenient = argc > 4 && std::string(argv[4]) == "--lenient";
  std::string line, name; std::vector<Arg> args;
  double sr = 48000;
  if (std::getline(in, line) && line.rfind("sr ", 0) == 0) sr = std::stod(line.substr(3));
  Engine e(sr); e.retire.immediate = true;
  FILE* out = std::fopen(argv[3], "wb");
  if (!out) { std::fprintf(stderr, "cannot write %s\n", argv[3]); return 2; }
  std::vector<float> L, R, I;
  int lineNo = 1;
  while (std::getline(in, line)) {
    lineNo++;
    if (line.empty() || line[0] == '#') continue;
    if (line.rfind("render ", 0) == 0) {
      int n = std::stoi(line.substr(7));
      L.assign(n, 0); R.assign(n, 0); I.resize((size_t)n * 2);
      e.render(L.data(), R.data(), n);
      for (int i = 0; i < n; i++) { I[i * 2] = L[i]; I[i * 2 + 1] = R[i]; }
      std::fwrite(I.data(), 4, I.size(), out);
      continue;
    }
    if (!parseLine(line, name, args, blob.data(), blob.size())) { std::fprintf(stderr, "line %d: cannot parse: %.80s\n", lineNo, line.c_str()); return 2; }
    Cmd c;
    if (!prepare(name, args, e, c)) {
      if (c.error.rfind("unsupported", 0) == 0 && lenient && c.op >= 0) { apply(e, c); continue; }
      if (c.error.rfind("unsupported", 0) == 0) { std::printf("UNSUPPORTED %s\n", c.error.c_str()); std::fclose(out); return 3; }
      std::fprintf(stderr, "line %d: %s\n", lineNo, c.error.c_str()); return 2;
    }
    apply(e, c);
  }
  std::fclose(out);
  return 0;
}
