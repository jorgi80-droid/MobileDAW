// FL Studio Mobile note effects (Note Echo 47, Transpose 48, Randomizer 49, Scale 50, Arpeggiator 51): a track's notes in, the notes its
// instrument plays out, worked out ahead of playback (when the notes reach the engine, off the audio thread), as Honeydew does it. Port of
// Honeydew crates/audio/src/note_effects.rs (NoteEffectRack::process_events) and sequencer.rs (Arpeggiator)
// (https://github.com/daijro/honeydew, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md). C++ only (native and WebAssembly).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include <vector>
#include <cstdint>

namespace mdaw {

struct NfxModule { int type = 0; int32_t instance = 0; std::vector<float> p; };    // FLM type id, instance id (random seeds), normalized params
// start / end in beats; velocity 1..255 (0 = a note-off alone), pan 0..1 (FLM's: 127/255 is the centre)
struct NfxNote { double start = 0, end = 0; int pitch = 0; int velocity = 0; float pan = 0.5f; };

// Runs `notes` (in their order: notes on one beat keep it) through `mods`. Returns false and leaves `notes` as they came when Honeydew
// would refuse them (invalid values, too many notes). barBeats = the bar of the Arpeggiator's bar retrigger; sampleRate / block = the
// frame grid of Note Echo's timing.
bool nfxProcess(const std::vector<NfxModule>& mods, double startBeat, double endBeat, double tempo, double barBeats, double sampleRate,
                uint64_t block, std::vector<NfxNote>& notes);
int nfxParamCount(int type);   // 0: not a note effect

}  // namespace mdaw
