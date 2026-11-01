'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const RANK = (n) => (n >= 10 ? 'A' : String(n));
  const RULE_NAMES = { open: 'Open', same: 'Same', plus: 'Plus', elemental: 'Elemental' };

  let mode = null;          // 'ai' | 'online'
  let state = null;
  let me = 0;
  let names = ['You', 'CPU'];
  let selected = null;
  let busy = false;
  let aiLevel = 'normal';
  let lastRules = null;
  let prevBoard = Array(9).fill(null);
  let ws = null, wsWanted = false, session = null;
  const decks = new Map();
  const glyph = (el) => (state && state.glyphs && state.glyphs[el]) || '';

  // ---------- screens & helpers ----------
  function musicFor(deckId) { const d = decks.get(deckId); return d && d.music ? { ...d.music, file: d.music.file } : null; }
  function show(id) {
    if (id === 'menu' && typeof Music !== 'undefined') Music.play(musicFor($('#deck').value));
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    $('#result').classList.remove('show');
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function banner(text) {
    const b = $('#banner'); b.textContent = text; b.classList.add('show');
    await sleep(750); b.classList.remove('show'); await sleep(200);
  }
  function readRules() {
    return { open: $('#r-open').checked, same: $('#r-same').checked, plus: $('#r-plus').checked, elemental: $('#r-elemental').checked };
  }
  function playerName() { return ($('#name').value || '').trim() || 'Player'; }
  function hue(id) { return (Number(id) * 47 + 200) % 360; }
  function initials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); }

  // ---------- card rendering ----------
  function cardEl(card, side) {
    const el = document.createElement('div');
    if (!card || card.hidden) { el.className = 'card back'; return el; }
    el.className = 'card ' + side;
    const art = document.createElement('div');
    art.className = 'art';
    if (card.img) art.style.backgroundImage = `url("${encodeURI(card.img)}")`;
    else {
      const h = hue(card.id);
      art.style.background = `radial-gradient(circle at 50% 45%, hsl(${h} 70% 62% / .9), hsl(${(h + 40) % 360} 60% 30% / .85) 70%)`;
      const s = document.createElement('div'); s.className = 'sigil'; s.textContent = initials(card.name); art.appendChild(s);
    }
    el.appendChild(art);
    const ranks = document.createElement('div');
    ranks.className = 'ranks';
    ['t', 'r', 'b', 'l'].forEach((k, i) => { const s = document.createElement('span'); s.className = k; s.textContent = RANK(card.r[i]); ranks.appendChild(s); });
    el.appendChild(ranks);
    if (card.el) { const e = document.createElement('div'); e.className = 'el'; e.textContent = glyph(card.el); e.title = card.el; el.appendChild(e); }
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = card.name; el.appendChild(nm);
    el.title = `${card.name} — ${card.r.map(RANK).join(' / ')}${card.el ? ' (' + card.el + ')' : ''}`;
    return el;
  }

  // ---------- render ----------
  function myTurn() { return state && !state.over && state.turn === me && !busy; }

  function render() {
    if (!state) return;
    if (typeof Music !== 'undefined' && state.deck) Music.play(musicFor(state.deck.id));
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
    $('#rules-label').textContent = (state.deck && state.deck.name ? state.deck.name + ' — ' : '') + (Object.keys(RULE_NAMES).filter((k) => state.rules[k]).map((k) => RULE_NAMES[k]).join(' · ') || 'Basic rules');

    // hands
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

    // board
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
        else if (prev.owner !== slot.owner) el.classList.add('flip');
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
  function startDrag(e, i, el) {
    if (!myTurn() || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, rect = el.getBoundingClientRect();
    const offX = sx - rect.left, offY = sy - rect.top;
    let ghost = null, over = null;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        ghost = el.cloneNode(true);
        ghost.classList.remove('selected', 'playable');
        ghost.classList.add('drag-ghost');
        ghost.style.width = rect.width + 'px'; ghost.style.height = rect.height + 'px';
        document.body.appendChild(ghost);
        el.classList.add('dragging');
        markDrops(true);
      }
      ghost.style.transform = `translate(${ev.clientX - offX}px, ${ev.clientY - offY}px) rotate(-3deg) scale(1.06)`;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const c = hit && hit.closest('#board .cell[data-cell]');
      const target = c && !state.board[Number(c.dataset.cell)] ? c : null;
      if (over !== target) { if (over) over.classList.remove('drop-over'); over = target; if (over) over.classList.add('drop-over'); }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (ghost) {
        ghost.remove();
        el.classList.remove('dragging');
        if (over && ev.type === 'pointerup' && myTurn()) { selected = i; playMove(i, Number(over.dataset.cell)); return; }
        render();
        return;
      }
      selected = selected === i ? null : i;
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  async function applyResult(newState, events) {
    state = newState;
    selected = null;
    render();
    for (const e of events) {
      if (e.type === 'rule') await banner({ same: 'Same!', plus: 'Plus!', combo: 'Combo!' }[e.rule]);
    }
    if (state.over) showResult();
  }

  function showResult() {
    const sc = TT.score(state);
    const w = state.winner;
    $('#result-title').textContent = w === 'draw' ? 'Draw' : w === me ? 'You win!' : 'You lose';
    $('#result-score').textContent = `${sc[me]} – ${sc[1 - me]}`;
    $('#result-note').textContent = '';
    $('#btn-rematch').disabled = false;
    setTimeout(() => $('#result').classList.add('show'), 500);
  }

  // ---------- moves ----------
  function playMove(hand, cell) {
    if (!myTurn()) return;
    if (mode === 'ai') {
      const r = TT.applyMove(state, me, hand, cell);
      busy = true;
      applyResult(r.state, r.events).then(() => { busy = false; maybeAI(); });
    } else if (mode === 'online') {
      busy = true; selected = null; render();
      send({ t: 'move', hand, cell });
    }
  }

  let aiRunning = false;
  async function maybeAI() {
    if (aiRunning) return;   // only one computer turn at a time
    if (mode !== 'ai' || !state || state.over || state.turn === me) { render(); return; }
    aiRunning = true;
    const game = state;
    busy = true; render();
    try {
      await sleep(650);
      if (mode !== 'ai' || !state || state !== game || state.over || state.turn === me) return;
      const m = TT.chooseMove(state, aiLevel);
      const r = TT.applyMove(state, state.turn, m.hand, m.cell);
      await applyResult(r.state, r.events);
    } catch (e) {
      console.error('AI turn failed', e);
    } finally {
      aiRunning = false;
      busy = false;
      render();
    }
  }

  function startAI() {
    mode = 'ai';
    aiLevel = $('#difficulty').value;
    lastRules = readRules();
    me = 0;
    names = [playerName(), `CPU (${aiLevel})`];
    state = TT.newGame(lastRules, undefined, decks.get($('#deck').value));
    prevBoard = Array(9).fill(null); selected = null; busy = false;
    show('game');
    render();
    banner(state.turn === me ? 'You start' : 'CPU starts').then(maybeAI);
  }

  // ---------- online ----------
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function connect(onOpen) {
    wsWanted = true;
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
    ws = null; session = null;
    try { sessionStorage.removeItem('triad-session'); } catch (e) { /* ignore */ }
  }

  function onMessage(msg) {
    switch (msg.t) {
      case 'room':
        session = { code: msg.code, token: msg.token };
        try { sessionStorage.setItem('triad-session', JSON.stringify(session)); } catch (e) { /* ignore */ }
        me = msg.you;
        if (!state || mode !== 'online') { $('#room-code').textContent = msg.code; show('lobby'); }
        mode = 'online';
        break;
      case 'state': {
        const fresh = !state || msg.events.some((e) => e.type === 'start');
        me = msg.you; names = msg.names;
        if (fresh) { prevBoard = Array(9).fill(null); $('#result').classList.remove('show'); }
        if (!document.querySelector('#game.active')) show('game');
        busy = false;
        applyResult(msg.state, msg.events).then(() => {
          if (fresh && msg.events.some((e) => e.type === 'start')) banner(state.turn === me ? 'You start' : `${names[1 - me]} starts`);
        });
        break;
      }
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
        disconnect(); state = null; show('menu');
        break;
      case 'error':
        busy = false; render();
        if (msg.fatal) { disconnect(); state = null; show('menu'); }
        if (document.querySelector('#menu.active')) $('#menu-error').textContent = msg.msg; else toast(msg.msg);
        break;
    }
  }

  // ---------- wiring ----------
  // rule tooltips: the (i) button toggles its tip (for touch screens); tapping elsewhere closes it
  document.querySelectorAll('.rule-info').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const lab = b.closest('.rule'), open = !lab.classList.contains('tip-open');
      document.querySelectorAll('.rule.tip-open').forEach((l) => l.classList.remove('tip-open'));
      lab.classList.toggle('tip-open', open);
      if (!open) b.blur();
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.rule-info')) document.querySelectorAll('.rule.tip-open').forEach((l) => l.classList.remove('tip-open'));
  });

  $('#btn-ai').onclick = startAI;
  $('#btn-create').onclick = () => {
    $('#menu-error').textContent = '';
    state = null; mode = 'online';
    connect(() => send({ t: 'create', name: playerName(), rules: readRules(), deck: $('#deck').value }));
  };
  $('#btn-join').onclick = () => {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length !== 4) { $('#menu-error').textContent = 'Enter the 4-letter room code.'; return; }
    $('#menu-error').textContent = '';
    state = null; mode = 'online';
    connect(() => send({ t: 'join', code, name: playerName() }));
  };
  $('#btn-copy').onclick = async () => {
    const link = `${location.origin}/?room=${$('#room-code').textContent}`;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch (e) { toast(link); }
  };
  $('#btn-cancel').onclick = () => { disconnect(); mode = null; show('menu'); };
  const toMenu = () => { if (mode === 'online') disconnect(); mode = null; state = null; show('menu'); };
  $('#btn-quit').onclick = toMenu;
  $('#btn-menu').onclick = toMenu;
  $('#btn-rematch').onclick = () => {
    if (mode === 'ai') { $('#result').classList.remove('show'); $('#r-open').checked = lastRules.open; startAI(); }
    else { send({ t: 'rematch' }); $('#btn-rematch').disabled = true; $('#result-note').textContent = 'Waiting for opponent…'; }
  };
  $('#name').addEventListener('change', () => { try { localStorage.setItem('triad-name', $('#name').value); } catch (e) { /* ignore */ } });

  // ---------- boot ----------
  async function loadDecks() {
    const index = await (await fetch('decks/index.json')).json();
    const sel = $('#deck');
    for (const f of index.decks) {
      const d = await (await fetch('decks/' + f)).json();
      d.id = d.id || f.replace(/\.json$/, '');
      decks.set(d.id, d);
      const o = document.createElement('option'); o.value = d.id; o.textContent = `${d.name} (${d.cards.length})`; sel.appendChild(o);
    }
    try { const saved = localStorage.getItem('triad-deck'); if (saved && decks.has(saved)) sel.value = saved; } catch (e) { /* ignore */ }
    const desc = () => { $('#deck-desc').textContent = (decks.get(sel.value) || {}).description || ''; };
    sel.onchange = () => { desc(); if (document.querySelector('#menu.active')) Music.play(musicFor(sel.value)); try { localStorage.setItem('triad-deck', sel.value); } catch (e) { /* ignore */ } };
    desc();
    if (document.querySelector('#menu.active')) Music.play(musicFor(sel.value));
  }

  fetch('version').then((r) => r.json()).then((v) => { $('#version').textContent = 'v' + v.version; }).catch(() => {});

  loadDecks().then(() => {
    try { $('#name').value = localStorage.getItem('triad-name') || ''; } catch (e) { /* ignore */ }
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
