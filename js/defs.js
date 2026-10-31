import { factoryPresets } from './presetlib.js';
import { wtName, WT_COUNT } from './engine/live.js';
// Instrument + device definitions. Parameter ORDER must match the C++ side
// (app/src/main/cpp/instruments.h and devices.h).
export const INST = { MINISYNTH: 1, SUPERSAW: 2, DRUM: 3, DIRECTWAVE: 4, GMS: 5, SOUNDFONT: 6, MOISTURE: 7, OSPHERE: 8, KEYSTONE: 9, SAMPLER: 10, WAVETABLE: 11 };
// Instruments a synth/sampler track can switch between (drums have their own track type).
export const INST_LIST = [17, 16, 15, 14, 13, 11, 10, 1, 2, 4, 5, 6, 7, 8, 9, 12];

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
      pct('Amount', 1), q('Time', 0.1, 10, 1, { curve: 'log', unit: 'x' }), dB('Output', -24, 12, 0), onoff('Soft Knee'), onoff('RMS'), onoff('Low Solo'), onoff('Mid Solo'), onoff('High Solo')] },
    39: { name: 'Resonators', kit: true, params: [onoff('Filter', 1), q('Frequency', 50, 20000, 50, { curve: 'log', unit: 'Hz' }), list('Filter Type', ['LP', 'BP', 'HP', 'Notch'], 2), list('Mode', ['A', 'B'], 0), pct('Decay', 0.77), onoff('Const'), pct('Color', 0.857),
      onoff('I On', 1), q('Note', 24, 96, 43, { step: 1, fmt: 'note' }), q('I Fine', -50, 50, 0, { unit: 'ct' }), dB('I Gain', -48, 0, 0),
      ...['II', 'III', 'IV', 'V'].flatMap((r, k) => [onoff(r + ' On', 1), q(r + ' Pitch', -24, 24, [7, 7, 3, 12][k], { step: 1, fmt: 'st' }), q(r + ' Fine', -50, 50, 0, { unit: 'ct' }), dB(r + ' Gain', -48, 0, 0)]),
      pct('Width', 1), dB('Gain', -24, 24, 0), pct('Dry/Wet', 0.49)] },
    40: { name: 'Corpus', kit: true, params: [list('Type', ['Beam', 'Marimba', 'String', 'Membrane', 'Plate', 'Pipe', 'Tube'], 3), list('Quality', ['Eco', 'Mid', 'High'], 1), pct('Decay', 0.5), pct('Material', 0.84),
      q('Bright', -1, 1, 0, { fmt: 'pct1' }), q('Inharm', -1, 1, 0, { fmt: 'pct1' }), pct('Ratio', 0.5), pct('Hit', 0.5), pct('Width', 1), pct('Pos. L', 0.47), pct('Pos. R', 0.82),
      q('Tune', 20, 2000, 65.41, { curve: 'log', unit: 'Hz' }), q('Fine', -50, 50, 0, { unit: 'ct' }), q('Spread', -1, 1, 0, { fmt: 'pct1' }), onoff('LFO'), pct('LFO Amount', 0.5), q('LFO Rate', 0.01, 20, 0.5, { curve: 'log', unit: 'Hz' }),
      onoff('Filter'), q('Freq', 50, 18000, 1000, { curve: 'log', unit: 'Hz' }), q('Bdwidth', 0.1, 10, 4, { curve: 'log', unit: '' }), pct('Bleed', 0), dB('Gain', -24, 24, -0.5), pct('Dry/Wet', 1),
      list('LFO Shape', ['Sine', 'Square', 'Triangle', 'Saw Up', 'Saw Down', 'Random'], 0), onoff('LFO Sync'), list('LFO Sync Rate', ['1/16', '1/8', '1/4', '3/8', '1/2', '1', '2', '4'], 4),
      q('LFO Phase', 0, 360, 0, { fmt: 'deg' }), q('LFO Offset', 0, 360, 0, { fmt: 'deg' })] },
    41: { name: 'Vocoder', kit: true, params: [list('Carrier', ['Noise', 'Modulator', 'Pitch Tracking'], 0), onoff('Enhance'), q('Unvoiced', -60, 0, -60, { fmt: 'dbinf' }), pct('Sens.', 0.5), onoff('Fast'),
      list('Bands', ['4', '8', '12', '16', '20', '24', '32', '40'], 4), q('Range Lo', 20, 2000, 80, { curve: 'log', unit: 'Hz' }), q('Range Hi', 500, 18000, 12000, { curve: 'log', unit: 'Hz' }), q('BW', 0.1, 2, 1, { fmt: 'width' }),
      q('Gate', -60, 0, -60, { fmt: 'dbinf' }), dB('Level', -24, 12, 0), onoff('Precise'), pct('Depth', 1), q('Attack', 0.1, 30, 1, { curve: 'log', unit: 'ms' }), q('Release', 1, 300, 150, { curve: 'log', unit: 'ms' }),
      list('Output', ['Mono', 'Stereo', 'L/R'], 1), q('Formant', -1, 1, 0, { fmt: 'pct1' }), pct('Dry/Wet', 1), pct('Noise Rate', 1), pct('Crackle', 0)] },
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

