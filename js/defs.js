import { factoryPresets } from './presetlib.js';
import { wtName, WT_COUNT } from './engine/live.js';
// Instrument + device definitions. Parameter ORDER must match the C++ side
// (app/src/main/cpp/instruments.h and devices.h).
export const INST = { MINISYNTH: 1, SUPERSAW: 2, DRUM: 3, DIRECTWAVE: 4, GMS: 5, SOUNDFONT: 6, MOISTURE: 7, OSPHERE: 8, KEYSTONE: 9, SAMPLER: 10, WAVETABLE: 11 };
// Instruments a synth/sampler track can switch between (drums have their own track type).
export const INST_LIST = [11, 10, 1, 2, 4, 5, 6, 7, 8, 9];

export const INSTRUMENTS = {
  1: { name: 'Mini Synth', params: [
    { n: 'Wave', min: 0, max: 2, def: 0, step: 1, fmt: 'wave' },
    { n: 'Cutoff', min: 60, max: 18000, def: 8000, curve: 'log', unit: 'Hz' },
    { n: 'Attack', min: 0.001, max: 2, def: 0.005, curve: 'log', unit: 's' },
    { n: 'Decay', min: 0.01, max: 3, def: 0.15, curve: 'log', unit: 's' },
    { n: 'Sustain', min: 0, max: 1, def: 0.7, unit: '%' },
    { n: 'Release', min: 0.01, max: 5, def: 0.25, curve: 'log', unit: 's' },
    { n: 'Gain', min: 0, max: 1, def: 0.35, unit: '%' } ] },
  2: { name: 'SuperSaw', params: [
    { n: 'Detune', min: 0, max: 100, def: 25, unit: 'ct' },
    { n: 'Mix', min: 0, max: 1, def: 0.75, unit: '%' },
    { n: 'Cutoff', min: 60, max: 18000, def: 9000, curve: 'log', unit: 'Hz' },
    { n: 'Attack', min: 0.001, max: 2, def: 0.01, curve: 'log', unit: 's' },
    { n: 'Release', min: 0.01, max: 5, def: 0.4, curve: 'log', unit: 's' },
    { n: 'Gain', min: 0, max: 1, def: 0.3, unit: '%' } ] },
  3: { name: 'Drum Sampler', params: [] },
  4: { name: 'DirectWave', view: 'sampler1', params: [
    { n: 'Gain', min: 0, max: 1, def: 0.8, unit: '%' },
    { n: 'Attack', min: 0.001, max: 2, def: 0.002, curve: 'log', unit: 's' },
    { n: 'Release', min: 0.01, max: 5, def: 0.2, curve: 'log', unit: 's' },
    { n: 'Cutoff', min: 100, max: 20000, def: 18000, curve: 'log', unit: 'Hz' },
    { n: 'Tune', min: -12, max: 12, def: 0, step: 1, fmt: 'int' },
    { n: 'Vel Sens', min: 0, max: 1, def: 0.7, unit: '%' } ] },
  5: { name: 'GMS', params: [
    { n: 'Mode', min: 0, max: 1, def: 0, step: 1, fmt: 'mono' },
    { n: 'Glide', min: 1, max: 1000, def: 60, curve: 'log', unit: 'ms' },
    { n: 'Cutoff', min: 30, max: 18000, def: 2500, curve: 'log', unit: 'Hz' },
    { n: 'Reso', min: 0.5, max: 10, def: 1.2, curve: 'log', unit: '' },
    { n: 'Env Amt', min: -1, max: 1, def: 0.4, unit: '' },
    { n: 'Attack', min: 0.001, max: 3, def: 0.003, curve: 'log', unit: 's' },
    { n: 'Decay', min: 0.01, max: 4, def: 0.25, curve: 'log', unit: 's' },
    { n: 'Sustain', min: 0, max: 1, def: 0.6, unit: '%' },
    { n: 'Release', min: 0.01, max: 5, def: 0.2, curve: 'log', unit: 's' },
    { n: 'Gain', min: 0, max: 1, def: 0.4, unit: '%' },
    { n: 'O1 Wave', min: 0, max: 3, def: 0, step: 1, fmt: 'wave4' },
    { n: 'O1 Oct', min: -2, max: 2, def: 0, step: 1, fmt: 'int' },
    { n: 'O1 Fine', min: -50, max: 50, def: 0, unit: 'ct' },
    { n: 'O1 Level', min: 0, max: 1, def: 0.7, unit: '%' },
    { n: 'O2 Wave', min: 0, max: 3, def: 0, step: 1, fmt: 'wave4' },
    { n: 'O2 Oct', min: -2, max: 2, def: 0, step: 1, fmt: 'int' },
    { n: 'O2 Fine', min: -50, max: 50, def: 8, unit: 'ct' },
    { n: 'O2 Level', min: 0, max: 1, def: 0.5, unit: '%' },
    { n: 'O3 Wave', min: 0, max: 3, def: 0, step: 1, fmt: 'wave4' },
    { n: 'O3 Oct', min: -2, max: 2, def: -1, step: 1, fmt: 'int' },
    { n: 'O3 Fine', min: -50, max: 50, def: 0, unit: 'ct' },
    { n: 'O3 Level', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'Arp', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'Pattern', min: 0, max: 4, def: 0, step: 1, fmt: 'arppat' },
    { n: 'Rate', min: 0, max: 3, def: 2, step: 1, fmt: 'arprate' },
    { n: 'Arp Oct', min: 1, max: 3, def: 1, step: 1, fmt: 'int' },
    { n: 'Gate', min: 0.1, max: 1, def: 0.7, unit: '%' } ] },
  6: { name: 'SoundFont', view: 'soundfont', params: [
    { n: 'Gain', min: 0, max: 1, def: 0.8, unit: '%' } ] },
  7: { name: 'Moisture', params: [
    { n: 'Pos A', min: 0, max: 1, def: 0.25, unit: '%' },
    { n: 'Pos B', min: 0, max: 1, def: 0.6, unit: '%' },
    { n: 'B Level', min: 0, max: 1, def: 0.5, unit: '%' },
    { n: 'B Oct', min: -2, max: 2, def: 0, step: 1, fmt: 'int' },
    { n: 'Sub', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'Unison', min: 1, max: 5, def: 1, step: 1, fmt: 'int' },
    { n: 'Detune', min: 0, max: 60, def: 12, unit: 'ct' },
    { n: 'Filter', min: 0, max: 2, def: 0, step: 1, fmt: 'filt3' },
    { n: 'Cutoff', min: 30, max: 18000, def: 6000, curve: 'log', unit: 'Hz' },
    { n: 'Reso', min: 0.5, max: 12, def: 1, curve: 'log', unit: '' },
    { n: 'Env Amt', min: -1, max: 1, def: 0.3, unit: '' },
    { n: 'Attack', min: 0.001, max: 4, def: 0.005, curve: 'log', unit: 's' },
    { n: 'Decay', min: 0.01, max: 4, def: 0.35, curve: 'log', unit: 's' },
    { n: 'Sustain', min: 0, max: 1, def: 0.7, unit: '%' },
    { n: 'Release', min: 0.01, max: 6, def: 0.3, curve: 'log', unit: 's' },
    { n: 'LFO Rate', min: 0.05, max: 12, def: 0.5, curve: 'log', unit: 'Hz' },
    { n: 'LFO Depth', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'Gain', min: 0, max: 1, def: 0.4, unit: '%' } ] },
  8: { name: 'Osphere', params: [
    { n: 'L1 Wave', min: 0, max: 3, def: 0, step: 1, fmt: 'wave4' },
    { n: 'L1 Level', min: 0, max: 1, def: 0.6, unit: '%' },
    { n: 'L1 Oct', min: -2, max: 2, def: 0, step: 1, fmt: 'int' },
    { n: 'L1 Fine', min: 0, max: 40, def: 8, unit: 'ct' },
    { n: 'L2 Wave', min: 0, max: 3, def: 1, step: 1, fmt: 'wave4' },
    { n: 'L2 Level', min: 0, max: 1, def: 0.4, unit: '%' },
    { n: 'L2 Oct', min: -2, max: 2, def: 1, step: 1, fmt: 'int' },
    { n: 'L2 Detune', min: 0, max: 40, def: 10, unit: 'ct' },
    { n: 'Air', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'Cutoff', min: 40, max: 18000, def: 4500, curve: 'log', unit: 'Hz' },
    { n: 'Reso', min: 0.5, max: 8, def: 0.8, curve: 'log', unit: '' },
    { n: 'Attack', min: 0.01, max: 8, def: 0.6, curve: 'log', unit: 's' },
    { n: 'Release', min: 0.05, max: 10, def: 1.2, curve: 'log', unit: 's' },
    { n: 'Chorus', min: 0, max: 1, def: 0.5, unit: '%' },
    { n: 'Ch Mix', min: 0, max: 1, def: 0.4, unit: '%' },
    { n: 'Motion', min: 0, max: 1, def: 0.3, unit: '%' },
    { n: 'Mot Rate', min: 0.02, max: 4, def: 0.15, curve: 'log', unit: 'Hz' },
    { n: 'Gain', min: 0, max: 1, def: 0.35, unit: '%' } ] },
  9: { name: 'Keystone', view: 'sampler', params: [
    { n: 'Gain', min: 0, max: 1, def: 0.8, unit: '%' },
    { n: 'Attack', min: 0.001, max: 2, def: 0.002, curve: 'log', unit: 's' },
    { n: 'Release', min: 0.01, max: 5, def: 0.2, curve: 'log', unit: 's' },
    { n: 'Cutoff', min: 100, max: 20000, def: 18000, curve: 'log', unit: 'Hz' },
    { n: 'Tune', min: -12, max: 12, def: 0, step: 1, fmt: 'int' },
    { n: 'Vel Sens', min: 0, max: 1, def: 0.7, unit: '%' } ] },
  10: { name: 'Sampler', view: 'lsampler', params: [
    { n: 'Volume', min: -36, max: 12, def: 0, unit: 'dB' },
    { n: 'Pan', min: -1, max: 1, def: 0, fmt: 'pan' },
    { n: 'Transpose', min: -48, max: 48, def: 0, step: 1, fmt: 'st' },
    { n: 'Detune', min: -50, max: 50, def: 0, unit: 'ct' },
    { n: 'Spread', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'Voices', min: 1, max: 32, def: 16, step: 1, fmt: 'num' },
    { n: 'Scale', min: 0, max: 2, def: 1, unit: '%' },
    { n: 'Vol<Vel', min: 0, max: 1, def: 0.35, unit: '%' },
    { n: 'Interpol', min: 0, max: 1, def: 0, step: 1, fmt: 'interp' },
    { n: 'Filter', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'Type', min: 0, max: 3, def: 0, step: 1, fmt: 'filt4' },
    { n: 'Freq', min: 20, max: 20000, def: 20000, curve: 'log', unit: 'Hz' },
    { n: 'Res', min: 0.5, max: 12, def: 0.707, curve: 'log', unit: '' },
    { n: 'Env Amt', min: -1, max: 1, def: 0, unit: '' },
    { n: 'Attack', min: 0.001, max: 20, def: 0.001, curve: 'log', unit: 's' },
    { n: 'Decay', min: 0.001, max: 20, def: 0.6, curve: 'log', unit: 's' },
    { n: 'Sustain', min: 0, max: 1, def: 1, unit: '%' },
    { n: 'Release', min: 0.001, max: 20, def: 0.05, curve: 'log', unit: 's' },
    { n: 'F Attack', min: 0.001, max: 20, def: 0.001, curve: 'log', unit: 's' },
    { n: 'F Decay', min: 0.001, max: 20, def: 0.6, curve: 'log', unit: 's' },
    { n: 'F Sustain', min: 0, max: 1, def: 1, unit: '%' },
    { n: 'F Release', min: 0.001, max: 20, def: 0.05, curve: 'log', unit: 's' },
    { n: 'Pitch Env', min: -48, max: 48, def: 0, unit: 'st' },
    { n: 'P Decay', min: 0.01, max: 5, def: 0.15, curve: 'log', unit: 's' },
    { n: 'LFO Shape', min: 0, max: 4, def: 0, step: 1, fmt: 'lfo5' },
    { n: 'LFO Rate', min: 0.05, max: 40, def: 4, curve: 'log', unit: 'Hz' },
    { n: 'LFO Pitch', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'LFO Filter', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'LFO Vol', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'LFO Pan', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'Release Mode', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'Snap', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'Time', min: 0.1, max: 4, def: 1, curve: 'log', unit: 'x' },
    { n: 'Osc', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'Osc Wave', min: 0, max: 4, def: 0, step: 1, fmt: 'oscw' },
    { n: 'Osc Level', min: -48, max: 6, def: -12, unit: 'dB' },
    { n: 'Osc Semi', min: -48, max: 48, def: 0, step: 1, fmt: 'st' },
    { n: 'Osc Detune', min: -50, max: 50, def: 0, unit: 'ct' },
    { n: 'Sample Level', min: -48, max: 6, def: 0, unit: 'dB' } ] },
  11: { name: 'Wavetable', view: 'lwavetable', params: [
    { n: 'O1 Table', min: 0, max: 33, def: 0, step: 1, fmt: 'wtab' },
    { n: 'O1 Pos', min: 0, max: 1, def: 0.7, unit: '%' },
    { n: 'O1 FX 1', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'O1 FX 2', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'O1 FX Mode', min: 0, max: 3, def: 0, step: 1, fmt: 'wfx' },
    { n: 'O1 Gain', min: -36, max: 0, def: 0, unit: 'dB' },
    { n: 'O1 Semi', min: -48, max: 48, def: 0, step: 1, fmt: 'st' },
    { n: 'O1 Det', min: -50, max: 50, def: 0, unit: 'ct' },
    { n: 'O1 On', min: 0, max: 1, def: 1, step: 1, fmt: 'onoff' },
    { n: 'O2 Table', min: 0, max: 33, def: 4, step: 1, fmt: 'wtab' },
    { n: 'O2 Pos', min: 0, max: 1, def: 0.5, unit: '%' },
    { n: 'O2 FX 1', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'O2 FX 2', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'O2 FX Mode', min: 0, max: 3, def: 0, step: 1, fmt: 'wfx' },
    { n: 'O2 Gain', min: -36, max: 0, def: -6, unit: 'dB' },
    { n: 'O2 Semi', min: -48, max: 48, def: 0, step: 1, fmt: 'st' },
    { n: 'O2 Det', min: -50, max: 50, def: 0, unit: 'ct' },
    { n: 'O2 On', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'Sub', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'Sub Gain', min: -36, max: 0, def: -6, unit: 'dB' },
    { n: 'Sub Tone', min: 0, max: 1, def: 0.5, unit: '%' },
    { n: 'Sub Oct', min: 0, max: 2, def: 1, step: 1, fmt: 'suboct' },
    { n: 'Transpose', min: -48, max: 48, def: 0, step: 1, fmt: 'st' },
    { n: 'Mono', min: 0, max: 1, def: 0, step: 1, fmt: 'mono' },
    { n: 'Glide', min: 1, max: 2000, def: 30, curve: 'log', unit: 'ms' },
    { n: 'Voices', min: 1, max: 8, def: 8, step: 1, fmt: 'num' },
    { n: 'Unison', min: 0, max: 6, def: 0, step: 1, fmt: 'umode' },
    { n: 'Uni Voices', min: 2, max: 8, def: 4, step: 1, fmt: 'num' },
    { n: 'Uni Amount', min: 0, max: 1, def: 0.2, unit: '%' },
    { n: 'Volume', min: -36, max: 6, def: -6, unit: 'dB' },
    { n: 'Filter', min: 0, max: 1, def: 1, step: 1, fmt: 'onoff' },
    { n: 'Type', min: 0, max: 3, def: 0, step: 1, fmt: 'filt4' },
    { n: 'Freq', min: 20, max: 20000, def: 20000, curve: 'log', unit: 'Hz' },
    { n: 'Res', min: 0.5, max: 12, def: 0.707, curve: 'log', unit: '' },
    { n: 'Drive', min: 0, max: 24, def: 0, unit: 'dB' },
    { n: 'Amp A', min: 0.001, max: 20, def: 0.001, curve: 'log', unit: 's' },
    { n: 'Amp D', min: 0.001, max: 20, def: 0.6, curve: 'log', unit: 's' },
    { n: 'Amp S', min: 0, max: 1, def: 1, unit: '%' },
    { n: 'Amp R', min: 0.001, max: 20, def: 0.1, curve: 'log', unit: 's' },
    { n: 'E2 A', min: 0.001, max: 20, def: 0.001, curve: 'log', unit: 's' },
    { n: 'E2 D', min: 0.001, max: 20, def: 0.6, curve: 'log', unit: 's' },
    { n: 'E2 S', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'E2 R', min: 0.001, max: 20, def: 0.1, curve: 'log', unit: 's' },
    { n: 'E3 A', min: 0.001, max: 20, def: 0.001, curve: 'log', unit: 's' },
    { n: 'E3 D', min: 0.001, max: 20, def: 0.6, curve: 'log', unit: 's' },
    { n: 'E3 S', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'E3 R', min: 0.001, max: 20, def: 0.1, curve: 'log', unit: 's' },
    { n: 'LFO1 Shape', min: 0, max: 4, def: 0, step: 1, fmt: 'lfo5' },
    { n: 'LFO1 Rate', min: 0.05, max: 40, def: 1, curve: 'log', unit: 'Hz' },
    { n: 'LFO1 Attack', min: 0, max: 5, def: 0, unit: 's' },
    { n: 'LFO2 Shape', min: 0, max: 4, def: 0, step: 1, fmt: 'lfo5' },
    { n: 'LFO2 Rate', min: 0.05, max: 40, def: 1, curve: 'log', unit: 'Hz' },
    { n: 'LFO2 Attack', min: 0, max: 5, def: 0, unit: 's' },
    { n: 'Env 2>Osc1 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 2>Osc1 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 2>Osc2 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 2>Osc2 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 2>Filter Freq', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 2>Filter Res', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 2>Osc1 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 2>Osc2 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 3>Osc1 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 3>Osc1 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 3>Osc2 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 3>Osc2 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 3>Filter Freq', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 3>Filter Res', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 3>Osc1 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Env 3>Osc2 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 1>Osc1 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 1>Osc1 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 1>Osc2 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 1>Osc2 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 1>Filter Freq', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 1>Filter Res', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 1>Osc1 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 1>Osc2 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 2>Osc1 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 2>Osc1 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 2>Osc2 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 2>Osc2 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 2>Filter Freq', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 2>Filter Res', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 2>Osc1 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'LFO 2>Osc2 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Vel>Osc1 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Vel>Osc1 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Vel>Osc2 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Vel>Osc2 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Vel>Filter Freq', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Vel>Filter Res', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Vel>Osc1 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Vel>Osc2 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Key>Osc1 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Key>Osc1 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Key>Osc2 Pos', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Key>Osc2 Pitch', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Key>Filter Freq', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Key>Filter Res', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Key>Osc1 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'Key>Osc2 Gain', min: -1, max: 1, def: 0, unit: '%' },
    { n: 'F2 On', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'F2 Type', min: 0, max: 3, def: 1, step: 1, fmt: 'filt4' },
    { n: 'F2 Freq', min: 20, max: 20000, def: 20, curve: 'log', unit: 'Hz' },
    { n: 'F2 Res', min: 0.5, max: 12, def: 0.707, curve: 'log', unit: '' },
    { n: 'F2 Routing', min: 0, max: 1, def: 0, step: 1, fmt: 'f2route' },
    { n: 'Vel>Filter Res', min: -1, max: 1, def: 0, unit: '%' } ] },   // 106: Vel>Filter Res lives here (index 90 is the instrument pitch, never reaches the engine as a matrix cell)
};

