// FL Studio Mobile 3x Osc (MobileDAW instrument 36, FLM module 39): three oscillators -> filter -> amp, per-voice envelopes and LFOs,
// Echo / Fat Mode and Arpeggio, all on FLM's control tick (D/384 beat). Port of Honeydew crates/audio/src/three_osc/*
// (https://github.com/daijro/honeydew, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md), C++ only. f32 arithmetic as the Rust original.
// Params 0..148 are FLM's normalized values in FLM's order (0 = Enable: off freezes the voices, on resumes them); 149 = D, the song's
// TDIV subdivision (0 = 4). The Custom shape plays silence (FLM's own before a WAV is loaded): its CSTM file is not read yet.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "units.h"

namespace mdaw {

constexpr int THREE_OSC_PARAMS = 149;
Instrument* makeThreeOsc(double sr);

}  // namespace mdaw