// ---- Live 12 effects, part 3: spectral devices (engine: js/engine/fx5.js)
{
  const pct = (n, d) => q(n, 0, 1, d, { unit: '%' }), NOTES = ['1/32', '1/16', '1/8', '1/4', '1/2', '1 Bar', '2 Bars', '4 Bars'];
  Object.assign(DEVICES, {
    46: { name: 'Spectral Time', kit: true, params: [onoff('Freezer On', 1), list('Freeze Mode', ['Manual', 'Retrigger'], 1), list('Retrigger', ['Onsets', 'Sync'], 1), onoff('Freeze'),
      onoff('Interval Sync', 1), list('Interval', NOTES, 2), q('Interval Time', 10, 5000, 250, { curve: 'log', unit: 'ms' }), pct('Sensitivity', 0.5), list('Fade Type', ['Crossfade', 'Envelope'], 0), pct('X-Fade', 0.25),
      onoff('Delay On', 1), q('Time', 10, 3500, 250, { curve: 'log', unit: 'ms' }), q('Feedback', 0, 0.98, 0.21, { unit: '%' }), q('Shift', -1000, 1000, 0, { unit: 'Hz' }),
      list('Mode', ['Time', 'Notes', '16th', '16th Triplet', '16th Dotted'], 0), list('Notes', NOTES, 2), q('16th', 1, 16, 3, { step: 1, fmt: 'num' }), q('Stereo', -1, 1, 0, { fmt: 'pct1' }), pct('Mix', 0.5),
      q('Tilt', -1000, 1000, 0, { unit: 'ms' }), q('Spray', 0, 1000, 0, { unit: 'ms' }), q('Mask', -1, 1, 0, { unit: '' })] },
    47: { name: 'Spectral Resonator', kit: true, params: [list('Mode', ['Internal', 'MIDI'], 0), q('MIDI From', 0, 64, 0, { step: 1, fmt: 'midisrc' }), q('Freq', 20, 4000, 110, { curve: 'log', unit: 'Hz' }),
      q('Transp.', -48, 48, 0, { step: 1, fmt: 'st' }), q('Decay', 0.01, 20, 2.6, { curve: 'log', unit: 's' }), pct('HF Damp', 0), pct('LF Damp', 0), q('Stretch', -1, 1, 0, { fmt: 'pct1' }), q('Shift', -48, 48, 0, { unit: 'st' }),
      list('Mod', ['None', 'Chorus', 'Wander', 'Granular'], 0), pct('Mod Rate', 0.1), q('Pch.Mod', 0, 12, 0, { unit: 'st' }), q('Harmonics', 1, 256, 128, { step: 1, fmt: 'num' }), list('Polyphony', ['Mono', 'Poly'], 1),
      q('Voices', 1, 16, 16, { step: 1, fmt: 'num' }), list('Unison', ['1', '2', '4', '8'], 0), pct('Uni.Amt', 0.2), q('Input Send', -36, 12, 0, { unit: 'dB' }), pct('Dry/Wet', 0.5)] },
  });
}

