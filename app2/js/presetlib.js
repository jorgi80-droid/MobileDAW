// v72 factory preset library: 100 extra presets for Mini Synth, SuperSaw, GMS, Moisture and Osphere.
// Each instrument has 20 hand-designed base patches (keyed by parameter NAME, so the list survives parameter re-ordering); every base comes in
// five versions: as designed, Deep (darker), Bright, Soft (slower attack, longer tail) and Tight (shorter envelope). Values are clamped to the
// parameter ranges and stepped parameters are rounded. Pure data: no imports, defs.js passes its INSTRUMENTS table in.

const B = {
  1: [ // Mini Synth: Wave (0 saw, 1 square, 2 triangle), Cutoff, Attack, Decay, Sustain, Release, Gain
    ['Bass', 'Round Saw Bass', { Wave: 0, Cutoff: 900, Attack: 0.003, Decay: 0.18, Sustain: 0.5, Release: 0.12, Gain: 0.28 }],
    ['Bass', 'Square Bass', { Wave: 1, Cutoff: 700, Attack: 0.002, Decay: 0.25, Sustain: 0.4, Release: 0.1, Gain: 0.2 }],
    ['Bass', 'Triangle Sub', { Wave: 2, Cutoff: 400, Attack: 0.005, Decay: 0.4, Sustain: 0.9, Release: 0.15, Gain: 0.22 }],
    ['Bass', 'Plucked Bass', { Wave: 0, Cutoff: 1200, Attack: 0.001, Decay: 0.12, Sustain: 0, Release: 0.08, Gain: 0.23 }],
    ['Lead', 'Classic Saw Lead', { Wave: 0, Cutoff: 6000, Attack: 0.01, Decay: 0.3, Sustain: 0.8, Release: 0.3, Gain: 0.19 }],
    ['Lead', 'Hollow Square Lead', { Wave: 1, Cutoff: 4500, Attack: 0.01, Decay: 0.2, Sustain: 0.85, Release: 0.25, Gain: 0.17 }],
    ['Lead', 'Mellow Lead', { Wave: 2, Cutoff: 3000, Attack: 0.04, Decay: 0.4, Sustain: 0.8, Release: 0.4, Gain: 0.21 }],
    ['Lead', 'Chip Lead', { Wave: 1, Cutoff: 12000, Attack: 0.001, Decay: 0.1, Sustain: 0.7, Release: 0.05, Gain: 0.2 }],
    ['Pluck', 'Saw Pluck', { Wave: 0, Cutoff: 3000, Attack: 0.001, Decay: 0.22, Sustain: 0, Release: 0.25, Gain: 0.22 }],
    ['Pluck', 'Square Pluck', { Wave: 1, Cutoff: 2500, Attack: 0.001, Decay: 0.18, Sustain: 0, Release: 0.2, Gain: 0.2 }],
    ['Pluck', 'Triangle Pluck', { Wave: 2, Cutoff: 5000, Attack: 0.001, Decay: 0.3, Sustain: 0, Release: 0.35, Gain: 0.23 }],
    ['Keys', 'Square Organ', { Wave: 1, Cutoff: 5000, Attack: 0.005, Decay: 0.1, Sustain: 1, Release: 0.08, Gain: 0.16 }],
    ['Keys', 'Soft Keys', { Wave: 2, Cutoff: 4000, Attack: 0.005, Decay: 0.8, Sustain: 0.3, Release: 0.5, Gain: 0.21 }],
    ['Pad', 'Saw Pad', { Wave: 0, Cutoff: 2500, Attack: 0.8, Decay: 1.5, Sustain: 0.8, Release: 2, Gain: 0.2 }],
    ['Pad', 'Square Pad', { Wave: 1, Cutoff: 2000, Attack: 0.9, Decay: 1.5, Sustain: 0.75, Release: 2.2, Gain: 0.17 }],
    ['Pad', 'Triangle Pad', { Wave: 2, Cutoff: 3000, Attack: 1, Decay: 1, Sustain: 0.9, Release: 2.5, Gain: 0.2 }],
    ['Brass', 'Saw Brass', { Wave: 0, Cutoff: 2200, Attack: 0.06, Decay: 0.5, Sustain: 0.7, Release: 0.25, Gain: 0.19 }],
    ['FX', 'Zap', { Wave: 0, Cutoff: 16000, Attack: 0.001, Decay: 0.06, Sustain: 0, Release: 0.05, Gain: 0.22 }],
    ['FX', 'Blip', { Wave: 1, Cutoff: 9000, Attack: 0.001, Decay: 0.04, Sustain: 0, Release: 0.04, Gain: 0.2 }],
    ['FX', 'Low Drone', { Wave: 0, Cutoff: 800, Attack: 1.5, Decay: 2, Sustain: 1, Release: 3, Gain: 0.19 }],
  ],
  2: [ // SuperSaw: Detune, Mix, Cutoff, Attack, Release, Gain
    ['Lead', 'Hoover Lead', { Detune: 60, Mix: 0.9, Cutoff: 9000, Attack: 0.005, Release: 0.3, Gain: 0.29 }],
    ['Lead', 'Anthem Lead', { Detune: 35, Mix: 0.85, Cutoff: 12000, Attack: 0.01, Release: 0.4, Gain: 0.29 }],
    ['Lead', 'Soft Saw Lead', { Detune: 20, Mix: 0.6, Cutoff: 5000, Attack: 0.03, Release: 0.5, Gain: 0.32 }],
    ['Lead', 'Thin Lead', { Detune: 10, Mix: 0.4, Cutoff: 14000, Attack: 0.005, Release: 0.2, Gain: 0.28 }],
    ['Pad', 'Huge Pad', { Detune: 45, Mix: 1, Cutoff: 6000, Attack: 0.9, Release: 2.5, Gain: 0.26 }],
    ['Pad', 'Warm Saw Pad', { Detune: 25, Mix: 0.8, Cutoff: 3000, Attack: 1.2, Release: 3, Gain: 0.28 }],
    ['Pad', 'Air Pad', { Detune: 60, Mix: 1, Cutoff: 14000, Attack: 1.5, Release: 4, Gain: 0.22 }],
    ['Pad', 'Night Pad', { Detune: 30, Mix: 0.9, Cutoff: 1500, Attack: 1, Release: 3, Gain: 0.3 }],
    ['Stab', 'Rave Stab', { Detune: 40, Mix: 0.9, Cutoff: 8000, Attack: 0.001, Release: 0.15, Gain: 0.3 }],
    ['Stab', 'Chord Stab', { Detune: 30, Mix: 0.8, Cutoff: 6000, Attack: 0.001, Release: 0.25, Gain: 0.3 }],
    ['Pluck', 'Saw Pluck', { Detune: 25, Mix: 0.7, Cutoff: 4000, Attack: 0.001, Release: 0.2, Gain: 0.32 }],
    ['Bass', 'Saw Bass', { Detune: 15, Mix: 0.5, Cutoff: 900, Attack: 0.003, Release: 0.15, Gain: 0.38 }],
    ['Bass', 'Reese', { Detune: 50, Mix: 0.7, Cutoff: 700, Attack: 0.01, Release: 0.2, Gain: 0.36 }],
    ['Strings', 'Saw Strings', { Detune: 18, Mix: 0.7, Cutoff: 4500, Attack: 0.35, Release: 1.2, Gain: 0.28 }],
    ['Brass', 'Saw Brass', { Detune: 22, Mix: 0.75, Cutoff: 3500, Attack: 0.06, Release: 0.4, Gain: 0.3 }],
    ['Pad', 'Slow Swell', { Detune: 55, Mix: 1, Cutoff: 8000, Attack: 2, Release: 3, Gain: 0.25 }],
    ['Pad', 'Shimmer', { Detune: 70, Mix: 1, Cutoff: 16000, Attack: 0.5, Release: 2, Gain: 0.22 }],
    ['Keys', 'Saw Organ', { Detune: 8, Mix: 0.5, Cutoff: 7000, Attack: 0.005, Release: 0.1, Gain: 0.3 }],
    ['FX', 'Riser', { Detune: 100, Mix: 1, Cutoff: 18000, Attack: 1.8, Release: 0.5, Gain: 0.22 }],
    ['FX', 'Drone', { Detune: 80, Mix: 1, Cutoff: 2000, Attack: 2, Release: 5, Gain: 0.25 }],
  ],
  5: [ // GMS: three oscillators, filter + envelope, mono/poly, arpeggiator
    ['Bass', 'Mono Saw Bass', { Mode: 1, Glide: 40, Cutoff: 900, Reso: 2, 'Env Amt': 0.6, Attack: 0.002, Decay: 0.25, Sustain: 0.4, Release: 0.12, Gain: 0.42, 'O1 Wave': 0, 'O1 Oct': -1, 'O1 Level': 0.8, 'O2 Wave': 1, 'O2 Oct': -1, 'O2 Fine': 6, 'O2 Level': 0.5, 'O3 Level': 0 }],
    ['Bass', 'Sub Square Bass', { Mode: 1, Cutoff: 600, Reso: 1, 'Env Amt': 0.3, Attack: 0.003, Decay: 0.3, Sustain: 0.7, Release: 0.15, Gain: 0.45, 'O1 Wave': 1, 'O1 Oct': -1, 'O1 Level': 0.7, 'O2 Level': 0, 'O3 Wave': 3, 'O3 Oct': -2, 'O3 Level': 0.6 }],
    ['Bass', 'Squelch Bass', { Mode: 1, Glide: 80, Cutoff: 400, Reso: 7, 'Env Amt': 0.85, Attack: 0.002, Decay: 0.2, Sustain: 0.1, Release: 0.1, Gain: 0.15, 'O1 Wave': 0, 'O1 Oct': -1, 'O1 Level': 0.9, 'O2 Level': 0, 'O3 Level': 0 }],
    ['Bass', 'Fat Bass', { Mode: 1, Cutoff: 1200, Reso: 1.5, 'Env Amt': 0.4, Attack: 0.003, Decay: 0.35, Sustain: 0.6, Release: 0.15, Gain: 0.26, 'O1 Wave': 0, 'O1 Oct': -1, 'O1 Level': 0.7, 'O2 Wave': 0, 'O2 Oct': -1, 'O2 Fine': 14, 'O2 Level': 0.7, 'O3 Wave': 1, 'O3 Oct': -2, 'O3 Level': 0.4 }],
    ['Lead', 'Bright Mono Lead', { Mode: 1, Glide: 30, Cutoff: 5000, Reso: 2.5, 'Env Amt': 0.3, Attack: 0.005, Decay: 0.3, Sustain: 0.8, Release: 0.25, Gain: 0.25, 'O1 Wave': 0, 'O1 Level': 0.7, 'O2 Wave': 1, 'O2 Oct': 1, 'O2 Fine': 5, 'O2 Level': 0.5 }],
    ['Lead', 'Glide Lead', { Mode: 1, Glide: 180, Cutoff: 3500, Reso: 3, 'Env Amt': 0.4, Attack: 0.01, Decay: 0.4, Sustain: 0.85, Release: 0.3, Gain: 0.17, 'O1 Wave': 0, 'O1 Level': 0.8, 'O2 Wave': 0, 'O2 Fine': 10, 'O2 Level': 0.6 }],
    ['Lead', 'Square Lead', { Mode: 1, Glide: 20, Cutoff: 4000, Reso: 1.5, 'Env Amt': 0.2, Attack: 0.005, Decay: 0.2, Sustain: 0.9, Release: 0.2, Gain: 0.29, 'O1 Wave': 1, 'O1 Level': 0.8, 'O2 Wave': 1, 'O2 Oct': 1, 'O2 Level': 0.3 }],
    ['Lead', 'Sine Lead', { Mode: 1, Glide: 60, Cutoff: 6000, Reso: 1, 'Env Amt': 0.1, Attack: 0.03, Decay: 0.5, Sustain: 0.9, Release: 0.4, Gain: 0.38, 'O1 Wave': 3, 'O1 Level': 0.8, 'O2 Wave': 2, 'O2 Oct': 1, 'O2 Level': 0.3 }],
    ['Pad', 'Poly Pad', { Mode: 0, Cutoff: 2200, Reso: 1.2, 'Env Amt': 0.25, Attack: 0.9, Decay: 1.5, Sustain: 0.8, Release: 2.2, Gain: 0.16, 'O1 Wave': 0, 'O1 Level': 0.6, 'O2 Wave': 0, 'O2 Fine': 12, 'O2 Level': 0.6 }],
    ['Pad', 'Deep Pad', { Mode: 0, Cutoff: 900, Reso: 1.5, 'Env Amt': 0.35, Attack: 1.2, Decay: 2, Sustain: 0.7, Release: 2.5, Gain: 0.13, 'O1 Wave': 1, 'O1 Level': 0.6, 'O2 Wave': 0, 'O2 Oct': -1, 'O2 Fine': 8, 'O2 Level': 0.5 }],
    ['Pad', 'Glass Pad', { Mode: 0, Cutoff: 7000, Reso: 2, 'Env Amt': 0.15, Attack: 0.6, Decay: 1.2, Sustain: 0.7, Release: 2, Gain: 0.22, 'O1 Wave': 2, 'O1 Level': 0.6, 'O2 Wave': 3, 'O2 Oct': 1, 'O2 Level': 0.5, 'O3 Wave': 2, 'O3 Oct': 2, 'O3 Level': 0.2 }],
    ['Pluck', 'Poly Pluck', { Mode: 0, Cutoff: 1500, Reso: 2, 'Env Amt': 0.7, Attack: 0.001, Decay: 0.3, Sustain: 0, Release: 0.3, Gain: 0.15, 'O1 Wave': 0, 'O1 Level': 0.7, 'O2 Wave': 1, 'O2 Fine': 7, 'O2 Level': 0.4 }],
    ['Pluck', 'Bell Pluck', { Mode: 0, Cutoff: 6000, Reso: 1, 'Env Amt': 0.3, Attack: 0.001, Decay: 0.8, Sustain: 0, Release: 0.9, Gain: 0.22, 'O1 Wave': 3, 'O1 Level': 0.7, 'O2 Wave': 2, 'O2 Oct': 2, 'O2 Level': 0.35 }],
    ['Pluck', 'Mallet', { Mode: 0, Cutoff: 3000, Reso: 1, 'Env Amt': 0.4, Attack: 0.001, Decay: 0.4, Sustain: 0, Release: 0.4, Gain: 0.26, 'O1 Wave': 2, 'O1 Level': 0.8, 'O2 Wave': 3, 'O2 Oct': 1, 'O2 Level': 0.3 }],
    ['Brass', 'Analog Brass', { Mode: 0, Cutoff: 1400, Reso: 1.3, 'Env Amt': 0.6, Attack: 0.05, Decay: 0.5, Sustain: 0.7, Release: 0.25, Gain: 0.13, 'O1 Wave': 0, 'O1 Level': 0.7, 'O2 Wave': 0, 'O2 Fine': 9, 'O2 Level': 0.6 }],
    ['Keys', 'Electric Keys', { Mode: 0, Cutoff: 3500, Reso: 1, 'Env Amt': 0.3, Attack: 0.003, Decay: 1.2, Sustain: 0.3, Release: 0.5, Gain: 0.22, 'O1 Wave': 2, 'O1 Level': 0.7, 'O2 Wave': 3, 'O2 Oct': 1, 'O2 Level': 0.4 }],
    ['Keys', 'Drawbar Organ', { Mode: 0, Cutoff: 8000, Reso: 0.8, 'Env Amt': 0, Attack: 0.005, Decay: 0.1, Sustain: 1, Release: 0.08, Gain: 0.17, 'O1 Wave': 3, 'O1 Level': 0.6, 'O2 Wave': 3, 'O2 Oct': 1, 'O2 Level': 0.5, 'O3 Wave': 3, 'O3 Oct': 2, 'O3 Level': 0.3 }],
    ['Arp', 'Arp Up 16th', { Mode: 0, Cutoff: 2500, Reso: 2, 'Env Amt': 0.5, Attack: 0.001, Decay: 0.2, Sustain: 0.2, Release: 0.15, Gain: 0.3, 'O1 Wave': 0, 'O1 Level': 0.7, 'O2 Wave': 1, 'O2 Fine': 5, 'O2 Level': 0.4, Arp: 1, Pattern: 0, Rate: 2, 'Arp Oct': 2, Gate: 0.5 }],
    ['Arp', 'Arp Down Pluck', { Mode: 0, Cutoff: 3000, Reso: 2.5, 'Env Amt': 0.6, Attack: 0.001, Decay: 0.15, Sustain: 0, Release: 0.1, Gain: 0.26, 'O1 Wave': 1, 'O1 Level': 0.7, 'O2 Wave': 0, 'O2 Oct': 1, 'O2 Level': 0.3, Arp: 1, Pattern: 1, Rate: 2, 'Arp Oct': 2, Gate: 0.4 }],
    ['Arp', 'Arp Random Bells', { Mode: 0, Cutoff: 7000, Reso: 1, 'Env Amt': 0.2, Attack: 0.001, Decay: 0.3, Sustain: 0, Release: 0.3, Gain: 0.3, 'O1 Wave': 3, 'O1 Level': 0.7, 'O2 Wave': 2, 'O2 Oct': 2, 'O2 Level': 0.3, Arp: 1, Pattern: 4, Rate: 3, 'Arp Oct': 3, Gate: 0.3 }],
  ],
  7: [ // Moisture: two wavetable positions, sub, unison, filter type, envelope, LFO
    ['Bass', 'Growl Bass', { 'Pos A': 0.6, 'Pos B': 0.8, 'B Level': 0.5, 'B Oct': -1, Sub: 0.4, Unison: 2, Detune: 15, Filter: 0, Cutoff: 900, Reso: 3, 'Env Amt': 0.5, Attack: 0.003, Decay: 0.25, Sustain: 0.5, Release: 0.12, 'LFO Rate': 2, 'LFO Depth': 0.2, Gain: 0.23 }],
    ['Bass', 'Deep Sub', { 'Pos A': 0, 'Pos B': 0.1, 'B Level': 0.2, 'B Oct': -1, Sub: 0.8, Unison: 1, Detune: 0, Filter: 0, Cutoff: 500, Reso: 1, 'Env Amt': 0.2, Attack: 0.005, Decay: 0.4, Sustain: 0.9, Release: 0.15, 'LFO Depth': 0, Gain: 0.12 }],
    ['Bass', 'Reese Bass', { 'Pos A': 0.3, 'Pos B': 0.35, 'B Level': 0.7, 'B Oct': 0, Sub: 0.3, Unison: 3, Detune: 25, Filter: 0, Cutoff: 1200, Reso: 1.5, 'Env Amt': 0.2, Attack: 0.01, Decay: 0.5, Sustain: 0.8, Release: 0.2, 'LFO Rate': 0.3, 'LFO Depth': 0.3, Gain: 0.09 }],
    ['Bass', 'Pluck Bass', { 'Pos A': 0.4, 'Pos B': 0.7, 'B Level': 0.4, 'B Oct': -1, Sub: 0.3, Unison: 1, Filter: 0, Cutoff: 1500, Reso: 2, 'Env Amt': 0.7, Attack: 0.001, Decay: 0.2, Sustain: 0, Release: 0.1, 'LFO Depth': 0, Gain: 0.24 }],
    ['Lead', 'Digital Lead', { 'Pos A': 0.7, 'Pos B': 0.9, 'B Level': 0.5, 'B Oct': 1, Unison: 2, Detune: 10, Filter: 0, Cutoff: 6000, Reso: 2, 'Env Amt': 0.2, Attack: 0.005, Decay: 0.3, Sustain: 0.8, Release: 0.25, 'LFO Rate': 5, 'LFO Depth': 0.1, Gain: 0.14 }],
    ['Lead', 'Unison Lead', { 'Pos A': 0.25, 'Pos B': 0.3, 'B Level': 0.6, Unison: 5, Detune: 30, Filter: 0, Cutoff: 8000, Reso: 1, 'Env Amt': 0.1, Attack: 0.01, Decay: 0.4, Sustain: 0.85, Release: 0.35, 'LFO Depth': 0, Gain: 0.14 }],
    ['Lead', 'Vowel Lead', { 'Pos A': 0.5, 'Pos B': 0.6, 'B Level': 0.5, Unison: 1, Filter: 2, Cutoff: 1500, Reso: 5, 'Env Amt': 0.4, Attack: 0.01, Decay: 0.4, Sustain: 0.7, Release: 0.3, 'LFO Rate': 4, 'LFO Depth': 0.3, Gain: 0.34 }],
    ['Lead', 'Sweep Lead', { 'Pos A': 0.45, 'Pos B': 0.75, 'B Level': 0.5, Unison: 2, Detune: 12, Filter: 0, Cutoff: 3000, Reso: 4, 'Env Amt': 0.3, Attack: 0.01, Decay: 0.5, Sustain: 0.8, Release: 0.3, 'LFO Rate': 0.4, 'LFO Depth': 0.6, Gain: 0.11 }],
    ['Pad', 'Morph Pad', { 'Pos A': 0.2, 'Pos B': 0.8, 'B Level': 0.6, 'B Oct': 0, Unison: 3, Detune: 20, Filter: 0, Cutoff: 3500, Reso: 1.2, 'Env Amt': 0.2, Attack: 1.2, Decay: 2, Sustain: 0.8, Release: 2.5, 'LFO Rate': 0.2, 'LFO Depth': 0.4, Gain: 0.12 }],
    ['Pad', 'Airy Pad', { 'Pos A': 0.8, 'Pos B': 0.95, 'B Level': 0.5, 'B Oct': 1, Unison: 4, Detune: 30, Filter: 1, Cutoff: 400, Reso: 1, 'Env Amt': 0, Attack: 1.5, Decay: 2, Sustain: 0.9, Release: 3, 'LFO Rate': 0.15, 'LFO Depth': 0.3, Gain: 0.17 }],
    ['Pad', 'Dark Wave Pad', { 'Pos A': 0.1, 'Pos B': 0.3, 'B Level': 0.6, 'B Oct': -1, Unison: 3, Detune: 18, Filter: 0, Cutoff: 1000, Reso: 1.5, 'Env Amt': 0.3, Attack: 1, Decay: 2, Sustain: 0.8, Release: 3, 'LFO Rate': 0.1, 'LFO Depth': 0.3, Gain: 0.12 }],
    ['Pad', 'Evolving Pad', { 'Pos A': 0.4, 'Pos B': 0.9, 'B Level': 0.7, Unison: 2, Detune: 15, Filter: 2, Cutoff: 2000, Reso: 2.5, 'Env Amt': 0.3, Attack: 2, Decay: 3, Sustain: 0.8, Release: 4, 'LFO Rate': 0.08, 'LFO Depth': 0.7, Gain: 0.28 }],
    ['Pluck', 'Glass Pluck', { 'Pos A': 0.85, 'Pos B': 0.95, 'B Level': 0.4, 'B Oct': 1, Unison: 1, Filter: 0, Cutoff: 5000, Reso: 2, 'Env Amt': 0.5, Attack: 0.001, Decay: 0.4, Sustain: 0, Release: 0.4, 'LFO Depth': 0, Gain: 0.32 }],
    ['Pluck', 'Wood Pluck', { 'Pos A': 0.15, 'Pos B': 0.3, 'B Level': 0.3, Unison: 1, Filter: 0, Cutoff: 2000, Reso: 3, 'Env Amt': 0.6, Attack: 0.001, Decay: 0.2, Sustain: 0, Release: 0.2, 'LFO Depth': 0, Gain: 0.29 }],
    ['Stab', 'Wave Stab', { 'Pos A': 0.5, 'Pos B': 0.6, 'B Level': 0.6, Unison: 3, Detune: 20, Filter: 0, Cutoff: 3500, Reso: 1.5, 'Env Amt': 0.6, Attack: 0.001, Decay: 0.3, Sustain: 0.2, Release: 0.2, 'LFO Depth': 0, Gain: 0.18 }],
    ['Keys', 'Wave Keys', { 'Pos A': 0.35, 'Pos B': 0.5, 'B Level': 0.4, 'B Oct': 1, Unison: 1, Filter: 0, Cutoff: 4000, Reso: 1, 'Env Amt': 0.3, Attack: 0.003, Decay: 1, Sustain: 0.4, Release: 0.5, 'LFO Depth': 0, Gain: 0.23 }],
    ['Keys', 'Digital Bell', { 'Pos A': 0.9, 'Pos B': 1, 'B Level': 0.5, 'B Oct': 2, Unison: 1, Filter: 0, Cutoff: 9000, Reso: 1, 'Env Amt': 0.2, Attack: 0.001, Decay: 1.5, Sustain: 0, Release: 1.5, 'LFO Depth': 0, Gain: 0.3 }],
    ['FX', 'Wobble', { 'Pos A': 0.4, 'Pos B': 0.8, 'B Level': 0.6, 'B Oct': -1, Sub: 0.4, Unison: 2, Detune: 12, Filter: 0, Cutoff: 700, Reso: 5, 'Env Amt': 0.2, Attack: 0.005, Decay: 0.5, Sustain: 0.9, Release: 0.2, 'LFO Rate': 3, 'LFO Depth': 0.9, Gain: 0.07 }],
    ['FX', 'Riser', { 'Pos A': 0.3, 'Pos B': 0.9, 'B Level': 0.5, Unison: 5, Detune: 40, Filter: 1, Cutoff: 200, Reso: 3, 'Env Amt': 0.9, Attack: 3, Decay: 4, Sustain: 1, Release: 1, 'LFO Rate': 6, 'LFO Depth': 0.3, Gain: 0.08 }],
    ['FX', 'Noise Sweep', { 'Pos A': 1, 'Pos B': 1, 'B Level': 0.5, Unison: 4, Detune: 60, Filter: 2, Cutoff: 1500, Reso: 6, 'Env Amt': 0.2, Attack: 0.5, Decay: 2, Sustain: 0.7, Release: 2, 'LFO Rate': 0.3, 'LFO Depth': 0.9, Gain: 0.22 }],
  ],
  8: [ // Osphere: two layers, air, filter, chorus, motion
    ['Strings', 'Silk Strings', { 'L1 Wave': 0, 'L1 Level': 0.6, 'L1 Oct': 0, 'L1 Fine': 8, 'L2 Wave': 0, 'L2 Level': 0.5, 'L2 Oct': 0, 'L2 Detune': 14, Air: 0.1, Cutoff: 3500, Reso: 0.8, Attack: 0.5, Release: 1.4, Chorus: 0.5, 'Ch Mix': 0.4, Motion: 0.2, 'Mot Rate': 0.15, Gain: 0.23 }],
    ['Strings', 'Cello Ensemble', { 'L1 Wave': 0, 'L1 Level': 0.7, 'L1 Oct': -1, 'L1 Fine': 6, 'L2 Wave': 1, 'L2 Level': 0.3, 'L2 Oct': -1, 'L2 Detune': 10, Air: 0, Cutoff: 2000, Reso: 1, Attack: 0.4, Release: 1.2, Chorus: 0.4, 'Ch Mix': 0.3, Motion: 0.2, 'Mot Rate': 0.2, Gain: 0.22 }],
    ['Strings', 'Bright Strings', { 'L1 Wave': 0, 'L1 Level': 0.6, 'L1 Fine': 12, 'L2 Wave': 0, 'L2 Level': 0.5, 'L2 Oct': 1, 'L2 Detune': 18, Cutoff: 8000, Reso: 0.8, Attack: 0.3, Release: 1, Chorus: 0.6, 'Ch Mix': 0.5, Gain: 0.23 }],
    ['Pad', 'Choir Air', { 'L1 Wave': 2, 'L1 Level': 0.6, 'L2 Wave': 3, 'L2 Level': 0.4, 'L2 Oct': 1, 'L2 Detune': 8, Air: 0.5, Cutoff: 4000, Reso: 1.5, Attack: 1.2, Release: 2.5, Chorus: 0.6, 'Ch Mix': 0.5, Motion: 0.4, 'Mot Rate': 0.1, Gain: 0.21 }],
    ['Pad', 'Crystal Pad', { 'L1 Wave': 3, 'L1 Level': 0.6, 'L2 Wave': 2, 'L2 Level': 0.3, 'L2 Oct': 2, 'L2 Detune': 6, Air: 0.4, Cutoff: 9000, Reso: 1, Attack: 0.8, Release: 2, Chorus: 0.5, 'Ch Mix': 0.4, Motion: 0.3, 'Mot Rate': 0.25, Gain: 0.22 }],
    ['Pad', 'Warm Analog Pad', { 'L1 Wave': 0, 'L1 Level': 0.6, 'L2 Wave': 1, 'L2 Level': 0.4, 'L2 Oct': 0, 'L2 Detune': 16, Cutoff: 1800, Reso: 1.2, Attack: 1, Release: 2.2, Chorus: 0.5, 'Ch Mix': 0.5, Motion: 0.3, 'Mot Rate': 0.12, Gain: 0.17 }],
    ['Pad', 'Dark Drone', { 'L1 Wave': 0, 'L1 Level': 0.6, 'L1 Oct': -2, 'L2 Wave': 1, 'L2 Level': 0.4, 'L2 Oct': -1, 'L2 Detune': 20, Cutoff: 600, Reso: 2, Attack: 2.5, Release: 5, Chorus: 0.3, 'Ch Mix': 0.3, Motion: 0.6, 'Mot Rate': 0.05, Gain: 0.19 }],
    ['Pad', 'Shimmer Pad', { 'L1 Wave': 3, 'L1 Level': 0.6, 'L1 Oct': 1, 'L2 Wave': 3, 'L2 Level': 0.4, 'L2 Oct': 2, 'L2 Detune': 25, Air: 0.8, Cutoff: 14000, Reso: 0.8, Attack: 1.5, Release: 4, Chorus: 0.8, 'Ch Mix': 0.6, Motion: 0.5, 'Mot Rate': 0.3, Gain: 0.17 }],
    ['Pad', 'Breathing Pad', { 'L1 Wave': 1, 'L1 Level': 0.6, 'L2 Wave': 0, 'L2 Level': 0.4, 'L2 Detune': 12, Air: 0.3, Cutoff: 2500, Reso: 2, Attack: 1.8, Release: 3, Chorus: 0.4, 'Ch Mix': 0.4, Motion: 0.8, 'Mot Rate': 0.08, Gain: 0.17 }],
    ['Pad', 'Lush Wide Pad', { 'L1 Wave': 0, 'L1 Level': 0.6, 'L1 Fine': 20, 'L2 Wave': 0, 'L2 Level': 0.5, 'L2 Detune': 35, Cutoff: 5000, Reso: 0.8, Attack: 0.9, Release: 2.8, Chorus: 1, 'Ch Mix': 0.7, Motion: 0.3, 'Mot Rate': 0.2, Gain: 0.21 }],
    ['Keys', 'Velvet Keys', { 'L1 Wave': 2, 'L1 Level': 0.7, 'L2 Wave': 3, 'L2 Level': 0.3, 'L2 Oct': 1, 'L2 Detune': 4, Cutoff: 3000, Reso: 0.8, Attack: 0.01, Release: 0.8, Chorus: 0.3, 'Ch Mix': 0.3, Motion: 0, Gain: 0.28 }],
    ['Keys', 'Organ Pad', { 'L1 Wave': 3, 'L1 Level': 0.6, 'L2 Wave': 3, 'L2 Level': 0.5, 'L2 Oct': 1, Cutoff: 6000, Reso: 0.8, Attack: 0.05, Release: 0.5, Chorus: 0.7, 'Ch Mix': 0.5, Gain: 0.19 }],
    ['Keys', 'Bell Pad', { 'L1 Wave': 3, 'L1 Level': 0.6, 'L2 Wave': 2, 'L2 Level': 0.4, 'L2 Oct': 2, 'L2 Detune': 3, Air: 0.2, Cutoff: 10000, Reso: 0.8, Attack: 0.01, Release: 3, Chorus: 0.5, 'Ch Mix': 0.4, Gain: 0.26 }],
    ['Brass', 'Soft Brass', { 'L1 Wave': 0, 'L1 Level': 0.6, 'L2 Wave': 0, 'L2 Level': 0.5, 'L2 Detune': 8, Cutoff: 1500, Reso: 1.5, Attack: 0.15, Release: 0.6, Chorus: 0.3, 'Ch Mix': 0.3, Motion: 0.2, 'Mot Rate': 0.3, Gain: 0.25 }],
    ['Brass', 'Horn Section', { 'L1 Wave': 0, 'L1 Level': 0.6, 'L1 Oct': -1, 'L2 Wave': 1, 'L2 Level': 0.4, 'L2 Oct': 0, 'L2 Detune': 10, Cutoff: 1200, Reso: 1.2, Attack: 0.1, Release: 0.5, Gain: 0.23 }],
    ['Lead', 'Airy Lead', { 'L1 Wave': 2, 'L1 Level': 0.6, 'L2 Wave': 3, 'L2 Level': 0.4, 'L2 Oct': 1, 'L2 Detune': 5, Air: 0.4, Cutoff: 5000, Reso: 0.8, Attack: 0.05, Release: 0.6, Chorus: 0.4, 'Ch Mix': 0.3, Gain: 0.25 }],
    ['Lead', 'Flute Pad', { 'L1 Wave': 3, 'L1 Level': 0.7, 'L2 Wave': 2, 'L2 Level': 0.2, 'L2 Oct': 1, Air: 0.6, Cutoff: 3500, Reso: 0.8, Attack: 0.15, Release: 0.7, Chorus: 0.3, 'Ch Mix': 0.2, Motion: 0.2, 'Mot Rate': 0.4, Gain: 0.26 }],
    ['FX', 'Wind', { 'L1 Wave': 1, 'L1 Level': 0.2, 'L2 Level': 0.1, Air: 1, Cutoff: 2000, Reso: 3, Attack: 2, Release: 4, Motion: 0.9, 'Mot Rate': 0.06, Gain: 0.23 }],
    ['FX', 'Space Swell', { 'L1 Wave': 0, 'L1 Level': 0.6, 'L2 Wave': 0, 'L2 Level': 0.5, 'L2 Oct': 1, 'L2 Detune': 30, Air: 0.6, Cutoff: 6000, Reso: 2, Attack: 4, Release: 6, Chorus: 0.8, 'Ch Mix': 0.6, Motion: 0.7, 'Mot Rate': 0.1, Gain: 0.19 }],
    ['FX', 'Tape Pad', { 'L1 Wave': 1, 'L1 Level': 0.6, 'L2 Wave': 0, 'L2 Level': 0.4, 'L2 Detune': 6, Cutoff: 1400, Reso: 1, Attack: 0.7, Release: 2, Chorus: 0.9, 'Ch Mix': 0.6, Motion: 0.4, 'Mot Rate': 1.5, Gain: 0.19 }],
  ],
};

