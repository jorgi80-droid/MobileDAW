// MobileDAW cross-check: every value Honeydew's FLM reader takes from a project, one line per item, to diff against js/import/flm.js.
use honeydew::song::{Event, LaneKind};
fn f(v: f64) -> String { format!("{:.6}", v) }
fn main() {
    for path in std::env::args().skip(1) {
        let song = honeydew::flm::read(&std::fs::read(&path).unwrap()).unwrap();
        println!("## {}", path.rsplit('/').next().unwrap());
        for ch in &song.channels {
            let n = &ch.name;
            println!("{n}|chan|{}", ch.params.0.iter().map(|v| f(*v as f64)).collect::<Vec<_>>().join(","));
            for m in &ch.rack.modules { println!("{n}|mod|{}|{}", m.type_id, m.params.iter().map(|v| f(*v as f64)).collect::<Vec<_>>().join(",")); }
            if let Some(k) = &ch.drum_kit { for s in &k.slots { println!("{n}|pad|{}|{}|{}|{}|{}", s.cut_group, s.params.iter().map(|v| f(*v as f64)).collect::<Vec<_>>().join(","), s.file.stretch_mode, f(s.file.stretch_ratio), f(s.file.pitch_semitones)); } }
            for lane in &ch.lanes { for c in &lane.clips {
                println!("{n}|clip|{:?}|{}|{}|{}|{}|{}", lane.kind, c.start_tick, f(c.visible_len_beats), f(c.loop_len_beats), f(c.offset_beats), c.muted);
                if let Some(s) = c.file.sample.as_deref() { println!("{n}|smp|{}|{}|{}|{}", s.file.stretch_mode, f(s.file.stretch_ratio), f(s.file.pitch_semitones), s.params.iter().map(|v| f(*v as f64)).collect::<Vec<_>>().join(",")); }
                for e in &c.events { match *e {
                    Event::Note { pos, len_beats, key, velocity, pan, slide } => println!("{n}|note|{pos}|{}|{key}|{velocity}|{pan}|{slide}", f(len_beats)),
                    Event::Drum { pos, len_beats, pad, velocity, pan, value, repeat } => println!("{n}|drum|{pos}|{}|{pad}|{velocity}|{pan}|{value}|{repeat}", f(len_beats)),
                    Event::Automation { pos, value, .. } => println!("{n}|auto|{pos}|{}", f(value as f64)),
                    Event::Envelope { pos, env_param, value, .. } => println!("{n}|env|{pos}|{env_param}|{}", f(value as f64)),
                } }
            } }
        }
    }
}
