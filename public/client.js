'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const RANK = (n) => (n >= 10 ? 'A' : String(n));
  const RULE_NAMES = { open: 'Open', same: 'Same', plus: 'Plus', elemental: 'Elemental', wager: 'Wager' };
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
    try { localStorage.setItem('triad-deck', deckId); } catch (e) { /* ignore */ }
    $('#deck-desc').textContent = decks.get(deckId).description || '';
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
    // the navigation belongs to the menu and the collection, not to matches
    const navOn = id === 'menu' || id === 'collection';
    document.body.classList.toggle('with-nav', navOn);
    markNav(id === 'collection' ? 'collection' : currentView);
    if (id === 'menu') { refreshProgress(); refreshDailies(); }
  }

  // ---------- navigation ----------
  let currentView = 'play';
  try { const v = sessionStorage.getItem('triad-view'); if (v && v !== 'collection') currentView = v; } catch (e) { /* ignore */ }
  function markNav(view) {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  }
  function setView(view) {
    if (view === 'collection') {
      if (!account) { currentView = 'account'; setView('account'); toast('Sign in to start a collection.'); return; }
      openCollection($('#deck').value);
      return;
    }
    currentView = view;
    try { sessionStorage.setItem('triad-view', view); } catch (e) { /* ignore */ }
    document.querySelectorAll('#menu .view').forEach((v) => { v.hidden = v.dataset.view !== view; });
    if (!document.querySelector('#menu.active')) show('menu'); else { document.body.classList.add('with-nav'); markNav(view); }
    window.scrollTo(0, 0);
    if (view === 'challenges') refreshDailies();
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
      open: $('#r-open').checked, same: $('#r-same').checked, plus: $('#r-plus').checked, elemental: $('#r-elemental').checked,
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
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = card.name; el.appendChild(nm);
    el.title = `${card.name} — ${RARITY[card.level] || ''} · ${cap(card.el)}${card.foil ? ' · Foil' : ''} — ${card.r.map(RANK).join(' / ')}`;
    return el;
  }

  // ---------- game render ----------
  function myTurn() { return state && !state.over && state.turn === me && !busy; }

  function render() {
    if (!state) return;
    if (typeof Music !== 'undefined' && state.deck) Music.play(musicFor(state.deck.id));
    if (state.deck) applyTheme(state.deck.id);
    const opp = 1 - me;
    const sc = TT.score(state);
    $('#score-mine').textContent = sc[me];
    $('#score-theirs').textContent = sc[opp];
    $('#name-mine').textContent = names[me] || 'You';
    $('#name-theirs').textContent = names[opp] || 'Opponent';
    const turn = $('#turn');
    if (state.over) { turn.textContent = 'Game over'; turn.classList.remove('me'); }
    else if (state.turn === me) { turn.textContent = selected === null ? 'Your turn — drag a card onto the board' : 'Place it on the board'; turn.classList.add('me'); }
    else { turn.textContent = `${names[opp] || 'Opponent'} is thinking…`; turn.classList.remove('me'); }
    const ruleBits = Object.keys(RULE_NAMES).filter((k) => state.rules[k]).map((k) => RULE_NAMES[k]);
    if (HAND_NAMES[state.rules.handMode]) ruleBits.push(HAND_NAMES[state.rules.handMode]);
    $('#rules-label').textContent = (state.deck && state.deck.name ? state.deck.name + ' — ' : '') + (ruleBits.join(' · ') || 'Basic rules');

    const hm = $('#hand-mine'); hm.innerHTML = '';
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
        const prev = prevBoard[i];
        if (!prev) el.classList.add('placed');
        else if (prev.owner !== slot.owner) {
          const from = prevBoard.findIndex((p, k) => !p && state.board[k]);   // the card just played
          const src = from >= 0 ? from : i;
          const sameRow = Math.floor(src / 3) === Math.floor(i / 3);
          el.classList.add('flip', sameRow ? 'flip-y' : 'flip-x');
          el.style.setProperty('--fd', sameRow ? (i % 3 > src % 3 ? 1 : -1) : (i > src ? -1 : 1));
        }
        cell.appendChild(el);
        if (elKey) {
          const up = slot.card.el === elKey;
          const m = document.createElement('div'); m.className = 'mod ' + (up ? 'up' : 'down'); m.textContent = up ? '+1' : '−1';
          cell.appendChild(m);
        }
      } else if (myTurn() && selected !== null) {
        cell.classList.add('can-drop');
        cell.onclick = () => playMove(selected, i);
      }
      board.appendChild(cell);
    }
    prevBoard = state.board.map((s) => (s ? { owner: s.owner, id: s.card.id } : null));
    renderHistory();
  }

  // ---------- move history ----------
  const SIDE = ['top', 'right', 'bottom', 'left'];
  const RAR_COLOR = { 1: '#8d939c', 2: '#b77d47', 3: '#d4dbe4', 4: '#e9c55a', 5: '#c58cff' };
  let historyOpen = false;
  function setHistory(open) {
    historyOpen = open;
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
      cards[h.cell] = h.card;
      const snapshot = cards.slice();
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
      const modTxt = (m, v) => (m ? ` <small>(${RANK(v - m)} ${m > 0 ? '+ 1' : '− 1'} element)</small>` : '');
      if (h.mod) lines.push({ html: `Placed on ${h.mod > 0 ? 'a matching' : 'a different'} element square: <b>${h.mod > 0 ? '+1' : '−1'}</b> to every side.`, cls: 'note' });
      h.steps.forEach((st, si) => {
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
          lines.push({ html: `<span class="tag ${st.k}">${st.k === 'same' ? 'Same' : 'Plus'}</span>${parts.join('<br>')}${got.length ? `<br>→ flips <b>${got.join(', ')}</b>` : ''}`, step: si, cls: st.k });
        } else {
          const od = (st.d + 2) % 4;
          const cls = st.k === 'combo' ? 'combo' : st.flip ? 'win' : 'hold';
          marks.push({ cell: st.from, d: st.d, cls: st.flip ? cls : 'weak', step: si }, { cell: st.n, d: od, cls: st.flip ? 'lose' : 'strong', step: si });
          if (st.flip) flips.add(st.n);
          const a = `${st.k === 'combo' ? nm(st.from) + '’s ' : ''}${SIDE[st.d]} ${num(st.a, st.flip ? 'win' : 'weak')}${modTxt(st.am, st.a)}`;
          const b = `${nm(st.n)}’s ${SIDE[od]} ${num(st.b, st.flip ? 'lose' : 'strong')}${modTxt(st.bm, st.b)}`;
          lines.push({
            html: st.k === 'combo'
              ? `<span class="tag combo">Combo</span> ${a} beats ${b} → <b>captured</b>`
              : st.flip ? `${a} beats ${b} → <b>captured</b>` : `${a} vs ${b} → ${st.a === st.b ? 'tie, ' : ''}holds`,
            step: si, cls,
          });
        }
      });
      if (!h.steps.length) {
        const around = [0, 1, 2, 3].map((d) => TT.neighbor(h.cell, d)).filter((n) => n >= 0 && h.owners[n] !== null);
        lines.push({ html: i === 0 ? 'First card on the board.' : around.length ? 'Only its own side’s cards next to it, so nothing to capture.' : 'Nothing next to it yet.', cls: 'note' });
      }

      const head = document.createElement('div'); head.className = 'hist-head';
      head.innerHTML = `<span class="hist-no">${i + 1}</span><span><b>${who(h.p)}</b> played <b>${h.card.name}</b> <small>· ${SIDE_CELL[h.cell]}</small></span><span class="hist-res${flips.size ? '' : ' none'}">${flips.size ? `+${flips.size} flip${flips.size > 1 ? 's' : ''}` : 'no flips'}</span>`;
      li.appendChild(head);
      const body = document.createElement('div'); body.className = 'hist-body';
      const mb = document.createElement('div'); mb.className = 'mini-board';
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div'); cell.className = 'mini-cell';
        const ek = state.elements && state.elements[c];
        if (ek) { cell.classList.add('elem'); cell.dataset.el = glyphs[ek] || glyph(ek) || ''; }
        if (snapshot[c]) {
          cell.classList.add(h.owners[c] === me ? 'own-mine' : 'own-theirs');
          const mc = miniCard(snapshot[c], h.owners[c], c, marks);
          if (c === h.cell) mc.classList.add('placed');
          if (flips.has(c)) { mc.classList.add('flipped'); const f = document.createElement('i'); f.className = 'flip-badge'; f.textContent = '↻'; mc.appendChild(f); }
          cell.appendChild(mc);
        }
        mb.appendChild(cell);
      }
      body.appendChild(mb);
      const ul = document.createElement('ul'); ul.className = 'hist-steps';
      for (const ln of lines) {
        const sli = document.createElement('li'); sli.className = ln.cls || ''; sli.innerHTML = ln.html;
        if (ln.step !== undefined) {
          const on = (v) => { mb.classList.toggle('focus', v); mb.querySelectorAll('.rk.hl').forEach((r) => r.classList.toggle('on', v && r.dataset.steps.split(' ').includes(String(ln.step)))); };
          sli.addEventListener('pointerenter', () => on(true));
          sli.addEventListener('pointerleave', () => on(false));
        }
        ul.appendChild(sli);
      }
      body.appendChild(ul);
      li.appendChild(body);
      list.appendChild(li);
    }
  }
  const SIDE_CELL = ['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'];

  // ---------- drag & drop (mouse and touch); a plain click still selects ----------
  function markDrops(on) {
    document.querySelectorAll('#board .cell').forEach((c, idx) => {
      if (!state.board[idx]) c.classList.toggle('can-drop', on || selected !== null);
    });
  }
  // Cancels an in-progress drag (set while dragging) — used by right-click and Escape.
  let cancelDrag = null;
  let swallowMenuUntil = 0;   // set when the right button cancels a card move
  function startDrag(e, i, el) {
    if (!myTurn() || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, rect = el.getBoundingClientRect();
    const offX = sx - rect.left, offY = sy - rect.top;
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
        ghost.style.width = rect.width + 'px'; ghost.style.height = rect.height + 'px';
        ghost._swing = { rx: 0, ry: 0 };
        document.body.appendChild(ghost);
        lastX = ev.clientX; lastY = ev.clientY;
        const decay = () => { if (!ghost) return; ghost._swing.rx *= 0.82; ghost._swing.ry *= 0.82; requestAnimationFrame(decay); };
        requestAnimationFrame(decay);
        el.classList.add('dragging');
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
      const target = c && !state.board[Number(c.dataset.cell)] ? c : null;
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
  async function applyResult(newState, events) {
    const prevTurn = state ? state.turn : null;
    state = newState;
    selected = null;
    render();
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
      const pct = ((100 - r.nextPackIn) / 100) * 100;
      $('#result-xp-fill').style.width = pct + '%';
      let t = `+${r.gained} XP · ${r.xp} XP in ${(decks.get(roomDeck) || {}).name || 'this set'}`;
      if (r.newPacks > 0) t += ` · ${r.newPacks === 1 ? 'A pack unlocked!' : r.newPacks + ' packs unlocked!'}`;
      else t += ` · next pack in ${r.nextPackIn} XP`;
      $('#result-xp-text').textContent = t;
      sfx('xp', { delay: 0.6 });
      if (r.newPacks > 0) sfx('unlock', { delay: 1.1 });
      $('#btn-result-packs').hidden = !(r.packs > 0);
      $('#btn-result-packs').textContent = r.packs > 1 ? `Open packs (${r.packs})` : 'Open pack';
    } else if (!account) {
      $('#result-xp').hidden = false; $('#result-xp-fill').style.width = '0%';
      $('#result-xp-text').textContent = 'Sign in to earn XP and card packs.';
    }
    const dl = $('#result-daily'); dl.innerHTML = ''; dl.hidden = !(msg.daily && msg.daily.length);
    (msg.daily || []).forEach((d) => { const li = document.createElement('li'); li.innerHTML = `<span>✔ ${d.text}</span><span class="shards">+${d.reward}</span>`; dl.appendChild(li); });
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
        if (fresh) { prevBoard = Array(9).fill(null); resultShown = false; $('#result').classList.remove('show'); }
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
        toast('Your opponent left the room.');
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
      const wrap = document.createElement('div'); wrap.className = 'grid-card';
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
    $('#account-guest').hidden = !!account;
    $('#account-user').hidden = !account;
    $('#guest-note').hidden = !!account;
    document.querySelectorAll('.nav-shards, .mobile-head .shard-balance').forEach((el) => { el.hidden = !account; });
    if (account) { $('#acct-name').textContent = account.name; setShards(account.shards || 0); }
    syncRuleOptions();
    refreshProgress();
    refreshDailies();
  }
  function setShards(n) {
    if (account) account.shards = n;
    document.querySelectorAll('.shard-balance').forEach((el) => { el.textContent = n.toLocaleString(); });
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
    try { localStorage.setItem('triad-rules', JSON.stringify(readRules())); } catch (e) { /* ignore */ }
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
  async function refreshProgress() {
    const box = $('#set-progress');
    if (!account || !decks.size) { box.hidden = true; return; }
    try {
      const s = await api('GET', `/api/collection?deck=${encodeURIComponent($('#deck').value)}`);
      box.hidden = false;
      $('#menu-xp-fill').style.width = `${((s.xpPerPack - s.nextPackIn) / s.xpPerPack) * 100}%`;
      $('#menu-xp-text').textContent = `${s.xp} XP · ${s.owned}/${s.total} cards · next pack in ${s.nextPackIn} XP`;
      const b = $('#btn-packs');
      b.hidden = !(s.packs > 0);
      b.textContent = s.packs > 1 ? `Open ${s.packs} packs` : 'Open your pack';
    } catch (e) { box.hidden = true; }
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
    $('#col-xp-text').textContent = `${s.xp} XP · next pack in ${s.nextPackIn} XP`;
    $('#col-owned').textContent = `${s.owned} of ${s.total} cards`;
    $('#col-record').textContent = s.games ? `${s.wins} wins in ${s.games} games` : 'No games yet';
    const ob = $('#btn-open-pack');
    ob.disabled = s.packs < 1;
    ob.textContent = s.packs > 0 ? `Open pack (${s.packs})` : 'No packs yet';
    // extras: everything beyond one normal and one foil copy of each card
    let extraValue = 0, extraCount = 0;
    for (const foil of [false, true]) for (const [id, n] of Object.entries(foil ? s.foils : s.cards)) if (n > 1) {
      extraCount += n - 1; extraValue += (n - 1) * s.scrap[deckCard(deckId, id).level] * (foil ? s.foilMult : 1);
    }
    const xb = $('#btn-scrap-extras');
    xb.disabled = !extraCount;
    xb.innerHTML = extraCount ? `Scrap ${extraCount} extra${extraCount > 1 ? 's' : ''} <span class="shards">+${extraValue}</span>` : 'No extras to scrap';
    const grid = $('#col-grid'); grid.innerHTML = '';
    for (const c of deck.cards) {
      const wrap = document.createElement('div'); wrap.className = 'grid-card';
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
    detail = { deckId, id, foil: foil !== undefined ? foil : (nf > 0 && !n) };
    renderCardDetail();
    $('#card-detail').classList.add('show');
  }
  function renderCardDetail() {
    const { deckId, id, foil } = detail, s = colSummary, deck = decks.get(deckId), c = deckCard(deckId, id);
    const big = $('#cd-card'); big.innerHTML = '';
    big.appendChild(cardEl(playCard(c, foil), 'neutral', deck.elements));
    $('#cd-name').textContent = c.name;
    $('#cd-meta').textContent = `${RARITY[c.level]} · ${cap(c.element)} · ${c.ranks.map(RANK).join(' / ')}`;
    const have = (foil ? s.foils : s.cards)[id] || 0;
    $('#cd-owned').textContent = `You have ${s.cards[id] || 0} normal and ${s.foils[id] || 0} foil`;
    $('#cd-normal').classList.toggle('on', !foil); $('#cd-foil').classList.toggle('on', foil);
    const cost = s.craft[c.level] * (foil ? s.foilMult : 1), value = s.scrap[c.level] * (foil ? s.foilMult : 1);
    const craft = $('#cd-craft'), scrap = $('#cd-scrap');
    craft.innerHTML = `Craft${foil ? ' foil' : ''} <span class="shards">${cost}</span>`;
    craft.disabled = s.shards < cost;
    scrap.innerHTML = `Scrap${foil ? ' foil' : ''} <span class="shards">+${value}</span>`;
    scrap.disabled = have < 1 || s.copies - 1 < s.minCards;
    $('#cd-note').textContent = s.shards < cost ? `You have ${s.shards} shards — ${cost - s.shards} more to craft this.` :
      (have >= 1 && s.copies - 1 < s.minCards ? `You need at least ${s.minCards} cards in a set, so you can\u2019t scrap this one.` : '');
  }
  async function detailAction(kind) {
    const { deckId, id, foil } = detail;
    try {
      const r = await api('POST', kind === 'craft' ? '/api/craft' : '/api/scrap', { deck: deckId, card: id, foil });
      colSummary = r.summary; setShards(r.shards);
      sfx(kind === 'craft' ? `reveal-${Math.min(5, deckCard(deckId, id).level)}` : 'cancel');
      toast(kind === 'craft' ? `Crafted ${foil ? 'a foil ' : ''}${deckCard(deckId, id).name}.` : `Scrapped for ${r.gained} shards.`);
      renderCardDetail();
      renderCollection();
    } catch (e) { toast(e.message); sfx('error'); }
  }

  let packDeck = null;
  // Step 1: show the sealed pack. Nothing is spent until it's torn open.
  function openPack(deckId) {
    packDeck = deckId;
    const deck = decks.get(deckId);
    applyTheme(deckId);
    const box = $('#pack-cards'); box.innerHTML = '';
    $('#pack-title').textContent = `${deck.name} pack`;
    // a real 3D pack: front and back faces with thickness between them, foil side walls,
    // pillow shading and crinkles; it floats in a wrapper and tilts toward the pointer
    const float = document.createElement('div'); float.className = 'sealed-float';
    const sealed = document.createElement('div');
    sealed.className = 'sealed lit';
    sealed.dataset.tilt = '26';
    const src = `packs/${encodeURIComponent(deckId)}.svg`, backSrc = `packs/${encodeURIComponent(deckId)}-back.svg`;
    sealed.style.setProperty('--pack-art', `url("${src}")`);
    sealed.style.setProperty('--pack-back', `url("${backSrc}")`);
    const front = document.createElement('div'); front.className = 'pack-face pack-front';
    for (const part of ['pack-body', 'pack-top']) {
      const d = document.createElement('div'); d.className = part;
      const img = document.createElement('img'); img.src = src; img.alt = part === 'pack-body' ? `${deck.name} card pack` : '';
      img.draggable = false;
      d.appendChild(img); front.appendChild(d);
    }
    for (const layer of ['pack-bulge', 'pack-crinkle', 'foil-layer', 'glare-spot']) {
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
      sealed.classList.add('shaking');
      let r;
      try { r = await api('POST', '/api/packs/open', { deck: deckId }); }
      catch (e) { sealed.classList.remove('shaking'); opening = false; toast(e.message); sfx('error'); return; }
      sfx('pack-open');
      sealed.classList.remove('shaking');
      sealed.classList.add('tearing');
      burst.classList.add('go');
      $('#pack-hint').textContent = '';
      await sleep(950);
      float.remove(); burst.remove();
      revealPackCards(deckId, r);
    };
    $('#pack-hint').textContent = 'Click the pack to tear it open';
    $('#btn-pack-again').hidden = true;
    $('#btn-pack-done').textContent = 'Later';
    $('#pack').classList.add('show');
  }

  // Step 2: the three cards come out face down; click each to reveal it.
  function revealPackCards(deckId, r) {
    const box = $('#pack-cards'); box.innerHTML = '';
    const deck = decks.get(deckId);
    let revealed = 0;
    r.cards.forEach((pc, i) => {
      const c = deck.cards.find((x) => x.id === pc.id);
      const holder = document.createElement('div'); holder.className = 'pack-card';
      holder.style.animationDelay = `${i * 140}ms`;
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
          holder.classList.add('scrapped'); sb.disabled = true; sb.innerHTML = `Scrapped <span class="shards">+${res.gained}</span>`;
        } catch (err) { toast(err.message); sfx('error'); }
      };
      holder.appendChild(sb);
      holder.onclick = () => {
        if (holder.classList.contains('revealed')) return;
        holder.classList.add('revealed', `rarity-${c.level}`);
        sfx(`reveal-${Math.min(5, Math.max(1, c.level))}`);
        if (++revealed === r.cards.length) {
          $('#pack-hint').textContent = r.summary.packs > 0 ? `${r.summary.packs} more pack${r.summary.packs > 1 ? 's' : ''} to open` : 'All cards added to your collection';
          $('#btn-pack-again').hidden = r.summary.packs < 1;
          $('#btn-pack-done').textContent = 'Done';
        }
      };
      box.appendChild(holder);
    });
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
  $('#btn-quit').onclick = toMenu;
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
  $('#btn-result-packs').onclick = () => openPack(roomDeck);
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
  $('#btn-collection').onclick = () => openCollection($('#deck').value);
  $('#btn-packs').onclick = () => openPack($('#deck').value);
  $('#btn-col-back').onclick = () => setView(currentView === 'collection' ? 'play' : currentView);
  $('#col-deck').onchange = () => { chooseSet($('#col-deck').value); Music.play(musicFor($('#col-deck').value)); renderCollection(); refreshProgress(); };
  $('#btn-open-pack').onclick = () => openPack($('#col-deck').value);
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
  $('#btn-pack-again').onclick = () => openPack(packDeck);
  $('#btn-pack-done').onclick = () => {
    $('#pack').classList.remove('show');
    if (document.querySelector('#collection.active')) renderCollection();
    refreshProgress();
    if (state && state.over) $('#btn-result-packs').hidden = true;
  };

  // ---------- boot ----------
  async function loadDecks() {
    const index = await (await fetch('decks/index.json')).json();
    const sel = $('#deck'), csel = $('#col-deck');
    for (const f of index.decks) {
      const d = await (await fetch('decks/' + f)).json();
      d.id = d.id || f.replace(/\.json$/, '');
      decks.set(d.id, d);
      const o = document.createElement('option'); o.value = d.id; o.textContent = `${d.name} (${d.cards.length})`; sel.appendChild(o);
      csel.appendChild(o.cloneNode(true));
    }
    let saved = null;
    try { saved = localStorage.getItem('triad-deck'); } catch (e) { /* ignore */ }
    chooseSet(saved && decks.has(saved) ? saved : sel.value);
    sel.onchange = () => { chooseSet(sel.value); refreshProgress(); if (document.querySelector('#menu.active')) Music.play(musicFor(sel.value)); };
    if (document.querySelector('#menu.active')) Music.play(musicFor(sel.value));
  }

  fetch('version').then((r) => r.json()).then((v) => { $('#version').textContent = 'v' + v.version; }).catch(() => {});

  loadDecks().then(async () => {
    try { $('#name').value = localStorage.getItem('triad-name') || ''; } catch (e) { /* ignore */ }
    try {
      const r = JSON.parse(localStorage.getItem('triad-rules') || 'null');
      if (r) { ['open', 'same', 'plus', 'elemental', 'wager'].forEach((k) => { $('#r-' + k).checked = !!r[k]; }); if (r.handMode) $('#r-hands').value = r.handMode; }
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
