'use strict';
/* Shared sound controls: round icon buttons (fixed at the top of the screen) that open a small popover
   with an on/off switch and a volume slider. A slash across the icon means that sound is off. */
window.SoundUI = window.SoundUI || (() => {
  const ICONS = {
    note: '<path d="M9 17.5V5.5l10-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  };
  let box = null;
  function getBox() {
    if (box) return box;
    box = document.createElement('div'); box.className = 'music-ctl';
    document.body.appendChild(box);
    document.addEventListener('pointerdown', (e) => { if (!box.contains(e.target)) box.querySelectorAll('.snd-group.open').forEach((g) => g.classList.remove('open')); });
    return box;
  }
  function group(o) {
    const el = document.createElement('span'); el.className = 'snd-group';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'music-btn snd-btn';
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[o.icon]}<line class="slash" x1="4" y1="4" x2="20" y2="20"/></svg>`;
    btn.setAttribute('aria-haspopup', 'true');
    const pop = document.createElement('span'); pop.className = 'snd-pop';
    const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'snd-toggle small';
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = 0; slider.max = 1; slider.step = 0.01;
    slider.setAttribute('aria-label', `${o.label} volume`);
    const name = document.createElement('span'); name.className = 'snd-name'; name.textContent = o.label;
    pop.append(name, tog, slider);
    el.append(btn, pop);
    btn.onclick = (e) => {
      e.stopPropagation();
      const open = !el.classList.contains('open');
      getBox().querySelectorAll('.snd-group.open').forEach((g) => g.classList.remove('open'));
      el.classList.toggle('open', open);
    };
    tog.onclick = (e) => { e.stopPropagation(); o.setEnabled(!o.enabled()); };
    slider.oninput = () => o.setVolume(Number(slider.value));
    if (o.onChange) slider.onchange = o.onChange;
    const update = () => {
      const on = o.enabled();
      btn.classList.toggle('off', !on);
      btn.title = `${o.label} ${on ? 'on' : 'off'} — click for volume`;
      btn.setAttribute('aria-label', btn.title);
      tog.textContent = on ? 'On' : 'Off'; tog.classList.toggle('on', on);
      slider.value = o.volume();
    };
    return { el, update };
  }
  return { box: getBox, group };
})();
/* Background music: plays each card set's track as a gapless loop with crossfades.
   Starts on its own as soon as the browser allows sound, unless the player has turned music off. */
window.Music = (() => {
  let ctx = null, master = null;
  let current = null;           // { key, src, gain }
  let wanted = null;            // { file, title, loop } most recently requested
  const buffers = new Map();    // file -> Promise<AudioBuffer>
  let enabled = true, volume = 0.45;
  try {
    const s = JSON.parse(localStorage.getItem('triad-music') || '{}');
    if (typeof s.enabled === 'boolean') enabled = s.enabled;
    if (typeof s.volume === 'number') volume = Math.min(1, Math.max(0, s.volume));
  } catch (e) { /* ignore */ }
  const save = () => { try { localStorage.setItem('triad-music', JSON.stringify({ enabled, volume })); } catch (e) { /* ignore */ } };

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? volume : 0;
    master.connect(ctx.destination);
    // whenever the browser lets audio run (now, or after the first click/tap/key), start the wanted track
    ctx.addEventListener('statechange', () => { if (ctx.state === 'running' && wanted) start(wanted); });
    return ctx;
  }

  function load(file) {
    if (!buffers.has(file)) {
      buffers.set(file, fetch(file)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
        .catch((e) => { buffers.delete(file); throw e; }));
    }
    return buffers.get(file);
  }

  function stopCurrent(fade = 1.2) {
    if (!current) return;
    const { src, gain } = current;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + fade);
    try { src.stop(t + fade + 0.05); } catch (e) { /* ignore */ }
    current = null;
  }

  async function start(track) {
    if (!enabled || !ensureCtx()) return;
    if (ctx.state === 'suspended') {
      // allowed straight away on sites the browser trusts for media; otherwise this waits for the first gesture
      ctx.resume().catch(() => {});
      if (ctx.state !== 'running') return;
    }
    const key = track.file;
    if (current && current.key === key) return;
    let buf;
    try { buf = await load(track.file); } catch (e) { return; }
    if (!wanted || wanted.file !== key || (current && current.key === key)) return;
    stopCurrent();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // MP3 encoders pad the start; loop exactly the composed length from the end of the padding.
    const len = track.loop && track.loop < buf.duration ? track.loop : buf.duration;
    src.loopStart = Math.max(0, buf.duration - len);
    src.loopEnd = buf.duration;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    src.connect(gain).connect(master);
    src.start(0, src.loopStart);
    current = { key, src, gain };
    updateUI();
  }

  function play(track) {
    wanted = track && track.file ? track : null;
    if (!wanted) { if (ctx) stopCurrent(); updateUI(); return; }
    updateUI();
    start(wanted);
  }

  function unlock() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume().then(() => wanted && start(wanted));
    else if (wanted) start(wanted);
  }
  ['pointerdown', 'mousedown', 'touchstart', 'touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true, capture: true }));

  function setEnabled(on) {
    enabled = on; save();
    if (ensureCtx()) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(on ? volume : 0, t + 0.4);
    }
    if (on && wanted) start(wanted);
    updateUI();
  }
  function setVolume(v) {
    volume = v; save();
    if (ctx && enabled) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    if (v > 0 && !enabled) setEnabled(true);
    updateUI();
  }

  // ---------- control: small icons at the top that open a volume popover ----------
  let group;
  function buildUI() {
    const box = window.SoundUI.box();
    group = window.SoundUI.group({
      icon: 'note', label: 'Music',
      enabled: () => enabled, setEnabled: (on) => { setEnabled(on); unlock(); },
      volume: () => volume, setVolume,
    });
    box.appendChild(group.el);
    updateUI();
  }
  function updateUI() { if (group) group.update(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI); else buildUI();
  // try right away (works where the browser allows autoplay, e.g. an installed app or a site you play often)
  window.addEventListener('load', () => { if (enabled && wanted) start(wanted); });

  return { play, setEnabled, setVolume };
})();