// ---- Live 12 modulators (engine: js/engine/fx6.js). Mapping block at the end of each (MOD_MAP[type] = its first index):
// Map Mode, Bipolar, Mod Amount, Min, Max, then hidden: target strip, device index (-1 = instrument), parameter, target min / max / log, base value
export const MOD_MAP = { 48: 14, 49: 35, 50: 6 };
export const IRACK_DEF = { name: 'Instrument Rack', rack: true, params: [] };   // filled below with the Audio Effect Rack parameters + key / velocity zones
{
  const pct = (n, d) => q(n, 0, 1, d, { unit: '%' }), NOTES = ['1/32', '1/16', '1/8', '1/4', '1/2', '1 Bar', '2 Bars', '4 Bars'], H = { hidden: true };
  const map = () => [list('Map Mode', ['Remap', 'Mod'], 0), onoff('Bipolar'), pct('Mod Amount', 0.5), pct('Min', 0), pct('Max', 1),
    q('Map Strip', -1, 72, -1, { step: 1, ...H }), q('Map Device', -1, 16, 0, { step: 1, ...H }), q('Map Param', 0, 255, 0, { step: 1, ...H }),
    q('Map Lo', -1e6, 1e6, 0, H), q('Map Hi', -1e6, 1e6, 1, H), q('Map Log', 0, 1, 0, { step: 1, ...H }), q('Map Base', -1e6, 1e6, 0, H)];
  const pts = [0, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5, 1, 1, 0];
  Object.assign(DEVICES, {
    48: { name: 'LFO', kit: true, mod: true, params: [list('Waveform', ['Sine', 'Saw Up', 'Saw Down', 'Triangle', 'Rectangle', 'Random', 'Binary Noise'], 0), q('Shape', -1, 1, 0, { fmt: 'pct1' }),
      q('Steps', 0, 16, 0, { step: 1, fmt: 'steps' }), pct('Jitter', 0), pct('Smooth', 0), q('Rate', 0.01, 40, 1, { curve: 'log', unit: 'Hz' }), onoff('Sync'), list('Sync Rate', NOTES, 3), onoff('x10'),
      pct('Depth', 1), q('Offset', -1, 1, 0, { fmt: 'pct1' }), pct('Phase', 0), onoff('Hold'), q('Retrigger', 0, 1e6, 0, { step: 1, ...H }), ...map()] },
    49: { name: 'Shaper', kit: true, mod: true, params: [q('Rate', 0.01, 40, 1, { curve: 'log', unit: 'Hz' }), onoff('Sync'), list('Sync Rate', NOTES, 3), pct('Depth', 1), q('Offset', -1, 1, 0, { fmt: 'pct1' }),
      pct('Phase', 0), pct('Jitter', 0), pct('Smooth', 0), q('Grid', 1, 16, 4, { step: 1, fmt: 'num' }), onoff('Snap', 1), q('Points', 2, 8, 4, { step: 1, ...H }),
      ...Array.from({ length: 8 }, (_, j) => [q(`P${j + 1} X`, 0, 1, j < 4 ? pts[j * 3] : 1, H), q(`P${j + 1} Y`, 0, 1, j < 4 ? pts[j * 3 + 1] : 0, H), q(`P${j + 1} Curve`, -1, 1, j < 4 ? pts[j * 3 + 2] : 0, H)]).flat(), ...map()] },
    50: { name: 'Envelope Follower', kit: true, mod: true, params: [q('Gain', -24, 24, 0, { unit: 'dB' }), pct('Rise', 0.157), pct('Fall', 0.134), q('Delay', 0, 1000, 63, { unit: 'ms' }), onoff('Delay Sync'), list('Delay Note', NOTES, 2), ...map()] },
  });
}

// ---- Live 12 instruments (full: true = the project sends every parameter, stored or default, so engine and panel never disagree)
{
  const ms = (n, d, max = 20000) => q(n, 0.5, max, d, { curve: 'log', unit: 'ms' }), pct = (n, d) => q(n, 0, 1, d, { unit: '%' }), bi = (n, d = 0) => q(n, -1, 1, d, { fmt: 'pct1' });
  const SRC = ['Env 1', 'Env 2', 'LFO', 'Velocity', 'Key', 'Random'], DEST = ['Off', 'Osc 1 Gain', 'Osc 2 Gain', 'Noise Gain', 'Shape', 'Osc 2 Detune', 'Pitch', 'Filter Freq', 'Res', 'HP', 'LFO Rate', 'Amp', 'Pan'];
  const gain = (n, d) => q(n, -60, 0, d, { fmt: 'dbinf' });
  INSTRUMENTS[13] = { name: 'Drift', view: 'kit', full: true, params: [
    list('Osc 1 Wave', ['Sine', 'Triangle', 'Shark Tooth', 'Saturated', 'Saw', 'Pulse', 'Rectangle'], 0), q('Osc 1 Oct', -2, 3, 0, { step: 1, fmt: 'num' }), q('Shape', 0, 1, 0, { unit: '' }),
    list('Shape Mod', SRC, 0), bi('Shape Mod Amt'), list('Osc 2 Wave', ['Sine', 'Triangle', 'Saturated', 'Saw', 'Rectangle'], 3), q('Osc 2 Oct', -2, 3, -1, { step: 1, fmt: 'num' }), q('Detune', -12, 12, 0, { unit: '' }),
    list('Pitch Mod 1', SRC, 1), bi('Pitch Mod 1 Amt'), list('Pitch Mod 2', SRC, 2), bi('Pitch Mod 2 Amt', 0.047),
    onoff('Osc 1 On', 1), gain('Osc 1 Gain', -3.7), onoff('Osc 1 Filter', 1), onoff('Osc 2 On', 1), gain('Osc 2 Gain', -60), onoff('Osc 2 Filter', 1), onoff('Noise On', 1), gain('Noise Gain', -7.4), onoff('Noise Filter', 1),
    onoff('Reset'), q('Freq', 20, 20000, 3280, { curve: 'log', unit: 'Hz' }), list('Type', ['I', 'II'], 1), q('Key', 0, 1, 1, { unit: '' }), q('Res', 0, 1, 0, { unit: '' }), q('HP', 10, 1000, 10, { curve: 'log', unit: 'Hz' }),
    list('Freq Mod 1', SRC, 1), bi('Freq Mod 1 Amt'), list('Freq Mod 2', SRC, 2), bi('Freq Mod 2 Amt'),
    ms('Env 1 Attack', 2), ms('Env 1 Decay', 600), pct('Env 1 Sustain', 0.096), ms('Env 1 Release', 491), ms('Env 2 Attack', 1), ms('Env 2 Decay', 600), pct('Env 2 Sustain', 0.7), ms('Env 2 Release', 600), onoff('Env 2 Cycle'),
    list('LFO Wave', ['Sine', 'Triangle', 'Saw Up', 'Saw Down', 'Square', 'S&H', 'Wander', 'Linear Env', 'Exp Env'], 0), list('LFO Mode', ['Hz', 'Ratio', 'Time', 'Sync'], 1), q('LFO Rate', 0.01, 40, 1, { curve: 'log', unit: 'Hz' }),
    q('LFO Ratio', 1, 1600, 100, { curve: 'log', fmt: 'ratio' }), q('LFO Time', 25, 10000, 1000, { curve: 'log', unit: 'ms' }), list('LFO Sync', ['1/16', '1/8', '1/4', '1/2', '1 Bar', '2 Bars', '4 Bars'], 2), onoff('LFO Retrig'),
    pct('LFO Amount', 1), list('LFO Mod', SRC, 1), bi('LFO Mod Amt'),
    list('Mode', ['Poly', 'Mono', 'Stereo', 'Unison'], 0), list('Voices', ['2', '4', '6', '8', '12', '16', '24', '32'], 7), pct('Drift', 0.072), onoff('Legato'), q('Glide', 0, 5000, 0, { unit: 'ms' }),
    q('Volume', -60, 6, -0.3, { fmt: 'dbinf' }), pct('Vel > Vol', 0.1), q('Transpose', -48, 48, 0, { step: 1, fmt: 'st' }), q('PB Range', 0, 48, 7, { step: 1, fmt: 'st' }),
    ...[0, 1, 2].flatMap((m) => [list(`Mod ${m + 1} Source`, SRC, [0, 2, 3][m]), list(`Mod ${m + 1} Target`, DEST, 0), bi(`Mod ${m + 1} Amount`)])] };
}

