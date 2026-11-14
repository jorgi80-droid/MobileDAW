// FL Studio Mobile Transistor Bass (MobileDAW instrument 34, FLM module 19): a monophonic acid bass. Port of Honeydew
// crates/audio/src/transistor_bass.rs (https://github.com/daijro/honeydew, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md), C++ only.
// Parameters are FLM's normalized values (0..1), FLM's order (0 = Enable). f32 arithmetic as the Rust original.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "units.h"

namespace mdaw {

Instrument* makeTransistorBass(double sr);

}  // namespace mdaw
