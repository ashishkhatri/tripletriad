'use strict';
/* Sound effects: short MP3s in /sfx, preloaded and played through Web Audio. */
window.Sfx = (() => {
  // relative loudness per effect (files are peak-normalized)
  const MIX = {
    pick: 0.35, place: 0.6, flip: 0.5, cancel: 0.35, click: 0.25, error: 0.4,
    same: 0.55, plus: 0.55, combo: 0.6, turn: 0.35,
    win: 0.7, lose: 0.6, draw: 0.55, xp: 0.45, unlock: 0.6, 'wager-win': 0.55, 'wager-lose': 0.55,
    'pack-open': 0.65, 'reveal-1': 0.45, 'reveal-2': 0.5, 'reveal-3': 0.55, 'reveal-4': 0.65, 'reveal-5': 0.75,
  };
  let ctx = null, out = null;
  const buffers = new Map();
  let enabled = true, volume = 0.7;
  try {
    const s = JSON.parse(localStorage.getItem('triad-sfx') || '{}');
    if (typeof s.enabled === 'boolean') enabled = s.enabled;
    if (typeof s.volume === 'number') volume = Math.min(1, Math.max(0, s.volume));
  } catch (e) { /* ignore */ }
  const save = () => { try { localStorage.setItem('triad-sfx', JSON.stringify({ enabled, volume })); } catch (e) { /* ignore */ } };

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
    preload();
    return ctx;
  }
  function load(name) {
    if (!buffers.has(name)) {
      buffers.set(name, fetch(`sfx/${name}.mp3`).then((r) => r.arrayBuffer())
        .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
        .catch(() => { buffers.delete(name); return null; }));
    }
    return buffers.get(name);
  }
  function preload() { Object.keys(MIX).forEach(load); }

  // play('flip') or play('flip', { delay: 0.1, rate: 1.05 })
  async function play(name, opts = {}) {
    if (!enabled || !ensure()) return;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { return; } }
    const buf = await load(name);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || (1 + (Math.random() - 0.5) * 0.06);   // slight variety
    const g = ctx.createGain();
    g.gain.value = (MIX[name] || 0.5) * (opts.gain || 1);
    src.connect(g).connect(out);
    src.start(ctx.currentTime + (opts.delay || 0));
  }

  const unlock = () => { if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));

  function setEnabled(on) { enabled = on; save(); updateUI(); if (on) play('click'); }
  function setVolume(v) { volume = v; save(); if (out) out.gain.setTargetAtTime(v, ctx.currentTime, 0.03); if (v > 0 && !enabled) enabled = true; updateUI(); }

  // ---------- control (sits beside the music control) ----------
  let btn, slider;
  function buildUI() {
    const box = document.querySelector('.music-ctl');
    if (!box) return setTimeout(buildUI, 50);
    const wrap = document.createElement('span'); wrap.className = 'sfx-ctl';
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'music-btn sfx-btn';
    btn.onclick = (e) => { e.stopPropagation(); setEnabled(!enabled); };
    slider = document.createElement('input'); slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = 0.01;
    slider.setAttribute('aria-label', 'Sound effects volume');
    slider.oninput = () => setVolume(Number(slider.value));
    slider.onchange = () => play('flip');
    wrap.append(btn, slider);
    box.prepend(wrap);
    updateUI();
  }
  function updateUI() {
    if (!btn) return;
    btn.textContent = enabled ? '🔔' : '🔕';
    btn.title = enabled ? 'Sound effects on — click to mute' : 'Sound effects off — click to turn on';
    btn.classList.toggle('off', !enabled);
    slider.value = volume;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI); else buildUI();

  return { play, setEnabled, setVolume };
})();