// Operator (instrument 14, engine js/engine/operator.js): operator o (A = 0 .. D = 3) at 16 * o
{
  const ms = (n, d) => q(n, 0.1, 20000, Math.max(0.1, d), { curve: 'log', unit: 'ms' }), dB = (n, d) => q(n, -60, 0, d, { fmt: 'dbinf' });
  const op = (o) => { const L = 'ABCD'[o]; return [onoff(`${L} On`, 1), q(`${L} Coarse`, 0, 48, 1, { step: 1, fmt: 'coarse' }), q(`${L} Fine`, 0, 1000, 0, { step: 1, fmt: 'num' }), onoff(`${L} Fixed`),
    q(`${L} Freq`, 1, 20000, 100, { curve: 'log', unit: 'Hz' }), q(`${L} Multi`, 0.01, 10, 1, { curve: 'log', unit: '' }), dB(`${L} Level`, [0, -12, -60, -60][o]),
    list(`${L} Wave`, ['Sine', 'Saw', 'Square', 'Triangle', 'Noise'], 0), q(`${L} Feedback`, 0, 1, 0, { unit: '%' }), q(`${L} Vel > Level`, 0, 1, 0.5, { unit: '%' }),
    ms(`${L} Attack`, 0), ms(`${L} Decay`, 600), dB(`${L} Sustain`, o ? -12 : -6), ms(`${L} Release`, 300), dB(`${L} Initial`, -60), dB(`${L} Peak`, 0)]; };
  INSTRUMENTS[14] = { name: 'Operator', view: 'kit', full: true, params: [...op(0), ...op(1), ...op(2), ...op(3), ...[0, 1, 2, 3].map((o) => list(`${'ABCD'[o]} Loop`, ['None', 'Loop', 'Trigger'], 0)),
    q('Algorithm', 0, 10, 0, { step: 1, fmt: 'algo' }), onoff('Filter On'), list('Filter Type', ['Low', 'High', 'Band'], 0), q('Filter Freq', 20, 20000, 18000, { curve: 'log', unit: 'Hz' }), q('Filter Res', 0, 1, 0.1, { unit: '%' }),
    q('Filter Env', -1, 1, 0, { fmt: 'pct1' }), ms('Filter Attack', 5), ms('Filter Decay', 400), q('Pan', -1, 1, 0, { fmt: 'pan' }), q('Time', -2, 2, 0, { fmt: 'pct1' }), q('Tone', 0, 1, 0.7, { unit: '%' }),
    q('Volume', -60, 6, -6, { fmt: 'dbinf' }), q('Transpose', -48, 48, 0, { step: 1, fmt: 'st' }), q('Spread', 0, 1, 0, { unit: '%' }), q('PB Range', 0, 48, 5, { step: 1, fmt: 'st' }), q('Voices', 1, 16, 6, { step: 1, fmt: 'num' })] };
}

