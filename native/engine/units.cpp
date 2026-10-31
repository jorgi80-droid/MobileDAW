// Registry of ported instruments and effects. Grows one entry at a time as ports pass their golden tests.
#include "units.h"
#include "instruments.h"
#include "inst_live.h"
#include "poli.h"
#include "drift.h"
#include "operator.h"
#include "analog.h"
#include "meld.h"
#include "simpler.h"
#include "fx.h"
#include "fx2.h"
#include "fx4.h"

namespace mdaw {

Instrument* makeInstrument(int type, double sr, Bank* bank) {
  switch (type) {
    case 1: return new MiniSynth(sr);
    case 2: return new SuperSaw(sr);
    case 13: return new Drift(sr); case 14: return new Operator(sr); case 15: return new Analog(sr); case 17: return new Meld(sr); case 18: return new Simpler(sr, bank); case 16: return new Poli(sr);
    case 19: return new DsKick(sr); case 20: return new DsSnare(sr); case 21: return new DsTom(sr);
    case 22: return new DsHH(sr); case 23: return new DsClap(sr); case 24: return new DsFm(sr);
    case 25: return new Electric(sr); case 26: return new Tension(sr); case 27: return new Collision(sr);
    case 28: return new Impulse(sr, bank); case 29: return new Granulator(sr, bank);
    default: return nullptr;
  }
}
Device* makeDevice(int type, double sr, float* sidechain) {
  (void)sidechain;
  switch (type) {
    case 0: return new Utility(sr); case 1: return new AutoFilter(sr); case 6: return new Echo(sr); case 9: return new Roar(sr); case 2: return new Eq3(sr); case 3: return new Saturator(sr); case 4: return new Compressor(sr);
    case 5: return new Limiter(sr); case 7: return new Reverb(sr); case 8: return new ParametricEq(sr);
    case 17: return new Delay3(sr); case 18: return new FilterDelay(sr); case 19: return new BeatRepeat(sr); case 20: return new ChorusEnsemble(sr);
    case 21: return new PhaserFlanger(sr); case 22: return new AutoPan(sr); case 23: return new Gate(sr); case 24: return new GlueComp(sr); case 25: return new ChannelEq(sr);
    case 26: return new Erosion(sr); case 27: return new Redux(sr); case 28: return new VinylDist(sr); case 29: return new DrumBuss(sr); case 30: return new Tuner(sr); case 31: return new EqEight(sr); case 32: return new Spectrum(sr);
    case 33: return new Amp(sr); case 34: return new Cabinet(sr); case 35: return new Overdrive(sr); case 36: return new Pedal(sr); case 37: return new DynTube(sr);
    case 38: return new MultibandDyn(sr); case 39: return new Resonators(sr); case 40: return new Corpus(sr);
    case 41: return new Vocoder(sr); case 42: return new Shifter(sr); case 43: return new GrainDelay(sr); case 44: return new HybridReverb(sr); case 45: return new Looper(sr);
    default: return nullptr;
  }
}
bool instPorted(int type) { return type == 1 || type == 2 || type == 13 || type == 14 || type == 15 || type == 17 || type == 18 || type == 16 || (type >= 19 && type <= 29); }
bool devPorted(int type) { return (type >= 17 && type <= 45) || type == 1 || type == 6 || type == 9 || type == 0 || type == 2 || type == 3 || type == 4 || type == 5 || type == 7 || type == 8; }

}  // namespace mdaw
