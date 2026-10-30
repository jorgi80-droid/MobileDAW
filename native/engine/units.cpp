// Registry of ported instruments and effects. Grows one entry at a time as ports pass their golden tests.
#include "units.h"
#include "instruments.h"

namespace mdaw {

Instrument* makeInstrument(int type, double sr, Bank* bank) {
  (void)bank;
  switch (type) {
    case 1: return new MiniSynth(sr);
    case 2: return new SuperSaw(sr);
    default: return nullptr;
  }
}
Device* makeDevice(int type, double sr, float* sidechain) { (void)type; (void)sr; (void)sidechain; return nullptr; }
bool instPorted(int type) { return type == 1 || type == 2; }
bool devPorted(int type) { (void)type; return false; }

}  // namespace mdaw