// Analog (instrument 15, engine js/engine/analog.js): Osc o at 12 * o, Noise 24.., Fil f at 28 + 12 * f, 52 To F2, 53 Follow, Amp a at 54 + 8 * a,
// LFO l at 70 + 5 * l, global 80..89, 90 = engine Pitch (unused here), 91 Free
{
  const ms = (n, d) => q(n, 0.5, 20000, d, { curve: 'log', unit: 'ms' }), dB = (n, d) => q(n, -60, 0, d, { fmt: 'dbinf' }), pct = (n, d) => q(n, 0, 1, d, { unit: '%' });
  const osc = (o) => { const L = `Osc${o + 1}`; return [onoff(`${L} On`, o ? 1 : 1), dB(`${L} Level`, o ? -3.5 : 0), q(`${L} F1/F2`, 0, 1, 0, { fmt: 'f1f2' }), list(`${L} Shape`, ['Sine', 'Saw', 'Rectangle', 'Noise'], 1),
    q(`${L} Octave`, -3, 3, o ? 1 : 0, { step: 1, fmt: 'num' }), q(`${L} Semi`, -12, 12, o ? 7 : 0, { step: 1, fmt: 'st' }), q(`${L} Detune`, -1, 1, o ? -0.04 : 0, { unit: '' }), pct(`${L} PW`, 0),
    q(`${L} Sub`, 0, 1, 0, { unit: '%' }), q(`${L} PEG`, -1, 1, 0, { fmt: 'pct1' }), q(`${L} LFO`, 0, 1, 0, { unit: '%' }), onoff(`${L} Key`, 1)]; };
  const fil = (f) => { const L = `Fil${f + 1}`; return [onoff(`${L} On`, 1), list(`${L} Type`, ['LP12', 'LP24', 'BP6', 'BP12', 'Notch', 'HP12', 'HP24'], f ? 0 : 1), q(`${L} Freq`, 20, 20000, f ? 1000 : 1200, { curve: 'log', unit: 'Hz' }),
    q(`${L} Res`, 0, 1, 0.2, { unit: '' }), q(`${L} Env`, -1, 1, 0.3, { fmt: 'pct1' }), q(`${L} Key`, 0, 1, 0, { unit: '' }), list(`${L} Drive`, ['Off', 'Sym1', 'Sym2', 'Sym3', 'Asym1', 'Asym2', 'Asym3'], f ? 0 : 1),
    ms(`${L} Attack`, 16), ms(`${L} Decay`, 600), pct(`${L} Sustain`, 0.3), ms(`${L} Release`, 400), q(`${L} LFO`, 0, 1, 0, { unit: '%' })]; };
  const amp = (a) => { const L = `Amp${a + 1}`; return [onoff(`${L} On`, a ? 0 : 1), dB(`${L} Level`, 0), q(`${L} Pan`, -1, 1, 0, { fmt: 'pan' }), ms(`${L} Attack`, 2), ms(`${L} Decay`, 600), pct(`${L} Sustain`, 0.7), ms(`${L} Release`, 300), q(`${L} LFO`, 0, 1, 0, { unit: '%' })]; };
  const lfo = (l) => { const L = `LFO${l + 1}`; return [onoff(`${L} On`, 1), list(`${L} Wave`, ['Sine', 'Triangle', 'Rectangle', 'S&H', 'Noise'], 0), q(`${L} Rate`, 0.01, 30, 2, { curve: 'log', unit: 'Hz' }), onoff(`${L} Retrig`), q(`${L} Phase`, 0, 1, 0, { unit: '%' })]; };
  INSTRUMENTS[15] = { name: 'Analog', view: 'kit', full: true, params: [...osc(0), ...osc(1), onoff('Noise On', 0), dB('Noise Level', 0), q('Noise F1/F2', 0, 1, 0, { fmt: 'f1f2' }), q('Noise Color', 20, 20000, 682, { curve: 'log', unit: 'Hz' }),
    ...fil(0), ...fil(1), pct('To F2', 1), onoff('Follow'), ...amp(0), ...amp(1), ...lfo(0), ...lfo(1),
    list('Voices', ['Mono', '2', '4', '6', '8', '12', '16', '24', '32'], 4), list('Unison', ['Off', '2', '3', '4'], 0), q('Uni Detune', 0, 1, 0.2, { unit: '' }), q('Glide', 0, 2000, 0, { unit: 'ms' }), onoff('Legato'),
    q('Vibrato', 0, 1, 0, { unit: '%' }), q('Vib Rate', 0.1, 12, 5, { curve: 'log', unit: 'Hz' }), q('Volume', -60, 6, -6, { fmt: 'dbinf' }), q('PB Range', 0, 48, 2, { step: 1, fmt: 'st' }), list('Env Slope', ['LIN', 'EXP'], 1),
    { n: '-', min: 0, max: 1, def: 0, hidden: true }, onoff('Free')] };
}

