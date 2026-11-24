// Moisture (MobileDAW instrument 37): a wavetable synthesizer laid out like Serum 1 (Xfer Records), MobileDAW's own DSP.
// Parameters 0..298 are Serum 1's VST parameters in Serum's order and Serum's normalized 0..1 values (so a Serum .fxp preset's
// parameter block loads 1:1, js/serumfxp.js); 300.. are Moisture's own (wavetables, LFO shapes, voicing, the modulation routes).
// No Serum code, data or artwork is used; the laws that turn a normalized value into Hz / seconds / dB are MobileDAW's
// approximations of the published ranges (docs/HANDOFF.md). C++ only (web: the WebAssembly build of this file).
#pragma once
#include "units.h"

namespace mdaw {

constexpr int M2_PARAMS = 400;
// Moisture's own parameters (after Serum's 0..298)
constexpr int M2_TBL_A = 300, M2_TBL_B = 301, M2_SMP_A = 302, M2_SMP_B = 303, M2_NOISE = 304, M2_VOICES = 305, M2_MONO = 306, M2_LEGATO = 307;
constexpr int M2_LFO_SHAPE = 308, M2_LFO_SYNC = 316, M2_LFO_MODE = 324;            // 8 each: shape index, 1 = tempo sync, 0 trig / 1 env / 2 free
constexpr int M2_ROUTE = 332, M2_ROUTES = 32;                                     // 32 x (source, destination): 332 + 2k = source, 333 + 2k = destination (a parameter index)
constexpr int M2_BUILTIN_TABLES = 10;
Instrument* makeMoist2(double sr, Bank* bank);
const char* moist2TableName(int k);

}  // namespace mdaw
