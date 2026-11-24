// FL Studio Mobile effect modules on Honeydew's model (https://github.com/daijro/honeydew, crates/audio/src/lib.rs, reverbs.rs,
// biquad.rs, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md), ported by hand to C++ (no JS twin: C++ only, native and WebAssembly).
// One device per FLM module type: device type = HDFX_BASE + FLM module id. Parameters are FLM's own normalized values (0..1, the
// numbers an .flm stores), index 0 = Enable; after them the rack's common parameters Post Gain, Mix and Wet Pan (CommonModule).
// f32 arithmetic as the Rust original.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "units.h"
#include <vector>
#include <cstdint>

namespace mdaw {

constexpr int HDFX_BASE = 100;
int hdfxParamCount(int flmId);          // the module's own parameter count (Enable included); 0 = not ported
Device* makeHdFx(int flmId, double sr);

}  // namespace mdaw