// Poli (instrument 16, engine js/engine/poli.js): see the index list at the top of poli.js
{
  const ms = (n, d) => q(n, 0.5, 20000, d, { curve: 'log', unit: 'ms' }), pct = (n, d) => q(n, 0, 1, d, { unit: '%' }), bi = (n, d = 0) => q(n, -1, 1, d, { unit: '%' });
  const TGT = ['LPF', 'HPF', 'Vol', 'Pitch', 'PWM', 'RM Freq', 'LFO Freq'], GD = { 'LPF,0': 0.11, 'LPF,1': 0.72, 'LPF,2': 0.39, 'HPF,0': 0.09, 'HPF,1': -0.54, 'Vol,0': 0.02, 'Vol,1': 0.7, 'PWM,1': -0.15, 'PWM,2': 0.4, 'RM Freq,1': 0.08 };
  const grid = []; for (let t = 0; t < 7; t++) for (let sI = 0; sI < 3; sI++) { if ((t === 2 && sI === 2) || (t === 6 && sI !== 1)) continue; grid.push(bi(`${TGT[t]} < ${['LFO', 'Filter Env', 'Amp Env'][sI]}`, GD[TGT[t] + ',' + sI] || 0)); }
  const midi = []; for (let t = 0; t < 7; t++) for (let sI = 0; sI < 2; sI++) midi.push(bi(`${TGT[t]} < ${['Velocity', 'Key'][sI]}`, 0));
  INSTRUMENTS[16] = { name: 'Poli', view: 'kit', full: true, params: [pct('XMod', 0), q('PW', 0, 1, 0.59, { unit: '%' }), list('Sub Wave', ['Square', 'Saw'], 1), q('Color', 0, 1, 0.84, { unit: '' }), list('RM Source', ['Saw', 'Pulse'], 0),
    pct('Saw', 0.646), pct('Pulse', 0.795), pct('Sub', 0.693), pct('Noise', 0.0866), pct('Ring', 0.0157), q('Freq', 0, 2000, 0, { unit: 'Hz' }),
    list('LFO Shape', ['Sine', 'Triangle', 'Saw Up', 'Saw Down', 'Square', 'S&H', 'Noise'], 0), onoff('Sync', 1), onoff('LFO Retrig', 1), q('Rate', 0.01, 30, 2, { curve: 'log', unit: 'Hz' }), list('Sync Rate', ['1/16', '1/8', '1/4', '1/2', '1 Bar', '2 Bars', '4 Bars'], 0),
    q('Fade-In', 0, 10, 1.49, { unit: 's' }), onoff('Sub Boost', 1), q('HPF', 10, 2000, 9.45, { curve: 'log', unit: 'Hz' }), q('LPF', 20, 20000, 35.4 * 100, { curve: 'log', unit: 'Hz' }), q('Res', 0, 1, 0.31, { unit: '%' }), onoff('Loop'),
    ms('Filter Attack', 72.6), ms('Filter Decay', 672), pct('Filter Sustain', 0.803), ms('Filter Release', 131), ...grid, ...midi,
    list('Chorus', ['-', 'A', 'B', 'C'], 2), pct('Random Pan', 0.2), q('Volume', -60, 6, -8.2, { fmt: 'dbinf' }), q('PB Range', 0, 24, 2, { step: 1, fmt: 'st' }), onoff('PB All', 1),
    list('Glide', ['Off', 'On', 'Legato'], 0), q('Glide Time', 0, 2000, 11.5, { unit: 'ms' }), list('Voices', ['Poly', 'Mono', 'Unison'], 0), pct('Spread', 0),
    ms('Attack', 128), ms('Decay', 1960), pct('Sustain', 0.921), ms('Release', 1740)] };
}

