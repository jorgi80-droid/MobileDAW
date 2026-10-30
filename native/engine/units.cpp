// Registry of ported instruments and effects. Grows one entry at a time as ports pass their golden tests.
#include "units.h"

namespace mdaw {

Instrument* makeInstrument(int type, double sr, Bank* bank) { (void)type; (void)sr; (void)bank; return nullptr; }
Device* makeDevice(int type, double sr, float* sidechain) { (void)type; (void)sr; (void)sidechain; return nullptr; }
bool instPorted(int type) { (void)type; return false; }
bool devPorted(int type) { (void)type; return false; }

}  // namespace mdaw