// Built-in drum sounds: engine sample ids 0..5, mapped to these MIDI pitches.
export const DRUM_PADS = [
  { pitch: 36, name: 'Kick' }, { pitch: 38, name: 'Snare' }, { pitch: 39, name: 'Clap' },
  { pitch: 42, name: 'Hat' }, { pitch: 46, name: 'Open Hat' }, { pitch: 41, name: 'Tom' },
];

export const DEVICES = {
  0: { name: 'Utility', params: [
    { n: 'Gain', min: -60, max: 24, def: 0, unit: 'dB' },
    { n: 'Pan', min: -1, max: 1, def: 0, fmt: 'pan' },
    { n: 'Invert', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' },
    { n: 'Mono', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff' } ] },
  1: { name: 'Auto Filter', view: 'autofilter', params: [
    { n: 'Type', min: 0, max: 3, def: 0, step: 1, fmt: 'filt4', hidden: true },
    { n: 'Freq', min: 20, max: 20000, def: 20000, curve: 'log', unit: 'Hz' },
    { n: 'Res', min: 0.3, max: 12, def: 0.707, curve: 'log', unit: '' },
    { n: 'Slope', min: 0, max: 1, def: 0, step: 1, fmt: 'slope', hidden: true },
    { n: 'Env Amt', min: -1, max: 1, def: 0, unit: '' },
    { n: 'Env Atk', min: 1, max: 500, def: 6, curve: 'log', unit: 'ms' },
    { n: 'Env Rel', min: 10, max: 2000, def: 200, curve: 'log', unit: 'ms' },
    { n: 'LFO Amt', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'LFO Rate', min: 0.05, max: 20, def: 1, curve: 'log', unit: 'Hz' },
    { n: 'Shape', min: 0, max: 4, def: 0, step: 1, fmt: 'lfo5', hidden: true } ],
    lay: { l: [1, 2, 3], r: [] } },
  2: { name: 'EQ Three', params: [
    { n: 'Low', min: -15, max: 15, def: 0, unit: 'dB' },
    { n: 'Mid', min: -15, max: 15, def: 0, unit: 'dB' },
    { n: 'High', min: -15, max: 15, def: 0, unit: 'dB' },
    { n: 'Mid Hz', min: 200, max: 8000, def: 1000, curve: 'log', unit: 'Hz' },
    { n: 'Low Hz', min: 40, max: 800, def: 250, curve: 'log', unit: 'Hz' },
    { n: 'High Hz', min: 1000, max: 16000, def: 4000, curve: 'log', unit: 'Hz' } ] },
  3: { name: 'Saturator', params: [
    { n: 'Drive', min: 0, max: 36, def: 0, unit: 'dB' },
    { n: 'Mix', min: 0, max: 1, def: 1, unit: '%' },
    { n: 'Output', min: -24, max: 6, def: 0, unit: 'dB' },
    { n: 'Tone', min: 500, max: 20000, def: 20000, curve: 'log', unit: 'Hz' } ] },
  4: { name: 'Compressor', params: [
    { n: 'Thresh', min: -60, max: 0, def: -18, unit: 'dB' },
    { n: 'Ratio', min: 1, max: 20, def: 4, curve: 'log', unit: ':1' },
    { n: 'Attack', min: 0.1, max: 100, def: 10, curve: 'log', unit: 'ms' },
    { n: 'Release', min: 10, max: 1000, def: 120, curve: 'log', unit: 'ms' },
    { n: 'Makeup', min: 0, max: 24, def: 0, unit: 'dB' },
    { n: 'Knee', min: 0, max: 24, def: 6, unit: 'dB' },
    { n: 'Mix', min: 0, max: 1, def: 1, unit: '%' } ] },
  5: { name: 'Limiter', params: [
    { n: 'Ceiling', min: -12, max: 0, def: -0.3, unit: 'dB' },
    { n: 'Release', min: 5, max: 500, def: 80, curve: 'log', unit: 'ms' },
    { n: 'Gain', min: 0, max: 24, def: 0, unit: 'dB' } ] },
  6: { name: 'Echo', view: 'echo', params: [
    { n: 'Left', min: 1, max: 2000, def: 350, curve: 'log', unit: 'ms' },
    { n: 'Feedback', min: 0, max: 0.98, def: 0.35, unit: '%' },
    { n: 'Dry/Wet', min: 0, max: 1, def: 0.25, unit: '%' },
    { n: 'Ping-Pong', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff', hidden: true },
    { n: 'LP', min: 200, max: 20000, def: 6000, curve: 'log', unit: 'Hz' },
    { n: 'HP', min: 20, max: 2000, def: 20, curve: 'log', unit: 'Hz' },
    { n: 'Right', min: 1, max: 2000, def: 350, curve: 'log', unit: 'ms' },
    { n: 'Link', min: 0, max: 1, def: 1, step: 1, fmt: 'onoff', hidden: true },
    { n: 'Sync', min: 0, max: 1, def: 0, step: 1, fmt: 'onoff', hidden: true },
    { n: 'L Div', min: 0, max: 7, def: 2, step: 1, fmt: 'div', hidden: true },
    { n: 'R Div', min: 0, max: 7, def: 1, step: 1, fmt: 'div', hidden: true },
    { n: 'Reverb', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'Stereo', min: 0, max: 1, def: 1, unit: '%' },
    { n: 'Input', min: -24, max: 24, def: 0, unit: 'dB' },
    { n: 'Output', min: -24, max: 12, def: 0, unit: 'dB' },
    { n: 'Mod Rate', min: 0.1, max: 10, def: 0.5, curve: 'log', unit: 'Hz' },
    { n: 'Mod Amt', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'Drive', min: 0, max: 1, def: 0, unit: '%' } ] },
  7: { name: 'Reverb', params: [
    { n: 'Size', min: 0, max: 1, def: 0.6, unit: '%' },
    { n: 'Damp', min: 0, max: 1, def: 0.5, unit: '%' },
    { n: 'Mix', min: 0, max: 1, def: 0.25, unit: '%' },
    { n: 'Pre-delay', min: 0, max: 100, def: 0, unit: 'ms' } ] },
  8: { name: 'Parametric EQ', sideOrder: [0, 1, -1, 2, 3, 4, 5, 6, 7, 8, 9, -1], sideRows: 3, params: [
    { n: 'Low Hz', min: 30, max: 400, def: 100, curve: 'log', unit: 'Hz' },
    { n: 'Low Gain', min: -18, max: 18, def: 0, unit: 'dB' },
    { n: 'Mid1 Hz', min: 100, max: 5000, def: 400, curve: 'log', unit: 'Hz' },
    { n: 'Mid1 Gain', min: -18, max: 18, def: 0, unit: 'dB' },
    { n: 'Mid1 Q', min: 0.3, max: 10, def: 1, curve: 'log', unit: '' },
    { n: 'Mid2 Hz', min: 500, max: 12000, def: 3000, curve: 'log', unit: 'Hz' },
    { n: 'Mid2 Gain', min: -18, max: 18, def: 0, unit: 'dB' },
    { n: 'Mid2 Q', min: 0.3, max: 10, def: 1, curve: 'log', unit: '' },
    { n: 'High Hz', min: 2000, max: 16000, def: 8000, curve: 'log', unit: 'Hz' },
    { n: 'High Gain', min: -18, max: 18, def: 0, unit: 'dB' } ] },
  9: { name: 'Roar', view: 'roar', params: [
    { n: 'Shape', min: 0, max: 5, def: 0, step: 1, fmt: 'roar6', hidden: true },
    { n: 'Drive', min: 0, max: 40, def: 12, unit: 'dB' },
    { n: 'Tone', min: 500, max: 20000, def: 12000, curve: 'log', unit: 'Hz' },
    { n: 'Dry/Wet', min: 0, max: 1, def: 1, unit: '%' },
    { n: 'Output', min: -24, max: 12, def: -6, unit: 'dB' },
    { n: 'Bias', min: -1, max: 1, def: 0, unit: '' },
    { n: 'Amount', min: 0, max: 1, def: 1, unit: '%' },
    { n: 'FB Amt', min: 0, max: 1, def: 0, unit: '%' },
    { n: 'FB Time', min: 1, max: 100, def: 10, curve: 'log', unit: 'ms' },
    { n: 'FB Freq', min: 100, max: 20000, def: 20000, curve: 'log', unit: 'Hz' },
    { n: 'Compress', min: 0, max: 1, def: 0, unit: '%' } ] },
  10: { name: 'Autoduck', view: 'autoduck', params: [
    { n: 'Source', min: 0, max: 64, def: 0, step: 1, fmt: 'src' },
    { n: 'Thresh', min: -60, max: 0, def: -30, unit: 'dB' },
    { n: 'Amount', min: 0, max: 48, def: 12, unit: 'dB' },
    { n: 'Attack', min: 0.1, max: 100, def: 5, curve: 'log', unit: 'ms' },
    { n: 'Release', min: 20, max: 1000, def: 200, curve: 'log', unit: 'ms' } ] },
  12: { name: 'Level', view: 'loudness', params: [
    { n: 'Reset', min: 0, max: 1000000, def: 0, step: 1, hidden: true },
    { n: 'Gain', min: -24, max: 24, def: 0, unit: 'dB' } ] },
  13: { name: 'Analyzer', view: 'analyzer', params: [
    { n: 'Reset', min: 0, max: 1000000, def: 0, step: 1, hidden: true } ] },
  14: { name: 'Stereolizer', view: 'stereolizer', params: [
    { n: 'Width', min: 0, max: 2, def: 1, fmt: 'width' },
    { n: 'Mid', min: -12, max: 12, def: 0, unit: 'dB' },
    { n: 'Side', min: -12, max: 12, def: 0, unit: 'dB' },
    { n: 'Bass Mono', min: 0, max: 500, def: 0, fmt: 'bassmono' },
    { n: 'Balance', min: -1, max: 1, def: 0, fmt: 'pan' },
    { n: 'Output', min: -24, max: 12, def: 0, unit: 'dB' } ] },
  15: { name: 'Spacer', view: 'spacer', params: [
    { n: 'Size', min: 0, max: 1, def: 0.5, unit: '%' },
    { n: 'Spread', min: 0, max: 1, def: 0.5, unit: '%' },
    { n: 'Damp', min: 0, max: 1, def: 0.4, unit: '%' },
    { n: 'Mix', min: 0, max: 1, def: 0.3, unit: '%' },
    { n: 'Pre-delay', min: 0, max: 60, def: 0, unit: 'ms' },
    { n: 'Low Cut', min: 20, max: 1000, def: 120, curve: 'log', unit: 'Hz' } ] },
  16: { name: 'MiniMeters', view: 'minimeters', params: [        // transparent metering suite; the display options live in minimeters.js (saved per device)
    { n: 'Reset', min: 0, max: 1000000, def: 0, step: 1, hidden: true },
    { n: 'FFT', min: 0, max: 4, def: 2, step: 1, hidden: true },
    { n: 'Follow Pitch', min: 0, max: 1, def: 0, step: 1, hidden: true },
    { n: 'Channels', min: 0, max: 1, def: 0, step: 1, hidden: true } ] },
};

// ---- Live 12 effects (engine: js/engine/fx3.js). kit: the panel is laid out by js/fxkit.js (no automatic knob column).
const q = (n, min, max, def, o = {}) => ({ n, min, max, def, ...o });
const onoff = (n, def = 0) => q(n, 0, 1, def, { step: 1, fmt: 'onoff' });
const list = (n, items, def = 0) => q(n, 0, items.length - 1, def, { step: 1, fmt: 'list', items });
const DIV16 = ['1', '2', '3', '4', '5', '6', '8', '16'];
Object.assign(DEVICES, {
  17: { name: 'Delay', kit: true, params: [
    onoff('L Sync', 1), list('L 16th', DIV16, 2), q('L Time', 1, 5000, 250, { curve: 'log', unit: 'ms' }), q('L Offset', -0.333, 0.333, 0, { fmt: 'pct1' }),
    onoff('R Sync', 1), list('R 16th', DIV16, 3), q('R Time', 1, 5000, 300, { curve: 'log', unit: 'ms' }), q('R Offset', -0.333, 0.333, 0, { fmt: 'pct1' }),
    onoff('Link', 1), q('Feedback', 0, 0.95, 0.5, { unit: '%' }), onoff('Freeze'), onoff('Filter', 1), q('Filter Freq', 50, 18000, 1000, { curve: 'log', unit: 'Hz' }),
    q('Filter Width', 0.5, 9, 6.5, { unit: '' }), q('Mod Rate', 0.01, 40, 0.5, { curve: 'log', unit: 'Hz' }), q('Mod Filter', 0, 1, 0, { unit: '%' }), q('Mod Time', 0, 1, 0, { unit: '%' }),
    list('Mode', ['Repitch', 'Fade', 'Jump'], 1), onoff('Ping Pong'), q('Dry/Wet', 0, 1, 0.5, { unit: '%' })] },
  18: { name: 'Filter Delay', kit: true, params: [
    ...['L', 'L+R', 'R'].flatMap((c, k) => [onoff(c + ' On', 1), onoff(c + ' Filter', 1), q(c + ' Freq', 50, 18000, [1010, 156, 1730][k], { curve: 'log', unit: 'Hz' }), q(c + ' Width', 0.5, 9, [2.09, 3.42, 2.36][k], { unit: '' }),
      onoff(c + ' Sync', 0), list(c + ' 16th', DIV16, 3), q(c + ' Time', 1, 3000, 250, { curve: 'log', unit: 'ms' }), q(c + ' Feedback', 0, 0.95, 0.2, { unit: '%' }), q(c + ' Pan', -1, 1, [-0.5, 0, 0.5][k], { fmt: 'pan' }), q(c + ' Volume', -60, 12, 0, { fmt: 'dbinf' })]),
    q('Dry', -60, 12, 0, { fmt: 'dbinf' })] },
  19: { name: 'Beat Repeat', kit: true, params: [
    list('Interval', ['1/32', '1/16', '1/8', '1/4', '1/2', '1 Bar', '2 Bars', '4 Bars'], 5), q('Offset', 0, 15, 0, { step: 1, fmt: 'num' }),
    list('Grid', ['1/4', '1/6', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48', '1/64'], 4), q('Variation', 0, 10, 0, { step: 1, fmt: 'num' }), q('Chance', 0, 1, 1, { unit: '%' }),
    q('Gate', 1, 64, 8, { step: 1, fmt: 'list16' }), q('Pitch', -48, 0, 0, { step: 1, fmt: 'st' }), q('Pitch Decay', 0, 1, 0, { unit: '%' }), onoff('Filter', 1),
    q('Filter Freq', 50, 18000, 1000, { curve: 'log', unit: 'Hz' }), q('Filter Width', 0.5, 9, 6, { unit: '' }), list('Mix Mode', ['Mix', 'Ins', 'Gate'], 0),
    q('Volume', -60, 0, 0, { fmt: 'dbinf' }), q('Decay', 0, 1, 0, { unit: '%' }), onoff('No Triplets'), onoff('Repeat')] },
  20: { name: 'Chorus-Ensemble', kit: true, params: [
    list('Mode', ['Chorus', 'Ensemble', 'Vibrato'], 0), q('Rate', 0.01, 10, 0.62, { curve: 'log', unit: 'Hz' }), q('Amount', 0, 1, 0.59, { unit: '%' }), q('Feedback', 0, 0.95, 0.3, { unit: '%' }),
    onoff('Invert'), onoff('HP Filter'), q('HP Freq', 20, 2000, 50, { curve: 'log', unit: 'Hz' }), q('Width', 0, 2, 1, { fmt: 'width' }), q('Time', 1, 40, 20, { unit: 'ms' }),
    list('Taps', ['1', '2'], 1), q('Warmth', 0, 1, 0, { unit: '%' }), q('Output', -24, 12, 0, { unit: 'dB' }), q('Dry/Wet', 0, 1, 0.5, { unit: '%' })] },
  21: { name: 'Phaser-Flanger', kit: true, params: [
    list('Mode', ['Phaser', 'Flanger', 'Doubler'], 0), q('Notches', 1, 24, 4, { step: 1, fmt: 'num' }), q('Center', 20, 8000, 769, { curve: 'log', unit: 'Hz' }), q('Spread', 0, 1, 0.37, { unit: '%' }),
    q('Blend', 0, 1, 0.62, { unit: '' }), q('Freq', 0.01, 10, 0.5, { curve: 'log', unit: 'Hz' }), onoff('Sync'), q('Amount', 0, 1, 0.69, { unit: '%' }), q('Feedback', 0, 0.95, 0.12, { unit: '%' }),
    onoff('Invert'), q('Warmth', 0, 1, 0.27, { unit: '%' }), q('Output', -24, 12, 0, { unit: 'dB' }), q('Dry/Wet', 0, 1, 0.5, { unit: '%' }), q('Time', 0.1, 20, 2, { unit: 'ms' }),
    list('Sync Rate', ['1/16', '1/8', '1/4', '1/2', '1 Bar', '2 Bars', '4 Bars'], 3)] },
  22: { name: 'Auto Pan', kit: true, params: [
    q('Amount', 0, 1, 0.5, { unit: '%' }), q('Rate', 0.01, 20, 1, { curve: 'log', unit: 'Hz' }), onoff('Sync'), list('Sync Rate', ['1/16', '1/8', '1/4', '1/2', '1 Bar', '2 Bars', '4 Bars'], 2),
    q('Phase', 0, 360, 180, { fmt: 'deg' }), q('Shape', 0, 1, 0, { unit: '%' }), q('Offset', 0, 360, 0, { fmt: 'deg' }), list('Waveform', ['Sine', 'Triangle', 'Saw Down', 'Random'], 0), onoff('Invert')] },
  23: { name: 'Gate', kit: true, params: [
    q('Threshold', -80, 0, -40, { unit: 'dB' }), q('Return', 0, 24, 3, { unit: 'dB' }), q('Attack', 0.02, 150, 0.1, { curve: 'log', unit: 'ms' }), q('Hold', 0, 1000, 10, { unit: 'ms' }),
    q('Release', 1, 3000, 100, { curve: 'log', unit: 'ms' }), q('Floor', -80, 0, -80, { fmt: 'dbinf' }), onoff('Flip')] },
  24: { name: 'Glue Compressor', kit: true, params: [
    list('Attack', ['0.01', '0.1', '0.3', '1', '3', '10', '30'], 3), list('Release', ['0.1', '0.2', '0.4', '0.6', '0.8', '1.2', 'A'], 2), list('Ratio', ['2', '4', '10'], 0),
    q('Threshold', -40, 0, -10, { unit: 'dB' }), q('Makeup', 0, 20, 0, { unit: 'dB' }), q('Range', 0, 70, 70, { unit: 'dB' }), onoff('Soft Clip'), q('Dry/Wet', 0, 1, 1, { unit: '%' })] },
  25: { name: 'Channel EQ', kit: true, params: [
    onoff('HP 80 Hz'), q('Low', -15, 15, 0, { unit: 'dB' }), q('Mid', -12, 12, 0, { unit: 'dB' }), q('Mid Freq', 120, 7500, 1500, { curve: 'log', unit: 'Hz' }), q('High', -15, 15, 0, { unit: 'dB' }), q('Output', -15, 15, 0, { unit: 'dB' })] },
  26: { name: 'Erosion', kit: true, params: [list('Mode', ['Noise', 'Wide Noise', 'Sine'], 0), q('Freq', 100, 18000, 670, { curve: 'log', unit: 'Hz' }), q('Width', 0.08, 10, 0.3, { curve: 'log', unit: '' }), q('Amount', 0, 1, 0.6, { unit: '%' })] },
  27: { name: 'Redux', kit: true, params: [
    q('Rate', 200, 40000, 40000, { curve: 'log', unit: 'Hz' }), q('Jitter', 0, 1, 0, { unit: '%' }), onoff('Pre Filter', 1), q('Bits', 1, 16, 8, { step: 1, fmt: 'num' }), onoff('Quantize'),
    q('Shape', 0, 1, 0, { unit: '%' }), onoff('DC Shift'), q('Dry/Wet', 0, 1, 1, { unit: '%' })] },
  28: { name: 'Vinyl Distortion', kit: true, params: [
    onoff('Tracing', 1), q('Tracing Drive', 0, 1, 0.14, { unit: '' }), q('Tracing Freq', 20, 20000, 10400, { curve: 'log', unit: 'Hz' }), q('Tracing Width', 0.1, 10, 1.67, { curve: 'log', unit: '' }),
    onoff('Pinch', 1), q('Pinch Drive', 0, 1, 0.14, { unit: '' }), q('Pinch Freq', 20, 20000, 5080, { curve: 'log', unit: 'Hz' }), q('Pinch Width', 0.1, 10, 3, { curve: 'log', unit: '' }),
    list('Stereo', ['Stereo', 'Mono'], 0), list('Pinch Type', ['Soft', 'Hard'], 1), q('Crackle Volume', 0, 1, 0, { unit: '' }), q('Density', 0, 1, 0, { unit: '' }), q('Drive', 0, 2, 1, { unit: '' })] },
  29: { name: 'Drum Buss', kit: true, params: [
    q('Drive', 0, 1, 0.45, { unit: '%' }), list('Type', ['Soft', 'Medium', 'Hard'], 2), q('Trim', -12, 0, -12, { unit: 'dB' }), onoff('Comp', 1), q('Crunch', 0, 1, 0, { unit: '%' }),
    q('Damp', 4500, 20000, 20000, { curve: 'log', unit: 'Hz' }), q('Transients', -1, 1, -0.45, { unit: '' }), q('Boom', 0, 1, 0, { unit: '%' }), q('Freq', 30, 90, 49, { unit: 'Hz' }),
    q('Decay', 0, 1, 1, { unit: '%' }), q('Output', -24, 12, -4, { unit: 'dB' }), q('Dry/Wet', 0, 1, 1, { unit: '%' })] },
  30: { name: 'Tuner', kit: true, params: [q('Reference', 410, 480, 440, { unit: 'Hz' })] },
});

// Live 12 redesign of the original effects: the indices stay, new parameters are appended (an older project gets their defaults on load,
// migrate() maps an old meaning onto the new parameters where one changed).
{
  const D = DEVICES, rn = (t, k, n) => { D[t].params[k].n = n; }, show = (t, ...ks) => { for (const k of ks) delete D[t].params[k].hidden; };
  Object.assign(D[0], { kit: true, migrate: (p, n0) => { if (n0 <= 4 && p[2] > 0.5) p[4] = 1; } });          // old Invert flipped both channels
  rn(0, 1, 'Balance'); rn(0, 2, 'Phase L');
  D[0].params.push(onoff('Phase R'), list('Channel', ['Stereo', 'Left', 'Right', 'Swap'], 0), q('Width', 0, 4, 1, { fmt: 'width' }), onoff('Bass Mono'),
    q('Bass Freq', 50, 500, 120, { curve: 'log', unit: 'Hz' }), onoff('Mute'), onoff('DC'));
  Object.assign(D[1], { kit: true }); show(1, 0, 3, 9);
  D[1].params.push(q('Drive', 0, 24, 0, { unit: 'dB' }), q('Dry/Wet', 0, 1, 1, { unit: '%' }), q('LFO Phase', 0, 360, 0, { fmt: 'deg' }));
  Object.assign(D[2], { kit: true }); rn(2, 0, 'GainLow'); rn(2, 1, 'GainMid'); rn(2, 2, 'GainHi'); rn(2, 4, 'FreqLow'); rn(2, 5, 'FreqHi'); D[2].params[3].hidden = true;   // the crossover EQ has no mid frequency
  D[2].params.push(onoff('Low On', 1), onoff('Mid On', 1), onoff('High On', 1), list('Slope', ['24', '48'], 0));
  Object.assign(D[3], { kit: true }); rn(3, 1, 'Dry/Wet');
  D[3].params.push(list('Type', ['Analog Clip', 'Soft Sine', 'Medium Curve', 'Hard Curve', 'Sinoid Fold', 'Digital Clip'], 0), onoff('Soft Clip'));
  Object.assign(D[4], { kit: true }); rn(4, 4, 'Output'); rn(4, 6, 'Dry/Wet');
  D[4].params.push(list('Mode', ['Peak', 'RMS', 'Expand'], 0), onoff('Makeup'), list('Lookahead', ['0 ms', '1 ms', '10 ms'], 0), list('Env', ['Lin', 'Log'], 1), onoff('Auto Release'));
  Object.assign(D[5], { kit: true });
  Object.assign(D[6], { kit: true }); show(6, 3, 7, 8, 9, 10);
  Object.assign(D[7], { kit: true }); rn(7, 1, 'Damping'); rn(7, 2, 'Dry/Wet'); rn(7, 3, 'Predelay');
  D[7].params.push(q('Width', 0, 1, 1, { unit: '%' }), onoff('Freeze'), q('Lo Cut', 20, 2000, 20, { curve: 'log', unit: 'Hz' }), q('Hi Cut', 1000, 20000, 20000, { curve: 'log', unit: 'Hz' }));
  D[31] = { name: 'EQ Eight', kit: true, params: [...Array.from({ length: 8 }, (_, b) => [onoff((b + 1) + ' On', b === 0 || b === 7 ? 0 : 1), list((b + 1) + ' Type', ['Low Cut 48', 'Low Cut 12', 'Low Shelf', 'Bell', 'Notch', 'High Shelf', 'High Cut 12', 'High Cut 48'], [1, 2, 3, 3, 3, 3, 5, 6][b]),
    q((b + 1) + ' Freq', 10, 22000, [30, 100, 250, 1000, 2500, 5000, 10000, 18000][b], { curve: 'log', unit: 'Hz' }), q((b + 1) + ' Gain', -15, 15, 0, { unit: 'dB' }), q((b + 1) + ' Q', 0.1, 18, 0.71, { curve: 'log', unit: '' })]).flat(),
    q('Scale', -2, 2, 1, { fmt: 'width' }), q('Gain', -12, 12, 0, { unit: 'dB' })] };
  D[32] = { name: 'Spectrum', kit: true, params: [list('Block', ['1024', '2048', '4096', '8192', '16384'], 2), list('Channel', ['L', 'R', 'L+R'], 2), q('Avg', 1, 20, 4, { step: 1, fmt: 'num' }),
    list('Graph', ['Line', 'Bins'], 0), onoff('Max'), list('Scale X', ['Lin', 'Log', 'ST'], 1), onoff('Auto', 1)] };
}

// ---- Live 12 effects, part 2 (engine: js/engine/fx4.js)
{
  const pct = (n, d) => q(n, 0, 1, d, { unit: '%' }), dB = (n, lo, hi, d) => q(n, lo, hi, d, { unit: 'dB' }), ten = (n, d) => q(n, 0, 10, d, { unit: '' });
  Object.assign(DEVICES, {
    33: { name: 'Amp', kit: true, params: [list('Type', ['Clean', 'Boost', 'Blues', 'Rock', 'Lead', 'Heavy', 'Bass'], 2), ten('Gain', 6.9), ten('Bass', 6.27), ten('Middle', 5.79), ten('Treble', 4.44), ten('Presence', 2.62), ten('Volume', 8.25), list('Output', ['Mono', 'Stereo'], 0), pct('Dry/Wet', 1)] },
    34: { name: 'Cabinet', kit: true, params: [list('Cabinet', ['1x12', '2x12', '4x12', '4x10 Bass'], 1), list('Microphone', ['Condenser', 'Dynamic'], 1), list('Position', ['Near On-Axis', 'Near Off-Axis', 'Far'], 0), list('Output', ['Mono', 'Stereo'], 0), pct('Dry/Wet', 1)] },
    35: { name: 'Overdrive', kit: true, params: [q('Filter Freq', 50, 20000, 1100, { curve: 'log', unit: 'Hz' }), q('Bandwidth', 0.5, 9, 6, { unit: '' }), pct('Drive', 0.5), pct('Tone', 0.5), pct('Dynamics', 0.5), pct('Dry/Wet', 1)] },
    36: { name: 'Pedal', kit: true, params: [list('Type', ['OD', 'Distort', 'Fuzz'], 0), pct('Gain', 0.5), dB('Output', -20, 20, 0), q('Bass', -1, 1, 0, { fmt: 'pct1' }), q('Mid', -1, 1, 0, { fmt: 'pct1' }), q('Treble', -1, 1, 0, { fmt: 'pct1' }), list('Mid Freq', ['Low', 'Mid', 'High'], 1), onoff('Sub'), pct('Dry/Wet', 1)] },
    37: { name: 'Dynamic Tube', kit: true, params: [dB('Drive', -12, 24, 0), pct('Bias', 0.5), q('Envelope', -1, 1, 0, { fmt: 'pct1' }), list('Tube', ['A', 'B', 'C'], 0), pct('Tone', 0.5), q('Attack', 0.1, 300, 10, { curve: 'log', unit: 'ms' }), q('Release', 1, 3000, 100, { curve: 'log', unit: 'ms' }), dB('Output', -24, 12, 0), pct('Dry/Wet', 1)] },
    38: { name: 'Multiband Dynamics', kit: true, params: [q('Low Split', 20, 1000, 120, { curve: 'log', unit: 'Hz' }), q('High Split', 500, 16000, 2500, { curve: 'log', unit: 'Hz' }),
      ...['Low', 'Mid', 'High'].flatMap((b) => [onoff(b + ' On', 1), dB(b + ' Input', -24, 24, 6), dB(b + ' Output', -24, 24, 0), dB(b + ' Above', -60, 0, -12), q(b + ' Ratio A', 0.5, 20, 4, { curve: 'log', unit: ':1' }),
        dB(b + ' Below', -80, 0, -40), q(b + ' Ratio B', 0.5, 4, 1, { unit: ':1' }), q(b + ' Attack', 0.1, 300, 10, { curve: 'log', unit: 'ms' }), q(b + ' Release', 1, 3000, 100, { curve: 'log', unit: 'ms' })]),
      pct('Amount', 1), q('Time', 0.1, 10, 1, { curve: 'log', unit: 'x' }), dB('Output', -24, 12, 0), onoff('Soft Knee'), onoff('RMS')] },
    39: { name: 'Resonators', kit: true, params: [onoff('Filter', 1), q('Frequency', 50, 20000, 50, { curve: 'log', unit: 'Hz' }), list('Filter Type', ['LP', 'BP', 'HP', 'Notch'], 2), list('Mode', ['A', 'B'], 0), pct('Decay', 0.77), onoff('Const'), pct('Color', 0.857),
      onoff('I On', 1), q('Note', 24, 96, 43, { step: 1, fmt: 'note' }), q('I Fine', -50, 50, 0, { unit: 'ct' }), dB('I Gain', -48, 0, 0),
      ...['II', 'III', 'IV', 'V'].flatMap((r, k) => [onoff(r + ' On', 1), q(r + ' Pitch', -24, 24, [7, 7, 3, 12][k], { step: 1, fmt: 'st' }), q(r + ' Fine', -50, 50, 0, { unit: 'ct' }), dB(r + ' Gain', -48, 0, 0)]),
      pct('Width', 1), dB('Gain', -24, 24, 0), pct('Dry/Wet', 0.49)] },
    40: { name: 'Corpus', kit: true, params: [list('Type', ['Beam', 'Marimba', 'String', 'Membrane', 'Plate', 'Pipe', 'Tube'], 3), list('Quality', ['Eco', 'Mid', 'High'], 1), pct('Decay', 0.5), pct('Material', 0.84),
      q('Bright', -1, 1, 0, { fmt: 'pct1' }), q('Inharm', -1, 1, 0, { fmt: 'pct1' }), pct('Ratio', 0.5), pct('Hit', 0.5), pct('Width', 1), pct('Pos. L', 0.47), pct('Pos. R', 0.82),
      q('Tune', 20, 2000, 65.41, { curve: 'log', unit: 'Hz' }), q('Fine', -50, 50, 0, { unit: 'ct' }), q('Spread', -1, 1, 0, { fmt: 'pct1' }), onoff('LFO'), pct('LFO Amount', 0.5), q('LFO Rate', 0.01, 20, 0.5, { curve: 'log', unit: 'Hz' }),
      onoff('Filter'), q('Freq', 50, 18000, 1000, { curve: 'log', unit: 'Hz' }), q('Bdwidth', 0.1, 10, 4, { curve: 'log', unit: '' }), pct('Bleed', 0), dB('Gain', -24, 24, -0.5), pct('Dry/Wet', 1)] },
    41: { name: 'Vocoder', kit: true, params: [list('Carrier', ['Noise', 'Modulator', 'Pitch Tracking'], 0), onoff('Enhance'), q('Unvoiced', -60, 0, -60, { fmt: 'dbinf' }), pct('Sens.', 0.5), onoff('Fast'),
      list('Bands', ['4', '8', '12', '16', '20', '24', '32', '40'], 4), q('Range Lo', 20, 2000, 80, { curve: 'log', unit: 'Hz' }), q('Range Hi', 500, 18000, 12000, { curve: 'log', unit: 'Hz' }), q('BW', 0.1, 2, 1, { fmt: 'width' }),
      q('Gate', -60, 0, -60, { fmt: 'dbinf' }), dB('Level', -24, 12, 0), onoff('Precise'), pct('Depth', 1), q('Attack', 0.1, 30, 1, { curve: 'log', unit: 'ms' }), q('Release', 1, 300, 150, { curve: 'log', unit: 'ms' }),
      list('Output', ['Mono', 'Stereo', 'L/R'], 1), q('Formant', -1, 1, 0, { fmt: 'pct1' }), pct('Dry/Wet', 1)] },
    42: { name: 'Shifter', kit: true, params: [list('Mode', ['Pitch', 'Freq', 'Ring'], 0), q('Pitch', -48, 48, 7, { step: 1, fmt: 'st' }), q('Fine', -50, 50, 0, { unit: 'ct' }), q('Freq', -5000, 5000, 100, { unit: 'Hz' }),
      q('Window', 10, 300, 60, { curve: 'log', unit: 'ms' }), pct('Spread', 0), pct('Feedback', 0), q('Tone', 500, 20000, 20000, { curve: 'log', unit: 'Hz' }), pct('Dry/Wet', 1)] },
    43: { name: 'Grain Delay', kit: true, params: [onoff('Sync'), list('16th', DIV16, 3), q('Delay', 1, 1000, 100, { curve: 'log', unit: 'ms' }), q('Spray', 0, 500, 15, { unit: 'ms' }), q('Frequency', 1, 150, 4, { curve: 'log', unit: 'Hz' }),
      q('Pitch', -36, 12, 0, { unit: 'st' }), pct('Rand Pitch', 0), q('Feedback', 0, 0.95, 0, { unit: '%' }), pct('Dry/Wet', 0.5)] },
    44: { name: 'Hybrid Reverb', kit: true, params: [q('Send', -60, 0, 0, { fmt: 'dbinf' }), q('Predelay', 0, 1000, 10, { unit: 'ms' }), pct('Feedback', 0), list('Routing', ['Serial', 'Parallel', 'Algorithm', 'Convolution'], 0), pct('Blend', 0.6),
      list('IR', ['Hall', 'Room', 'Plate', 'Spring', 'Chamber'], 0), pct('IR Decay', 0.6), pct('IR Size', 0.6), list('Algorithm', ['Dark Hall', 'Quartz', 'Shimmer', 'Tides', 'Prism'], 0),
      q('Decay', 0.2, 60, 3.5, { curve: 'log', unit: 's' }), pct('Size', 0.5), pct('Damping', 0.5), pct('Diffusion', 0.7), pct('Mod', 0.5), onoff('Freeze'), onoff('EQ'),
      q('Low Cut', 20, 2000, 20, { curve: 'log', unit: 'Hz' }), q('High Cut', 1000, 20000, 20000, { curve: 'log', unit: 'Hz' }), q('Stereo', 0, 1.2, 1, { fmt: 'width' }), list('Vintage', ['Off', 'Subtle', 'Old', 'Older', 'Extreme'], 0), onoff('Bass Mono'), pct('Dry/Wet', 0.3)] },
    45: { name: 'Looper', kit: true, params: [list('State', ['Stop', 'Record', 'Play', 'Overdub'], 0), list('Length', ['Free', '1 Bar', '2 Bars', '4 Bars', '8 Bars', '16 Bars'], 0), q('Speed', -12, 12, 0, { step: 1, fmt: 'st' }),
      onoff('Reverse'), pct('Feedback', 1), list('Monitor', ['Always', 'Never', 'Rec/OVR', 'Rec/OVR/Stop'], 0), q('Clear', 0, 1000000, 0, { step: 1, hidden: true }), dB('Volume', -24, 12, 0)] },
  });
}

// Audio effect categories as in Live 12's browser. Older devices that have no Live 12 counterpart stay loadable under 'Lainnya (lama)'.
export const FX_GROUPS = [['loop', 'Delay & Loop', [19, 17, 6, 18, 43, 45]], ['drive', 'Drive & Color', [33, 34, 29, 37, 26, 27, 35, 36, 9, 3, 28]], ['dyn', 'Dynamics', [4, 23, 24, 5, 38]],
  ['eq', 'EQ & Filters', [1, 25, 31, 2]], ['mod', 'Pitch & Modulation', [22, 20, 21, 42]], ['rev', 'Reverb & Resonance', [40, 44, 39, 7, 41]], ['util', 'Utilities', [0, 32, 30, 16]], ['old', 'Lainnya (lama)', [8, 13, 10, 12, 14, 15]]];

// Parameter <-> 0..1 mapping shared by knobs, automation editing and the engine sync.
export const normOf = (p, v) => { const x = p.curve === 'log' ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min); return x < 0 ? 0 : x > 1 ? 1 : x; };
export function valOf(p, x) {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  let v = p.curve === 'log' ? p.min * Math.pow(p.max / p.min, x) : p.min + x * (p.max - p.min);
  if (p.step) v = Math.round(v / p.step) * p.step;
  return Math.min(p.max, Math.max(p.min, v));
}

// Preset = { name, cat, p: { parameter index: value } }; parameters not listed return to their defaults.
// Parameter indices follow INSTRUMENTS above (checked against each parameter's min / max by the self-test in the build notes).
export const PRESETS = {
  1: [   // Mini Synth: 0 wave, 1 cutoff, 2 attack, 3 decay, 4 sustain, 5 release, 6 gain
    { cat: 'Bass', name: 'Saw Bass', p: { 0: 0, 1: 900, 2: 0.003, 3: 0.18, 4: 0.5, 5: 0.12, 6: 0.4 } },
    { cat: 'Bass', name: 'Triangle Sub', p: { 0: 2, 1: 400, 2: 0.004, 3: 0.3, 4: 0.85, 5: 0.15, 6: 0.5 } },
    { cat: 'Bass', name: 'Square Funk Bass', p: { 0: 1, 1: 700, 2: 0.002, 3: 0.12, 4: 0.2, 5: 0.08, 6: 0.38 } },
    { cat: 'Lead', name: 'Bright Square Lead', p: { 0: 1, 1: 7500, 2: 0.005, 3: 0.15, 4: 0.8, 5: 0.2, 6: 0.3 } },
    { cat: 'Lead', name: 'Brass Stab', p: { 0: 0, 1: 2600, 2: 0.04, 3: 0.3, 4: 0.55, 5: 0.15, 6: 0.35 } },
    { cat: 'Keys', name: 'Soft Triangle Keys', p: { 0: 2, 1: 6000, 2: 0.01, 3: 0.4, 4: 0.45, 5: 0.35, 6: 0.4 } },
    { cat: 'Keys', name: 'Clav Stab', p: { 0: 1, 1: 2200, 2: 0.001, 3: 0.12, 4: 0, 5: 0.08, 6: 0.4 } },
    { cat: 'Pluck', name: 'Square Pluck', p: { 0: 1, 1: 3200, 2: 0.002, 3: 0.22, 4: 0, 5: 0.18, 6: 0.35 } },
    { cat: 'Pluck', name: 'Bell Pluck', p: { 0: 2, 1: 9000, 2: 0.001, 3: 0.35, 4: 0, 5: 0.5, 6: 0.4 } },
    { cat: 'Pad', name: 'Warm Pad', p: { 0: 0, 1: 1800, 2: 0.8, 3: 1.2, 4: 0.7, 5: 1.8, 6: 0.3 } },
    { cat: 'Pad', name: 'String Ensemble', p: { 0: 0, 1: 3000, 2: 0.35, 3: 0.8, 4: 0.8, 5: 0.9, 6: 0.3 } },
  ],
  2: [   // SuperSaw: 0 detune, 1 mix, 2 cutoff, 3 attack, 4 release, 5 gain
    { cat: 'Lead', name: 'Trance Lead', p: { 0: 35, 1: 0.9, 2: 11000, 3: 0.005, 4: 0.35, 5: 0.3 } },
    { cat: 'Lead', name: 'Hoover Lead', p: { 0: 90, 1: 1, 2: 6000, 3: 0.01, 4: 0.5, 5: 0.28 } },
    { cat: 'Chord', name: 'EDM Chord Stab', p: { 0: 30, 1: 0.8, 2: 7000, 3: 0.002, 4: 0.15, 5: 0.3 } },
    { cat: 'Chord', name: 'Soft Saw Keys', p: { 0: 15, 1: 0.5, 2: 4500, 3: 0.01, 4: 0.6, 5: 0.3 } },
    { cat: 'Pluck', name: 'Super Pluck', p: { 0: 20, 1: 0.6, 2: 5000, 3: 0.001, 4: 0.12, 5: 0.32 } },
    { cat: 'Bass', name: 'Dark Saw Bass', p: { 0: 12, 1: 0.5, 2: 800, 3: 0.004, 4: 0.2, 5: 0.35 } },
    { cat: 'Pad', name: 'Epic Pad', p: { 0: 45, 1: 0.85, 2: 3500, 3: 0.9, 4: 2.2, 5: 0.28 } },
    { cat: 'Pad', name: 'Wide Ambient', p: { 0: 70, 1: 1, 2: 2500, 3: 1.4, 4: 3.5, 5: 0.26 } },
  ],
  10: [   // Sampler: global parameters only (zones keep their samples); 33 osc on, 34 osc wave, 35 osc level, 38 sample level
    { cat: 'Basic', name: 'Init', p: {} },
    { cat: 'Basic', name: 'Octave Down', p: { 2: -12 } },
    { cat: 'Basic', name: 'Wide Stereo', p: { 4: 0.6, 17: 0.12 } },
    { cat: 'Pluck', name: 'Short Pluck', p: { 14: 0.001, 15: 0.25, 16: 0, 17: 0.12, 7: 0.6 } },
    { cat: 'Pluck', name: 'Chop Stab', p: { 15: 0.15, 16: 0, 17: 0.04, 31: 1, 7: 0.8 } },
    { cat: 'Pad', name: 'Soft Pad', p: { 14: 0.6, 17: 1.8, 9: 1, 11: 6000, 4: 0.3 } },
    { cat: 'Pad', name: 'Vibrato Strings', p: { 14: 0.15, 17: 0.6, 24: 0, 25: 5.5, 26: 0.12, 4: 0.25 } },
    { cat: 'Pad', name: 'Slow Filter Pad', p: { 14: 0.9, 17: 2.2, 9: 1, 11: 700, 13: 0.6, 18: 1.4, 19: 1.5, 20: 0.4, 21: 1.5, 4: 0.35 } },
    { cat: 'Layer', name: 'Sub Layer', p: { 33: 1, 34: 0, 35: -6, 38: -6 } },
    { cat: 'Layer', name: 'Saw Layer', p: { 33: 1, 34: 2, 35: -16, 36: -12 } },
    { cat: 'Layer', name: 'Square Octave', p: { 33: 1, 34: 3, 35: -20, 36: 12, 37: 6 } },
    { cat: 'Layer', name: 'Noise Hit', p: { 33: 1, 34: 4, 35: -14, 15: 0.12, 16: 0, 17: 0.08 } },
    { cat: 'Bass', name: 'Pitch Drop Kick', p: { 22: 24, 23: 0.08, 33: 1, 34: 0, 35: -6, 15: 0.3, 16: 0, 17: 0.08 } },
    { cat: 'Bass', name: 'Filter Pluck', p: { 9: 1, 10: 0, 11: 500, 12: 2.5, 13: 0.7, 18: 0.001, 19: 0.25, 20: 0, 21: 0.1, 15: 0.3, 16: 0, 17: 0.1 } },
    { cat: 'Lo-Fi', name: 'Tape Wobble', p: { 9: 1, 11: 4500, 24: 0, 25: 0.6, 26: 0.08, 3: -8 } },
    { cat: 'Lo-Fi', name: 'Radio', p: { 9: 1, 10: 2, 11: 1800, 12: 2.5 } },
    { cat: 'Lo-Fi', name: 'Gated Tremolo', p: { 24: 3, 25: 8, 28: 0.8 } },
    { cat: 'FX', name: 'Auto Pan', p: { 24: 0, 25: 2, 29: 0.8 } },
    { cat: 'Perc', name: 'One-Shot Hit', p: { 14: 0.001, 15: 0.6, 16: 1, 17: 0.45, 7: 0.7 } },
    { cat: 'Perc', name: 'Tight Drum', p: { 14: 0.001, 15: 0.3, 16: 1, 17: 0.12, 7: 0.9 } },
  ],
  11: [   // Wavetable: see INSTRUMENTS[11] (0..8 osc 1, 9..17 osc 2, 18..21 sub, 35..38 amp env, 39..42 env 2, 53+ matrix, 101..105 filter 2)
    { cat: 'Basic', name: 'Init', p: {} },
    { cat: 'Bass', name: 'Sub Wobble', p: { 1: 0.1, 18: 1, 23: 1, 24: 40, 32: 400, 33: 2, 47: 0, 48: 2, 73: 0.5 } },
    { cat: 'Bass', name: 'Analog Saw Bass', p: { 0: 31, 1: 0.5, 23: 1, 24: 30, 32: 900, 33: 1.5, 39: 0.001, 40: 0.3, 41: 0, 57: 0.45, 36: 0.3 } },
    { cat: 'Bass', name: 'Fold Bass', p: { 0: 10, 1: 0.6, 23: 1, 32: 1500, 34: 6 } },
    { cat: 'Bass', name: 'Dual Filter Bass', p: { 0: 31, 1: 0.6, 23: 1, 32: 700, 33: 3, 101: 1, 102: 0, 103: 6000, 104: 1.2, 105: 0, 39: 0.001, 40: 0.25, 41: 0, 57: 0.4 } },
    { cat: 'Lead', name: 'Glass Lead', p: { 0: 3, 1: 0.8, 9: 24, 17: 1, 15: -8, 26: 1, 27: 3, 28: 0.15, 32: 9000 } },
    { cat: 'Lead', name: 'Formant Lead', p: { 0: 16, 1: 0.5, 48: 4, 69: 0.25 } },
    { cat: 'Lead', name: 'Chip Lead', p: { 0: 28, 1: 0.25, 23: 1, 24: 20, 32: 12000 } },
    { cat: 'Pad', name: 'Warm Pad', p: { 0: 31, 9: 32, 17: 1, 15: -8, 35: 0.8, 38: 1.5, 26: 1, 27: 6, 28: 0.35, 32: 3000 } },
    { cat: 'Pad', name: 'Choir Pad', p: { 0: 17, 1: 0.5, 35: 0.9, 38: 2, 51: 0.2, 77: 0.2 } },
    { cat: 'Pad', name: 'Evolving Pad', p: { 0: 13, 1: 0.3, 9: 14, 17: 1, 15: -8, 35: 1.2, 38: 2, 39: 3, 40: 3, 41: 0.8, 53: 0.6 } },
    { cat: 'Pad', name: 'Notch Sweep Pad', p: { 0: 31, 1: 0.5, 35: 0.8, 38: 1.6, 101: 1, 102: 3, 103: 1200, 104: 2, 47: 0, 48: 0.3, 69: 0.3 } },
    { cat: 'Pluck', name: 'Pluck Tine', p: { 0: 23, 1: 0.6, 35: 0.001, 36: 0.35, 37: 0, 38: 0.15 } },
    { cat: 'Keys', name: 'E-Piano', p: { 0: 24, 1: 0.5, 36: 1.2, 37: 0.2, 85: 0.3 } },
    { cat: 'Keys', name: 'Organ', p: { 0: 22, 1: 0.8, 18: 1 } },
    { cat: 'FX', name: 'Noise Sweep', p: { 0: 26, 1: 0.5, 9: 27, 17: 1, 15: -8, 30: 1, 31: 2, 32: 1500, 33: 4, 47: 2, 48: 0.5, 73: 0.8 } },
    { cat: 'FX', name: 'Ring Mod Bell', p: { 0: 7, 1: 0.4, 36: 1.5, 37: 0, 38: 1 } },
    { cat: 'Bass', name: 'Mumbai Growl', p: { 0: 31, 1: 0.5, 2: 0.55, 3: 0.3, 4: 1, 9: 10, 10: 0.4, 11: 0.4, 14: -6, 15: -12, 17: 1, 23: 1, 24: 35, 26: 1, 27: 3, 28: 0.15, 29: -8, 31: 0, 32: 900, 33: 4, 34: 10, 35: 0.001, 36: 0.5, 37: 1, 38: 0.06, 39: 0.001, 40: 0.22, 41: 0, 47: 1, 48: 4.667, 57: 0.3, 69: 0.35, 73: 0.55, 101: 1, 102: 1, 103: 140, 104: 0.707, 105: 0 } },
    { cat: 'Bass', name: 'Neuro Reese', p: { 0: 31, 1: 0.5, 2: 0.3, 7: 12, 9: 31, 10: 0.5, 14: -3, 16: -14, 17: 1, 23: 1, 24: 60, 26: 1, 27: 6, 28: 0.35, 29: -8, 31: 0, 32: 1200, 33: 2.5, 34: 8, 36: 0.6, 37: 1, 38: 0.1, 47: 0, 48: 0.35, 73: 0.4, 101: 1, 102: 3, 103: 900, 104: 3, 105: 0 } },
    { cat: 'Bass', name: 'Yoi Formant', p: { 0: 16, 1: 0.1, 2: 0.4, 3: 0.2, 9: 16, 10: 0.6, 14: -4, 15: 12, 17: 1, 23: 1, 24: 20, 26: 1, 27: 3, 28: 0.1, 29: -8, 31: 0, 32: 3500, 33: 2, 34: 8, 36: 0.4, 37: 1, 38: 0.07, 47: 1, 48: 3.5, 69: 0.8, 71: 0.8, 73: 0.2 } },
    { cat: 'Bass', name: 'Sub Sine', p: { 0: 0, 1: 0, 2: 0, 9: 0, 17: 0, 23: 1, 24: 25, 29: -6, 31: 0, 32: 300, 33: 0.707, 35: 0.003, 36: 0.3, 37: 1, 38: 0.08 } },
    { cat: 'Lead', name: 'Screech Lead', p: { 0: 8, 1: 0.35, 2: 0.4, 4: 2, 9: 30, 10: 0.5, 14: -6, 15: 12, 17: 1, 26: 1, 27: 5, 28: 0.3, 29: -9, 31: 0, 32: 9000, 33: 1.5, 34: 6, 35: 0.002, 36: 0.4, 37: 0.8, 38: 0.2, 39: 0.001, 40: 0.5, 41: 0.3, 47: 0, 48: 5.5, 53: 0.5, 57: 0.2, 70: 0.02, 101: 1, 102: 1, 103: 300, 105: 0 } },
  ],
  4: [   // DirectWave: 0 gain, 1 attack, 2 release, 3 cutoff, 4 tune, 5 vel sens
    { cat: 'Sampler', name: 'Natural', p: {} },
    { cat: 'Sampler', name: 'Soft Swell', p: { 1: 0.35, 2: 1.4, 3: 12000, 5: 0.4 } },
    { cat: 'Sampler', name: 'Tight Pluck', p: { 1: 0.001, 2: 0.1, 5: 0.9 } },
    { cat: 'Sampler', name: 'Lo-Fi Tape', p: { 3: 3500, 4: -1, 5: 0.5 } },
    { cat: 'Sampler', name: 'Octave Down', p: { 2: 0.3, 4: -12 } },
  ],
  9: [   // Keystone: same parameter set as DirectWave
    { cat: 'Sampler', name: 'Natural', p: {} },
    { cat: 'Sampler', name: 'Soft Swell', p: { 1: 0.35, 2: 1.4, 3: 12000, 5: 0.4 } },
    { cat: 'Sampler', name: 'Tight Pluck', p: { 1: 0.001, 2: 0.1, 5: 0.9 } },
    { cat: 'Sampler', name: 'Lo-Fi Tape', p: { 3: 3500, 4: -1, 5: 0.5 } },
    { cat: 'Sampler', name: 'Octave Down', p: { 2: 0.3, 4: -12 } },
  ],
  5: [   // GMS: see INSTRUMENTS[5]
    { cat: 'Bass', name: 'Acid Bass', p: { 0: 1, 1: 80, 2: 700, 3: 7, 4: 0.8, 6: 0.18, 7: 0.15, 8: 0.12, 13: 0.9, 17: 0 } },
    { cat: 'Bass', name: 'Sub Mono', p: { 0: 1, 1: 40, 2: 500, 3: 1, 4: 0.2, 10: 3, 13: 0.9, 14: 3, 15: -1, 17: 0 } },
    { cat: 'Bass', name: 'Reese Bass', p: { 0: 1, 1: 40, 2: 600, 3: 1.5, 4: 0.2, 5: 0.005, 6: 0.4, 7: 0.8, 8: 0.2, 10: 0, 11: -1, 12: -9, 13: 0.7, 14: 0, 15: -1, 16: 9, 17: 0.7, 18: 1, 19: -2, 21: 0.3 } },
    { cat: 'Bass', name: 'Square Bass', p: { 0: 1, 1: 30, 2: 900, 3: 2, 4: 0.5, 6: 0.2, 7: 0.5, 8: 0.12, 10: 1, 11: -1, 13: 0.8, 14: 3, 15: -2, 17: 0.5 } },
    { cat: 'Bass', name: 'Funk Bass', p: { 0: 1, 1: 10, 2: 500, 3: 3, 4: 0.7, 6: 0.15, 7: 0.2, 8: 0.1, 10: 0, 11: -1, 13: 0.8, 17: 0 } },
    { cat: 'Lead', name: 'Fat Lead', p: { 0: 1, 1: 120, 2: 4500, 3: 2, 4: 0.3, 5: 0.005, 7: 0.8, 13: 0.7, 16: 7, 17: 0.6, 18: 1, 20: -7, 21: 0.4 } },
    { cat: 'Lead', name: 'Saw Stack Lead', p: { 0: 1, 1: 60, 2: 5000, 3: 1.4, 4: 0.3, 5: 0.004, 6: 0.3, 7: 0.7, 8: 0.25, 10: 0, 13: 0.6, 14: 0, 16: 12, 17: 0.55, 18: 0, 19: 1, 20: -8, 21: 0.4 } },
    { cat: 'Pluck', name: 'Pluck Arp', p: { 2: 3500, 3: 2, 4: 0.5, 6: 0.12, 7: 0, 8: 0.15, 13: 0.8, 14: 1, 17: 0.5, 22: 1, 24: 2, 25: 2, 26: 0.5 } },
    { cat: 'Pluck', name: 'Rave Stab', p: { 0: 0, 2: 3500, 3: 2.5, 4: 0.6, 5: 0.002, 6: 0.18, 7: 0, 8: 0.12, 10: 0, 13: 0.6, 14: 1, 15: 0, 16: -10, 17: 0.5 } },
    { cat: 'Pluck', name: 'Electric Piano', p: { 2: 3000, 3: 0.8, 4: 0.3, 5: 0.003, 6: 0.9, 7: 0, 8: 0.3, 10: 2, 13: 0.7, 14: 3, 15: 1, 17: 0.25 } },
    { cat: 'Arp', name: 'Gate Arp Up', p: { 2: 4000, 3: 1.5, 4: 0.4, 5: 0.002, 6: 0.15, 7: 0.3, 8: 0.15, 10: 1, 13: 0.6, 14: 0, 16: 6, 17: 0.4, 22: 1, 23: 0, 24: 2, 25: 2, 26: 0.55 } },
    { cat: 'Arp', name: 'Trance Arp Up-Down', p: { 2: 6000, 3: 1.2, 4: 0.5, 5: 0.002, 6: 0.12, 7: 0.2, 8: 0.1, 10: 0, 13: 0.6, 14: 0, 16: 10, 17: 0.5, 22: 1, 23: 2, 24: 3, 25: 3, 26: 0.45 } },
    { cat: 'Pad', name: 'Pad Chord', p: { 2: 2200, 3: 1, 4: 0.2, 5: 0.4, 6: 1, 7: 0.8, 8: 0.9, 13: 0.5, 16: 7, 17: 0.5, 20: -5, 21: 0.4 } },
    { cat: 'Pad', name: 'Warm Poly Pad', p: { 0: 0, 2: 1500, 3: 1, 4: 0.15, 5: 0.8, 6: 1.5, 7: 0.7, 8: 1.6, 10: 0, 13: 0.5, 14: 2, 16: 6, 17: 0.5 } },
  ],
  7: [   // Moisture
    { cat: 'Bass', name: 'Wavetable Bass', p: { 0: 0.1, 1: 0.5, 2: 0.4, 3: -1, 4: 0.5, 5: 1, 7: 0, 8: 700, 9: 2, 10: 0.5, 11: 0.003, 12: 0.3, 13: 0.6, 14: 0.15, 15: 3, 16: 0.2 } },
    { cat: 'Bass', name: 'Sub Bass', p: { 0: 0, 1: 0.1, 2: 0, 4: 0.7, 8: 900, 9: 1, 10: 0.4, 11: 0.002, 12: 0.2, 13: 0.6, 14: 0.15 } },
    { cat: 'Lead', name: 'Hollow Lead', p: { 0: 0.45, 1: 0.95, 2: 0.5, 5: 2, 6: 10, 8: 4500, 9: 2, 10: 0.3, 11: 0.01, 13: 0.8, 14: 0.25, 15: 5, 16: 0.15 } },
    { cat: 'Lead', name: 'Growl Lead', p: { 0: 0.5, 1: 0.9, 2: 0.7, 5: 3, 6: 15, 7: 0, 8: 2500, 9: 4, 10: 0.6, 11: 0.004, 12: 0.4, 13: 0.7, 14: 0.2, 15: 5, 16: 0.5 } },
    { cat: 'Pluck', name: 'Glass Pluck', p: { 0: 0.8, 1: 0.9, 2: 0.4, 3: 1, 5: 2, 6: 8, 8: 5000, 9: 1.5, 10: 0.5, 11: 0.002, 12: 0.25, 13: 0, 14: 0.35 } },
    { cat: 'Pluck', name: 'Digital Pluck', p: { 0: 0.7, 1: 0.3, 2: 0.5, 3: 1, 5: 2, 6: 10, 8: 6500, 9: 1.2, 10: 0.6, 11: 0.001, 12: 0.2, 13: 0, 14: 0.25 } },
    { cat: 'Keys', name: 'Metallic Keys', p: { 0: 0.9, 1: 0.6, 2: 0.5, 3: 1, 5: 1, 8: 8000, 9: 1, 10: 0.3, 11: 0.002, 12: 0.7, 13: 0.1, 14: 0.6 } },
    { cat: 'Pad', name: 'Warm Wave Pad', p: { 0: 0.15, 1: 0.35, 2: 0.6, 5: 3, 6: 18, 8: 2500, 10: 0.1, 11: 0.6, 12: 1, 13: 0.8, 14: 1.5, 15: 0.2, 16: 0.3 } },
    { cat: 'Pad', name: 'Evolving Pad', p: { 0: 0.2, 1: 0.8, 2: 0.6, 5: 3, 6: 20, 8: 3000, 9: 1, 10: 0.1, 11: 1.2, 12: 1.5, 13: 0.8, 14: 2.5, 15: 0.3, 16: 0.35 } },
    { cat: 'FX', name: 'Morph Sweep', p: { 0: 0.1, 1: 0.9, 2: 0.6, 5: 4, 6: 25, 8: 3500, 10: 0.2, 11: 0.3, 12: 1.2, 13: 0.7, 14: 1, 15: 0.3, 16: 0.9 } },
  ],
  8: [   // Osphere
    { cat: 'Strings', name: 'Warm Strings', p: { 0: 0, 1: 0.5, 2: 0, 3: 12, 4: 0, 5: 0.5, 6: 0, 7: 14, 9: 3200, 11: 0.5, 12: 1, 13: 0.6, 14: 0.5, 15: 0.2, 16: 0.2 } },
    { cat: 'Strings', name: 'Bright Ensemble', p: { 0: 0, 1: 0.5, 2: 0, 3: 12, 4: 0, 5: 0.4, 6: 1, 7: 14, 8: 0.1, 9: 5500, 10: 0.8, 11: 0.25, 12: 1, 13: 0.7, 14: 0.5, 15: 0.3, 16: 0.3 } },
    { cat: 'Strings', name: 'Cinematic Swell', p: { 0: 0, 1: 0.6, 2: 0, 3: 10, 4: 2, 5: 0.5, 6: -1, 7: 14, 8: 0.2, 9: 2200, 10: 1, 11: 3.5, 12: 5, 13: 0.7, 14: 0.5, 15: 0.4, 16: 0.08 } },
    { cat: 'Vocal', name: 'Air Choir', p: { 0: 3, 1: 0.7, 2: 0, 3: 6, 4: 2, 5: 0.3, 6: 1, 7: 8, 8: 0.35, 9: 2800, 11: 0.9, 12: 1.8, 13: 0.7, 14: 0.6, 15: 0.4, 16: 0.12 } },
    { cat: 'Vocal', name: 'Choir Ahh', p: { 0: 3, 1: 0.6, 2: 0, 3: 5, 4: 2, 5: 0.4, 6: 1, 7: 7, 8: 0.5, 9: 3600, 10: 0.8, 11: 0.5, 12: 1.5, 13: 0.4, 14: 0.3, 15: 0.2, 16: 0.2 } },
    { cat: 'Pad', name: 'Analog Pad', p: { 0: 0, 1: 0.5, 2: 0, 3: 15, 4: 1, 5: 0.4, 6: 0, 7: 12, 8: 0, 9: 1800, 10: 1.2, 11: 0.9, 12: 2.2, 13: 0.6, 14: 0.5, 15: 0.25, 16: 0.12 } },
    { cat: 'Pad', name: 'Glass Pad', p: { 0: 2, 1: 0.6, 2: 1, 3: 10, 4: 3, 5: 0.5, 6: 2, 7: 14, 9: 6500, 11: 0.8, 12: 2.5, 13: 0.8, 14: 0.5, 15: 0.5, 16: 0.1 } },
    { cat: 'Pad', name: 'Ethereal Keys', p: { 0: 3, 1: 0.7, 2: 1, 3: 3, 4: 2, 5: 0.4, 6: 2, 7: 4, 8: 0.15, 9: 7000, 10: 0.8, 11: 0.02, 12: 2.5, 13: 0.5, 14: 0.4, 15: 0.1, 16: 0.3 } },
    { cat: 'Atmos', name: 'Dark Drone', p: { 0: 0, 1: 0.7, 2: -1, 3: 20, 4: 1, 5: 0.4, 6: -1, 7: 22, 8: 0.2, 9: 1200, 10: 1.5, 11: 2.5, 12: 4, 13: 0.4, 14: 0.3, 15: 0.6, 16: 0.06 } },
    { cat: 'Atmos', name: 'Sub Atmosphere', p: { 0: 3, 1: 0.7, 2: -1, 3: 4, 4: 2, 5: 0.3, 6: -2, 7: 3, 8: 0.3, 9: 900, 10: 0.8, 11: 2, 12: 4, 13: 0.3, 14: 0.3, 15: 0.5, 16: 0.05 } },
    { cat: 'Bell', name: 'Soft Bell', p: { 0: 3, 1: 0.6, 2: 1, 3: 3, 4: 3, 5: 0.4, 6: 2, 7: 5, 9: 9000, 11: 0.01, 12: 2.5, 13: 0.3, 14: 0.3, 15: 0 } },
  ],
};

export const noteName = (p) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][p % 12] + (Math.floor(p / 12) - 1);

export function fmtParam(p, v) {
  switch (p.fmt) {
    case 'wave': return ['Saw', 'Square', 'Tri'][Math.round(v)] || '';
    case 'wave4': return ['Saw', 'Square', 'Tri', 'Sine'][Math.round(v)] || '';
    case 'filt3': return ['Low-pass', 'High-pass', 'Band-pass'][Math.round(v)] || '';
    case 'mono': return Math.round(v) ? 'Mono' : 'Poly';
    case 'arppat': return ['Up', 'Down', 'Up-Down', 'Random', 'Played'][Math.round(v)] || '';
    case 'arprate': return ['1/4', '1/8', '1/16', '1/32'][Math.round(v)] || '';
    case 'int': return (v > 0 ? '+' : '') + Math.round(v);
    case 'lphp': return Math.round(v) ? 'High-pass' : 'Low-pass';
    case 'gain': return v < 0.001 ? '-\u221E dB' : (20 * Math.log10(v)).toFixed(1) + ' dB';
    case 'filt4': return ['Low-pass', 'High-pass', 'Band-pass', 'Notch'][Math.round(v)] || '';
    case 'slope': return Math.round(v) ? '24 dB' : '12 dB';
    case 'oscw': return ['Sine', 'Triangle', 'Saw', 'Square', 'Noise'][Math.round(v)] || '';
    case 'f2route': return Math.round(v) ? 'Parallel' : 'Serial';
    case 'lfo5': return ['Sine', 'Triangle', 'Saw', 'Square', 'S&H'][Math.round(v)] || '';
    case 'div': return ['1/16', '1/8', '1/4', '1/2', '1 bar', '1/16T', '1/8T', '1/4T'][Math.round(v)] || '';
    case 'roar6': return ['Soft', 'Hard', 'Fold', 'Sine', 'Bit', 'Noise'][Math.round(v)] || '';
    case 'src': return v < 1 ? 'Off' : 'Trk ' + Math.round(v);
    case 'dist': return ['Soft', 'Hard', 'Fold'][Math.round(v)] || '';
    case 'width': return Math.round(v * 100) + ' %';
    case 'bassmono': return v < 20 ? 'Off' : Math.round(v) + ' Hz';
    case 'onoff': return Math.round(v) ? 'On' : 'Off';
    case 'bpm': return v.toFixed(1) + ' BPM';
    case 'st': return (v > 0 ? '+' : '') + Math.round(v) + ' st';
    case 'num': return String(Math.round(v));
    case 'interp': return Math.round(v) ? 'High' : 'Norm';
    case 'suboct': return ['0', '-1', '-2'][Math.round(v)] || '0';
    case 'umode': return ['None', 'Classic', 'Shimmer', 'Noise', 'Phase Sync', 'Pos Spread', 'Random'][Math.round(v)] || '';
    case 'wfx': return ['None', 'FM', 'Classic', 'Modern'][Math.round(v)] || '';
    case 'wtab': return wtName(v);
    case 'list16': return Math.round(v) % 16 === 0 ? Math.round(v) / 16 + (Math.round(v) === 16 ? ' Bar' : ' Bars') : Math.round(v) + '/16';
    case 'note': return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][Math.round(v) % 12] + (Math.floor(Math.round(v) / 12) - 1);   // same octave numbering as the piano roll (60 = C4)
    case 'list': return (p.items || [])[Math.round(v - p.min)] ?? '';
    case 'dbinf': return v <= -60 ? '-inf dB' : v.toFixed(1) + ' dB';
    case 'deg': return Math.round(v) + '\u00B0';
    case 'pct1': return (v * 100).toFixed(1) + ' %';
    case 'pan': return Math.abs(v) < 0.01 ? 'C' : (v < 0 ? Math.round(-v * 50) + 'L' : Math.round(v * 50) + 'R');
  }
  if (p.unit === '%') return Math.round(v * 100) + ' %';
  if (p.unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz';
  if (p.unit === 's') return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
  if (p.unit === 'ms') return v < 10 ? v.toFixed(1) + ' ms' : Math.round(v) + ' ms';
  if (p.unit === ':1') return v.toFixed(1) + ':1';
  if (p.unit) return v.toFixed(1) + ' ' + p.unit;
  return v.toFixed(2);
}

// v72: the factory preset library (js/presetlib.js) adds 100 presets each to Mini Synth, SuperSaw, GMS, Moisture and Osphere. Merged per category
// (first-seen order), so the preset menu shows every category heading once.
{
  const extra = factoryPresets(INSTRUMENTS, Object.fromEntries(Object.entries(PRESETS).map(([t, L]) => [t, L.map((x) => x.name)])));
  for (const [t, L] of Object.entries(extra)) {
    const all = [...(PRESETS[t] || []), ...L], order = [];
    for (const x of all) if (!order.includes(x.cat)) order.push(x.cat);
    PRESETS[t] = order.flatMap((c) => all.filter((x) => x.cat === c));
  }
}