// Meld (instrument 17, engine js/engine/meld.js): engine A at 0, globals at 68, placeholders 76..90 (90 = engine Pitch), engine B at 91
{
  const ms = (n, d) => q(n, 0.5, 20000, d, { curve: 'log', unit: 'ms' }), pct = (n, d) => q(n, 0, 1, d, { unit: '%' }), bi = (n, d = 0) => q(n, -1, 1, d, { unit: '%' });
  const OSC = ['Basic Shapes', 'Swarm Sine', 'Harmonic FM', 'Fold FM', 'Squelch', 'Noise Loop', 'Bitgrinder', 'Chip'], LW = ['Sine', 'Triangle', 'Saw', 'Square', 'S&H', 'Wander'], SY = ['1/16', '1/8', '1/4', '1/2', '1 Bar', '2 Bars', '4 Bars'];
  const TGT = ['Osc Macro 1', 'Osc Macro 2', 'Filter Freq', 'Filter Macro 1', 'Filter Macro 2', 'LFO 1 Rate'], SRC = ['A Env', 'M Env', 'LFO 1', 'LFO 2', 'Vel'];
  const eng = (e) => { const L = 'AB'[e]; return [list(`${L} Osc`, OSC, 0), q(`${L} Oct`, -3, 3, 0, { step: 1, fmt: 'oct' }), q(`${L} Semi`, -12, 12, 0, { step: 1, fmt: 'sd' }), q(`${L} Fine`, -50, 50, 0, { step: 1, unit: 'ct' }),
    q(`${L} Shape`, 0, 1, e ? 0 : 0.246, { fmt: 'mac' }), q(`${L} Tone`, 0, 1, e ? 0 : 0.484, { fmt: 'mac' }), list(`${L} Filter`, ['SVF 12dB', 'SVF 24dB', 'Ladder', 'Comb'], 0), q(`${L} Freq`, 20, 20500, 20500, { curve: 'log', unit: 'Hz' }),
    q(`${L} Q`, 0, 1, 0, { fmt: 'num2' }), q(`${L} L-B-H-N`, 0, 1, 0, { fmt: 'num2' }), q(`${L} Pan`, -1, 1, 0, { fmt: 'pan' }), q(`${L} Tone Tilt`, -1, 1, 0, { fmt: 'num2' }), q(`${L} Level`, -60, 6, -3, { fmt: 'dbinf' }), onoff(`${L} On`, e ? 0 : 1),
    ms(`${L} A Attack`, 2), ms(`${L} A Decay`, 600), pct(`${L} A Sustain`, 0.7), ms(`${L} A Release`, 300), ms(`${L} M Attack`, 10), ms(`${L} M Decay`, 800), pct(`${L} M Sustain`, 0), ms(`${L} M Release`, 300),
    list(`${L} LFO 1 Wave`, LW, 0), onoff(`${L} LFO 1 Sync`), q(`${L} LFO 1 Rate`, 0.01, 40, 0.24, { curve: 'log', unit: 'Hz' }), list(`${L} LFO 1 Sync Rate`, SY, 2), bi(`${L} LFO 1 Shape`), pct(`${L} LFO 1 Fold`, 0), q(`${L} LFO 1 Phase`, 0, 360, 0, { fmt: 'deg' }), onoff(`${L} LFO 1 Retrig`),
    bi(`${L} LFO 1 Attenuv.`, 1), q(`${L} LFO 1 Fade In`, 0, 10, 0, { unit: 's' }), list(`${L} LFO 2 Wave`, LW, 0), onoff(`${L} LFO 2 Sync`), q(`${L} LFO 2 Rate`, 0.01, 40, 6, { curve: 'log', unit: 'Hz' }), list(`${L} LFO 2 Sync Rate`, SY, 2), q(`${L} LFO 2 Phase`, 0, 360, 0, { fmt: 'deg' }), onoff(`${L} LFO 2 Retrig`),
    ...TGT.flatMap((t) => SRC.map((sN) => bi(`${L} ${t} < ${sN}`, 0)))]; };
  const ph = Array.from({ length: 15 }, () => ({ n: '-', min: 0, max: 1, def: 0, hidden: true }));
  INSTRUMENTS[17] = { name: 'Meld', view: 'kit', full: true, params: [...eng(0), list('Voice Mode', ['Poly', 'Mono'], 0), q('Voices', 1, 16, 8, { step: 1, fmt: 'num' }), pct('Spread', 0), list('Stack', ['Off', '2', '3', '4'], 0),
    pct('Drive', 0), q('Volume', -60, 6, 0, { fmt: 'dbinf' }), onoff('Limit', 1), q('PB Range', 0, 24, 2, { step: 1, fmt: 'st' }), ...ph, ...eng(1)] };
}

