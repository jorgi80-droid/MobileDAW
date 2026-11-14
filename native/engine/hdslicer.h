// FL Studio Mobile Slicer (MobileDAW instrument 35, FLM module 33): one loop cut into slices at its transients; slice k plays on key first + k.
// Port of Honeydew crates/audio/src/slicer.rs (https://github.com/daijro/honeydew, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md), C++ only.
// Params 0..6 are FLM's normalized values (0 Enable, 1 Pitch, 3 Attack, 4 Decay, 5 Sustain, 6 Mono); 7 = Sensitivity (FLM's CSTM SENS, 0 = the
// file's cue markers, none here); 8 = the first key (0 = FLM's default 48); 100 = the loop (bank sample id: zone 0 of project.js).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "units.h"
#include <vector>
#include <cstddef>

namespace mdaw {

struct Bank;
Instrument* makeSlicer(double sr, Bank* bank);
// slicer.rs detect(): the slice starts of a loop (left channel, normalised to the peak of both), at `sensitivity` (> 0)
std::vector<size_t> slicerDetect(const float* left, const float* right, size_t frames, float sensitivity);

}  // namespace mdaw
