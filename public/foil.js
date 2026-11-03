'use strict';
/*
 * Card lighting and 3D tilt.
 *
 * Every visible .card.foil is treated as a glossy, foil-laminated plane. Each frame:
 *  1. Tilt: the card under the pointer turns toward it (up to MAX_TILT); other cards lean gently
 *     toward the pointer. Rotations ease toward their targets with a critically damped spring.
 *  2. Shading: the card's surface normal N comes from its rotation. The pointer is a point light
 *     hovering LIGHT_HEIGHT px above the screen, the viewer looks straight on (V = +z).
 *     - Specular glare uses Blinn-Phong: spec = max(N·H, 0)^shininess with H = normalize(L + V).
 *       The glare spot is placed where the half-vector points in the card's own frame, so it slides
 *       across the card as you move the light or tilt the card, like a real reflection.
 *     - Foil (holographic spectrum + grain) strength grows with how far the card turns from the
 *       viewer plus a Schlick Fresnel term and a little specular, and is masked to a soft region
 *       around the reflection point, so color sweeps across the art instead of covering it.
 *     - The spectrum's offset follows the half-vector too, so colors sweep as the angle changes.
 *  3. Results are written as CSS variables that the stylesheet uses for the transform, the glare
 *     and foil layers (blended over the art, so it works on any picture) and the drop shadow.
 * On phones and tablets the device's motion sensors drive it instead: tilting the device tilts the cards
 * the same way, and the light stays put in the room, so the glare and foil sweep across the cards like
 * a real card in your hand. Without sensors (or before permission is given) the light drifts on its own.
 */