// ---- Audio Effect Rack (engine: js/engine/fx7.js; project: d.chains, d.macroMap)
{
  const H = { hidden: true }, P = [];
  for (let c = 0; c < 8; c++) P.push(q(`Chain ${c + 1} Volume`, -60, 6, 0, { fmt: 'dbinf' }), q(`Chain ${c + 1} Pan`, -1, 1, 0, { fmt: 'pan' }), onoff(`Chain ${c + 1} On`, 1), onoff(`Chain ${c + 1} Solo`));
  P.push(q('Chains', 0, 8, 1, { step: 1, ...H }));
  for (let m = 0; m < 8; m++) P.push(q(`Macro ${m + 1}`, 0, 1, 0, { fmt: 'macro' }));
  for (let m = 0; m < 8; m++) P.push(q(`M${m + 1} Chain`, -1, 7, -1, { step: 1, ...H }), q(`M${m + 1} Device`, 0, 15, 0, { step: 1, ...H }), q(`M${m + 1} Param`, 0, 255, 0, { step: 1, ...H }),
    q(`M${m + 1} Lo`, -1e6, 1e6, 0, H), q(`M${m + 1} Hi`, -1e6, 1e6, 1, H), q(`M${m + 1} Log`, 0, 1, 0, { step: 1, ...H }), q(`M${m + 1} Min`, 0, 1, 0, { unit: '%' }), q(`M${m + 1} Max`, 0, 1, 1, { unit: '%' }));
  P.push(q('Chain Selector', 0, 127, 0, { step: 1, fmt: 'num' })); for (let c = 0; c < 8; c++) P.push(q(`Chain ${c + 1} Zone Low`, 0, 127, 0, { step: 1, fmt: 'num' }), q(`Chain ${c + 1} Zone High`, 0, 127, 127, { step: 1, fmt: 'num' }));
  DEVICES[51] = { name: 'Audio Effect Rack', kit: true, rack: true, params: P };
  // Instrument Rack (instrument type 12): the same rack parameters plus key and velocity zones per chain; stored at 100 + k in the instrument
  // parameters (90 is the engine's Pitch), so INSTRUMENTS[12].params starts with 100 hidden placeholders
  const IP = P.map((x) => (/ Device$/.test(x.n) ? { ...x, min: -1 } : x));
  for (let c = 0; c < 8; c++) IP.push(q(`Chain ${c + 1} Key Low`, 0, 127, 0, { step: 1, fmt: 'note' }), q(`Chain ${c + 1} Key High`, 0, 127, 127, { step: 1, fmt: 'note' }));
  for (let c = 0; c < 8; c++) IP.push(q(`Chain ${c + 1} Vel Low`, 1, 127, 1, { step: 1, fmt: 'num' }), q(`Chain ${c + 1} Vel High`, 1, 127, 127, { step: 1, fmt: 'num' }));
  IRACK_DEF.params = IP;
  INSTRUMENTS[12] = { name: 'Instrument Rack', view: 'irack', params: [...Array.from({ length: 100 }, () => ({ n: '-', min: 0, max: 1, def: 0, hidden: true })), ...IP] };
}

// Audio effect categories as in Live 12's browser. Older devices that have no Live 12 counterpart stay loadable under 'Lainnya (lama)'.
export const FX_GROUPS = [['loop', 'Delay & Loop', [19, 17, 6, 18, 43, 45, 46]], ['drive', 'Drive & Color', [33, 34, 29, 37, 26, 27, 35, 36, 9, 3, 28]], ['dyn', 'Dynamics', [4, 23, 24, 5, 38]],
  ['eq', 'EQ & Filters', [1, 25, 31, 2]], ['mod', 'Pitch & Modulation', [22, 20, 21, 42]], ['rev', 'Reverb & Resonance', [40, 44, 39, 7, 47, 41]], ['modu', 'Modulators', [50, 48, 49]], ['util', 'Utilities', [51, 0, 32, 30, 16]], ['old', 'Lainnya (lama)', [8, 13, 10, 12, 14, 15]]];

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
    case 'midisrc': return v < 1 ? 'This Track' : 'Track ' + Math.round(v);
    case 'dist': return ['Soft', 'Hard', 'Fold'][Math.round(v)] || '';
    case 'width': return Math.round(v * 100) + ' %';
    case 'bassmono': return v < 20 ? 'Off' : Math.round(v) + ' Hz';
    case 'onoff': return Math.round(v) ? 'On' : 'Off';
    case 'bpm': return v.toFixed(1) + ' BPM';
    case 'st': return (v > 0 ? '+' : '') + Math.round(v) + ' st';
    case 'num': return String(Math.round(v));
    case 'macro': return String(Math.round(v * 127));
    case 'f1f2': return v < 0.02 ? 'F1' : v > 0.98 ? 'F2' : Math.round((1 - v) * 100) + '/' + Math.round(v * 100);
    case 'oct': return Math.round(v) + ' oct';
    case 'sd': return Math.round(v) + ' sd';
    case 'mac': return (v * 100).toFixed(1);
    case 'num2': return v.toFixed(2);
    case 'coarse': return v < 0.5 ? '0.5' : String(Math.round(v));
    case 'algo': return String(Math.round(v) + 1);
    case 'ratio': return (v / 100).toFixed(2);
    case 'steps': return v < 2 ? 'Off' : String(Math.round(v));
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
  if (p.unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : v < 10 ? v.toFixed(2) + ' Hz' : v < 100 ? v.toFixed(1) + ' Hz' : Math.round(v) + ' Hz';   // LFO rates below 10 Hz keep their decimals
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
