'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const RANK = (n) => (n >= 10 ? 'A' : String(n));
  const RULE_NAMES = { open: 'Open', same: 'Same', plus: 'Plus', elemental: 'Elemental', storms: 'Storms', wager: 'Wager' };
  const HAND_NAMES = { balanced: '', random: 'Random hands', build: 'Built hands', budget: 'Budget hands' };

  let mode = null;            // 'ai' | 'online' while a match is open
  let state = null;
  let me = 0;
  let names = ['You', 'CPU'];
  let selected = null;
  let busy = false;
  let prevBoard = Array(9).fill(null);
  let ws = null, wsWanted = false, session = null;
  let roomDeck = null;        // deck id of the current room
  let account = null;         // { name } when signed in
  const decks = new Map();
  const sfx = (name, opts) => (typeof Sfx !== 'undefined' ? Sfx : { play() {} }).play(name, opts);
  const glyphsFor = (deckId) => ((decks.get(deckId) || {}).elements) || {};
  const glyph = (el) => (state && state.glyphs && state.glyphs[el]) || glyphsFor(roomDeck)[el] || '';

  // ---------- theme (follows the chosen card set, site-wide) ----------
  const THEME_COLOR = { wilds: '#3b2516', arcane: '#2b2150', starfall: '#0f1d3a', tidebound: '#0b3c46', bloomwild: '#25421c', hollow: '#231b34' };
  function applyTheme(deckId) {
    if (!deckId || document.documentElement.dataset.theme === deckId) return;
    document.documentElement.dataset.theme = deckId;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', THEME_COLOR[deckId] || '#3b2516');
  }
  // the set the player has chosen (menu and collection pickers stay in sync)
  function chooseSet(deckId) {
    if (!decks.has(deckId)) return;
    $('#deck').value = deckId; $('#col-deck').value = deckId;
    const si = $('#set-icon'); if (si) si.textContent = SET_ICON[deckId] || '🃏';   // phones show just the icon
    try { localStorage.setItem('triad-deck', deckId); } catch (e) { /* ignore */ }
    const dd = $('#deck-desc'); if (dd) dd.textContent = decks.get(deckId).description || '';
    applyTheme(deckId);
  }

  // ---------- helpers ----------
  function musicFor(deckId) { const d = decks.get(deckId); return d && d.music ? { ...d.music } : null; }
  function show(id) {
    if (id === 'menu' || id === 'collection' || id === 'lobby') applyTheme($('#deck').value);
    if (id === 'builder' && roomDeck) applyTheme(roomDeck);
    if ((id === 'menu' || id === 'collection') && typeof Music !== 'undefined') Music.play(musicFor(id === 'menu' ? $('#deck').value : $('#col-deck').value));
    if (id === 'builder' && typeof Music !== 'undefined') Music.play(musicFor(roomDeck));
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    $('#result').classList.remove('show');
    navRecord(id === 'menu' ? currentView : id);
    // the navigation belongs to the menu and the collection, not to matches
    const navOn = id === 'menu' || id === 'collection';
    document.body.classList.toggle('with-nav', navOn);
    document.body.classList.toggle('in-game', id === 'game');
    markNav(id === 'collection' ? 'collection' : currentView);
    if (id === 'menu') { refreshProgress(); refreshDailies(); }
  }

  // ---------- browser history: Back goes to the previous screen (or closes the open popup) ----------
  // Each screen change adds a history entry; popups add one too, so Back closes them first.
  let navFromPop = false;
  const MATCH_SCREENS = ['lobby', 'builder', 'game'];
  function navRecord(loc) {
    if (navFromPop) return;
    const cur = history.state || {};
    if (cur.loc === loc && !cur.overlay) return;
    // moving between match stages (lobby → hand builder → game) replaces the entry, so Back leaves the match
    const replace = !cur.loc || (MATCH_SCREENS.includes(cur.loc) && MATCH_SCREENS.includes(loc)) || cur.overlay;
    history[replace ? 'replaceState' : 'pushState']({ loc }, '', location.pathname + location.search);
  }
  function navGo(loc) {
    navFromPop = true;
    try {
      if (loc === 'collection') openCollection($('#deck').value);
      else if (MATCH_SCREENS.includes(loc)) { /* can't re-enter a finished match from history */ setView(currentView); }
      else setView(loc);
    } finally { navFromPop = false; }
  }
  const OVERLAYS = ['concede', 'reward-pick', 'card-zoom', 'card-detail', 'auth', 'pack-pick', 'pack', 'history'];
  const overlayOpen = () => OVERLAYS.find((id) => { const el = document.getElementById(id); return el && el.classList.contains('show'); });
  function closeOverlay(id) {
    if (id === 'history') { setHistory(false); return; }
    if (id === 'pack') { $('#btn-pack-done').click(); return; }
    document.getElementById(id).classList.remove('show');
  }
  let skipPop = false;   // set when the page itself steps back over a popup's entry
  window.addEventListener('popstate', (e) => {
    if (skipPop) { skipPop = false; return; }
    const st = e.state || {};
    const open = overlayOpen();
    if (open) {   // Back closes the popup that's open
      if (open === 'pack' && document.querySelector('#pack .sealed.charging, #pack .sealed.tearing')) { history.pushState({ loc: (history.state || {}).loc, overlay: 'pack' }, ''); return; }
      navFromPop = true; try { closeOverlay(open); } finally { navFromPop = false; }
      if (st.overlay) return;
      if (st.loc && st.loc !== activeLoc()) navGo(st.loc);
      return;
    }
    if (st.overlay) { history.back(); return; }   // a leftover popup entry: skip it
    const here = activeLoc();
    if (MATCH_SCREENS.includes(here) && !MATCH_SCREENS.includes(st.loc || '')) {
      const inProgress = here === 'game' ? (state && !state.over) : true;
      if (inProgress && !confirm('Leave this match?')) { history.pushState({ loc: here }, ''); return; }
      navFromPop = true; try { disconnect(); show('menu'); setView(st.loc && !MATCH_SCREENS.includes(st.loc) && st.loc !== 'collection' ? st.loc : currentView); } finally { navFromPop = false; }
      return;
    }
    if (st.loc) navGo(st.loc);
  });
  function activeLoc() {
    const scr = document.querySelector('.screen.active');
    return !scr ? null : scr.id === 'menu' ? currentView : scr.id;
  }
  // popups: opening one adds a history entry; closing it in the page removes that entry again
  OVERLAYS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    let was = el.classList.contains('show');
    new MutationObserver(() => {
      const now = el.classList.contains('show');
      if (now === was) return;
      was = now;
      if (navFromPop) return;
      if (now) history.pushState({ loc: activeLoc(), overlay: id }, '');
      else if ((history.state || {}).overlay === id) { skipPop = true; history.back(); }
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  // ---------- navigation ----------
  let currentView = 'play';
  try { const v = sessionStorage.getItem('triad-view'); if (v && ['play', 'challenges', 'rewards'].includes(v)) currentView = v; } catch (e) { /* ignore */ }
  function markNav(view) {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  }
  function setView(view) {
    if (view === 'collection') {
      if (!account) { openAuth(); toast('Sign in to start a collection.'); return; }
      openCollection($('#deck').value);
      return;
    }
    currentView = view;
    try { sessionStorage.setItem('triad-view', view); } catch (e) { /* ignore */ }
    document.querySelectorAll('#menu .view').forEach((v) => { v.hidden = v.dataset.view !== view; });
    if (!document.querySelector('#menu.active')) show('menu'); else { document.body.classList.add('with-nav'); markNav(view); navRecord(view); }
    window.scrollTo(0, 0);
    if (view === 'challenges') refreshDailies();
    if (view === 'rewards') refreshRewards(true);
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function banner(text) {
    const b = $('#banner'); b.textContent = text; b.classList.add('show');
    await sleep(750); b.classList.remove('show'); await sleep(200);
  }
  function readRules() {
    return {
      open: $('#r-open').checked, same: $('#r-same').checked, plus: $('#r-plus').checked, elemental: $('#r-elemental').checked, storms: $('#r-storms').checked,
      handMode: $('#r-hands').value, wager: $('#r-wager').checked,
    };
  }
  function playerName() { return account ? account.name : (($('#name').value || '').trim() || 'Player'); }
  function hue(id) { return (Number(id) * 47 + 200) % 360; }
  function initials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); }
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  // deck card (from JSON) -> play card shape used for rendering
  const playCard = (c, foil) => ({ id: c.id, name: c.name, level: c.level, r: c.ranks, el: c.element || null, img: c.image || null, foil: !!foil });
  const RARITY = { 1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Epic', 5: 'Legendary' };
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : 'No element');
  const deckCard = (deckId, id) => (decks.get(deckId).cards.find((c) => c.id === Number(id)));

  // ---------- card rendering ----------
  // side: 'mine' | 'theirs' | 'neutral'. Frame: outer = rarity metal, inner rim = element, name plate = owner.
  function cardEl(card, side, glyphs) {
    const el = document.createElement('div');
    if (!card || card.hidden) {
      el.className = 'card back lit';
      const sh = document.createElement('div'); sh.className = 'glare-spot'; el.appendChild(sh);
      return el;
    }
    el.className = `card lit ${side} rar-${Math.min(5, Math.max(1, card.level || 1))} el-${card.el || 'none'}${card.foil ? ' holo' : ''}`;
    const art = document.createElement('div');
    art.className = 'art';
    if (card.img) art.style.backgroundImage = `url("${encodeURI(card.img)}")`;
    else {
      const h = hue(card.id);
      art.style.background = `radial-gradient(circle at 50% 45%, hsl(${h} 70% 62% / .9), hsl(${(h + 40) % 360} 60% 30% / .85) 70%)`;
      const s = document.createElement('div'); s.className = 'sigil'; s.textContent = initials(card.name); art.appendChild(s);
    }
    if (card.foil) { const foil = document.createElement('div'); foil.className = 'foil-layer'; art.appendChild(foil); }
    const glare = document.createElement('div'); glare.className = 'glare-spot'; art.appendChild(glare);
    el.appendChild(art);
    const back = document.createElement('div'); back.className = 'flip-face'; el.appendChild(back);
    const ranks = document.createElement('div');
    ranks.className = 'ranks';
    ['t', 'r', 'b', 'l'].forEach((k, i) => { const s = document.createElement('span'); s.className = k; s.textContent = RANK(card.r[i]); ranks.appendChild(s); });
    el.appendChild(ranks);
    if (card.el) { const e = document.createElement('div'); e.className = 'el'; e.textContent = (glyphs || {})[card.el] || glyph(card.el); e.title = cap(card.el); el.appendChild(e); }
    if (card.level === 5) { const cm = document.createElement('i'); cm.className = 'comets'; el.prepend(cm); }   // legendary frame comets (behind the art)
    if (card.level === 4) for (let k = 0; k < 4; k++) { const t = document.createElement('i'); t.className = 'tw'; el.appendChild(t); }   // diamond frame sparkles
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = card.name; el.appendChild(nm);
    el.title = `${card.name} — ${RARITY[card.level] || ''} · ${cap(card.el)}${card.foil ? ' · Foil' : ''} — ${card.r.map(RANK).join(' / ')}`;
    return el;
  }

  // ---------- game render ----------
  function myTurn() { return state && !state.over && state.turn === me && !busy; }

  function render() {
    if (!state) return;
    $('#btn-quit').textContent = state.over ? 'Main Menu' : 'Concede';
    if (typeof Music !== 'undefined' && state.deck) Music.play(musicFor(state.deck.id));
    if (state.deck) applyTheme(state.deck.id);
    // element icons only matter in Elemental matches
    $('#game').classList.toggle('no-elements', !state.rules.elemental);
    const opp = 1 - me;
    const sc = TT.score(state);
    $('#score-mine').textContent = sc[me];
    $('#score-theirs').textContent = sc[opp];
    $('#name-mine').textContent = names[me] || 'You';
    $('#name-theirs').textContent = names[opp] || 'Opponent';
    const turn = $('#turn');
    if (state.over) { turn.textContent = 'Game over'; turn.classList.remove('me'); }
    else if (state.storm) { turn.textContent = state.storm.chooser === me ? 'A storm is coming — choose how to face it' : `${names[state.storm.chooser] || 'Opponent'} is facing the storm…`; turn.classList.toggle('me', state.storm.chooser === me); }
    else if (state.turn === me) { turn.textContent = selected === null ? 'Your turn — drag a card onto the board' : 'Place it on the board'; turn.classList.add('me'); }
    else { turn.textContent = `${names[opp] || 'Opponent'} is thinking…`; turn.classList.remove('me'); }
    const ruleBits = Object.keys(RULE_NAMES).filter((k) => state.rules[k]).map((k) => RULE_NAMES[k]);
    if (HAND_NAMES[state.rules.handMode]) ruleBits.push(HAND_NAMES[state.rules.handMode]);
    $('#rules-label').textContent = (state.deck && state.deck.name ? state.deck.name + ' — ' : '') + (ruleBits.join(' · ') || 'Basic rules');

    const hm = $('#hand-mine'); hm.innerHTML = '';
    hm.classList.toggle('has-selected', selected !== null && myTurn());
    state.hands[me].forEach((c, i) => {
      const el = cardEl(c, 'mine');
      if (myTurn()) {
        el.classList.add('playable');
        el.addEventListener('pointerdown', (e) => startDrag(e, i, el));
      }
      if (selected === i) el.classList.add('selected');
      hm.appendChild(el);
    });
    const ht = $('#hand-theirs'); ht.innerHTML = '';
    state.hands[opp].forEach((c) => ht.appendChild(cardEl(c, 'theirs')));

    const board = $('#board'); board.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.cell = i;
      const slot = state.board[i];
      const elKey = state.elements[i];
      if (elKey && !slot) { const e = document.createElement('div'); e.className = `elem el-${elKey}`; e.textContent = glyph(elKey) || '?'; e.title = `${cap(elKey)} square`; cell.appendChild(e); }
      if (slot) {
        const el = cardEl(slot.card, slot.owner === me ? 'mine' : 'theirs');
        const moved = shiftedFrom[i];
        const prev = moved !== undefined ? prevBoard[moved] : prevBoard[i];
        if (moved !== undefined) { el.classList.add('shifted'); el.dataset.from = moved; if (prev && prev.owner !== slot.owner) el.classList.add('owner-changed'); }
        else if (!prev) el.classList.add('placed');
        else if (prev.owner !== slot.owner) {
          const from = prevBoard.findIndex((p, k) => !p && state.board[k]);   // the card just played
          const src = from >= 0 ? from : i;
          const sameRow = Math.floor(src / 3) === Math.floor(i / 3);
          el.classList.add('flip', sameRow ? 'flip-y' : 'flip-x');
          el.style.setProperty('--fd', sameRow ? (i % 3 > src % 3 ? 1 : -1) : (i > src ? -1 : 1));
        }
        cell.appendChild(el);
        const total = (elKey ? (slot.card.el === elKey ? 1 : -1) : 0) + (slot.mod || 0);
        if (slot.mod < 0) el.classList.add('scorched');
        if (slot.mod > 0) el.classList.add('empowered');
        if (total) {
          const m = document.createElement('div'); m.className = 'mod ' + (total > 0 ? 'up' : 'down'); m.textContent = (total > 0 ? '+' : '−') + Math.abs(total);
          m.title = [elKey ? (slot.card.el === elKey ? '+1 matching element square' : '−1 element square') : '', slot.mod < 0 ? `${slot.mod} scorched` : slot.mod > 0 ? `+${slot.mod} harnessed` : ''].filter(Boolean).join(', ');
          cell.appendChild(m);
        }
      } else if (myTurn() && selected !== null && TT.openCells(state).includes(i)) {
        cell.classList.add('can-drop');
        cell.onclick = () => playMove(selected, i);
      }
      if (state.frost && state.frost[i] > 0) {
        cell.classList.add('frozen');
        const f = document.createElement('div'); f.className = 'frost-tag'; f.textContent = `❄ ${state.frost[i]}`; f.title = `Frozen for ${state.frost[i]} more turn${state.frost[i] > 1 ? 's' : ''}`;
        cell.appendChild(f);
      }
      if (state.storm && state.storm.cells.includes(i)) { cell.classList.add('storm-target', 'st-' + state.storm.kind); cell.style.setProperty('--si', state.storm.cells.indexOf(i)); const ring = document.createElement('div'); ring.className = 'storm-ring'; cell.appendChild(ring); }
      board.appendChild(cell);
    }
    prevBoard = state.board.map((s) => (s ? { owner: s.owner, id: s.card.id } : null));
    shiftedFrom = {};
    renderStormBits();
    renderHistory();
  }

  // ---------- storms ----------
  let shiftedFrom = {};
  const STORM_ICON = { fire: '🔥', tide: '🌊', wind: '🌪️', lightning: '⚡', frost: '❄️', quake: '⛰️', dragon: '🐉' };
  const RESP_ICON = { ward: '🛡️', deflect: '↪️', brace: '🪨', harness: '✨', weather: '⛈️', defy: '🎲' };
  let stormTick = null, stormShownFor = null;
  function renderStormBits() {
    const on = !!(state && state.rules.storms);
    $('#wards-mine').hidden = !on; $('#wards-theirs').hidden = !on;
    if (on) {
      const w = state.wards || [0, 0], b = state.boost || [0, 0];
      $('#wards-mine').innerHTML = `<i>🛡️</i>${w[me]}${b[me] ? ' <i>✨</i>' : ''}`;
      $('#wards-theirs').innerHTML = `<i>🛡️</i>${w[1 - me]}${b[1 - me] ? ' <i>✨</i>' : ''}`;
      $('#wards-mine').title = `Your Wards: ${w[me]}${b[me] ? ' · next card +1 (Harness)' : ''}`;
      $('#wards-theirs').title = `${names[1 - me] || 'Opponent'}'s Wards: ${w[1 - me]}${b[1 - me] ? ' · next card +1' : ''}`;
    }
    const panel = $('#storm');
    const st = state && state.storm;
    $('#board').classList.toggle('storming', !!st);
    if (!st) { panel.classList.remove('show'); clearInterval(stormTick); stormShownFor = null; return; }
    const key = st.seed;
    if (stormShownFor === key) { markStormPick(st); return; }
    stormShownFor = key;
    const info = TT.STORMS[st.kind];
    const mine = st.chooser === me;
    panel.className = 'storm show st-' + st.kind;   // also clears .decided
    $('#storm-icon').textContent = STORM_ICON[st.kind];
    $('#storm-name').textContent = info.name;
    $('#storm-text').textContent = info.text + (info.el && st.kind !== 'quake' && st.kind !== 'tide' && st.kind !== 'frost' ? ` ${cap(info.el)} cards are immune.` : '');
    $('#storm-who').textContent = mine ? 'How will you face it?' : `${names[st.chooser] || 'Opponent'} is choosing how to face it…`;
    const box = $('#storm-options'); box.innerHTML = '';
    st.options.forEach((o) => {
      const r = TT.RESPONSES[o];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'resp resp-' + o; b.disabled = !mine;
      const extra = o === 'ward' ? ` (${(state.wards || [0, 0])[st.chooser]} left)` : '';
      b.innerHTML = `<span class="resp-ic">${RESP_ICON[o]}</span><b>${r.name}</b><span class="resp-tx">${r.text}${extra}</span>`;
      b.onclick = () => { if (!mine) return; box.querySelectorAll('.resp').forEach((x) => { x.disabled = true; x.classList.toggle('picked', x === b); }); sfx('click'); send({ t: 'storm', choice: o }); };
      box.appendChild(b);
    });
    const bar = $('#storm-timer span');
    clearInterval(stormTick);
    const total = st.deadline ? Math.max(1, st.deadline - Date.now()) : 25000;
    const end = Date.now() + total, full = 25000;
    const tick = () => { const left = Math.max(0, end - Date.now()); bar.style.width = (100 * left / full) + '%'; if (!left) clearInterval(stormTick); };
    tick(); stormTick = setInterval(tick, 200);
    markStormPick(st);
  }
  // Once a response is chosen (by anyone), highlight it and dim the rest until it resolves.
  function markStormPick(st) {
    const box = $('#storm-options');
    if (!st.picked) return;
    clearInterval(stormTick);
    $('#storm').classList.add('decided');
    box.querySelectorAll('.resp').forEach((b) => { b.disabled = true; b.classList.toggle('picked', b.classList.contains('resp-' + st.picked)); });
    $('#storm-who').textContent = st.chooser === me ? `You chose ${TT.RESPONSES[st.picked].name}…` : `${names[st.chooser] || 'Opponent'} chose ${TT.RESPONSES[st.picked].name}…`;
  }
  // Plays a strike on the current board before the new state is drawn.
  async function stormFx(e) {
    const board = $('#board');
    const cells = e.cells.map((c) => board.querySelector(`.cell[data-cell="${c}"]`)).filter(Boolean);
    sfx('storm-' + e.kind);
    board.classList.add('fx-' + e.kind);
    if (e.kind === 'dragon' && cells.length) {
      const b = board.getBoundingClientRect();
      const first = cells[0].getBoundingClientRect(), last = cells[cells.length - 1].getBoundingClientRect();
      const cx = (r) => r.left + r.width / 2 - b.left, cy = (r) => r.top + r.height / 2 - b.top;
      const dx = cx(last) - cx(first), dy = cy(last) - cy(first);
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, pad = Math.max(b.width, b.height) * 0.45;
      const d = document.createElement('div'); d.className = 'dragon';
      d.innerHTML = DRAGON_SVG;
      d.style.setProperty('--x0', (cx(first) - ux * pad) + 'px'); d.style.setProperty('--y0', (cy(first) - uy * pad) + 'px');
      d.style.setProperty('--x1', (cx(last) + ux * pad) + 'px'); d.style.setProperty('--y1', (cy(last) + uy * pad) + 'px');
      d.style.setProperty('--ang', Math.atan2(uy, ux) + 'rad');
      board.appendChild(d);
      cells.forEach((c, k) => setTimeout(() => c.classList.add('fx-hit'), 350 + k * 260));
      await sleep(1500);
      d.remove();
    } else {
      cells.forEach((c, k) => { c.style.setProperty('--fi', k); c.classList.add('fx-hit'); });
      await sleep(e.kind === 'tide' || e.kind === 'quake' ? 650 : 900);
    }
    board.classList.remove('fx-' + e.kind);
    cells.forEach((c) => c.classList.remove('fx-hit'));
  }
  // Slides moved cards from their old square to the new one.
  function animateShifts() {
    const board = $('#board');
    board.querySelectorAll('.card.shifted').forEach((el) => {
      const from = board.querySelector(`.cell[data-cell="${el.dataset.from}"]`);
      const to = el.closest('.cell');
      if (!from || !to) return;
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      el.style.transition = 'none';
      el.style.translate = `${a.left - b.left}px ${a.top - b.top}px`;
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'translate .55s cubic-bezier(.3,1.3,.5,1)'; el.style.translate = '0 0'; }));
      setTimeout(() => { el.style.transition = ''; el.style.translate = ''; }, 700);
    });
  }
  const DRAGON_SVG = `<svg viewBox="0 0 200 120" aria-hidden="true"><defs><linearGradient id="dg" x1="0" x2="1"><stop offset="0" stop-color="#3a0d0a"/><stop offset=".6" stop-color="#8e1d12"/><stop offset="1" stop-color="#d9481e"/></linearGradient><radialGradient id="df" cx=".1" cy=".5" r=".9"><stop offset="0" stop-color="#fff6b0"/><stop offset=".35" stop-color="#ffb02e"/><stop offset="1" stop-color="#ff3d00" stop-opacity="0"/></radialGradient></defs>
    <path class="wing w1" d="M92 58 C80 20 60 6 34 2 C46 18 50 30 48 42 C40 34 30 30 18 30 C30 40 36 50 38 60 Z" fill="url(#dg)" opacity=".95"/>
    <path d="M18 64 C40 54 70 52 96 56 C120 50 140 52 158 58 C168 54 178 54 186 58 C180 62 176 66 168 68 C150 72 128 72 110 70 C80 76 50 76 18 64 Z" fill="url(#dg)"/>
    <path d="M18 64 C10 60 4 62 0 70 C8 68 12 70 18 70 Z" fill="#3a0d0a"/>
    <circle cx="176" cy="59" r="2.2" fill="#ffd34d"/>
    <path d="M180 54 L190 46 L186 56 Z" fill="#3a0d0a"/>
    <path class="wing w2" d="M100 58 C96 26 112 10 140 4 C130 20 128 32 132 44 C138 38 150 34 164 36 C150 44 140 52 134 62 Z" fill="#6b150d" opacity=".9"/>
    <path class="breath" d="M188 60 C200 58 214 56 230 50 L232 72 C214 68 202 66 188 64 Z" fill="url(#df)"/>
  </svg>`;

  // ---------- move history ----------
  const SIDE = ['top', 'right', 'bottom', 'left'];
  const RAR_COLOR = { 1: '#8d939c', 2: '#b77d47', 3: '#d4dbe4', 4: '#e9c55a', 5: '#c58cff' };
  let historyOpen = false;
  function setHistory(open) {
    historyOpen = open;
    if (open) autoPlayed = -1; else stopReplay();
    $('#history').classList.toggle('show', open);
    $('#btn-history').setAttribute('aria-expanded', String(open));
    if (open) renderHistory();
  }
  function miniCard(card, owner, cellIdx, marks) {
    const el = document.createElement('div');
    el.className = `mini-card ${owner === me ? 'mine' : 'theirs'}${card.level === 5 ? ' r5' : ''}`;
    el.style.setProperty('--rar', RAR_COLOR[card.level] || RAR_COLOR[1]);
    if (card.img) el.style.backgroundImage = `url("${encodeURI(card.img)}")`;
    el.title = card.name;
    SIDE.forEach((sd, d) => {
      const r = document.createElement('span');
      r.className = `rk ${sd}`; r.textContent = RANK(card.r[d]);
      const m = marks.filter((x) => x.cell === cellIdx && x.d === d);
      if (m.length) { r.classList.add('hl', m[m.length - 1].cls); r.dataset.steps = m.map((x) => x.step).join(' '); }
      el.appendChild(r);
    });
    return el;
  }
  function renderHistory() {
    const hist = (state && state.history) || [];
    const btn = $('#btn-history');
    if (btn) btn.querySelector('b').textContent = hist.length;
    if (!historyOpen) return;
    const list = $('#history-list'); list.innerHTML = '';
    if (!hist.length) { const li = document.createElement('li'); li.className = 'muted hist-empty'; li.textContent = 'No moves yet.'; list.appendChild(li); return; }
    const glyphs = (state && state.glyphs) || {};
    const who = (p) => (p === me ? 'You' : (names[p] || 'Opponent'));
    const cards = Array(9).fill(null);
    const entries = [];
    hist.forEach((h, i) => {
      let snapshot;
      if (h.snap) snapshot = h.snap.map((x) => (x && x.card ? x.card : null));
      else { cards[h.cell] = h.card; snapshot = cards.slice(); }
      entries.push({ h, i, snapshot });
    });
    for (const { h, i, snapshot } of entries.reverse()) {
      const li = document.createElement('li');
      li.className = `hist-move ${h.p === me ? 'mine' : 'theirs'}`;
      const nm = (c) => (snapshot[c] ? snapshot[c].name : '?');
      const marks = [];   // highlighted numbers on the mini board
      const lines = [];
      const flips = new Set();
      const num = (v, cls) => `<b class="n ${cls}">${RANK(v)}</b>`;
      const modTxt = (m, v) => (m ? ` <small>(${RANK(v - m)} ${m > 0 ? '+' : '−'} ${Math.abs(m)})</small>` : '');
      if (h.mod) lines.push({ html: `Placed on ${h.mod > 0 ? 'a matching' : 'a different'} element square: <b>${h.mod > 0 ? '+1' : '−1'}</b> to every side.`, cls: 'note' });
      if (h.storm) {
        const SN = TT.STORMS, R = TT.RESPONSES;
        lines.push({ html: `<span class="htag tstorm">${R[h.choice].name}</span> ${h.choice === 'ward' ? 'The storm was blocked.' : R[h.choice].text}`, cls: 'note' });
        if (h.kind !== h.original) lines.push({ html: `Fate turned ${SN[h.original].name} into <b>${SN[h.kind].name}</b>.`, cls: 'note' });
      }
      if (h.boosted) lines.push({ html: 'Harnessed: <b>+1</b> to every side.', cls: 'note' });
      h.steps.forEach((st, si) => {
        if (h.storm) {
          const t = {
            warded: null, 'gain-ward': null, boost: null, deflected: null, defied: null,
            scorch: `🔥 <b>${nm(st.n)}</b> is scorched: −1 to every side.`,
            bolt: `⚡ <b>${nm(st.n)}</b> was struck and changed sides.`,
            burn: `🐉 <b>${nm(st.n)}</b> was swept up by the dragon and changed sides.`,
            spin: `🌪 <b>${nm(st.n)}</b> spun a quarter turn <b>clockwise</b> ↻: top → right → bottom → left.`,
            freeze: `❄ The ${SIDE_CELL[st.n]} square is frozen for two turns.`,
            swap: `⛰ <b>${nm(st.a)}</b> and <b>${nm(st.b)}</b> swapped places.`,
            tide: st.moves ? `🌊 ${st.moves.length ? st.moves.map((m) => `<b>${nm(m.to)}</b> was pushed ${SIDE_CELL[m.from]} → ${SIDE_CELL[m.to]}`).join('; ') : 'Nothing could move.'}` : '',
            dragon: '🐉 The dragon flew over the ' + (st.path ? st.path.map((c) => SIDE_CELL[c]).join(' → ') : '') + ' squares.',
            sx: `<b>${nm(st.n)}</b> was ${st.why === 'immune' ? 'immune (same element as the storm)' : st.why === 'frozen' ? 'frozen solid and held' : 'braced and held'}.`,
          }[st.k];
          if (st.k === 'scap') {
            const od = (st.d + 2) % 4;
            marks.push({ cell: st.from, d: st.d, cls: 'win', step: si }, { cell: st.n, d: od, cls: 'lose', step: si });
            flips.add(st.n);
            lines.push({ html: `${nm(st.from)}’s ${SIDE[st.d]} ${num(st.a, 'win')} beats ${nm(st.n)}’s ${SIDE[od]} ${num(st.b, 'lose')} → <b>captured</b>`, step: si, cls: 'win' });
          } else if (t) {
            if (st.k === 'bolt' || st.k === 'burn') flips.add(st.n);
            const cells = st.k === 'swap' ? [st.a, st.b] : st.k === 'tide' ? (st.moves || []).flatMap((m) => [m.from, m.to]) : st.k === 'dragon' ? (st.path || []) : st.n !== undefined ? [st.n] : [];
            lines.push({ html: t, cls: 'note', cells, flipped: st.k === 'bolt' || st.k === 'burn' ? [st.n] : [], fx: st.k });
          }
          return;
        }
        if (st.k === 'same' || st.k === 'plus') {
          const parts = st.pairs.map((x) => {
            marks.push({ cell: h.cell, d: x.d, cls: st.k, step: si }, { cell: x.n, d: (x.d + 2) % 4, cls: st.k, step: si });
            if (x.flip) flips.add(x.n);
            const od = SIDE[(x.d + 2) % 4];
            const pair = st.k === 'same'
              ? `${SIDE[x.d]} ${num(x.a, st.k)} = ${nm(x.n)}’s ${od} ${num(x.b, st.k)}`
              : `${SIDE[x.d]} ${num(x.a, st.k)} + ${nm(x.n)}’s ${od} ${num(x.b, st.k)} = <b>${st.sum}</b>`;
            return pair + (x.own ? ' <small>(already theirs: counts, doesn’t flip)</small>' : '');
          });
          const got = st.pairs.filter((x) => x.flip).map((x) => nm(x.n));
          lines.push({ html: `<span class="htag ${st.k}">${st.k === 'same' ? 'Same' : 'Plus'}</span>${parts.join('<br>')}${got.length ? `<br>→ flips <b>${got.join(', ')}</b>` : ''}`, step: si, cls: st.k });
        } else {
          const od = (st.d + 2) % 4;
          const cls = st.k === 'combo' ? 'combo' : st.flip ? 'win' : 'hold';
          marks.push({ cell: st.from, d: st.d, cls: st.flip ? cls : 'weak', step: si }, { cell: st.n, d: od, cls: st.flip ? 'lose' : 'strong', step: si });
          if (st.flip) flips.add(st.n);
          const a = `${st.k === 'combo' ? nm(st.from) + '’s ' : ''}${SIDE[st.d]} ${num(st.a, st.flip ? 'win' : 'weak')}${modTxt(st.am, st.a)}`;
          const b = `${nm(st.n)}’s ${SIDE[od]} ${num(st.b, st.flip ? 'lose' : 'strong')}${modTxt(st.bm, st.b)}`;
          lines.push({
            html: st.k === 'combo'
              ? `<span class="htag combo">Combo</span> ${a} beats ${b} → <b>captured</b>`
              : st.flip ? `${a} beats ${b} → <b>captured</b>` : st.ice ? `${a} beats ${b}, but it’s frozen → holds` : `${a} vs ${b} → ${st.a === st.b ? 'tie, ' : ''}holds`,
            step: si, cls,
          });
        }
      });
      // what each line points at: numbers (by step), cards to flash, and cards that changed sides
      for (const ln of lines) {
        if (ln.step === undefined) { if (!ln.cells) ln.cells = []; continue; }
        const st = h.steps[ln.step];
        ln.cells = [...new Set(marks.filter((m) => m.step === ln.step).map((m) => m.cell))];
        ln.flipped = st.pairs ? st.pairs.filter((x) => x.flip).map((x) => x.n) : st.flip ? [st.n] : [];
      }
      if (h.mod || h.boosted) lines.filter((l) => l.cls === 'note' && !l.cells.length && !h.storm).forEach((l) => { l.cells = [h.cell]; });
      if (!h.steps.length && !h.storm) {
        const around = [0, 1, 2, 3].map((d) => TT.neighbor(h.cell, d)).filter((n) => n >= 0 && h.owners[n] !== null);
        lines.push({ html: i === 0 ? 'First card on the board.' : around.length ? 'Only its own side’s cards next to it, so nothing to capture.' : 'Nothing next to it yet.', cls: 'note' });
      }

      const head = document.createElement('div'); head.className = 'hist-head';
      if (h.storm) li.classList.add('storm-entry');
      const playBtn = '<button type="button" class="hist-play" title="Replay this move" aria-label="Replay this move">▶</button>';
      head.innerHTML = h.storm
        ? `<span class="hist-no">${STORM_ICON[h.kind]}</span><span><b>${TT.STORMS[h.original || h.kind].name}</b> <small>· ${who(h.p)} chose ${TT.RESPONSES[h.choice].name}</small></span><span class="hist-res${flips.size ? '' : ' none'}">${flips.size ? `${flips.size} flipped` : 'no flips'}</span>${playBtn}`
        : `<span class="hist-no">${hist.slice(0, i + 1).filter((x) => !x.storm).length}</span><span><b>${who(h.p)}</b> played <b>${h.card.name}</b> <small>· ${SIDE_CELL[h.cell]}</small></span><span class="hist-res${flips.size ? '' : ' none'}">${flips.size ? `+${flips.size} flip${flips.size > 1 ? 's' : ''}` : 'no flips'}</span>${playBtn}`;
      li.appendChild(head);
      const body = document.createElement('div'); body.className = 'hist-body';
      const mb = document.createElement('div'); mb.className = 'mini-board';
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div'); cell.className = 'mini-cell';
        const ek = state.elements && state.elements[c];
        if (ek) { cell.classList.add('elem'); cell.dataset.el = glyphs[ek] || glyph(ek) || ''; }
        const sn = h.snap && h.snap[c];
        if (sn && sn.f) { cell.classList.add('mini-frozen'); }
        if (h.storm && h.cells && h.cells.includes(c)) cell.classList.add('mini-struck');
        if (snapshot[c]) {
          cell.classList.add(h.owners[c] === me ? 'own-mine' : 'own-theirs');
          const mc = miniCard(snapshot[c], h.owners[c], c, marks);
          if (sn && sn.m) { const mm = document.createElement('i'); mm.className = 'mini-mod ' + (sn.m > 0 ? 'up' : 'down'); mm.textContent = (sn.m > 0 ? '+' : '−') + Math.abs(sn.m); mc.appendChild(mm); }
          if (!h.storm && c === h.cell) mc.classList.add('placed');
          if (flips.has(c)) { mc.classList.add('flipped'); const f = document.createElement('i'); f.className = 'flip-badge'; f.textContent = '↻'; mc.appendChild(f); }
          cell.appendChild(mc);
        }
        // storms: the board as it was before the strike, shown while a line is replayed, then swapped for the result
        if (h.storm && h.before) {
          const bs = h.before[c];
          const wrap = document.createElement('div'); wrap.className = 'mini-before';
          if (bs && bs.card) {
            wrap.classList.add(bs.o === me ? 'own-mine' : 'own-theirs');
            const bc = miniCard(bs.card, bs.o, -1, []);
            if (bs.m) { const mm = document.createElement('i'); mm.className = 'mini-mod ' + (bs.m > 0 ? 'up' : 'down'); mm.textContent = (bs.m > 0 ? '+' : '−') + Math.abs(bs.m); bc.appendChild(mm); }
            wrap.appendChild(bc);
          }
          if (bs && bs.f) wrap.classList.add('mini-frozen');
          cell.appendChild(wrap);
        }
        mb.appendChild(cell);
      }
      body.appendChild(mb);
      const ul = document.createElement('ul'); ul.className = 'hist-steps';
      const mcells = [...mb.children];
      const hasBefore = !!(h.storm && h.before);
      const goOff = () => { ul.querySelectorAll('li.lit').forEach((x) => x.classList.remove('lit')); mcells.forEach((c) => c.classList.remove('cell-flash', 'cell-turn', 'fx-spin', 'fx-scorch', 'fx-bolt', 'fx-burn', 'fx-freeze', 'fx-tide', 'fx-swap', 'fx-dragon')); mb.classList.remove('focus'); };
      let afterTimer = null;
      const lit = lines.map((ln, lineNo) => {
        const sli = document.createElement('li'); sli.className = ln.cls || ''; sli.innerHTML = ln.html;
        // light up this line: its numbers glow, its cards flash, captured cards change colour.
        // For storms the affected squares first show how they were before the strike, then change to the result.
        const on = (v) => {
          if (hasBefore) {
            clearTimeout(afterTimer);
            mb.classList.toggle('show-before', v);
            if (v) {
              const earlier = new Set(lines.slice(0, lineNo).flatMap((l) => l.cells));
              mcells.forEach((c, k) => c.classList.toggle('cell-after', earlier.has(k)));
              sli.classList.add('lit');
              afterTimer = setTimeout(() => {
                mcells.forEach((c, k) => { if (ln.cells.includes(k)) c.classList.add('cell-after'); });
                go(true);
              }, ln.cells.length ? 450 : 0);
              return;
            }
            mcells.forEach((c) => c.classList.remove('cell-after'));
          }
          go(v);
        };
        const go = (v) => {
          sli.classList.toggle('lit', v);
          mb.classList.toggle('focus', v && ln.step !== undefined);
          if (ln.step !== undefined) mb.querySelectorAll('.rk.hl').forEach((r) => r.classList.toggle('on', v && r.dataset.steps.split(' ').includes(String(ln.step))));
          mcells.forEach((c, k) => {
            const hit = v && ln.cells.includes(k);
            c.classList.remove('cell-flash', 'cell-turn', 'fx-' + ln.fx);
            if (hit) { void c.offsetWidth; c.classList.add('cell-flash'); if (ln.fx) c.classList.add('fx-' + ln.fx); }
            if (v && (ln.flipped || []).includes(k)) { c.classList.add('cell-turn'); c.style.setProperty('--was', h.owners[k] === me ? 'var(--theirs)' : 'var(--mine)'); }
          });
        };
        sli.addEventListener('pointerenter', () => { stopReplay(); on(true); });
        sli.addEventListener('pointerleave', () => on(false));
        ul.appendChild(sli);
        return on;
      });
      body.appendChild(ul);
      li.appendChild(body);
      li._replay = async () => {
        const token = {};
        replayToken = token;
        li.classList.add('replaying');
        const placed = !h.storm && mcells[h.cell];
        if (placed) { placed.classList.remove('cell-drop'); void placed.offsetWidth; placed.classList.add('cell-drop'); await sleep(550); }
        for (const on of lit) {
          if (replayToken !== token) break;
          on(true); await sleep(hasBefore ? 1500 : 1100);
          if (hasBefore) { goOff(); continue; }
          on(false);
          if (replayToken !== token) break;
          await sleep(120);
        }
        li.classList.remove('replaying');
        if (placed) placed.classList.remove('cell-drop');
        if (hasBefore) { goOff(); mb.classList.remove('show-before'); mcells.forEach((c) => c.classList.remove('cell-after')); }
      };
      head.querySelector('.hist-play').onclick = (e) => { e.stopPropagation(); li._replay(); };
      list.appendChild(li);
    }
    // play the newest move once when the panel opens or a new move arrives
    if (hist.length !== autoPlayed) {
      autoPlayed = hist.length;
      const first = list.querySelector('.hist-move');
      if (first && first._replay && !matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(() => { if (historyOpen) first._replay(); }, 350);
    }
  }
  let replayToken = null, autoPlayed = -1;
  const stopReplay = () => { replayToken = null; };
  const SIDE_CELL = ['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'];

  // ---------- drag & drop (mouse and touch); a plain click still selects ----------
  function markDrops(on) {
    document.querySelectorAll('#board .cell').forEach((c, idx) => {
      if (!state.board[idx]) c.classList.toggle('can-drop', (on || selected !== null) && TT.openCells(state).includes(idx));
    });
  }
  // Cancels an in-progress drag (set while dragging) — used by right-click and Escape.
  let cancelDrag = null;
  let swallowMenuUntil = 0;   // set when the right button cancels a card move
  function startDrag(e, i, el) {
    if (!myTurn() || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, rect = el.getBoundingClientRect();
    let offX = sx - rect.left, offY = sy - rect.top;
    let ghost = null, over = null, lastX = sx, lastY = sy;
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('contextmenu', onContext, true);
      cancelDrag = null;
      if (ghost) { ghost.remove(); ghost = null; }
      if (over) over.classList.remove('drop-over');
      el.classList.remove('dragging');
    };
    // put the card back in the hand and deselect it
    const cancel = () => { cleanup(); selected = null; render(); sfx('cancel'); };
    const onContext = (ev) => { ev.preventDefault(); ev.stopPropagation(); cancel(); };
    const move = (ev) => {
      if (ev.buttons & 2) { swallowMenuUntil = Date.now() + 1500; return cancel(); }   // right button pressed while dragging
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        sfx('pick');
        ghost = el.cloneNode(true);
        ghost.classList.remove('selected', 'playable', 'placed', 'flip');
        ghost.classList.add('drag-ghost');
        // the dragged card takes the size of a square on the board, growing from the hand size
        const slot = document.querySelector('#board .cell .card') || document.querySelector('#board .cell');
        const sr = slot ? slot.getBoundingClientRect() : rect;
        const gw = sr.width || rect.width, gh = sr.height || rect.height, k = gw / rect.width;
        ghost.style.width = gw + 'px'; ghost.style.height = gh + 'px';
        ghost.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * k) + 'px';
        offX *= k; offY *= gh / rect.height;               // keep the same spot under your finger
        ghost.style.transformOrigin = `${offX}px ${offY}px`;
        ghost.style.setProperty('--g0', (1 / k).toFixed(3));
        ghost._swing = { rx: 0, ry: 0 };
        document.body.appendChild(ghost);
        lastX = ev.clientX; lastY = ev.clientY;
        const decay = () => { if (!ghost) return; ghost._swing.rx *= 0.82; ghost._swing.ry *= 0.82; requestAnimationFrame(decay); };
        requestAnimationFrame(decay);
        el.classList.add('dragging');
        // dragging a card replaces any card selected by tapping
        if (selected !== null) {
          selected = null;
          document.querySelectorAll('#hand-mine .card.selected').forEach((x) => x.classList.remove('selected'));
          $('#hand-mine').classList.remove('has-selected');
        }
        markDrops(true);
      }
      ghost.style.setProperty('--gx', `${ev.clientX - offX}px`);
      ghost.style.setProperty('--gy', `${ev.clientY - offY}px`);
      // swing like a card held at the top: moving right tips it, moving fast tips it more
      const vx = ev.clientX - lastX, vy = ev.clientY - lastY; lastX = ev.clientX; lastY = ev.clientY;
      ghost._swing.ry = Math.max(-38, Math.min(38, ghost._swing.ry * 0.6 + vx * 1.8));
      ghost._swing.rx = Math.max(-30, Math.min(30, ghost._swing.rx * 0.6 - vy * 1.4));
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const c = hit && hit.closest('#board .cell[data-cell]');
      const target = c && !state.board[Number(c.dataset.cell)] && TT.openCells(state).includes(Number(c.dataset.cell)) ? c : null;
      if (over !== target) { if (over) over.classList.remove('drop-over'); over = target; if (over) over.classList.add('drop-over'); }
    };
    const up = (ev) => {
      const wasDragging = !!ghost, target = over;
      cleanup();
      if (wasDragging) {
        if (target && ev.type === 'pointerup' && myTurn()) { selected = i; playMove(i, Number(target.dataset.cell)); return; }
        render();
        return;
      }
      selected = selected === i ? null : i;
      sfx(selected === null ? 'cancel' : 'pick');
      render();
    };
    cancelDrag = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('contextmenu', onContext, true);
  }

  // Right-click or Escape puts a selected (click-to-place) or dragged card back.
  function resetCard() {
    if (cancelDrag) { cancelDrag(); return true; }
    if (state && selected !== null) { selected = null; render(); sfx('cancel'); return true; }
    return false;
  }
  // The right button cancels a drag on pointerdown/move, before the browser's contextmenu event
  // arrives (on mouse-up on Windows), so remember that it was ours to swallow.
  document.addEventListener('pointerdown', (e) => {
    if (e.button === 2 && document.querySelector('#game.active') && (cancelDrag || selected !== null)) { swallowMenuUntil = Date.now() + 1500; resetCard(); }
  }, true);
  document.addEventListener('contextmenu', (e) => {
    if (!document.querySelector('#game.active')) return;
    if (Date.now() < swallowMenuUntil || resetCard()) { e.preventDefault(); swallowMenuUntil = 0; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('#game.active')) resetCard();
  });

  let resultShown = false;
  // Updates are applied one at a time: storm animations wait, and a later update must never be overwritten by an earlier one.
  let applyQueue = Promise.resolve();
  function applyResult(newState, events) {
    const run = applyQueue.then(() => applyResultNow(newState, events)).catch((e) => console.error(e));
    applyQueue = run;
    return run;
  }
  async function applyResultNow(newState, events) {
    const prevTurn = state ? state.turn : null;
    const strikeEv = events.find((e) => e.type === 'strike');
    const stormEv = events.find((e) => e.type === 'storm');
    if (stormEv) {
      $('#storm').classList.remove('show');
      if (stormEv.choice === 'ward') sfx('ward');
    }
    if (events.some((e) => e.type === 'storm-pick') && newState.storm && newState.storm.chooser !== me) sfx('click');
    if (strikeEv && state) await stormFx(strikeEv);
    shiftedFrom = {};
    for (const e of events) if (e.type === 'shift') shiftedFrom[e.to] = e.from;
    state = newState;
    selected = null;
    render();
    if (Object.keys(shiftedFrom).length || events.some((e) => e.type === 'shift')) animateShifts();
    for (const e of events) {
      const el = document.querySelector(`#board .cell[data-cell="${e.cell}"] .card`);
      if (e.type === 'spin' && el) el.classList.add('spun');
      if (e.type === 'scorch' && el) el.classList.add('scorch-anim');
      if (e.type === 'flip' && e.by === 'storm' && el && !el.classList.contains('flip')) el.classList.add('flip', 'flip-y');
    }
    if (events.some((e) => e.type === 'flip' && e.by === 'storm')) sfx('flip', { delay: 0.1 });
    if (events.some((e) => e.type === 'storm-warn')) {
      await sleep(events.some((e) => e.type === 'place') ? 650 : 0);
      sfx('storm-warn');
      await banner(`${STORM_ICON[newState.storm.kind]} ${TT.STORMS[newState.storm.kind].name}!`);
    }
    // sounds: placing, then each flip a beat apart; rule chimes play with their banners
    let flips = 0;
    for (const e of events) {
      if (e.type === 'place') sfx('place');
      else if (e.type === 'flip' && e.by === 'basic') sfx('flip', { delay: 0.18 + 0.09 * flips++ });
    }
    for (const e of events) {
      if (e.type === 'rule') {
        sfx(e.rule);
        await banner({ same: 'Same!', plus: 'Plus!', combo: 'Combo!' }[e.rule]);
        const ruleFlips = events.filter((x) => x.type === 'flip' && x.by === e.rule);
        ruleFlips.forEach((_, k) => sfx('flip', { delay: 0.08 * k }));
      }
    }
    if (!state.over && state.turn === me && prevTurn !== null && prevTurn !== me) sfx('turn', { delay: 0.35 });
    if (state.over && !resultShown) showResult();
  }

  // ---------- result screen ----------
  function showResult() {
    resultShown = true;
    const sc = TT.score(state);
    const w = state.winner;
    $('#result-title').textContent = w === 'draw' ? 'Draw' : w === me ? 'You win!' : 'You lose';
    $('#result-score').textContent = `${sc[me]} – ${sc[1 - me]}`;
    $('#result-note').textContent = '';
    $('#result-xp').hidden = true;
    $('#result-wager').hidden = true;
    $('#result-wager-cards').innerHTML = '';
    $('#btn-result-packs').hidden = true;
    $('#btn-rematch').disabled = false;
    setTimeout(() => { $('#result').classList.add('show'); sfx(w === 'draw' ? 'draw' : w === me ? 'win' : 'lose'); }, 500);
  }
  function showRewards(msg) {
    const r = msg.rewards;
    if (r) {
      $('#result-xp').hidden = false;
      // the bar shows where you were, then the XP you just earned grows on the end in green with "+N XP" riding its tip
      const after = 100 - r.nextPackIn, wrapped = r.newPacks > 0, before = wrapped ? 0 : Math.max(0, after - r.gained);
      const fill = $('#result-xp-fill'), gain = $('#result-xp-gain'), plus = $('#result-xp-plus');
      fill.style.transition = gain.style.transition = 'none';
      fill.style.width = before + '%'; gain.style.left = before + '%'; gain.style.width = '0%';
      plus.textContent = r.mult > 1 ? `+${r.gained} XP · ×${r.mult} big win` : `+${r.gained} XP`; $('#result-xp-num').textContent = `${after} / 100`; plus.style.left = before + '%'; plus.classList.remove('show');
      void gain.offsetWidth;
      fill.style.transition = gain.style.transition = '';
      setTimeout(() => { gain.style.width = (after - before) + '%'; plus.style.left = after + '%'; plus.style.translate = after < 12 ? '-12% 0' : after > 88 ? '-88% 0' : ''; plus.classList.add('show'); }, 750);
      $('#result-xp-text').textContent = wrapped
        ? (r.newPacks === 1 ? 'A pack unlocked!' : r.newPacks + ' packs unlocked!') + ` · ${r.nextPackIn} XP until the next pack reward`
        : `${r.nextPackIn} XP until the next pack reward`;
      sfx('xp', { delay: 0.6 });
      if (r.newPacks > 0) sfx('unlock', { delay: 1.1 });
      $('#btn-result-packs').hidden = !(r.packs > 0);
      $('#btn-result-packs').textContent = r.packs > 1 ? `Open packs (${r.packs})` : 'Open pack';
    } else if (!account) {
      $('#result-xp').hidden = false; $('#result-xp-fill').style.width = '0%'; $('#result-xp-gain').style.width = '0%'; $('#result-xp-plus').classList.remove('show'); $('#result-xp-num').textContent = '';
      $('#result-xp-text').textContent = 'Sign in to earn XP and card packs.';
    }
    const dl = $('#result-daily'); dl.innerHTML = ''; dl.hidden = !(msg.daily && msg.daily.length);
    (msg.daily || []).forEach((d, i) => { const li = document.createElement('li'); li.innerHTML = `<span>✔ ${d.text}</span><span class="shards">+${d.reward}</span>`; li.style.animationDelay = (1.75 + i * 0.2) + 's'; dl.appendChild(li); });
    // went up an account level this match: a "Level N!" stamp, pointing to the Rewards screen
    const oldLv = document.querySelector('#result .level-banner'); if (oldLv) oldLv.remove();
    if (r && r.levelUp) {
      const lb = document.createElement('div'); lb.className = 'quest-banner level-banner';
      lb.innerHTML = `Level ${r.level}! <small>Reward ready on the Rewards screen</small>`;
      lb.style.setProperty('--qd', '1.6s');
      $('#result-xp').after(lb);
      sfx('unlock', { delay: 1.7 });
    }
    if (r && typeof r.rewardsReady === 'number') setRewardsDot(r.rewardsReady);
    if (r && r.level) setLevel(r.level);
    // completed a challenge this match: a "Quest complete!" stamp drops in above the list
    const oldBanner = document.querySelector('#result .quest-banner:not(.level-banner)'); if (oldBanner) oldBanner.remove();
    dl.classList.remove('fresh');
    if (msg.daily && msg.daily.length) {
      const qb = document.createElement('div'); qb.className = 'quest-banner';
      qb.textContent = msg.daily.length > 1 ? `${msg.daily.length} Quests complete!` : 'Quest complete!';
      dl.before(qb); void dl.offsetWidth; dl.classList.add('fresh');
      sfx('unlock', { delay: 1.3 });
    }
    if (msg.daily && msg.daily.length) sfx('unlock', { delay: 1.6 });
    if (typeof msg.shards === 'number') setShards(msg.shards);
    if (msg.wager) {
      $('#result-wager').hidden = false;
      const wc = $('#result-wager-cards'); wc.innerHTML = '';
      const id = msg.wager.won || msg.wager.lost;
      const c = deckCard(roomDeck, id);
      wc.appendChild(cardEl(playCard(c, msg.wager.foil), msg.wager.won ? 'mine' : 'theirs', glyphsFor(roomDeck)));
      const fname = `${msg.wager.foil ? 'foil ' : ''}${c.name}`;
      $('#result-wager-text').textContent = msg.wager.won ? `Your new ${fname} joins your collection.` : `${names[1 - me]} took your ${fname}.`;
      sfx(msg.wager.won ? 'wager-win' : 'wager-lose', { delay: 0.3 });
      if (msg.wager.refill && msg.wager.refill.length) $('#result-wager-text').textContent += ' You got a spare level-1 card so you still have a full hand.';
    }
  }
  function showWagerPick(options) {
    $('#result').classList.add('show'); $('#btn-show-result').hidden = true;   // a choice is needed: bring the popup back
    $('#result-wager').hidden = false;
    $('#result-wager-text').textContent = 'You won the wager — pick one of their cards to keep:';
    const wc = $('#result-wager-cards'); wc.innerHTML = '';
    options.forEach((o, index) => {
      const el = cardEl(playCard(deckCard(roomDeck, o.id), o.foil), 'theirs', glyphsFor(roomDeck));
      el.classList.add('pickable');
      el.onclick = () => {
        send({ t: 'wager', index });
        wc.querySelectorAll('.card').forEach((x) => x.classList.remove('pickable'));
        el.classList.add('picked');
        $('#result-wager-text').textContent = 'Taking it…';
      };
      wc.appendChild(el);
    });
    $('#btn-rematch').disabled = true;
  }
  function showWagerWait(options) {
    $('#result-wager').hidden = false;
    $('#result-wager-text').textContent = `${names[1 - me]} is choosing one of your cards to take…`;
    const wc = $('#result-wager-cards'); wc.innerHTML = '';
    options.forEach((o) => wc.appendChild(cardEl(playCard(deckCard(roomDeck, o.id), o.foil), 'mine', glyphsFor(roomDeck))));
    $('#btn-rematch').disabled = true;
  }

  // ---------- moves ----------
  function playMove(hand, cell) {
    if (!myTurn()) return;
    busy = true; selected = null; render();
    send({ t: 'move', hand, cell });
  }

  // ---------- connection ----------
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function connect(onOpen) {
    wsWanted = true;
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { /* ignore */ } }
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    ws = new WebSocket(url);
    ws.onopen = () => onOpen && onOpen();
    ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      if (!wsWanted) return;
      toast('Connection lost — reconnecting…');
      setTimeout(() => {
        if (!wsWanted) return;
        connect(() => session && send({ t: 'resume', code: session.code, token: session.token }));
      }, 1500);
    };
  }
  function disconnect() {
    wsWanted = false;
    if (ws) { try { send({ t: 'leave' }); ws.close(); } catch (e) { /* ignore */ } }
    ws = null; session = null; mode = null; state = null;
    try { sessionStorage.removeItem('triad-session'); } catch (e) { /* ignore */ }
  }
  function startMatch(vs) {
    $('#menu-error').textContent = '';
    state = null; resultShown = false; mode = vs === 'ai' ? 'ai' : 'online';
    const rules = readRules();
    if (rules.handMode !== 'balanced' && !account) { $('#menu-error').textContent = 'Sign in to use collection hands.'; return; }
    connect(() => send({ t: 'create', vs, level: $('#difficulty').value, name: playerName(), rules, deck: $('#deck').value }));
  }

  function onMessage(msg) {
    switch (msg.t) {
      case 'room':
        session = { code: msg.code, token: msg.token };
        try { sessionStorage.setItem('triad-session', JSON.stringify(session)); } catch (e) { /* ignore */ }
        me = msg.you; roomDeck = msg.deck; mode = msg.vsAI ? 'ai' : 'online';
        if (!msg.vsAI && !msg.resumed && msg.you === 0) { $('#room-code').textContent = msg.code; show('lobby'); }
        break;
      case 'choose':
        roomDeck = msg.deck; names = msg.names || names;
        openBuilder(msg);
        break;
      case 'hand_ok':
        builder.locked = true; renderBuilder();
        $('#build-status').textContent = mode === 'ai' ? 'Starting…' : 'Ready! Waiting for your opponent…';
        break;
      case 'opponent_ready':
        if (document.querySelector('#builder.active') && !builder.locked) $('#build-status').textContent = `${names[1 - me] || 'Your opponent'} is ready.`;
        break;
      case 'state': {
        const fresh = !state || msg.events.some((e) => e.type === 'start');
        me = msg.you; names = msg.names;
        if (fresh) { prevBoard = Array(9).fill(null); resultShown = false; $('#result').classList.remove('show'); const sb = $('#btn-show-result'); sb.hidden = true; sb.disabled = false; sb.textContent = 'Rematch'; }
        if (!document.querySelector('#game.active')) show('game');
        busy = false;
        applyResult(msg.state, msg.events).then(() => {
          if (fresh && msg.events.some((e) => e.type === 'start')) banner(state.turn === me ? 'You start' : `${names[1 - me]} starts`);
        });
        break;
      }
      case 'wager_pick': waitForResult().then(() => showWagerPick(msg.options)); break;
      case 'wager_wait': waitForResult().then(() => showWagerWait(msg.options)); break;
      case 'result':
        waitForResult().then(() => { showRewards(msg); $('#btn-rematch').disabled = false; refreshProgress(); });
        break;
      case 'presence':
        names = msg.names;
        if (state && msg.connected && !msg.connected[1 - me]) toast(`${names[1 - me] || 'Opponent'} disconnected — waiting…`);
        render();
        break;
      case 'rematch_requested':
        $('#result-note').textContent = `${names[1 - me]} wants a rematch.`;
        break;
      case 'opponent_left':
        if (msg.conceded) toast(`Your opponent conceded. You win!${msg.rewards ? ` +${msg.rewards.gained} XP` : ''}`);
        else toast('Your opponent left the room.');
        if (msg.rewards) refreshProgress();
        disconnect(); show('menu');
        break;
      case 'error':
        sfx('error');
        busy = false; render();
        if (msg.fatal) { disconnect(); show('menu'); }
        if (document.querySelector('#menu.active')) $('#menu-error').textContent = msg.msg; else toast(msg.msg);
        if (document.querySelector('#builder.active')) { builder.locked = false; renderBuilder(); }
        break;
    }
  }
  // the result overlay appears shortly after the last move; reward messages wait for it
  function waitForResult() {
    return new Promise((res) => {
      const t0 = Date.now();
      const tick = () => (resultShown && $('#result').classList.contains('show')) || Date.now() - t0 > 4000 ? res() : setTimeout(tick, 100);
      tick();
    });
  }

  // ---------- hand builder ----------
  const builder = { mode: 'build', budget: 15, cards: {}, picked: [], locked: false };
  function openBuilder(msg) {
    const totals = { ...msg.cards };
    for (const [id, n] of Object.entries(msg.foils || {})) totals[id] = (totals[id] || 0) + n;
    Object.assign(builder, { mode: msg.mode, budget: msg.budget, cards: totals, foils: msg.foils || {}, picked: [], locked: !!msg.done });
    $('#build-status').textContent = msg.done ? 'Ready! Waiting for your opponent…' : '';
    $('#result').classList.remove('show');
    state = null; resultShown = false;
    show('builder');
    renderBuilder();
  }
  const levelOf = (id) => deckCard(roomDeck, id).level;
  const pickedLevel = () => builder.picked.reduce((n, id) => n + levelOf(id), 0);
  function canAdd(id) {
    if (builder.locked || builder.picked.length >= 5) return false;
    const used = builder.picked.filter((x) => x === id).length;
    if (used >= (builder.cards[id] || 0)) return false;
    if (builder.mode === 'budget' && pickedLevel() + levelOf(id) > builder.budget) return false;
    return true;
  }
  function renderBuilder() {
    const g = glyphsFor(roomDeck);
    const tray = $('#build-tray'); tray.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const slot = document.createElement('div'); slot.className = 'tray-slot';
      const id = builder.picked[i];
      if (id !== undefined) {
        const nth = builder.picked.slice(0, i + 1).filter((x) => x === id).length;   // foil copies are used first
        const el = cardEl(playCard(deckCard(roomDeck, id), nth <= (builder.foils[id] || 0)), 'mine', g);
        if (!builder.locked) { el.classList.add('pickable'); el.onclick = () => { builder.picked.splice(i, 1); sfx('cancel'); renderBuilder(); }; el.title = 'Remove from hand'; }
        slot.appendChild(el);
      }
      tray.appendChild(slot);
    }
    const lv = pickedLevel();
    $('#build-budget').textContent = builder.mode === 'budget' ? `Level ${lv} / ${builder.budget}` : `Level ${lv}`;
    $('#build-budget').classList.toggle('over', builder.mode === 'budget' && lv > builder.budget);
    $('#btn-build-ready').disabled = builder.locked || builder.picked.length !== 5;
    $('#btn-build-auto').disabled = builder.locked;
    const grid = $('#build-grid'); grid.innerHTML = '';
    const owned = decks.get(roomDeck).cards.filter((c) => builder.cards[c.id]).sort((a, b) => b.level - a.level || a.id - b.id);
    for (const c of owned) {
      const wrap = document.createElement('div'); wrap.className = 'grid-card'; wrap.dataset.card = c.id;
      const el = cardEl(playCard(c, (builder.foils[c.id] || 0) > 0), 'mine', g);
      const left = builder.cards[c.id] - builder.picked.filter((x) => x === c.id).length;
      if (canAdd(c.id)) { el.classList.add('pickable'); el.onclick = () => { builder.picked.push(c.id); sfx('place'); renderBuilder(); }; }
      else wrap.classList.add('unavailable');
      wrap.appendChild(el);
      const badge = document.createElement('span'); badge.className = 'count'; badge.textContent = `×${left}`; wrap.appendChild(badge);
      grid.appendChild(wrap);
    }
  }
  function autoPick() {
    builder.picked = [];
    const copies = [];
    for (const [id, n] of Object.entries(builder.cards)) for (let i = 0; i < n; i++) copies.push(Number(id));
    copies.sort((a, b) => levelOf(b) - levelOf(a));
    for (const id of copies) if (canAdd(id)) builder.picked.push(id);
    // budget mode: if greedy left gaps, fill from the cheapest cards
    if (builder.picked.length < 5) { copies.reverse(); for (const id of copies) if (builder.picked.length < 5 && canAdd(id)) builder.picked.push(id); }
    renderBuilder();
  }

  // ---------- accounts ----------
  async function loadAccount() {
    try { const r = await api('GET', '/api/me'); account = r.guest ? null : r; } catch (e) { account = null; }
    renderAccount();
  }
  function renderAccount() {
    $('#user-note').hidden = !account;
    $('#name-field').hidden = !!account;
    $('#guest-note').hidden = !!account;
    document.querySelectorAll('.nav-shards, .mobile-head .shard-balance').forEach((el) => { el.hidden = !account; });
    if (account) { $('#acct-name').textContent = account.name; setShards(account.shards || 0); }
    syncRuleOptions();
    refreshProgress();
    refreshDailies();
    setRewardsDot(account ? account.rewardsReady || 0 : 0);
    setLevel(account ? account.level : 0);
  }
  function setShards(n) {
    if (account) account.shards = n;
    document.querySelectorAll('.shard-balance').forEach((el) => { el.textContent = n.toLocaleString(); });
  }
  // ---------- rewards: account levels ----------
  // account level badge in the top bar (opens Rewards); pops when it goes up
  function setLevel(n) {
    const b = $('#btn-level'); b.hidden = !n; if (!n) return;
    const el = $('#level-num'), old = Number(el.textContent);
    el.textContent = n; if (account) account.level = n;
    if (old && n > old) { b.classList.remove('level-up'); void b.offsetWidth; b.classList.add('level-up'); }
  }
  function setRewardsDot(n) {
    const dot = document.querySelector('.nav-item[data-view="rewards"] .nav-dot');
    if (dot) { dot.hidden = !n; dot.textContent = n; }
  }
  let rwData = null;
  async function refreshRewards(scroll) {
    $('#rewards-guest').hidden = !!account; $('#rewards-user').hidden = !account;
    if (!account) return;
    try { rwData = await api('GET', '/api/levels'); } catch (e) { return; }
    renderRewards(scroll ? 'auto' : null);
  }
  function rwTile(t, fresh) {
    const tile = document.createElement('div');
    const big = t.state !== 'claimed' ? '' : t.level % 50 === 0 ? 'm50' : t.level % 20 === 0 ? 'm20' : t.level % 10 === 0 ? 'm10' : t.level % 5 === 0 ? 'm5' : '';   // milestones only show once claimed
    tile.className = `rw-tile st-${t.state} kind-${t.kind} ${big}${fresh ? ' fresh' : ''}`;
    tile.dataset.level = t.level;
    const art = document.createElement('div'); art.className = 'rw-art';
    if (t.state !== 'claimed') {
      art.innerHTML = '<span class="rw-mystery">?</span>';   // what's inside stays a surprise until it's claimed
    } else {
      (t.cards || []).forEach((c, k) => {
        if (!decks.get(t.deck)) return;
        const el = cardEl(playCard(deckCard(t.deck, c.id), c.foil), 'neutral', glyphsFor(t.deck));
        el.classList.add('rw-card'); if (fresh) el.style.animationDelay = (k * 0.18) + 's';
        el.onclick = () => zoomCard(playCard(deckCard(t.deck, c.id), c.foil), glyphsFor(t.deck), t.deck, c.id);
        art.appendChild(el);
      });
      if (t.packs) {
        const pk = document.createElement('div'); pk.className = 'rw-pack';
        pk.innerHTML = `<img src="packs/${encodeURIComponent(t.deck || $('#deck').value)}.svg?v=${ASSET_V}" alt="Card pack">${t.packs > 1 ? `<b>×${t.packs}</b>` : ''}`;
        pk.title = 'A card pack: open it from the packs button at the top';
        art.appendChild(pk);
      }
      if (t.shards) art.insertAdjacentHTML('beforeend', `<span class="rw-shards"><span class="rw-gem">◆</span><b class="rw-amt">${t.shards}</b></span>`);
    }
    tile.appendChild(art);
    const lv = document.createElement('div'); lv.className = 'rw-lv'; lv.textContent = t.state === 'ready' ? `Level ${t.level} · Claim!` : `Level ${t.level}`;
    tile.appendChild(lv);
    if (t.state === 'claimed') { const ck = document.createElement('i'); ck.className = 'rw-check'; ck.textContent = '✓'; tile.appendChild(ck); }
    if (t.state === 'ready') { tile.tabIndex = 0; tile.setAttribute('role', 'button'); tile.onclick = () => openRewardPick(); }
    return tile;
  }
  function renderRewards(scrollMode, freshLevels) {
    const d = rwData; if (!d) return;
    setLevel(d.level);
    setRewardsDot(d.ready); if (account) account.rewardsReady = d.ready;
    const track = $('#rw-track'); const keep = track.scrollLeft; track.innerHTML = '';
    for (const t of d.track) track.appendChild(rwTile(t, freshLevels && freshLevels.has(t.level)));
    if (scrollMode) {
      const target = track.querySelector('.st-ready') || track.querySelector(`[data-level="${d.level + 1}"]`) || track.lastElementChild;
      requestAnimationFrame(() => { track.scrollLeft = Math.max(0, target.offsetLeft - track.clientWidth / 2 + target.offsetWidth / 2); });
    } else track.scrollLeft = keep;
  }
  // claiming: rewards are claimed one level at a time, and each one asks which set it should come from
  function openRewardPick() {
    const d = rwData; if (!d || !d.ready) return;
    if (!d.nextNeedsSet) { claimReward(null); return; }   // shards and packs don't belong to a set: claim straight away
    const next = d.track.find((t) => t.state === 'ready');
    $('#reward-pick-title').textContent = `Level ${next.level} reward`;
    const grid = $('#reward-pick-grid'); grid.innerHTML = '';
    for (const [id, dk] of decks) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pick-pack';
      b.innerHTML = `<img src="packs/${encodeURIComponent(id)}.svg?v=${ASSET_V}" alt=""><span>${SET_ICON[id] || ''} ${dk.name}</span>`;
      b.onclick = () => { $('#reward-pick').classList.remove('show'); claimReward(id); };
      grid.appendChild(b);
    }
    $('#reward-pick').classList.add('show');
  }
  let claiming = false;
  async function claimReward(deckId) {
    if (claiming) return; claiming = true;
    try {
      const r = await api('POST', '/api/levels/claim', deckId ? { deck: deckId } : {});
      setShards(r.shards); rwData = r.view;
      const c = r.claimed;
      renderRewards(null, new Set([c.level]));
      const tile = $('#rw-track').querySelector('.fresh');
      if (tile) tile.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      if (c.cards.length) showRewardCards(deckId, c);   // cards: the pack screen, face down, tap each to reveal
      else if (c.packs) { sfx('craft'); refreshProgress(); openPackPicker(); }   // a pack: straight into the usual pick-a-set-and-open flow
      else { sfx('craft'); toast(`Level ${c.level}: +${c.shards} shards`); }
    } catch (e) { toast(e.message); sfx('error'); }
    claiming = false;
  }
  // card rewards open on the pack screen: the cards fly in face down and you tap each one to reveal it
  function showRewardCards(deckId, c) {
    applyTheme(deckId);
    $('#pack-title').textContent = `Level ${c.level} reward`;
    const w = 120, h = 168, origin = { left: innerWidth / 2 - w / 2, top: innerHeight / 2 - h / 2, width: w, height: h };
    $('#btn-pack-again').hidden = true;
    $('#btn-pack-done').textContent = 'Later';
    $('#pack').classList.add('show');
    revealPackCards(deckId, { cards: c.cards, summary: { packs: 0 } }, origin);
    $('#pack-hint').textContent = c.cards.length > 1 ? 'Click each card to reveal it' : 'Click the card to reveal it';
  }
  $('#btn-level').onclick = () => setView('rewards');
  $('#reward-pick-close').onclick = () => $('#reward-pick').classList.remove('show');
  $('#reward-pick').addEventListener('click', (e) => { if (e.target.id === 'reward-pick') $('#reward-pick').classList.remove('show'); });
  for (const [sel, dir] of [['.rw-prev', -1], ['.rw-next', 1]]) {
    document.querySelector(sel).onclick = () => { const t = $('#rw-track'); t.scrollBy({ left: dir * t.clientWidth * 0.8, behavior: 'smooth' }); };
  }

  async function refreshDailies() {
    const box = $('#dailies');
    $('#dailies-guest').hidden = !!account;
    if (!account) { box.hidden = true; document.querySelector('.nav-item[data-view="challenges"] .nav-dot').hidden = true; return; }
    try {
      const d = await api('GET', '/api/daily');
      setShards(d.shards);
      box.hidden = false;
      const h = Math.floor(d.resetsIn / 3600e3), m = Math.floor((d.resetsIn % 3600e3) / 60e3);
      $('#daily-reset').textContent = `New challenges in ${h}h ${m}m`;
      const left = d.challenges.filter((c) => !c.done).length;
      const dot = document.querySelector('.nav-item[data-view="challenges"] .nav-dot');
      dot.hidden = !left; dot.textContent = left;
      const list = $('#daily-list'); list.innerHTML = '';
      for (const c of d.challenges) {
        const li = document.createElement('li'); li.className = c.done ? 'done' : '';
        li.innerHTML = `<div class="dl-top"><span>${c.done ? '✔ ' : ''}${c.text}</span><span class="shards">${c.reward}</span></div>
          <div class="xpbar"><span style="width:${(100 * c.progress) / c.goal}%"></span></div><div class="dl-prog">${c.progress} / ${c.goal}</div>`;
        list.appendChild(li);
      }
    } catch (e) { box.hidden = true; }
  }
  function syncRuleOptions() {
    const sel = $('#r-hands');
    [...sel.options].forEach((o) => { if (o.value !== 'balanced') o.disabled = !account; });
    if (!account && sel.value !== 'balanced') sel.value = 'balanced';
    const collectionHands = sel.value !== 'balanced';
    $('#r-wager').disabled = !collectionHands;
    if (!collectionHands) $('#r-wager').checked = false;
    $('#r-wager').closest('label').classList.toggle('disabled', !collectionHands);
    $('#rules-note').textContent = !account ? 'Sign in to play with your collection and earn packs.' : (!collectionHands ? 'Balanced hands don’t use your collection, but you still earn XP.' : '');
    try { localStorage.setItem('triad-rules-2', JSON.stringify(readRules())); } catch (e) { /* ignore */ }
    const r = readRules();
    const bits = ['open', 'same', 'plus', 'elemental', 'wager'].filter((k) => r[k]).map((k) => RULE_NAMES[k]);
    const hands = { balanced: 'Balanced hands', random: 'Random hands', build: 'Built hands', budget: 'Budget hands' }[r.handMode];
    $('#rules-summary').textContent = [...bits, hands].join(' · ');
  }
  function openAuth() {
    $('#auth-error').textContent = '';
    $('#auth').classList.add('show');
    setTimeout(() => $('#auth-name').focus(), 50);
  }
  async function doAuth(kind) {
    const name = $('#auth-name').value.trim(), password = $('#auth-pass').value;
    $('#auth-error').textContent = '';
    try {
      account = await api('POST', `/api/${kind}`, { name, password });
      $('#auth').classList.remove('show');
      setView('play');
      $('#auth-pass').value = '';
      renderAccount();
      toast(kind === 'register' ? `Welcome, ${account.name}! Your starter cards are waiting in each set.` : `Welcome back, ${account.name}.`);
    } catch (e) { $('#auth-error').textContent = e.message; }
  }

  // ---------- progress, collection & packs ----------
  // three card packs fanned out (the packs button)
  const PACKS_ICON = '<svg class="packs-ico" viewBox="0 0 24 24" aria-hidden="true">'
    + ['rotate(-28 12 23)', 'rotate(28 12 23)', ''].map((t) => `<g transform="${t}"><path d="M9 5h6v14H9z" class="pk-body"/><path d="M9 6.8h6M9 17.2h6" class="pk-line"/><path d="M9 5l.75-.9.75.9.75-.9.75.9.75-.9.75.9.75-.9.75.9" class="pk-line"/></g>`).join('')
    + '</svg>';
  async function refreshProgress() {
    const box = $('#set-progress');
    if (!account || !decks.size) { box.hidden = true; $('#btn-packs').hidden = true; return; }
    try {
      const s = await api('GET', `/api/collection?deck=${encodeURIComponent($('#deck').value)}`);
      box.hidden = false;
      $('#menu-xp-fill').style.width = `${((s.xpPerPack - s.nextPackIn) / s.xpPerPack) * 100}%`;
      const xpText = `${s.nextPackIn} XP until the next pack reward`;
      $('#menu-xp-text').textContent = xpText; box.title = xpText;
      const b = $('#btn-packs');
      b.hidden = !(s.packs > 0);
      b.innerHTML = `${PACKS_ICON} ${s.packs}`;
      b.title = s.packs > 1 ? `You have ${s.packs} packs to open` : 'You have a pack to open';
      packsLeft = s.packs;
    } catch (e) { box.hidden = true; $('#btn-packs').hidden = true; }
  }
  let colSummary = null;
  async function openCollection(deckId) {
    if (deckId) chooseSet(deckId);
    show('collection');
    await renderCollection();
  }
  async function renderCollection() {
    const deckId = $('#col-deck').value, deck = decks.get(deckId);
    try { colSummary = await api('GET', `/api/collection?deck=${encodeURIComponent(deckId)}`); }
    catch (e) { toast(e.message); return; }
    const s = colSummary;
    setShards(s.shards);
    $('#col-xp-fill').style.width = `${((s.xpPerPack - s.nextPackIn) / s.xpPerPack) * 100}%`;
    // the bar is XP toward the next pack
    $('#col-xp-text').textContent = `${s.nextPackIn} XP until the next pack reward`;
    $('#col-xp-num').textContent = `${s.xpPerPack - s.nextPackIn} / ${s.xpPerPack}`;
    const ob = $('#btn-open-pack');
    ob.hidden = s.packs < 1;
    ob.textContent = `Open pack (${s.packs})`;
    // extras: everything beyond one normal and one foil copy of each card
    let extraValue = 0, extraCount = 0;
    for (const foil of [false, true]) for (const [id, n] of Object.entries(foil ? s.foils : s.cards)) if (n > 1) {
      extraCount += n - 1; extraValue += (n - 1) * s.scrap[deckCard(deckId, id).level] * (foil ? s.foilMult : 1);
    }
    const xb = $('#btn-scrap-extras');
    xb.hidden = !extraCount;
    xb.innerHTML = `Scrap ${extraCount} extra${extraCount > 1 ? 's' : ''} <span class="shards">+${extraValue}</span>`;
    const grid = $('#col-grid'); grid.innerHTML = '';
    for (const c of deck.cards) {
      const wrap = document.createElement('div'); wrap.className = 'grid-card'; wrap.dataset.card = c.id;
      const n = s.cards[c.id] || 0, nf = s.foils[c.id] || 0;
      wrap.appendChild(cardEl(playCard(c, nf > 0 && !n ? true : nf > 0), 'neutral', deck.elements));
      if (n + nf === 0) {
        wrap.classList.add('unowned');
        const t = document.createElement('span'); t.className = 'craft-tag'; t.innerHTML = `Craft <span class="shards">${s.craft[c.level]}</span>`; wrap.appendChild(t);
      } else {
        if (n) { const b = document.createElement('span'); b.className = 'count'; b.textContent = `×${n}`; b.title = `${n} normal`; wrap.appendChild(b); }
        if (nf) { const b = document.createElement('span'); b.className = 'count foil-count'; b.textContent = `✦${nf}`; b.title = `${nf} foil`; wrap.appendChild(b); }
      }
      wrap.onclick = () => openCardDetail(deckId, c.id);
      grid.appendChild(wrap);
    }
  }

  // ---------- card detail: craft and scrap ----------
  let detail = null;
  function openCardDetail(deckId, id, foil) {
    const s = colSummary;
    const nf = s.foils[id] || 0, n = s.cards[id] || 0;
    detail = { deckId, id, foil: typeof foil === 'boolean' ? foil : (nf > 0 && !n) };   // always exactly one of Normal/Foil selected
    renderCardDetail();
    $('#card-detail').classList.add('show');
  }
  function renderCardDetail() {
    const { deckId, id, foil } = detail, s = colSummary, deck = decks.get(deckId), c = deckCard(deckId, id);
    const big = $('#cd-card'); big.innerHTML = '';
    big.appendChild(cardEl(playCard(c, foil), 'neutral', deck.elements));
    $('#cd-name').textContent = c.name;
    $('#cd-meta').textContent = `${RARITY[c.level]} · ${cap(c.element)}`;   // the numbers are on the card itself (and in its hover text)
    $('#cd-meta').title = `Top / Right / Bottom / Left: ${c.ranks.map(RANK).join(' / ')}`;
    const have = (foil ? s.foils : s.cards)[id] || 0;
    $('#cd-owned').textContent = `You have ${s.cards[id] || 0} normal and ${s.foils[id] || 0} foil`;
    $('#cd-normal').classList.toggle('on', !foil); $('#cd-foil').classList.toggle('on', foil);
    const cost = s.craft[c.level] * (foil ? s.foilMult : 1), value = s.scrap[c.level] * (foil ? s.foilMult : 1);
    const craft = $('#cd-craft'), scrap = $('#cd-scrap');
    // same labels for both versions (the Normal / Foil switch says which), so the popup never changes size
    craft.innerHTML = `Craft <span class="shards">${cost}</span>`;
    craft.title = `Craft a ${foil ? 'foil' : 'normal'} copy`;
    craft.disabled = s.shards < cost;
    scrap.innerHTML = `Scrap <span class="shards">+${value}</span>`;
    scrap.title = `Scrap a ${foil ? 'foil' : 'normal'} copy`;
    scrap.disabled = have < 1 || s.copies - 1 < s.minCards;
    $('#cd-note').textContent = s.shards < cost ? `You have ${s.shards} shards — ${cost - s.shards} more to craft this.` :
      (have >= 1 && s.copies - 1 < s.minCards ? `You need at least ${s.minCards} cards in a set, so you can\u2019t scrap this one.` : '');
  }
  // A freshly crafted card: a first copy flips in with a burst of light; an extra copy flashes and its count pops.
  function craftReveal(id, foil) {
    const tile = document.querySelector(`#col-grid .grid-card[data-card="${id}"]`);
    if (!tile) return;
    tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const s = colSummary, copies = (foil ? s.foils : s.cards)[id] || 0;
    tile.classList.remove('craft-new', 'craft-dupe'); void tile.offsetWidth;
    tile.classList.add(copies <= 1 ? 'craft-new' : 'craft-dupe');
    if (foil) tile.classList.add('craft-foil');
    const burst = document.createElement('div'); burst.className = 'craft-burst' + (foil ? ' foil' : ''); tile.appendChild(burst);
    setTimeout(() => { burst.remove(); tile.classList.remove('craft-new', 'craft-dupe', 'craft-foil'); }, 2400);
  }
  function scrapReveal(id, gained) {
    const tile = document.querySelector(`#col-grid .grid-card[data-card="${id}"]`);
    if (!tile) return;
    tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const s = colSummary, left = (s.cards[id] || 0) + (s.foils[id] || 0);
    tile.classList.remove('scrap-anim', 'scrap-gone'); void tile.offsetWidth;
    tile.classList.add('scrap-anim'); if (!left) tile.classList.add('scrap-gone');
    const fx = [];
    const fl = document.createElement('div'); fl.className = 'scrap-flash'; fx.push(fl);
    const mn = document.createElement('div'); mn.className = 'scrap-minus'; mn.textContent = '−1'; fx.push(mn);
    for (let k = 0; k < 9; k++) {
      const sh = document.createElement('i'); sh.className = 'scrap-shard'; sh.textContent = '◆';
      const a = (k / 9) * Math.PI * 2 + Math.random() * .4, d = 60 + Math.random() * 50;
      sh.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px'); sh.style.setProperty('--dy', (Math.sin(a) * d).toFixed(0) + 'px');
      sh.style.animationDelay = (.15 + Math.random() * .15).toFixed(2) + 's'; fx.push(sh);
    }
    tile.append(...fx);
    toast(`Scrapped for ${gained} shards.`);
    setTimeout(() => { fx.forEach((e) => e.remove()); tile.classList.remove('scrap-anim', 'scrap-gone'); }, 1500);
  }
  async function detailAction(kind) {
    const { deckId, id, foil } = detail;
    try {
      const r = await api('POST', kind === 'craft' ? '/api/craft' : '/api/scrap', { deck: deckId, card: id, foil });
      colSummary = r.summary; setShards(r.shards);
      if (kind === 'craft') {
        const lvl = deckCard(deckId, id).level;
        sfx(lvl >= 3 || foil ? 'craft-big' : 'craft');
        if (foil) sfx('reveal-foil', { delay: 0.85 });
      } else sfx('cancel');
      if (kind === 'craft') {
        // close the popup and show the new card arriving in the collection
        $('#card-detail').classList.remove('show');
        await renderCollection();
        craftReveal(id, foil);
        return;
      }
      // close the popup and show the card being scrapped in the collection (or its count dropping)
      $('#card-detail').classList.remove('show');
      await renderCollection();
      scrapReveal(id, r.gained);
    } catch (e) { toast(e.message); sfx('error'); }
  }

  // the release this page was served for (stamped on the script URL), used to fetch matching pack art
  const ASSET_V = (() => { try { return new URL(document.querySelector('script[src*="client.js"]').src).searchParams.get('v') || Date.now(); } catch (e) { return Date.now(); } })();
  let packDeck = null, packsLeft = 0;
  // Packs are earned with XP from any game and can be opened from any set: pick which set's pack to open.
  async function openPackPicker() {
    try { const s = await api('GET', `/api/collection?deck=${encodeURIComponent($('#deck').value)}`); packsLeft = s.packs; } catch (e) { /* keep last count */ }
    $('#pick-count').textContent = packsLeft > 0 ? `You have ${packsLeft} pack${packsLeft > 1 ? 's' : ''} to open` : 'No packs to open — play games to earn XP';
    const grid = $('#pick-grid'); grid.innerHTML = '';
    for (const [id, d] of decks) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'pick-pack'; b.disabled = packsLeft < 1;
      b.innerHTML = `<img src="packs/${encodeURIComponent(id)}.svg?v=${ASSET_V}" alt=""><span>${SET_ICON[id] || ''} ${d.name}</span>`;
      b.onclick = () => { $('#pack-pick').classList.remove('show'); chooseSet(id); setTimeout(() => openPack(id), 0); };
      grid.appendChild(b);
    }
    $('#pack-pick').classList.add('show');
  }
  // Step 1: show the sealed pack. Nothing is spent until it's torn open.
  function openPack(deckId) {
    packDeck = deckId;
    const deck = decks.get(deckId);
    applyTheme(deckId);
    const box = $('#pack-cards'); box.innerHTML = '';
    $('#pack-title').textContent = `${deck.name} pack`;
    box.classList.add('sealed-stage');
    // a real 3D pack: front and back faces with thickness between them, foil side walls,
    // pillow shading and crinkles; it floats in a wrapper and tilts toward the pointer
    const float = document.createElement('div'); float.className = 'sealed-float';
    const sealed = document.createElement('div');
    sealed.className = 'sealed lit';
    sealed.dataset.tilt = '26';
    const src = `packs/${encodeURIComponent(deckId)}.svg?v=${ASSET_V}`, backSrc = `packs/${encodeURIComponent(deckId)}-back.svg?v=${ASSET_V}`;
    // lighting is cut to the pack's outline with small bitmap masks (cheap to redraw every frame)
    sealed.style.setProperty('--pack-art', `url("packs/${encodeURIComponent(deckId)}-mask.png?v=${ASSET_V}")`);
    sealed.style.setProperty('--pack-back', `url("packs/${encodeURIComponent(deckId)}-back-mask.png?v=${ASSET_V}")`);
    const front = document.createElement('div'); front.className = 'pack-face pack-front';
    for (const part of ['pack-body', 'pack-top']) {
      const d = document.createElement('div'); d.className = part;
      const img = document.createElement('img'); img.src = src; img.alt = part === 'pack-body' ? `${deck.name} card pack` : '';
      img.draggable = false;
      d.appendChild(img); front.appendChild(d);
    }
    for (const layer of ['pack-bulge', 'pack-crinkle', 'foil-layer', 'glare-spot', 'pack-seam']) {
      const d = document.createElement('div'); d.className = layer; front.appendChild(d);
    }
    const back = document.createElement('div'); back.className = 'pack-face pack-back';
    const bimg = document.createElement('img'); bimg.src = backSrc; bimg.alt = ''; bimg.draggable = false; back.appendChild(bimg);
    const bb = document.createElement('div'); bb.className = 'pack-bulge'; back.appendChild(bb);
    const left = document.createElement('div'); left.className = 'pack-edge pack-edge-l';
    const right = document.createElement('div'); right.className = 'pack-edge pack-edge-r';
    sealed.append(back, left, right, front);
    float.appendChild(sealed);
    const burst = document.createElement('div'); burst.className = 'pack-burst'; box.appendChild(burst);
    box.appendChild(float);
    let opening = false;
    sealed.onclick = async () => {
      if (opening) return;
      opening = true;
      // 1. charge up: the pack shakes harder and light leaks from the seal
      sealed.classList.add('charging');
      sfx('pack-charge');
      $('#pack-hint').textContent = '';
      let r;
      try { [r] = await Promise.all([api('POST', '/api/packs/open', { deck: deckId }), sleep(reduceMotion ? 0 : 900)]); }
      catch (e) { sealed.classList.remove('charging'); opening = false; toast(e.message); sfx('error'); $('#pack-hint').textContent = 'Click the pack to tear it open'; return; }
      // 2. burst: the top tears off in a flash, light rays and sparks fly, the pack drops away
      sfx('pack-open');
      sealed.classList.remove('charging');
      sealed.classList.add('tearing');
      burst.classList.add('go');
      packFx(box, float);
      await sleep(reduceMotion ? 200 : 900);
      const origin = float.getBoundingClientRect();
      float.remove(); burst.remove();
      // 3. the cards fly out of the pack to their places
      revealPackCards(deckId, r, origin);
    };
    $('#pack-hint').textContent = 'Click the pack to tear it open';
    $('#btn-pack-again').hidden = true;
    $('#btn-pack-done').textContent = 'Later';
    $('#pack').classList.add('show');
  }

  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // flash, light rays and sparks when a pack bursts open
  function packFx(box, float) {
    const fr = float.getBoundingClientRect(), br = box.getBoundingClientRect();
    const fx = document.createElement('div'); fx.className = 'pack-fx';
    fx.style.left = (fr.left - br.left + fr.width / 2) + 'px'; fx.style.top = (fr.top - br.top + fr.height * 0.35) + 'px';
    fx.innerHTML = '<div class="pack-rays"></div><div class="pack-flash"></div>';
    for (let k = 0; k < 22; k++) {
      const sp = document.createElement('i'); sp.className = 'spark';
      const a = (k / 22) * Math.PI * 2 + Math.random() * 0.3, d = 110 + Math.random() * 170;
      sp.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px'); sp.style.setProperty('--dy', (Math.sin(a) * d - 40).toFixed(0) + 'px');
      sp.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
      fx.appendChild(sp);
    }
    box.appendChild(fx);
    setTimeout(() => fx.remove(), 1800);
  }

  // Step 2: the six cards fly out face down, in random order; click each to reveal it.
  function revealPackCards(deckId, r, origin) {
    const box = $('#pack-cards'); box.innerHTML = '';
    box.classList.remove('sealed-stage');
    const deck = decks.get(deckId);
    let revealed = 0;
    r.cards.forEach((pc, i) => {
      const c = deck.cards.find((x) => x.id === pc.id);
      const holder = document.createElement('div'); holder.className = 'pack-card';
      holder.style.animationDelay = `${i * 110}ms`;
      const inner = document.createElement('div'); inner.className = 'pack-inner';
      const back = cardEl(null, 'mine'); back.classList.add('face-back');
      const front = cardEl(playCard(c, pc.foil), 'neutral', deck.elements); front.classList.add('face-front');
      inner.append(back, front);
      holder.appendChild(inner);
      if (pc.isNew) { const nb = document.createElement('span'); nb.className = 'new-badge'; nb.textContent = 'NEW'; holder.appendChild(nb); }
      else { const db = document.createElement('span'); db.className = 'new-badge dupe-badge'; db.textContent = 'DUPLICATE'; holder.appendChild(db); }
      if (pc.foil) { const fb = document.createElement('span'); fb.className = 'foil-badge'; fb.textContent = 'FOIL'; holder.appendChild(fb); }
      const sb = document.createElement('button'); sb.type = 'button'; sb.className = 'small scrap-btn';
      sb.innerHTML = `Scrap <span class="shards">+${pc.scrap}</span>`;
      sb.onclick = async (e) => {
        e.stopPropagation();
        try {
          const res = await api('POST', '/api/scrap', { deck: deckId, card: c.id, foil: pc.foil });
          setShards(res.shards); sfx('cancel');
          holder.classList.add('scrapped'); sb.disabled = true; sb.classList.add('scrap-done'); sb.innerHTML = `Scrapped <span class="shards">+${res.gained}</span>`;
        } catch (err) { toast(err.message); sfx('error'); }
      };
      holder.appendChild(sb);
      holder.onclick = () => {
        if (holder.classList.contains('revealed')) { zoomCard(playCard(c, pc.foil), deck.elements, deckId, c.id); return; }
        holder.classList.add('revealed', `rarity-${c.level}`);
        // light bursts from behind the card as it turns: bigger and brighter for rarer cards, rainbow for foils
        const rb = document.createElement('div'); rb.className = `reveal-burst rb-${c.level}${pc.foil ? ' rb-foil' : ''}`;
        holder.prepend(rb);
        setTimeout(() => rb.remove(), 2200);
        sfx(`reveal-${Math.min(5, Math.max(1, c.level))}`);
        if (pc.foil) sfx('reveal-foil', { delay: c.level >= 3 ? 0.5 : 0.12 });
        if (c.level >= 5) {   // the announcer, timed to the reveal's impact
          if (typeof Sfx !== 'undefined' && Sfx.say) Sfx.say('Legendary!', { delay: 0.85 });
          const lb = document.createElement('div'); lb.className = 'legend-banner'; lb.textContent = 'LEGENDARY';
          $('#pack').appendChild(lb); setTimeout(() => lb.remove(), 2600);
        }
        if (++revealed === r.cards.length) {
          packsLeft = r.summary.packs;
          $('#pack-hint').textContent = r.summary.packs > 0 ? `${r.summary.packs} more pack${r.summary.packs > 1 ? 's' : ''} to open` : 'All cards added to your collection';
          $('#btn-pack-again').hidden = r.summary.packs < 1;
          $('#btn-pack-done').textContent = 'Done';
        }
      };
      box.appendChild(holder);
    });
    if (origin && !reduceMotion) {
      const ox = origin.left + origin.width / 2, oy = origin.top + origin.height / 2;
      box.querySelectorAll('.pack-card').forEach((h, k) => {
        const hr = h.getBoundingClientRect();
        h.style.setProperty('--fx', (ox - (hr.left + hr.width / 2)).toFixed(0) + 'px');
        h.style.setProperty('--fy', (oy - (hr.top + hr.height / 2)).toFixed(0) + 'px');
        h.style.setProperty('--fr', ((k % 2 ? 1 : -1) * (8 + Math.random() * 14)).toFixed(0) + 'deg');
        h.classList.add('fly');
      });
    }
    $('#pack-hint').textContent = 'Click each card to reveal it';
    $('#btn-pack-done').textContent = 'Done';
    (r.daily || []).forEach((d, k) => setTimeout(() => { toast(`Daily challenge done: ${d.text} (+${d.reward} shards)`); sfx('unlock'); }, 600 + k * 2700));
    if (r.daily && r.daily.length) refreshDailies();
  }

  // ---------- wiring ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (b && !b.disabled && !b.classList.contains('music-btn') && !b.classList.contains('rule-info')) sfx('click');
  }, true);

  // ---------- tooltips ----------
  // One floating tooltip, placed next to the (i) by script: above it if there's room, otherwise below,
  // and kept inside the window. Mouse: appears after resting 0.5s on the (i), hides as soon as it leaves.
  // Touch: tap the (i) to toggle. Keyboard: shows while the (i) has keyboard focus.
  const tipEl = $('#tooltip');
  let tipFor = null, tipTimer = null;
  function placeTip(icon) {
    const r = icon.getBoundingClientRect(), t = tipEl.getBoundingClientRect(), m = 8;
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(m, Math.min(innerWidth - t.width - m, x));
    let y = r.top - t.height - 10, below = false;
    if (y < m) { y = r.bottom + 10; below = true; }
    tipEl.classList.toggle('below', below);
    tipEl.style.transform = '';
    tipEl.style.left = `${Math.round(x)}px`; tipEl.style.top = `${Math.round(y)}px`;
    tipEl.style.setProperty('--ax', `${Math.round(r.left + r.width / 2 - x)}px`);
  }
  function showTip(icon) {
    clearTimeout(tipTimer);
    const src = icon.parentElement.querySelector('.rule-tip');
    if (!src) return;
    tipFor = icon;
    tipEl.textContent = src.textContent;
    tipEl.classList.remove('show');
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    placeTip(icon);
    icon.setAttribute('aria-describedby', 'tooltip');
    requestAnimationFrame(() => tipEl.classList.add('show'));
  }
  function hideTip() {
    clearTimeout(tipTimer); tipTimer = null;
    if (tipFor) tipFor.removeAttribute('aria-describedby');
    tipFor = null;
    tipEl.classList.remove('show');
  }
  document.querySelectorAll('.rule-info').forEach((b) => {
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => showTip(b), 500);
    });
    b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();            // don't toggle the rule's checkbox
      if (tipFor === b && tipEl.classList.contains('show')) hideTip(); else showTip(b);
    });
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) showTip(b); });
    b.addEventListener('blur', hideTip);
  });
  document.addEventListener('pointerdown', (e) => { if (!(e.target.closest && e.target.closest('.rule-info'))) hideTip(); }, true);
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });

  ['#r-open', '#r-same', '#r-plus', '#r-elemental', '#r-hands', '#r-wager'].forEach((s) => $(s).addEventListener('change', syncRuleOptions));

  $('#btn-ai').onclick = () => startMatch('ai');
  $('#btn-create').onclick = () => startMatch('human');
  $('#btn-join').onclick = () => {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length !== 4) { $('#menu-error').textContent = 'Enter the 4-letter room code.'; return; }
    $('#menu-error').textContent = '';
    state = null; resultShown = false; mode = 'online';
    connect(() => send({ t: 'join', code, name: playerName() }));
  };
  $('#btn-copy').onclick = async () => {
    const link = `${location.origin}/?room=${$('#room-code').textContent}`;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch (e) { toast(link); }
  };
  $('#btn-cancel').onclick = () => { disconnect(); show('menu'); };
  const toMenu = () => { disconnect(); show('menu'); };
  $('#btn-quit').onclick = () => {
    if (state && !state.over) $('#concede').classList.add('show'); else toMenu();
  };
  $('#btn-concede-yes').onclick = () => { $('#concede').classList.remove('show'); toMenu(); };
  $('#btn-concede-no').onclick = () => $('#concede').classList.remove('show');
  $('#concede').addEventListener('click', (e) => { if (e.target.id === 'concede') $('#concede').classList.remove('show'); });
  $('#btn-history').onclick = () => setHistory(!historyOpen);
  $('#btn-history-close').onclick = () => setHistory(false);
  $('#btn-result-history').onclick = () => setHistory(true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && historyOpen) setHistory(false); });
  $('#btn-menu').onclick = toMenu;
  $('#btn-build-quit').onclick = toMenu;
  $('#btn-rematch').onclick = () => {
    send({ t: 'rematch' });
    if (mode === 'online') { $('#btn-rematch').disabled = true; $('#result-note').textContent = 'Waiting for opponent…'; }
  };
  $('#btn-build-auto').onclick = autoPick;
  $('#btn-build-ready').onclick = () => { if (builder.picked.length === 5) { builder.locked = true; renderBuilder(); send({ t: 'hand', cards: builder.picked }); } };
  $('#btn-result-packs').onclick = () => openPackPicker();
  $('#name').addEventListener('change', () => { try { localStorage.setItem('triad-name', $('#name').value); } catch (e) { /* ignore */ } });

  $('#btn-signin').onclick = openAuth;
  document.querySelectorAll('[data-open-auth]').forEach((b) => { b.onclick = openAuth; });
  document.querySelectorAll('.nav-item').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
  document.querySelectorAll('.seg [data-level]').forEach((b) => {
    b.onclick = () => {
      $('#difficulty').value = b.dataset.level;
      document.querySelectorAll('.seg [data-level]').forEach((x) => x.classList.toggle('on', x === b));
      try { localStorage.setItem('triad-level', b.dataset.level); } catch (e) { /* ignore */ }
    };
  });
  try { const lv = localStorage.getItem('triad-level'); if (lv) { const b = document.querySelector(`.seg [data-level="${lv}"]`); if (b) b.click(); } } catch (e) { /* ignore */ }
  $('#auth-form').addEventListener('submit', (e) => { e.preventDefault(); doAuth('login'); });
  $('#btn-auth-register').onclick = () => { if ($('#auth-form').reportValidity()) doAuth('register'); };
  $('#btn-auth-cancel').onclick = () => $('#auth').classList.remove('show');
  $('#btn-signout').onclick = async () => { try { await api('POST', '/api/logout', {}); } catch (e) { /* ignore */ } account = null; renderAccount(); toast('Signed out.'); };
  $('#btn-packs').onclick = () => openPackPicker();
  $('#btn-col-back').onclick = () => setView(currentView === 'collection' ? 'play' : currentView);
  $('#col-deck').onchange = () => { chooseSet($('#col-deck').value); Music.play(musicFor($('#col-deck').value)); renderCollection(); refreshProgress(); };
  $('#btn-open-pack').onclick = () => openPackPicker();
  $('#btn-scrap-extras').onclick = async () => {
    try {
      const r = await api('POST', '/api/scrap/extras', { deck: $('#col-deck').value });
      setShards(r.shards); sfx('cancel'); toast(`Scrapped ${r.count} extra${r.count === 1 ? '' : 's'} for ${r.gained} shards.`); renderCollection();
    } catch (e) { toast(e.message); sfx('error'); }
  };
  $('#cd-normal').onclick = () => { detail.foil = false; renderCardDetail(); };
  $('#cd-foil').onclick = () => { detail.foil = true; renderCardDetail(); };
  $('#cd-craft').onclick = () => detailAction('craft');
  $('#cd-scrap').onclick = () => detailAction('scrap');
  $('#cd-close').onclick = () => $('#card-detail').classList.remove('show');
  $('#card-detail').addEventListener('click', (e) => { if (e.target.id === 'card-detail') $('#card-detail').classList.remove('show'); });
  // ---------- phones: the set picker sits in a top strip that scrolls away with the page (not a floating bar) ----------
  (function placeSetBar() {
    const bar = document.querySelector('.set-bar'), foot = document.querySelector('#nav .nav-foot');
    const strip = document.createElement('div'); strip.id = 'mtop'; document.body.prepend(strip);
    const mq = matchMedia('(max-width: 899px)');
    const lvl = document.querySelector('#btn-level'), packs = document.querySelector('#btn-packs');
    // desktop: level badge on the right with shards and version; phones: in the top strip beside the packs button
    const place = () => { if (mq.matches) { strip.appendChild(bar); bar.insertBefore(lvl, packs); } else { foot.before(bar); foot.prepend(lvl); } };
    mq.addEventListener('change', place); place();
  })();

  // ---------- full screen (phones and tablets) ----------
  (function fullscreenButton() {
    const root = document.documentElement;
    if (!(root.requestFullscreen || root.webkitRequestFullscreen) || !window.SoundUI) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'music-btn fs-btn';
    const icon = (on) => (on
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>');
    const sync = () => { const on = !!(document.fullscreenElement || document.webkitFullscreenElement); b.innerHTML = icon(on); b.title = on ? 'Exit full screen' : 'Full screen'; b.setAttribute('aria-label', b.title); };
    b.onclick = (e) => {
      e.stopPropagation();
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' });
    };
    document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
    sync(); window.SoundUI.box().appendChild(b);
  })();

  // ---------- large view of a card (tap an opened pack card) ----------
  function zoomCard(card, glyphs, deckId, id) {
    const z = $('#card-zoom'), box = $('#cz-card'), own = $('#cz-owned');
    own.textContent = '';
    // how many you own now (this pack and any scrapping included), like the collection's card view
    if (deckId) api('GET', `/api/collection?deck=${encodeURIComponent(deckId)}`).then((s) => {
      own.textContent = `You have ${s.cards[id] || 0} normal and ${s.foils[id] || 0} foil`;
    }).catch(() => {});
    box.innerHTML = ''; box.appendChild(cardEl(card, 'neutral', glyphs));
    $('#cz-name').textContent = card.name;
    $('#cz-meta').textContent = `${RARITY[card.level] || ''}${card.foil ? ' · Foil' : ''} · ${cap(card.el)}`;
    $('#cz-meta').title = `Top / Right / Bottom / Left: ${card.r.map(RANK).join(' / ')}`;
    z.classList.add('show'); sfx('pick');
  }
  $('#card-zoom').addEventListener('click', () => $('#card-zoom').classList.remove('show'));
  $('#pick-close').onclick = () => $('#pack-pick').classList.remove('show');
  $('#pack-pick').addEventListener('click', (e) => { if (e.target.id === 'pack-pick') $('#pack-pick').classList.remove('show'); });

  // ---------- closing popups: ✕ buttons and clicking outside ----------
  const closeResult = () => { $('#result').classList.remove('show'); $('#btn-show-result').hidden = !(state && state.over); };
  $('#btn-result-close').onclick = closeResult;
  // after closing the result popup, the bar offers a straight Rematch (it never reopens the popup)
  $('#btn-show-result').onclick = () => {
    const rb = $('#btn-rematch');
    if (rb.disabled) return;
    rb.click();
    if (mode === 'online') { const b = $('#btn-show-result'); b.disabled = true; b.textContent = 'Waiting…'; }
  };
  $('#result').addEventListener('click', (e) => { if (e.target.id === 'result') closeResult(); });
  $('#auth').addEventListener('click', (e) => { if (e.target.id === 'auth') $('#auth').classList.remove('show'); });
  // the pack screen needs a decision (open, reveal, scrap), so clicking outside doesn't close it: use Later / Done
  // the move history drawer closes when you click or tap anywhere else
  document.addEventListener('pointerdown', (e) => {
    if (!historyOpen) return;
    if (e.target.closest('#history, #btn-history, #btn-result-history')) return;
    setHistory(false);
  }, true);
  // Escape closes whichever popup is on top
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#pack-pick').classList.contains('show')) $('#pack-pick').classList.remove('show');
    else if ($('#card-zoom').classList.contains('show')) $('#card-zoom').classList.remove('show');
    else if ($('#card-detail').classList.contains('show')) $('#card-detail').classList.remove('show');
    else if ($('#auth').classList.contains('show')) $('#auth').classList.remove('show');
    else if ($('#pack').classList.contains('show') && !document.querySelector('#pack .sealed.charging, #pack .sealed.tearing')) $('#btn-pack-done').click();
    else if ($('#result').classList.contains('show')) closeResult();
  });
  $('#btn-pack-again').onclick = () => { $('#pack').classList.remove('show'); openPackPicker(); };
  $('#btn-pack-done').onclick = () => {
    $('#pack').classList.remove('show');
    if (document.querySelector('#collection.active')) renderCollection();
    refreshProgress();
    if (state && state.over) $('#btn-result-packs').hidden = true;
    if (!$('#view-rewards').hidden && document.querySelector('#menu.active')) { applyTheme($('#deck').value); refreshRewards(); }
  };

  // ---------- boot ----------
  const SET_ICON = { wilds: '🐾', arcane: '🔮', starfall: '🚀', tidebound: '🌊', bloomwild: '🌸', hollow: '🏮' };
  async function loadDecks() {
    const index = await (await fetch('decks/index.json')).json();
    const sel = $('#deck'), csel = $('#col-deck');
    for (const f of index.decks) {
      const d = await (await fetch('decks/' + f)).json();
      d.id = d.id || f.replace(/\.json$/, '');
      decks.set(d.id, d);
      const o = document.createElement('option'); o.value = d.id; o.textContent = `${d.name} (${d.cards.length})`;
      csel.appendChild(o.cloneNode(true));
      o.dataset.full = `${SET_ICON[d.id] || '🃏'} ${d.name}`; o.dataset.icon = SET_ICON[d.id] || '🃏'; o.textContent = o.dataset.full;
      sel.appendChild(o);
    }
    let saved = null;
    try { saved = localStorage.getItem('triad-deck'); } catch (e) { /* ignore */ }
    chooseSet(saved && decks.has(saved) ? saved : sel.value);
    sel.onchange = () => {
      chooseSet(sel.value); refreshProgress();
      if (document.querySelector('#menu.active, #collection.active')) Music.play(musicFor(sel.value));
      if (document.querySelector('#collection.active')) renderCollection();
    };
    if (document.querySelector('#menu.active')) Music.play(musicFor(sel.value));
  }

  fetch('version').then((r) => r.json()).then((v) => {
    // the version links to that release's patch notes
    for (const a of [$('#version'), $('#version-m')]) {
      a.textContent = 'v' + v.version;
      a.title = `Open v${v.version} Patch notes`;
      a.href = `https://github.com/ashishkhatri/tripletriad/releases/tag/v${v.version}`;
    }
  }).catch(() => {});

  loadDecks().then(async () => {
    try { $('#name').value = localStorage.getItem('triad-name') || ''; } catch (e) { /* ignore */ }
    try {
      const r = JSON.parse(localStorage.getItem('triad-rules-2') || 'null');
      if (r) { ['open', 'same', 'plus', 'elemental', 'storms', 'wager'].forEach((k) => { $('#r-' + k).checked = !!r[k]; }); if (r.handMode) $('#r-hands').value = r.handMode; }
    } catch (e) { /* ignore */ }
    await loadAccount();
    setView(currentView);
    const room = new URLSearchParams(location.search).get('room');
    if (room) $('#join-code').value = room.toUpperCase().slice(0, 4);
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('triad-session') || 'null'); } catch (e) { /* ignore */ }
    if (saved) {
      session = saved; mode = 'online';
      connect(() => send({ t: 'resume', code: saved.code, token: saved.token }));
    }
  }).catch(() => { $('#menu-error').textContent = 'Could not load the card sets'; });
})();
