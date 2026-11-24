# FLM reader cross-check against Honeydew

Runs Honeydew's own FLM reader (`honeydew::flm::read`, GPL-3.0, github.com/jorgi80-droid/honeydew) and MobileDAW's
`js/import/flm.js` on the same projects and compares every value: channel params, rack modules, drum slots, clips (start,
length, loop, offset, mute), audio clip stretch / pitch / slot params, notes, drum hits, automation and clip envelopes.

    cp tools/flmcheck/flmdeep.rs <honeydew>/examples/ && (cd <honeydew> && cargo build --example flmdeep)
    <target>/debug/examples/flmdeep a.flm b.flm > hd.txt
    (cd tools/flmcheck && node ourdeep.mjs a.flm b.flm > us.txt) && python3 -I tools/flmcheck/compare.py hd.txt us.txt

2026-11-16: HIPDUT, Caest La vie, New Song, New Song 1, Honeydew's owner-fresh-song: 9 846 items each, 0 differences.
