'use strict';
/* Sound effects: short MP3s in /sfx (one kit per card set), preloaded and played through Web Audio. */
window.Sfx = (() => {
  // relative loudness per effect (files are peak-normalized)
  const MIX = {
    pick: 0.35, place: 0.6, flip: 0.5, cancel: 0.35, click: 0.25, error: 0.4,
    same: 0.55, plus: 0.55, combo: 0.6, turn: 0.35,
    win: 0.7, lose: 0.6, draw: 0.55, xp: 0.45, unlock: 0.6, 'wager-win': 0.55, 'wager-lose': 0.55,
    'pack-open': 0.65, 'reveal-1': 0.45, 'reveal-2': 0.5, 'reveal-3': 0.55, 'reveal-4': 0.65, 'reveal-5': 0.75,
    'storm-warn': 0.6, 'storm-fire': 0.65, 'storm-tide': 0.65, 'storm-wind': 0.6, 'storm-lightning': 0.75,
    'storm-frost': 0.6, 'storm-quake': 0.75, 'storm-dragon': 0.8, ward: 0.55,
    'reveal-foil': 0.55, craft: 0.6, 'craft-big': 0.75, 'pack-charge': 0.55,
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
  // Each card set has its own sound kit in sfx/<set>/; the root files are the default (Wilds) kit.
  const KITS = new Set(['arcane', 'starfall', 'tidebound', 'bloomwild', 'hollow']);
  const kit = () => { const th = document.documentElement.dataset.theme; return KITS.has(th) ? th : ''; };
  function fetchBuf(url) {
    return fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)));
  }
  function load(name, k = kit()) {
    const key = `${k}/${name}`;
    if (!buffers.has(key)) {
      const p = k ? fetchBuf(`sfx/${k}/${name}.mp3`).catch(() => load(name, '')) : fetchBuf(`sfx/${name}.mp3`);
      buffers.set(key, p.catch(() => { buffers.delete(key); return null; }));
    }
    return buffers.get(key);
  }
  function preload() { Object.keys(MIX).forEach((n) => load(n)); }
  // load the new kit as soon as the set (theme) changes
  new MutationObserver(() => { if (ctx) preload(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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

  // Recorded announcer lines (sounds/<name>.mp3): played louder than the effects, falling back to the speech engine if missing
  const voices = new Map();
  async function voice(name, opts = {}) {
    if (!enabled || !ensure()) return;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { return; } }
    if (!voices.has(name)) voices.set(name, fetchBuf(`sounds/${name}.mp3`).catch(() => null));
    const buf = await voices.get(name);
    if (!buf) { if (opts.fallback) say(opts.fallback, opts); return; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = opts.gain || 2.6;
    // a limiter after the boost, so the louder voice doesn't clip on its peaks
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
    src.connect(g).connect(lim).connect(out);
    src.start(ctx.currentTime + (opts.delay || 0));
    return new Promise((res) => { src.onended = res; });   // resolves when the line has finished
  }

  // A bright chord stab for combo chains: step 0, 1, 2… climbs a progression (I–IV–V–vi, then the same an octave up…)
  const CHORDS = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [9, 12, 16]];
  function chord(step) {
    if (!enabled || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const base = 392 * Math.pow(2, Math.floor(step / CHORDS.length));   // starts around G4, up an octave every 4 chords
    const t = ctx.currentTime + 0.01;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    g.connect(out);
    for (const semi of CHORDS[step % CHORDS.length]) {
      for (const [type, mult, lvl] of [['triangle', 1, 0.5], ['sine', 2, 0.18]]) {   // body + a soft octave shimmer
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = base * Math.pow(2, semi / 12) * mult;
        const og = ctx.createGain(); og.gain.value = lvl; o.connect(og).connect(g); o.start(t); o.stop(t + 0.95);
      }
    }
  }

  const unlock = () => { if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));

  function setEnabled(on) { enabled = on; save(); updateUI(); if (on) play('click'); }
  function setVolume(v) { volume = v; save(); if (out) out.gain.setTargetAtTime(v, ctx.currentTime, 0.03); if (v > 0 && !enabled) enabled = true; updateUI(); }

  // ---------- control: bell icon at the top (see SoundUI in music.js) ----------
  let group;
  function buildUI() {
    if (!window.SoundUI) return setTimeout(buildUI, 50);
    const box = window.SoundUI.box();
    group = window.SoundUI.group({
      icon: 'bell', label: 'Sound effects',
      enabled: () => enabled, setEnabled, volume: () => volume, setVolume, onChange: () => play('flip'),
    });
    box.prepend(group.el);
    updateUI();
  }
  function updateUI() { if (group) group.update(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI); else buildUI();

  // An announcer line through the browser's speech engine (deep, slow and loud), only when sound effects are on.
  function say(text, opts = {}) {
    if (!enabled || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const en = voices.filter((v) => /^en/i.test(v.lang));
      const pick = en.find((v) => /male|daniel|fred|alex|guy|david|james|google uk english male/i.test(v.name)) || en[0];
      if (pick) u.voice = pick;
      u.pitch = opts.pitch ?? 0.2; u.rate = opts.rate ?? 0.72; u.volume = Math.min(1, volume * 1.4);
      speechSynthesis.cancel();
      setTimeout(() => speechSynthesis.speak(u), (opts.delay || 0) * 1000);
    } catch (e) { /* ignore */ }
  }
  if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); } catch (e) { /* ignore */ } }

  return { play, setEnabled, setVolume, say, voice, chord };
})();
