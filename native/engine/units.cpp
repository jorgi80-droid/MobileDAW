// Registry of ported instruments and effects. Grows one entry at a time as ports pass their golden tests.
#include "units.h"
#include "instruments.h"
#include "inst_live.h"

namespace mdaw {

Instrument* makeInstrument(int type, double sr, Bank* bank) {
  switch (type) {
    case 1: return new MiniSynth(sr);
    case 2: return new SuperSaw(sr);
    case 19: return new DsKick(sr); case 20: return new DsSnare(sr); case 21: return new DsTom(sr);
    case 22: return new DsHH(sr); case 23: return new DsClap(sr); case 24: return new DsFm(sr);
    case 25: return new Electric(sr); case 26: return new Tension(sr); case 27: return new Collision(sr);
    case 28: return new Impulse(sr, bank); case 29: return new Granulator(sr, bank);
    default: return nullptr;
  }
}
Device* makeDevice(int type, double sr, float* sidechain) { (void)type; (void)sr; (void)sidechain; return nullptr; }
bool instPorted(int type) { return type == 1 || type == 2 || (type >= 19 && type <= 29); }
bool devPorted(int type) { (void)type; return false; }

}  // namespace mdaw
