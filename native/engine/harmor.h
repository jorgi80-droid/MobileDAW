// Harmor (MobileDAW instrument 38): an additive synthesizer in the spirit of Image-Line's Harmor, MobileDAW's own DSP (no Image-Line
// code or data). Every voice is a bank of up to 516 sine partials (times its unison copies); two timbres (a waveform + a drawn harmonic
// level / phase table each) give every partial its amplitude and phase, mixed (complex sum) or morphed (amplitude + phase direction).
// The filters, the resonance and the formants are gains per partial (by its frequency), so they are exact and cost no extra oscillators.
// The parameter indices below are the stable IDs of js/harmor/schema.js: never renumber or reuse one, only add.
// 90 is never used: the host sends the track transpose there to every instrument.
#pragma once
#include "units.h"

namespace mdaw {

constexpr int HM_PARAMS = 1200;
constexpr int HM_MAXP = 516;          // partials per voice
constexpr int HM_POLY = 16;           // voices
constexpr int HM_UNI = 8;             // unison copies per voice
// global
constexpr int HM_VOL = 0, HM_PARTIALS = 1, HM_QUALITY = 2, HM_POLY_P = 3, HM_PITCH = 4, HM_FINE = 5, HM_GLIDE = 6, HM_MONO = 7, HM_LEGATO = 8;
// timbre t (0 / 1): base + 10 * t
constexpr int HM_T_WAVE = 10, HM_T_LEVEL = 11, HM_T_PRND = 12, HM_T_TABLE = 13;
// timbre mix / harmonic mapping
constexpr int HM_MIX = 30, HM_BLEND = 31, HM_STRETCH = 32, HM_SUB = 33;
// amplitude ADSR (used while the Volume articulator is off), vibrato
constexpr int HM_ATT = 40, HM_DEC = 41, HM_SUS = 42, HM_REL = 43, HM_VELS = 44, HM_VIB_RATE = 45, HM_VIB_DEPTH = 46, HM_VIB_DELAY = 47;
// filter f (0 / 1): base + 10 * f
constexpr int HM_F_ON = 50, HM_F_TYPE = 51, HM_F_CUT = 52, HM_F_RES = 53, HM_F_WIDTH = 54, HM_F_OFS = 55, HM_F_SLOPE = 56, HM_F_KEY = 57, HM_F_MIX = 58, HM_F_TABLE = 59;
enum { HM_LP = 0, HM_HP = 1, HM_BP = 2, HM_BS = 3, HM_FORMANT = 4, HM_FCUSTOM = 5 };
constexpr int HM_SELFOSC = 70, HM_VEL_FLT = 71;
// unison
constexpr int HM_U_VOICES = 75, HM_U_DETUNE = 76, HM_U_SPREAD = 77, HM_U_PHASE = 78, HM_U_PITCH = 79, HM_U_VOLDIST = 80;
// LFO l (0 / 1): base + 6 * l: rate (Hz), shape, phase, depth, destination, retrigger
constexpr int HM_L_RATE = 91, HM_L_SHAPE = 92, HM_L_PHASE = 93, HM_L_DEPTH = 94, HM_L_DEST = 95, HM_L_RETRIG = 96, HM_L_STRIDE = 6;
enum { HM_LD_OFF = 0, HM_LD_PITCH, HM_LD_CUT1, HM_LD_CUT2, HM_LD_VOL, HM_LD_MIX, HM_LD_HPHASE, HM_LD_PAN, HM_LD_STRETCH, HM_LD_COUNT };
// articulators (envelopes) e = 0..9: base 110 + 60 e. Slot: 0 on, 1 depth (-1..1), 2 points (0 = the AHDSR below), 3 sustain point,
// 4 loop start point, 5..9 attack / hold / decay / sustain / release, 10 + 3 j: point j = time from the previous point (s), level, curve
constexpr int HM_ENV = 110, HM_ENV_STRIDE = 60, HM_ENVS = 10, HM_ENV_PTS = 16;
enum { HM_E_VOL = 0, HM_E_PITCH, HM_E_CUT1, HM_E_CUT2, HM_E_FREQ, HM_E_HLEVEL, HM_E_HPHASE, HM_E_MIX, HM_E_IMGFREQ, HM_E_IMGGAIN };
// special processing (in the partial domain): Prism (partials moved off their harmonic places), Pluck (higher partials die faster),
// Blur (partial amplitudes smeared in time), spectral Phaser (notches sweeping across the spectrum)
constexpr int HM_PRISM_AMT = 81, HM_PRISM_MODE = 82, HM_PLUCK_AMT = 83, HM_PLUCK_TIME = 84, HM_PLUCK_DAMP = 85, HM_BLUR_ATT = 86, HM_BLUR_REL = 87, HM_BLUR_HARM = 88;
constexpr int HM_SPH_DEPTH = 103, HM_SPH_DENS = 104, HM_SPH_SPEED = 105, HM_SPH_SHARP = 106, HM_SPH_OFS = 107;
// effects rack: 7 MobileDAW effects run inside Harmor in a chosen order. HM_FX_ORDER + s = the effect in slot s; effect k: HM_FX + 48 k:
// 0 on, 1 mix, 2 + j = parameter j of the effect (its own MobileDAW device type HM_FX_TYPES[k], same parameters as on a track)
constexpr int HM_FX_ORDER = 712, HM_FX = 720, HM_FX_STRIDE = 48, HM_FX_N = 7;
constexpr int HM_FX_TYPES[HM_FX_N] = { 3, 20, 21, 17, 7, 4, 31 };   // Distortion (Saturator), Chorus-Ensemble, Phaser-Flanger, Delay, Reverb, Compressor, EQ Eight
constexpr int HM_FX_NP[HM_FX_N] = { 6, 13, 15, 20, 8, 12, 42 };      // their parameter counts (js/defs.js DEVICES): only these are passed on
// partial map (phase 3): image synthesis and audio resynthesis both give the voices a map of frames (time) x bins (partials, or
// log-frequency bands) of amplitude (left / right), frequency deviation (cents) and phase. A map lives in a sample-bank slot and
// describes itself: the first 16 values of the slot's left channel are a header (HM_MAP_MAGIC, frames, bins, hop s, layout,
// base MIDI note, lowest Hz, highest Hz), the data follows (frame-major). Slot A: left / right amplitude; slot B: deviation / phase.
constexpr int HM_MAP_MIX = 1060, HM_MAP_A = 1061, HM_MAP_B = 1062, HM_MAP_N = 1063, HM_MAP_NOISE = 1064, HM_MAP_W = 1065, HM_MAP_END = 1066, HM_MAP_SPEED = 1069, HM_MAP_START = 1070, HM_MAP_LOOP = 1071, HM_MAP_INTERP = 1072;
// more images (several vocals in one Harmor, one pattern): image 0 = the map parameters above; images 1..7 at HM_IMG + 10 (k - 1): slots
// A / B / N / W, Start, End, Loop, Level (x the map's), Shift (semitones, + the map's). A note picks its image (note field img -> the
// note event's 6th value -> noteOnSt); an image without a map plays image 0
constexpr int HM_IMG = 1100, HM_IMG_STRIDE = 10, HM_IMGS = 8;
enum { HM_I_A = 0, HM_I_B = 1, HM_I_N = 2, HM_I_W = 3, HM_I_START = 4, HM_I_END = 5, HM_I_LOOP = 6, HM_I_LEVEL = 7, HM_I_SHIFT = 8, HM_I_NOISE = 9 };   // Noise: x the map's
constexpr int HM_MAP_FORMANT = 1073, HM_MAP_FDEV = 1074, HM_MAP_LEVEL = 1075, HM_MAP_SHIFT = 1076, HM_MAP_PHASE = 1077;
constexpr int HM_MAP_HDR = 16; constexpr double HM_MAP_MAGIC = 4096.5;
enum { HM_MAP_HARM = 0, HM_MAP_LOGF = 1, HM_MAP_NOISEB = 2, HM_MAP_WAVE = 3 };
// slot W (resynthesis residual as a waveform): header (magic, samples, channels, sample rate, layout HM_MAP_WAVE), the samples follow;
// played on the map's timeline (not transposed) while Map Speed is 1, else the noise bands of slot N stand in
// slot N (resynthesis residual): frames x noise bands of band RMS (left / right), layout HM_MAP_NOISEB, header lowest / highest band
// edge; played as one noise source per voice through a bank of band-pass filters whose gains follow the map (HM_MAP_NOISE = level)
constexpr int HM_NB_MAX = 64;
// waveforms of a timbre
enum { HM_SINE = 0, HM_SAW = 1, HM_SQUARE = 2, HM_TRI = 3, HM_CUSTOM = 4 };

Instrument* makeHarmor(double sr, Bank* bank);

}  // namespace mdaw