(() => {
  const MAX_TILT = 16;          // degrees, card under the pointer
  const LEAN = 4;               // degrees, other cards leaning toward the pointer
  const LIGHT_HEIGHT = 520;     // px above the screen
  const SHININESS = 22;
  const D2R = Math.PI / 180;
  const finePointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let px = null, py = null;     // pointer (mouse) position, null when away
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { px = e.clientX; py = e.clientY; } }, { passive: true });
  document.addEventListener('pointerleave', () => { px = py = null; });
  window.addEventListener('blur', () => { px = py = null; });

  // ---------- device tilt (gyroscope / orientation sensor) ----------
  // tilt.x, tilt.y in -1..1: how far the device is tipped right / toward you from where you usually hold it.
  // Sources, best first: 'deviceorientation' angles, then gravity from 'devicemotion' (some browsers only
  // provide one of them). window.CardTilt reports what's happening so the Account page can show it.
  const tilt = { on: false, x: 0, y: 0, b0: null, g0: null, lastEvent: 0, source: null, listening: false, events: 0, nulls: 0, perm: null, since: 0 };
  const TILT_RANGE = 22;        // degrees of device tilt that map to a full card tilt
  const hasSensorApi = 'DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window;
  const needsPermission = typeof window.DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
  let userPref = null;          // tilt is on by default (there's no setting for it now); setEnabled() can still change it for this visit
  const wanted = () => (userPref !== null ? userPref : !reduceMotion);

  function feed(fb, lr, source) {
    // map the sensor's axes to the screen's axes for portrait / landscape
    const ang = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
    let f = fb, l = lr;
    if (ang === 90) { f = -lr; l = fb; }
    else if (ang === -90 || ang === 270) { f = lr; l = -fb; }
    else if (ang === 180) { f = -fb; l = -lr; }
    const now = performance.now();
    const dt = tilt.lastEvent ? Math.min(0.2, (now - tilt.lastEvent) / 1000) : 0;
    tilt.lastEvent = now; tilt.source = source;
    // the neutral pose slowly follows how the device is held, so any comfortable angle works
    if (tilt.b0 === null) { tilt.b0 = f; tilt.g0 = l; }
    const follow = 1 - Math.exp(-dt / 2.5);
    tilt.b0 += (f - tilt.b0) * follow;
    tilt.g0 += (l - tilt.g0) * follow;
    tilt.x = clamp((l - tilt.g0) / TILT_RANGE, -1, 1);
    tilt.y = clamp((f - tilt.b0) / TILT_RANGE, -1, 1);
    tilt.on = true;
  }
  function onOrientation(e) {
    tilt.events++;
    if (e.beta == null || e.gamma == null) { tilt.nulls++; return; }
    feed(e.beta, e.gamma, 'orientation');
  }
  function onMotion(e) {
    tilt.events++;
    // only used when orientation angles aren't arriving
    if (tilt.source === 'orientation' && performance.now() - tilt.lastEvent < 500) return;
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null || g.z == null || (g.x === 0 && g.y === 0 && g.z === 0)) { tilt.nulls++; return; }
    // gravity -> front/back (beta-like) and left/right (gamma-like) angles in degrees
    const fb = Math.atan2(g.y, g.z) / D2R;
    const lr = Math.atan2(-g.x, Math.hypot(g.y, g.z)) / D2R;
    feed(fb, lr, 'motion');
  }
  function listenTilt() {
    if (tilt.listening) return;
    tilt.listening = true; tilt.since = performance.now();
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
    window.addEventListener('devicemotion', onMotion, { passive: true });
    notify();
  }
  function stopTilt() {
    tilt.listening = false; tilt.on = false;
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('devicemotion', onMotion);
    notify();
  }
  // iOS (and anything else with requestPermission) only allows asking from a tap
  function requestAccess() {
    if (!needsPermission) { listenTilt(); return Promise.resolve('granted'); }
    const asks = [DeviceOrientationEvent.requestPermission()];
    if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') asks.push(DeviceMotionEvent.requestPermission());
    return Promise.all(asks).then((rs) => {
      tilt.perm = rs.includes('granted') ? 'granted' : 'denied';
      if (tilt.perm === 'granted') listenTilt();
      notify();
      return tilt.perm;
    }).catch(() => { tilt.perm = 'denied'; notify(); return 'denied'; });
  }
  if (!finePointer && hasSensorApi && wanted()) {
    if (needsPermission) {
      const ask = () => { window.removeEventListener('touchend', ask, true); window.removeEventListener('click', ask, true); if (wanted()) requestAccess(); };
      window.addEventListener('touchend', ask, true); window.addEventListener('click', ask, true);
    } else listenTilt();
  }
  // stale sensor (no events for a while): fall back to the drifting light
  const tiltLive = () => tilt.on && tilt.listening && performance.now() - tilt.lastEvent < 1500;

  const listeners = new Set();
  function notify() { listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); }
  function status() {
    if (finePointer) return { code: 'mouse', text: 'Using your mouse — tilt is for phones and tablets.' };
    if (!hasSensorApi) return { code: 'unsupported', text: 'This browser has no motion sensor support.' };
    if (!window.isSecureContext) return { code: 'insecure', text: 'Motion sensors need a secure (https://) address. Open the game through your https link instead of the local IP.' };
    if (!wanted()) return { code: 'off', text: reduceMotion && userPref === null ? 'Off because your device asks for reduced motion.' : 'Off.' };
    if (needsPermission && tilt.perm !== 'granted') return { code: tilt.perm === 'denied' ? 'denied' : 'permission', text: tilt.perm === 'denied' ? 'Motion access was refused. Allow it in your browser settings, then reload.' : 'Tap “Turn on” to allow motion access.' };
    if (tiltLive()) return { code: 'on', text: `Working (${tilt.source === 'motion' ? 'gravity sensor' : 'orientation sensor'}).` };
    const waited = tilt.listening ? performance.now() - tilt.since : 0;
    if (tilt.events && tilt.nulls >= tilt.events) return { code: 'blocked', text: 'Your browser is hiding the sensor readings. In Brave: Site settings → Motion sensors → Allow (and check Shields fingerprinting).' };
    if (waited > 2500 && !tilt.events) return { code: 'blocked', text: 'No sensor readings are arriving. Your browser may block motion sensors for this site — check its Site settings → Motion sensors.' };
    if (tilt.events && !tiltLive()) return { code: 'idle', text: 'Sensor connected — move the device to see it.' };
    return { code: 'waiting', text: 'Waiting for the sensor…' };
  }
  window.CardTilt = {
    status,
    reading: () => ({ x: tilt.x, y: tilt.y, events: tilt.events, source: tilt.source }),
    enabled: wanted,
    setEnabled(on) {
      userPref = !!on;
      if (on) return requestAccess();
      stopTilt();
      return Promise.resolve('off');
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  const states = new WeakMap();
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // CSS rotateX(a) rotateY(b): p' = Rx(a)·Ry(b)·p. Screen y grows downward.
  const rotX = (a, v) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  const rotY = (b, v) => [v[0] * Math.cos(b) + v[2] * Math.sin(b), v[1], -v[0] * Math.sin(b) + v[2] * Math.cos(b)];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function spring(s, key, target, dt) {
    // critically damped spring (no overshoot wobble), ~120ms response
    const k = 180, c = 2 * Math.sqrt(k);
    const v = s['v' + key] || 0;
    const a = k * (target - s[key]) - c * v;
    s['v' + key] = v + a * dt;
    s[key] += s['v' + key] * dt;
  }

  let last = performance.now(), frameNo = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; frameNo++;
    if (!document.hidden) {
      const cards = document.querySelectorAll('.screen.active .lit, .overlay.show .lit, .drag-ghost.lit');
      const vh = innerHeight, vw = innerWidth;
      // measure every card first, then write: mixing reads and writes forces a full layout per card
      const rects = Array.from(cards, (el) => el.getBoundingClientRect());
      let idx = -1;
      for (const el of cards) {
        const r = rects[++idx];
        if (r.bottom < -50 || r.top > vh + 50 || r.right < -50 || r.left > vw + 50 || r.width < 8) continue;
        // touch devices: plain cards are lit at half rate (alternating), foils, packs and the dragged card every frame
        if (!finePointer && !el.classList.contains('drag-ghost') && !el.classList.contains('holo') && !el.classList.contains('sealed') && ((idx + frameNo) & 1)) continue;
        // pack-reveal cards: only the side facing you needs lighting
        if (el.classList.contains('face-front') || el.classList.contains('face-back')) {
          const holder = el.closest('.pack-card');
          const shown = holder && holder.classList.contains('revealed') ? 'face-front' : 'face-back';
          if (!el.classList.contains(shown)) continue;
        }
        let s = states.get(el);
        if (!s) { s = { rx: 0, ry: 0, seed: Math.random() * 100 }; states.set(el, s); }
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const ghost = el.classList.contains('drag-ghost');
        const still = el.classList.contains('dragging') || el.classList.contains('tearing') || el.classList.contains('face-back');

        // light position and tilt targets
        let lx, ly, trx = 0, try_ = 0;
        if (px !== null && finePointer) {
          lx = px; ly = py;
          const dx = (px - cx) / (r.width / 2), dy = (py - cy) / (r.height / 2);
          const inside = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
          if (ghost) { trx = el._swing ? el._swing.rx : 0; try_ = el._swing ? el._swing.ry : 0; }
          else if (inside && !still) { const mt = Number(el.dataset.tilt) || MAX_TILT; try_ = dx * mt; trx = -dy * mt; }
          else if (!still) {
            const d = Math.hypot(dx, dy), f = 1 / (1 + d * 0.6);
            try_ = clamp(dx, -1, 1) * LEAN * f; trx = -clamp(dy, -1, 1) * LEAN * f;
          }
        } else if (tiltLive()) {
          // device tilt: cards turn with the device; the light stays fixed in the room, so on screen
          // it moves the opposite way and the reflection slides across the card
          const mt = Math.min(Number(el.dataset.tilt) || MAX_TILT, 18);
          if (ghost && el._swing) { trx = el._swing.rx; try_ = el._swing.ry; }
          else if (!still) { try_ = tilt.x * mt; trx = -tilt.y * mt; }
          lx = cx - tilt.x * r.width * 1.8;
          ly = cy - r.height * 0.6 - tilt.y * r.height * 1.6;
        } else if (!el.classList.contains('holo') && !ghost && !el.classList.contains('sealed')) {
          // no mouse, no sensor, plain card: a still light from above (animating every card's light on a phone
          // costs a lot of frames for little visible gain; foils and packs keep their shimmer)
          lx = cx; ly = cy - r.height * 0.9;
        } else {
          // no mouse: a slow wandering light, plus a soft idle sway
          const t = now / 1000 + s.seed;
          lx = cx + Math.sin(t * 0.45) * r.width * 1.4;
          ly = cy - r.height * 0.8 + Math.cos(t * 0.33) * r.height * 0.9;
          if (ghost && el._swing) { trx = el._swing.rx; try_ = el._swing.ry; }
          else if (!reduceMotion && !still) { try_ = Math.sin(t * 0.6) * 3; trx = Math.cos(t * 0.5) * 2; }
        }
        if (reduceMotion && !ghost && !tiltLive()) { trx = 0; try_ = 0; }
        const edt = s.t ? Math.min(0.034, (now - s.t) / 1000) : dt;   // per card: some cards update every other frame
        s.t = now;
        spring(s, 'rx', trx, edt);
        spring(s, 'ry', try_, edt);

        // shading
        const a = s.rx * D2R, b = s.ry * D2R;
        const N = rotX(a, rotY(b, [0, 0, 1]));
        const L = norm([lx - cx, ly - cy, LIGHT_HEIGHT]);
        const V = [0, 0, 1];
        const H = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
        const nh = Math.max(dot(N, H), 0);
        const spec = Math.pow(nh, SHININESS);
        const sheen = Math.pow(nh, 6);
        const fresnel = 0.04 + 0.96 * Math.pow(1 - Math.max(dot(N, V), 0), 5);
        // half-vector in the card's own frame -> where the reflection lands on the card
        const Hl = rotY(-b, rotX(-a, H));
        const mx = clamp(50 + Hl[0] * 160, -20, 120), my = clamp(50 + Hl[1] * 160, -20, 120);
        // how far the card is turned from the viewer (0 flat .. ~0.07 at 20deg); foil blooms with it
        const turn = 1 - Math.max(dot(N, V), 0);
        const foil = clamp(0.3 + turn * 14 + fresnel * 3 + spec * 0.35, 0, 0.92);
        const glare = clamp(0.3 + sheen * 0.6, 0, 0.95);

        // only touch a variable when its value actually changes: each write makes the browser restyle the card
        const prev = s.vars || (s.vars = {});
        const st = { setProperty(k, v) { if (prev[k] !== v) { prev[k] = v; el.style.setProperty(k, v); } } };
        st.setProperty('--rx', s.rx.toFixed(1) + 'deg');
        st.setProperty('--ry', s.ry.toFixed(1) + 'deg');
        st.setProperty('--mx', mx.toFixed(1) + '%');
        st.setProperty('--my', my.toFixed(1) + '%');
        // foils: the holographic sheen also drifts slowly on its own, so it shimmers even when still.
        // Smooth sine motion kept inside 0–100% so the oversized gradient never shows an edge or jumps.
        const t = now / 1000 + s.seed * 7;
        const drift = el.classList.contains('holo') && !reduceMotion;
        const amt = tiltLive() ? 0.35 : 1;   // with device tilt the motion comes mostly from your hand
        const dx = drift ? (Math.sin(t * 0.35) * 22 + Math.sin(t * 0.13) * 10) * amt : 0;
        const dy = drift ? Math.cos(t * 0.27) * 18 * amt : 0;
        st.setProperty('--bx', clamp(50 + Hl[0] * 120 + dx, 0, 100).toFixed(1) + '%');
        st.setProperty('--by', clamp(50 + Hl[1] * 120 + dy, 0, 100).toFixed(1) + '%');
        st.setProperty('--hx', clamp(50 + Hl[0] * 200 + dx * 1.3, 0, 100).toFixed(1) + '%');
        st.setProperty('--spec', spec.toFixed(2));
        st.setProperty('--glare', glare.toFixed(2));
        st.setProperty('--foil', foil.toFixed(2));
        // thickness: the side of the card that faces you when it tilts (normal points one way, that edge shows the other way)
        st.setProperty('--ex', clamp(-N[0] * 4, -1.2, 1.2).toFixed(1));
        st.setProperty('--ey', clamp(-N[1] * 4, -1.2, 1.2).toFixed(1));
        st.setProperty('--sx', Math.round(-s.ry * 0.6).toString());   // whole pixels: shadows are costly to redraw
        st.setProperty('--sy', Math.round(s.rx * 0.6 + 6).toString());
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
