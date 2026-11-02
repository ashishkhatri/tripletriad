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
 *       around the reflection point, so colour sweeps across the art instead of covering it.
 *     - The spectrum's offset follows the half-vector too, so colours sweep as the angle changes.
 *  3. Results are written as CSS variables that the stylesheet uses for the transform, the glare
 *     and foil layers (blended over the art, so it works on any picture) and the drop shadow.
 * Without a mouse (touch screens) the light drifts slowly on its own so cards still shimmer.
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

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!document.hidden) {
      const cards = document.querySelectorAll('.screen.active .lit, .overlay.show .lit, .drag-ghost.lit');
      const vh = innerHeight, vw = innerWidth;
      for (const el of cards) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -50 || r.top > vh + 50 || r.right < -50 || r.left > vw + 50 || r.width < 8) continue;
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
        } else {
          // no mouse: a slow wandering light, plus a soft idle sway
          const t = now / 1000 + s.seed;
          lx = cx + Math.sin(t * 0.45) * r.width * 1.4;
          ly = cy - r.height * 0.8 + Math.cos(t * 0.33) * r.height * 0.9;
          if (ghost && el._swing) { trx = el._swing.rx; try_ = el._swing.ry; }
          else if (!reduceMotion && !still) { try_ = Math.sin(t * 0.6) * 3; trx = Math.cos(t * 0.5) * 2; }
        }
        if (reduceMotion && !ghost) { trx = 0; try_ = 0; }
        spring(s, 'rx', trx, dt);
        spring(s, 'ry', try_, dt);

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

        const st = el.style;
        st.setProperty('--rx', s.rx.toFixed(2) + 'deg');
        st.setProperty('--ry', s.ry.toFixed(2) + 'deg');
        st.setProperty('--mx', mx.toFixed(1) + '%');
        st.setProperty('--my', my.toFixed(1) + '%');
        st.setProperty('--bx', (50 + Hl[0] * 220).toFixed(1) + '%');
        st.setProperty('--by', (50 + Hl[1] * 220).toFixed(1) + '%');
        st.setProperty('--spec', spec.toFixed(3));
        st.setProperty('--glare', glare.toFixed(3));
        st.setProperty('--foil', foil.toFixed(3));
        st.setProperty('--sx', (-s.ry * 0.6).toFixed(1));
        st.setProperty('--sy', (s.rx * 0.6 + 6).toFixed(1));
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