// five versions of every base patch (by parameter name; a parameter the instrument does not have is simply skipped)
const VARIANTS = [
  ['', () => {}],
  ['Deep', (v) => { mul(v, 'Cutoff', 0.45); mul(v, 'Reso', 1.15); }],
  ['Bright', (v) => { mul(v, 'Cutoff', 1.8); add(v, 'Air', 0.15); }],
  ['Soft', (v) => { if ('Attack' in v) v.Attack = v.Attack * 3 + 0.03; mul(v, 'Release', 1.5); mul(v, 'Cutoff', 0.8); }],
  ['Tight', (v) => { mul(v, 'Attack', 0.4); mul(v, 'Decay', 0.6); mul(v, 'Release', 0.5); }],
];
function mul(v, k, f) { if (k in v) v[k] *= f; }
function add(v, k, d) { if (k in v) v[k] += d; }

// INSTRUMENTS: the table from defs.js; taken: names already in use per type (the hand-made presets keep their names)
export function factoryPresets(INSTRUMENTS, taken = {}) {
  const out = {};
  for (const [type, bases] of Object.entries(B)) {
    const def = INSTRUMENTS[type]; if (!def) continue;
    const idx = new Map(def.params.map((p, k) => [p.n, k])), used = new Set(taken[type] || []), list = [];
    for (const [cat, name, vals] of bases) for (const [suffix, fn] of VARIANTS) {
      const v = { ...vals };
      for (const p of def.params) if (!(p.n in v) && suffix && (p.n === 'Cutoff' || p.n === 'Attack' || p.n === 'Release' || p.n === 'Air' || p.n === 'Decay' || p.n === 'Reso')) v[p.n] = p.def;   // a variant also shapes defaults
      fn(v);
      const p = {};
      for (const [n, x] of Object.entries(v)) {
        const k = idx.get(n); if (k === undefined) continue;
        const d = def.params[k]; let y = Math.min(d.max, Math.max(d.min, x));
        if (d.step) y = Math.round(y / d.step) * d.step; else y = Math.round(y * 10000) / 10000;
        p[k] = y;
      }
      let nm = suffix ? `${name} ${suffix}` : name;
      while (used.has(nm)) nm += ' II';
      used.add(nm); list.push({ cat, name: nm, p });
    }
    out[type] = list;
  }
  return out;
}
