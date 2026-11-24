// Gesture recogniser (js/gesture.js): tap / double tap / deferred tap / long press / drag / pan / pinch / cancel, with the timing from the
// preferences. Runs in Node with a fake element and synthetic pointer events (real timers, so the timing rules are tested as written).
import { attachGestures, cancelGestures, gestureTiming, GESTURE_DEFAULTS } from '../js/gesture.js';
import { prefs } from '../js/prefs.js';

let bad = 0;
const ok = (c, m) => { if (c) console.log('ok   ' + m); else { bad++; console.log('FAIL ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fake() {
  const L = {};
  return { addEventListener: (n, f) => { (L[n] = L[n] || []).push(f); }, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {},
    fire(n, e) { for (const f of L[n] || []) f({ preventDefault() {}, timeStamp: performance.now(), pointerType: 'touch', ...e }); } };
}
function rig(extra = {}) {
  const el = fake(), log = [];
  const h = { hit: (x, y) => ({ x, y, kind: x > 100 ? 'clip' : 'empty' }) };
  for (const k of ['tap', 'dtap', 'pan', 'pinch', 'pinchEnd', 'panEnd']) h[k] = (...a) => log.push([k, ...a]);
  h.long = (...a) => { log.push(['long', ...a]); return extra.keepLong === true; };
  h.dragStart = (x, y, t, fromLong) => { log.push(['dragStart', fromLong]); return extra.wantDrag !== false; };
  h.drag = (...a) => log.push(['drag', ...a]);
  h.dragEnd = (x, y, t, c) => log.push(['dragEnd', !!c]);
  if (extra.defer) h.defer = (t) => t && t.kind === 'clip';
  Object.assign(h, extra.h || {});
  attachGestures(el, h);
  const kinds = () => log.map((e) => e[0]);
  const down = (id, x, y) => el.fire('pointerdown', { pointerId: id, clientX: x, clientY: y });
  const move = (id, x, y) => el.fire('pointermove', { pointerId: id, clientX: x, clientY: y });
  const upP = (id, x, y) => el.fire('pointerup', { pointerId: id, clientX: x, clientY: y });
  return { log, kinds, down, move, up: upP, el };
}

// defaults
Object.assign(prefs, { longMs: undefined, touchSlop: undefined, dtapMs: undefined, haptics: false });
const T0 = gestureTiming();
ok(T0.longMs === GESTURE_DEFAULTS.longMs && T0.slop === GESTURE_DEFAULTS.slop && T0.dtapMs === GESTURE_DEFAULTS.dtapMs, 'default timing ' + JSON.stringify(T0));
prefs.longMs = 99999; prefs.touchSlop = -3; prefs.dtapMs = 'x';
const T1 = gestureTiming();
ok(T1.longMs === 900 && T1.slop === 4 && T1.dtapMs === GESTURE_DEFAULTS.dtapMs, 'out-of-range preferences are clamped ' + JSON.stringify(T1));
Object.assign(prefs, { longMs: 300, touchSlop: 8, dtapMs: 250 });

{ // 1. tap
  const r = rig(); r.down(1, 50, 50); r.up(1, 51, 50);
  ok(r.kinds().join() === 'tap', 'short tap = tap');
}
{ // 2. small jitter inside the slop stays a tap; moving past it becomes a drag
  const r = rig(); r.down(1, 50, 50); r.move(1, 55, 53); r.up(1, 55, 53);
  ok(r.kinds().join() === 'tap', 'jitter within the touch slop (8 px) is still a tap');
  const q = rig(); q.down(1, 50, 50); q.move(1, 62, 50); q.move(1, 80, 50); q.up(1, 80, 50);
  ok(q.kinds().join() === 'dragStart,drag,drag,dragEnd', 'moving past the slop = drag: ' + q.kinds().join());
}
{ // 3. declined drag = pan, with a fling speed on release
  const r = rig({ wantDrag: false }); r.down(1, 50, 50); r.move(1, 70, 50); r.move(1, 90, 50); r.up(1, 90, 50);
  ok(r.kinds().join() === 'dragStart,pan,pan,panEnd', 'dragStart declined = one-finger pan + panEnd: ' + r.kinds().join());
}
{ // 4. double tap on a non-deferred target: tap, tap, dtap (old behaviour kept for targets without a double-tap action)
  const r = rig(); r.down(1, 50, 50); r.up(1, 50, 50); await sleep(60); r.down(2, 52, 50); r.up(2, 52, 50);
  ok(r.kinds().join() === 'tap,tap,dtap', 'double tap (not deferred): ' + r.kinds().join());
}
{ // 5. deferred target: the single tap waits for the window, a double tap fires ONLY dtap
  const r = rig({ defer: true }); r.down(1, 150, 50); r.up(1, 150, 50);
  ok(r.kinds().join() === '', 'deferred tap is held back during the double-tap window');
  await sleep(320);
  ok(r.kinds().join() === 'tap', 'deferred tap fires after the window');
  const q = rig({ defer: true }); q.down(1, 150, 50); q.up(1, 150, 50); await sleep(80); q.down(2, 152, 51); q.up(2, 152, 51); await sleep(320);
  ok(q.kinds().join() === 'dtap', 'double tap on a deferred target = dtap only (never read as two single taps): ' + q.kinds().join());
}
{ // 6. a deferred tap followed by a touch elsewhere fires at once (nothing lost)
  const r = rig({ defer: true }); r.down(1, 150, 50); r.up(1, 150, 50); r.down(2, 20, 200);
  ok(r.kinds()[0] === 'tap', 'pending tap fires when the next touch lands elsewhere');
  r.up(2, 20, 200);
}
{ // 7. long press (threshold from prefs), no drag kept
  const r = rig(); r.down(1, 50, 50); await sleep(200);
  ok(!r.kinds().includes('long'), 'no long press before the threshold (300 ms)');
  await sleep(160);
  ok(r.kinds().join() === 'long', 'long press after the threshold');
  r.move(1, 90, 50); r.up(1, 90, 50);
  ok(r.kinds().join() === 'long', 'moving after a menu-type long press does nothing (no accidental drag / tap)');
}
{ // 8. long press kept as a drag (rubber band)
  const r = rig({ keepLong: true }); r.down(1, 50, 50); await sleep(340); r.move(1, 80, 80); r.up(1, 80, 80);
  ok(r.kinds().join() === 'long,dragStart,drag,dragEnd' && r.log[1][1] === true, 'long press kept as drag: ' + r.kinds().join());
}
{ // 8b. a target with its own long-press time (piano roll empty space: a deliberate 1 s hold before the rubber band, a quicker drag scrolls)
  const r = rig({ keepLong: true, wantDrag: false, h: { longMs: (t, ms) => (t && t.kind === 'empty' ? 700 : ms) } });
  r.down(1, 50, 50); await sleep(400);
  ok(!r.kinds().includes('long'), 'per-target long-press time: nothing at 400 ms (default 300 ms not used for this target)');
  r.move(1, 50, 80); r.up(1, 50, 80);
  ok(r.kinds()[0] === 'dragStart' && r.kinds().includes('pan') && !r.kinds().includes('long'), 'a drag before the longer hold = scroll: ' + r.kinds().join());
  const q = rig({ keepLong: true, h: { longMs: (t, ms) => (t && t.kind === 'empty' ? 700 : ms) } });
  q.down(1, 50, 50); await sleep(760); q.move(1, 80, 80); q.up(1, 80, 80);
  ok(q.kinds().join() === 'long,dragStart,drag,dragEnd', 'held past its own time: long press kept as the rubber band: ' + q.kinds().join());
  const c = rig({ h: { longMs: (t, ms) => (t && t.kind === 'empty' ? 700 : ms) } }); c.down(1, 150, 50); await sleep(340);
  ok(c.kinds().join() === 'long', 'other targets keep the preference time (300 ms)'); c.up(1, 150, 50);
}
{ // 9. movement before the threshold cancels the long press
  const r = rig(); r.down(1, 50, 50); r.move(1, 70, 50); await sleep(360); r.up(1, 70, 50);
  ok(!r.kinds().includes('long'), 'a drag started before the threshold never turns into a long press');
}
{ // 10. pinch: centred scale factors per axis, no single-finger action
  const r = rig(); r.down(1, 100, 100); r.down(2, 200, 100); r.move(2, 300, 100); r.up(2, 300, 100); r.up(1, 100, 100);
  const pin = r.log.find((e) => e[0] === 'pinch');
  ok(pin && Math.abs(pin[3] - 2) < 1e-9 && pin[4] === 1 && pin[1] === 200, 'horizontal pinch: sx 2, sy 1, centre between the fingers ' + JSON.stringify(pin));
  ok(!r.kinds().includes('tap') && r.kinds().includes('pinchEnd'), 'pinch never taps; pinchEnd fires');
}
{ // 11. two-finger pan moves the view, no pinch
  const r = rig(); r.down(1, 100, 100); r.down(2, 200, 100); r.move(1, 100, 140); r.move(2, 200, 140); r.up(1, 100, 140); r.up(2, 200, 140);
  const pans = r.log.filter((e) => e[0] === 'pan'), dy = pans.reduce((a, e) => a + e[2], 0);
  ok(Math.abs(dy - 40) < 1e-9 && !r.kinds().includes('pinch'), 'two-finger pan: view moves 40 px, no zoom');
}
{ // 12. cancelGestures (Escape) ends an active drag with cancel = true; the lift afterwards does nothing
  const r = rig(); r.down(1, 50, 50); r.move(1, 80, 50);
  ok(cancelGestures() === true, 'cancelGestures reports an active gesture');
  r.move(1, 120, 50); r.up(1, 120, 50);
  ok(r.kinds().join() === 'dragStart,drag,dragEnd' && r.log[2][1] === true, 'cancelled drag: dragEnd(cancel) once, later moves ignored: ' + r.kinds().join());
  ok(cancelGestures() === false, 'nothing left to cancel');
}
{ // 13. mouse uses a small fixed slop
  const el = rig(); el.el.fire('pointerdown', { pointerId: 1, clientX: 50, clientY: 50, pointerType: 'mouse' }); el.el.fire('pointermove', { pointerId: 1, clientX: 56, clientY: 50, pointerType: 'mouse' }); el.el.fire('pointerup', { pointerId: 1, clientX: 56, clientY: 50, pointerType: 'mouse' });
  ok(el.kinds()[0] === 'dragStart', 'mouse: 6 px is already a drag');
}
await sleep(50);
console.log(bad ? `\n${bad} FAILED` : '\ngesture-test: all passed');
process.exit(bad ? 1 : 0);
