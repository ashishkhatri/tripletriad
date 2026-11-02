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
    if (id === 'menu') refreshProgress();
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
  const playCard = (c) => ({ id: c.id, name: c.name, level: c.level, r: c.ranks, el: c.element || null, img: c.image || null });
  const deckCard = (deckId, id) => (decks.get(deckId).cards.find((c) => c.id === Number(id)));

  // ---------- card rendering ----------
  function cardEl(card, side, glyphs) {
    const el = document.createElement('div');
    if (!card || card.hidden) {
      el.className = 'card back foil';
      const sh = document.createElement('div'); sh.className = 'glare-spot'; el.appendChild(sh);
      return el;
    }
    el.className = 'card foil ' + side;
    const art = document.createElement('div');
    art.className = 'art';
    if (card.img) art.style.backgroundImage = `url("${encodeURI(card.img)}")`;
    else {
      const h = hue(card.id);
      art.style.background = `radial-gradient(circle at 50% 45%, hsl(${h} 70% 62% / .9), hsl(${(h + 40) % 360} 60% 30% / .85) 70%)`;
      const s = document.createElement('div'); s.className = 'sigil'; s.textContent = initials(card.name); art.appendChild(s);
    }
    const foil = document.createElement('div'); foil.className = 'foil-layer'; art.appendChild(foil);
    const glare = document.createElement('div'); glare.className = 'glare-spot'; art.appendChild(glare);
    el.appendChild(art);
    const back = document.createElement('div'); back.className = 'flip-face'; el.appendChild(back);
    const ranks = document.createElement('div');
    ranks.className = 'ranks';
    ['t', 'r', 'b', 'l'].forEach((k, i) => { const s = document.createElement('span'); s.className = k; s.textContent = RANK(card.r[i]); ranks.appendChild(s); });
    el.appendChild(ranks);
    if (card.el) { const e = document.createElement('div'); e.className = 'el'; e.textContent = (glyphs || {})[card.el] || glyph(card.el); e.title = card.el; el.appendChild(e); }
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = card.name; el.appendChild(nm);
    el.title = `${card.name} — level ${card.level || '?'} — ${card.r.map(RANK).join(' / ')}${card.el ? ' (' + card.el + ')' : ''}`;
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
      if (elKey && !slot) { const e = document.createElement('div'); e.className = 'elem'; e.textContent = glyph(elKey) || '?'; cell.appendChild(e); }
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
  }

  // ---------- drag & drop (mouse and touch); a plain click still selects ----------
  function markDrops(on) {
    document.querySelectorAll('#board .cell').forEach((c, idx) => {
      if (!state.board[idx]) c.classList.toggle('can-drop', on || selected !== null);
    });
  }
  // Cancels an in-progress drag (set while dragging) — used by right-click and Escape.
  let cancelDrag = null;
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
      if (ev.buttons & 2) return cancel();   // right button pressed while dragging
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
  document.addEventListener('contextmenu', (e) => {
    if (document.querySelector('#game.active') && resetCard()) e.preventDefault();
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
    if (msg.wager) {
      $('#result-wager').hidden = false;
      const wc = $('#result-wager-cards'); wc.innerHTML = '';
      const id = msg.wager.won || msg.wager.lost;
      const c = deckCard(roomDeck, id);
      wc.appendChild(cardEl(playCard(c), msg.wager.won ? 'mine' : 'theirs', glyphsFor(roomDeck)));
      $('#result-wager-text').textContent = msg.wager.won ? `${c.name} joins your collection.` : `${names[1 - me]} took your ${c.name}.`;
      sfx(msg.wager.won ? 'wager-win' : 'wager-lose', { delay: 0.3 });
      if (msg.wager.refill && msg.wager.refill.length) $('#result-wager-text').textContent += ' You got a spare level-1 card so you still have a full hand.';
    }
  }
  function showWagerPick(options) {
    $('#result-wager').hidden = false;
    $('#result-wager-text').textContent = 'You won the wager — pick one of their cards to keep:';
    const wc = $('#result-wager-cards'); wc.innerHTML = '';
    options.forEach((id) => {
      const el = cardEl(playCard(deckCard(roomDeck, id)), 'theirs', glyphsFor(roomDeck));
      el.classList.add('pickable');
      el.onclick = () => {
        send({ t: 'wager', card: id });
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
    options.forEach((id) => wc.appendChild(cardEl(playCard(deckCard(roomDeck, id)), 'mine', glyphsFor(roomDeck))));
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
    Object.assign(builder, { mode: msg.mode, budget: msg.budget, cards: msg.cards, picked: [], locked: !!msg.done });
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
        const el = cardEl(playCard(deckCard(roomDeck, id)), 'mine', g);
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
      const el = cardEl(playCard(c), 'mine', g);
      const left = builder.cards[c.id] - builder.picked.filter((x) => x === c.id).length;
      if (canAdd(c.id)) { el.classList.add('pickable'); el.onclick = () => { builder.picked.push(c.id); sfx('place'); renderBuilder(); }; }
      else wrap.classList.add('unavailable');
      wrap.appendChild(el);
      const badge = document.createElement('span'); badge.className = 'count'; badge.textContent = `×${left}`; wrap.appendChild(badge);
      const lvb = document.createElement('span'); lvb.className = 'lvl'; lvb.textContent = `L${c.level}`; wrap.appendChild(lvb);
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
    $('#acct-guest').hidden = !!account;
    $('#acct-user').hidden = !account;
    $('#name-field').hidden = !!account;
    if (account) $('#acct-name').textContent = account.name;
    syncRuleOptions();
    refreshProgress();
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
    $('#col-xp-fill').style.width = `${((s.xpPerPack - s.nextPackIn) / s.xpPerPack) * 100}%`;
    $('#col-xp-text').textContent = `${s.xp} XP · next pack in ${s.nextPackIn} XP`;
    $('#col-owned').textContent = `${s.owned} of ${s.total} cards found`;
    $('#col-record').textContent = s.games ? `${s.wins} wins in ${s.games} games` : 'No games yet';
    const ob = $('#btn-open-pack');
    ob.disabled = s.packs < 1;
    ob.textContent = s.packs > 0 ? `Open pack (${s.packs})` : 'No packs yet';
    const grid = $('#col-grid'); grid.innerHTML = '';
    for (const c of deck.cards) {
      const wrap = document.createElement('div'); wrap.className = 'grid-card';
      const n = s.cards[c.id] || 0;
      if (n) {
        wrap.appendChild(cardEl(playCard(c), 'mine', deck.elements));
        if (n > 1) { const b = document.createElement('span'); b.className = 'count'; b.textContent = `×${n}`; wrap.appendChild(b); }
      } else {
        wrap.classList.add('locked');
        const back = document.createElement('div'); back.className = 'card back'; wrap.appendChild(back);
        const q = document.createElement('span'); q.className = 'unknown'; q.textContent = '?'; wrap.appendChild(q);
      }
      const lvb = document.createElement('span'); lvb.className = 'lvl'; lvb.textContent = `L${c.level}`; wrap.appendChild(lvb);
      grid.appendChild(wrap);
    }
  }
  let packDeck = null;
  // Step 1: show the sealed pack. Nothing is spent until it's torn open.
  function openPack(deckId) {
    packDeck = deckId;
    const deck = decks.get(deckId);
    applyTheme(deckId);
    const box = $('#pack-cards'); box.innerHTML = '';
    $('#pack-title').textContent = `${deck.name} pack`;
    const sealed = document.createElement('div');
    sealed.className = 'sealed foil';
    const src = `packs/${encodeURIComponent(deckId)}.svg`;
    sealed.style.setProperty('--pack-art', `url("${src}")`);
    for (const part of ['pack-body', 'pack-top']) {
      const d = document.createElement('div'); d.className = part;
      const img = document.createElement('img'); img.src = src; img.alt = part === 'pack-body' ? `${deck.name} card pack` : '';
      img.draggable = false;
      d.appendChild(img); sealed.appendChild(d);
    }
    const foil = document.createElement('div'); foil.className = 'foil-layer'; sealed.appendChild(foil);
    const glare = document.createElement('div'); glare.className = 'glare-spot'; sealed.appendChild(glare);
    const burst = document.createElement('div'); burst.className = 'pack-burst'; box.appendChild(burst);
    box.appendChild(sealed);
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
      sealed.remove(); burst.remove();
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
      const front = cardEl(playCard(c), 'mine', deck.elements); front.classList.add('face-front');
      inner.append(back, front);
      holder.appendChild(inner);
      if (pc.isNew) { const nb = document.createElement('span'); nb.className = 'new-badge'; nb.textContent = 'NEW'; holder.appendChild(nb); }
      const lv = document.createElement('span'); lv.className = 'lvl'; lv.textContent = `Level ${c.level}`; holder.appendChild(lv);
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
  }

  // ---------- wiring ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (b && !b.disabled && !b.classList.contains('music-btn') && !b.classList.contains('rule-info')) sfx('click');
  }, true);

  document.querySelectorAll('.rule-info').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const lab = b.closest('.rule'), open = !lab.classList.contains('tip-open');
      document.querySelectorAll('.rule.tip-open').forEach((l) => l.classList.remove('tip-open'));
      lab.classList.toggle('tip-open', open);
      if (!open) b.blur();
    });
  });
  // any click or tap outside an (i) button closes open tips, including clicks on checkboxes and dropdowns
  const closeTips = (e) => {
    if (e.target.closest && e.target.closest('.rule-info')) return;
    document.querySelectorAll('.rule.tip-open').forEach((l) => l.classList.remove('tip-open'));
    const f = document.activeElement;
    if (f && f.classList && f.classList.contains('rule-info')) f.blur();
  };
  document.addEventListener('pointerdown', closeTips, true);
  document.addEventListener('click', closeTips);
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
  $('#auth-form').addEventListener('submit', (e) => { e.preventDefault(); doAuth('login'); });
  $('#btn-auth-register').onclick = () => { if ($('#auth-form').reportValidity()) doAuth('register'); };
  $('#btn-auth-cancel').onclick = () => $('#auth').classList.remove('show');
  $('#btn-signout').onclick = async () => { try { await api('POST', '/api/logout', {}); } catch (e) { /* ignore */ } account = null; renderAccount(); toast('Signed out.'); };
  $('#btn-collection').onclick = () => openCollection($('#deck').value);
  $('#btn-packs').onclick = () => openPack($('#deck').value);
  $('#btn-col-back').onclick = () => show('menu');
  $('#col-deck').onchange = () => { chooseSet($('#col-deck').value); Music.play(musicFor($('#col-deck').value)); renderCollection(); refreshProgress(); };
  $('#btn-open-pack').onclick = () => openPack($('#col-deck').value);
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
