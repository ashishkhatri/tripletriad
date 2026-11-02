/* Shared game engine — runs in the browser (window.TT) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TOP = 0, RIGHT = 1, BOTTOM = 2, LEFT = 3;

  let DECK = { elements: {}, cards: [] };
  function setDeck(deck) {
    if (!deck || !Array.isArray(deck.cards)) throw new Error('Invalid deck');
    DECK = { id: deck.id, name: deck.name, elements: deck.elements || {}, cards: deck.cards };
  }
  function getDeck() { return DECK; }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function neighbor(cell, dir) {
    const row = Math.floor(cell / 3), col = cell % 3;
    if (dir === TOP) return row > 0 ? cell - 3 : -1;
    if (dir === RIGHT) return col < 2 ? cell + 1 : -1;
    if (dir === BOTTOM) return row < 2 ? cell + 3 : -1;
    return col > 0 ? cell - 1 : -1;
  }
  const opposite = (d) => (d + 2) % 4;

  function toPlayCard(c) {
    return { id: c.id, name: c.name, level: c.level, r: c.ranks.slice(0, 4), el: c.element || null, img: c.image || null };
  }

  // Balanced deal: each player gets one card from each level present in the deck.
  function dealHands(rng, deck) {
    const levels = [...new Set(deck.cards.map((c) => c.level))].sort((a, b) => a - b);
    const hands = [[], []];
    for (const lvl of levels) {
      const pool = shuffle(deck.cards.filter((c) => c.level === lvl), rng);
      hands[0].push(toPlayCard(pool[0]));
      hands[1].push(toPlayCard(pool[1 % pool.length]));
    }
    // Fill up to 5 if the deck has fewer than 5 levels.
    for (const h of hands) {
      while (h.length < 5) h.push(toPlayCard(deck.cards[Math.floor(rng() * deck.cards.length)]));
      h.length = 5;
    }
    return hands;
  }

  const HAND_MODES = ['balanced', 'random', 'build', 'budget'];
  const LEVEL_BUDGET = 15;
  function normalizeRules(r) {
    r = r || {};
    const handMode = HAND_MODES.includes(r.handMode) ? r.handMode : 'balanced';
    return {
      open: r.open !== false, same: !!r.same, plus: !!r.plus, elemental: !!r.elemental, storms: !!r.storms,
      handMode, wager: handMode !== 'balanced' && !!r.wager,
    };
  }
  function cardById(deck, id) { return (deck || DECK).cards.find((c) => c.id === id) || null; }
  function handLevel(deck, ids) { return ids.reduce((n, id) => n + ((cardById(deck, id) || {}).level || 0), 0); }

  // presetHands: optional [[cardId x5], [cardId x5]] chosen from collections.
  function newGame(rules, rng, deck, presetHands) {
    rng = rng || Math.random;
    deck = deck || DECK;
    rules = normalizeRules(rules);
    const elements = Array(9).fill(null);
    const elKeys = Object.keys(deck.elements || {});
    if (rules.elemental && elKeys.length) {
      const n = 1 + Math.floor(rng() * 3);
      const cells = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rng).slice(0, n);
      for (const c of cells) elements[c] = elKeys[Math.floor(rng() * elKeys.length)];
    }
    const hands = presetHands ? presetHands.map((ids) => ids.map((id) => toPlayCard(cardById(deck, id)))) : dealHands(rng, deck);
    return {
      rules,
      startHands: hands.map((h) => h.map((c) => c.id)),
      board: Array(9).fill(null),
      elements,
      hands,
      deck: { id: deck.id || null, name: deck.name || '' },
      glyphs: deck.elements || {},
      turn: rng() < 0.5 ? 0 : 1,
      over: false,
      winner: null,
      history: [],
      // Storms rule
      wards: [2, 2],
      boost: [0, 0],
      frost: Array(9).fill(0),
      storm: null,
      stormCooldown: 2,
    };
  }

  function elementMod(s, cell) {
    const e = s.elements[cell], slot = s.board[cell];
    if (!e || !slot) return 0;
    return slot.card.el === e ? 1 : -1;
  }
  const value = (s, cell, side) => s.board[cell].card.r[side] + elementMod(s, cell) + (s.board[cell].mod || 0);
  const frozen = (s, cell) => !!(s.frost && s.frost[cell] > 0);

  function score(s) {
    const sc = [s.hands[0].length, s.hands[1].length];
    for (const slot of s.board) if (slot) sc[slot.owner]++;
    return sc;
  }

  function legalMoves(s) {
    if (s.over) return [];
    const moves = [];
    const hand = s.hands[s.turn];
    const cells = openCells(s);
    for (let h = 0; h < hand.length; h++) for (const c of cells) moves.push({ hand: h, cell: c });
    return moves;
  }
  // Empty squares you may play on: frozen ones are closed unless nothing else is left.
  function openCells(s) {
    const empty = [];
    for (let c = 0; c < 9; c++) if (!s.board[c]) empty.push(c);
    const thawed = empty.filter((c) => !frozen(s, c));
    return thawed.length ? thawed : empty;
  }

  function applyMove(s0, player, handIndex, cell) {
    if (s0.over) throw new Error('Game is over');
    if (player !== s0.turn) throw new Error('Not your turn');
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s0.board[cell]) throw new Error('Invalid cell');
    if (s0.storm) throw new Error('A storm is striking — choose how to face it first');
    if (!openCells(s0).includes(cell)) throw new Error('That square is frozen');
    if (!Number.isInteger(handIndex) || !s0.hands[player][handIndex]) throw new Error('Invalid card');

    const s = clone(s0);
    const p = player;
    const card = s.hands[p].splice(handIndex, 1)[0];
    s.board[cell] = { card, owner: p };
    let boosted = false;
    if (s.boost && s.boost[p] > 0) { s.board[cell].mod = (s.board[cell].mod || 0) + s.boost[p]; s.boost[p] = 0; boosted = true; }
    const events = [{ type: 'place', cell, player: p }];
    const flipped = new Set();
    const comboQueue = [];
    // Move history: what was placed, every check that mattered and why each card flipped.
    const mod = (c) => elementMod(s, c);
    const steps = [];
    const log = { p, cell, card: clone(card), steps, owners: null, boosted };

    const flip = (n, by) => {
      if (s.board[n].owner === p || flipped.has(n) || frozen(s, n)) return false;
      s.board[n].owner = p;
      flipped.add(n);
      events.push({ type: 'flip', cell: n, by });
      return true;
    };

    const nb = [];
    for (let d = 0; d < 4; d++) {
      const n = neighbor(cell, d);
      if (n >= 0 && s.board[n]) {
        nb.push({ d, n, mine: card.r[d], theirs: s.board[n].card.r[opposite(d)] });
      }
    }

    // Same: 2+ adjacent sides equal (printed values). Flips opponent cards among them.
    if (s.rules.same) {
      const m = nb.filter((x) => x.mine === x.theirs);
      if (m.length >= 2 && m.some((x) => s.board[x.n].owner !== p)) {
        events.push({ type: 'rule', rule: 'same' });
        const pairs = m.map((x) => ({ n: x.n, d: x.d, a: x.mine, b: x.theirs, own: s.board[x.n].owner === p, flip: false }));
        m.forEach((x, i) => { if (flip(x.n, 'same')) { comboQueue.push(x.n); pairs[i].flip = true; } });
        steps.push({ k: 'same', pairs });
      }
    }
    // Plus: 2+ adjacent pairs with the same sum.
    if (s.rules.plus) {
      const sums = {};
      for (const x of nb) (sums[x.mine + x.theirs] = sums[x.mine + x.theirs] || []).push(x);
      let announced = false;
      for (const group of Object.values(sums)) {
        if (group.length < 2 || !group.some((x) => s.board[x.n].owner !== p)) continue;
        if (!announced) { events.push({ type: 'rule', rule: 'plus' }); announced = true; }
        const pairs = group.map((x) => ({ n: x.n, d: x.d, a: x.mine, b: x.theirs, own: s.board[x.n].owner === p, flip: false }));
        group.forEach((x, i) => { if (flip(x.n, 'plus')) { comboQueue.push(x.n); pairs[i].flip = true; } });
        steps.push({ k: 'plus', sum: group[0].mine + group[0].theirs, pairs });
      }
    }
    // Basic captures (elemental modifiers apply).
    for (const x of nb) {
      if (s.board[x.n].owner === p) continue;
      const a = value(s, cell, x.d), b = value(s, x.n, opposite(x.d)), won = a > b;
      const ice = won && frozen(s, x.n);
      if (won) flip(x.n, 'basic');
      steps.push({ k: 'basic', from: cell, n: x.n, d: x.d, a, b, am: mod(cell) + (s.board[cell].mod || 0), bm: mod(x.n) + (s.board[x.n].mod || 0), flip: won && !ice, ice });
    }
    // Combo: cards flipped by Same/Plus capture neighbours with basic rules, cascading.
    let comboAnnounced = false;
    while (comboQueue.length) {
      const c = comboQueue.shift();
      for (let d = 0; d < 4; d++) {
        const n = neighbor(c, d);
        if (n < 0 || !s.board[n] || s.board[n].owner === p || frozen(s, n)) continue;
        if (value(s, c, d) > value(s, n, opposite(d))) {
          if (!comboAnnounced) { events.push({ type: 'rule', rule: 'combo' }); comboAnnounced = true; }
          if (flip(n, 'combo')) {
            comboQueue.push(n);
            steps.push({ k: 'combo', from: c, n, d, a: value(s, c, d), b: value(s, n, opposite(d)), am: mod(c) + (s.board[c].mod || 0), bm: mod(n) + (s.board[n].mod || 0), flip: true });
          }
        }
      }
    }

    log.owners = s.board.map((x) => (x ? x.owner : null));
    log.mod = mod(cell);
    if (s.frost) s.frost = s.frost.map((f) => Math.max(0, f - 1));
    log.snap = snap(s);
    s.history = (s.history || []).concat([log]);

    s.turn = 1 - p;
    if (s.board.every(Boolean)) {
      s.over = true;
      const sc = score(s);
      s.winner = sc[0] === sc[1] ? 'draw' : sc[0] > sc[1] ? 0 : 1;
      events.push({ type: 'end', winner: s.winner, score: sc });
    }
    return { state: s, events };
  }

  // Board picture for the move history (cards can move, spin and change under Storms).
  function snap(s) {
    return s.board.map((x, i) => (x ? { card: { id: x.card.id, name: x.card.name, level: x.card.level, r: x.card.r.slice(), el: x.card.el, img: x.card.img }, o: x.owner, m: x.mod || 0, f: s.frost ? s.frost[i] : 0 } : (s.frost && s.frost[i] ? { f: s.frost[i] } : null)));
  }

  // ---------- Storms ----------
  // Between moves a storm may strike the board. The player about to move is dealt 2–3 response
  // cards and picks how to face it. Everything here is deterministic given storm.seed.
  const STORMS = {
    fire:      { name: 'Wildfire',     el: 'fire',    weight: 3, text: 'Scorches a card: −1 to every side for the rest of the match.' },
    tide:      { name: 'Tidal Surge',  el: 'water',   weight: 2, text: 'Pushes a row or column along; moved cards attack their new neighbours.' },
    wind:      { name: 'Cyclone',      el: 'wind',    weight: 2, text: 'Spins a card a quarter turn clockwise (its top number moves to the right side, and so on); it then attacks with its new sides.' },
    lightning: { name: 'Thunderbolt',  el: 'thunder', weight: 2, text: 'Strikes a card and flips it to the other side.' },
    frost:     { name: 'Blizzard',     el: 'ice',     weight: 2, text: 'Freezes a square for two turns: no placing there, and a card on it can’t be flipped.' },
    quake:     { name: 'Earthquake',   el: 'earth',   weight: 2, text: 'Swaps two neighbouring cards; both attack their new neighbours.' },
    dragon:    { name: 'Dragon Flight', el: 'fire',   weight: 1, text: 'A dragon sweeps across a line of the board, flipping every card beneath it.' },
  };
  const RESPONSES = {
    ward:    { name: 'Ward',        text: 'Block the storm completely. Uses one of your Wards.' },
    deflect: { name: 'Deflect',     text: 'Turn the storm onto the spot that hurts your opponent most.' },
    brace:   { name: 'Brace',       text: 'Let it hit, but none of your cards can be flipped or weakened by it.' },
    harness: { name: 'Harness',     text: 'Let it hit, and your next card gets +1 on every side.' },
    weather: { name: 'Weather it',  text: 'Take the hit as it comes and gain a Ward (max 3).' },
    defy:    { name: 'Defy fate',   text: 'A different storm strikes instead, somewhere random. No more choices.' },
  };
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  function slideLine(s, line, dir) {   // dir +1: toward line end, -1: toward start. Returns [{from,to}]
    const cells = dir > 0 ? line.slice().reverse() : line.slice();
    const moves = [];
    let free = 0;   // index in `cells` of the next landing spot
    for (let k = 0; k < cells.length; k++) {
      if (!s.board[cells[k]]) continue;
      if (frozen(s, cells[k])) { free = k + 1; continue; }   // frozen cards stay put and block
      if (k !== free) moves.push({ from: cells[k], to: cells[free] });
      free++;
    }
    return moves;
  }
  function stormTargets(s, kind) {
    const occ = [], all = [];
    for (let c = 0; c < 9; c++) { all.push(c); if (s.board[c]) occ.push(c); }
    switch (kind) {
      case 'fire': case 'wind': return occ.map((c) => ({ cell: c }));
      case 'lightning': return occ.filter((c) => !frozen(s, c)).map((c) => ({ cell: c }));
      case 'frost': return all.filter((c) => !frozen(s, c)).map((c) => ({ cell: c }));
      case 'quake': {
        const out = [];
        for (const a of occ) for (const d of [RIGHT, BOTTOM]) { const b = neighbor(a, d); if (b >= 0 && s.board[b] && !frozen(s, a) && !frozen(s, b)) out.push({ a, b }); }
        return out;
      }
      case 'tide': {
        const out = [];
        LINES.slice(0, 6).forEach((line, i) => [1, -1].forEach((dir) => { if (slideLine(s, line, dir).length) out.push({ line: i, dir }); }));
        return out;
      }
      case 'dragon': return LINES.map((line, i) => ({ line: i, dir: 1 })).filter((t) => LINES[t.line].some((c) => s.board[c])).flatMap((t) => [t, { line: t.line, dir: -1 }]);
    }
    return [];
  }
  // Cells a storm target touches (for highlighting).
  function stormCells(kind, t) {
    if (!t) return [];
    if (t.cell !== undefined) return [t.cell];
    if (t.a !== undefined) return [t.a, t.b];
    if (t.line !== undefined) return t.dir > 0 ? LINES[t.line].slice() : LINES[t.line].slice().reverse();
    return [];
  }
  function pickWeighted(items, rng) {
    const total = items.reduce((n, x) => n + x.w, 0);
    let r = rng() * total;
    for (const x of items) { if ((r -= x.w) < 0) return x.v; }
    return items[items.length - 1].v;
  }
  function randomStorm(s, rng, exclude) {
    const kinds = Object.keys(STORMS).filter((k) => k !== exclude && stormTargets(s, k).length);
    if (!kinds.length) return null;
    const kind = pickWeighted(kinds.map((k) => ({ v: k, w: STORMS[k].weight })), rng);
    const ts = stormTargets(s, kind);
    return { kind, target: ts[Math.floor(rng() * ts.length)] };
  }
  // Called by the server after each move. May set s.storm (a pending choice).
  function rollStorm(s0, rng, chance) {
    rng = rng || Math.random;
    if (!s0.rules.storms || s0.over || s0.storm) return s0;
    const s = clone(s0);
    const placed = s.board.filter(Boolean).length;
    if (s.stormCooldown > 0) { s.stormCooldown--; return s; }
    if (placed < 2 || rng() >= (chance === undefined ? 0.4 : chance)) return s;
    const st = randomStorm(s, rng);
    if (!st) return s;
    const chooser = s.turn;
    const pool = ['deflect', 'brace', 'harness', 'defy'];
    if (s.wards[chooser] < 3) pool.push('weather');
    if (stormTargets(s, st.kind).length < 2) pool.splice(pool.indexOf('deflect'), 1);
    const opts = [];
    if (s.wards[chooser] > 0 && rng() < 0.6) opts.push('ward');
    const shuffled = shuffle(pool.slice(), rng);
    while (opts.length < 3 && shuffled.length) opts.push(shuffled.shift());
    s.storm = { kind: st.kind, target: st.target, cells: stormCells(st.kind, st.target), chooser, options: shuffle(opts, rng), seed: Math.floor(rng() * 2 ** 31) };
    return s;
  }

  // Applies one strike. protect: seat whose cards can't be flipped or weakened (Brace).
  function strike(s, kind, t, protect, steps, events) {
    const safe = (c) => protect !== null && protect !== undefined && s.board[c] && s.board[c].owner === protect;
    const immune = (c) => s.board[c] && s.board[c].card.el && s.board[c].card.el === STORMS[kind].el;
    const turnTo = (c, o, by, why) => {
      if (!s.board[c] || s.board[c].owner === o) return false;
      if (frozen(s, c)) { steps.push({ k: 'sx', why: 'frozen', n: c }); return false; }
      if (safe(c)) { steps.push({ k: 'sx', why: 'braced', n: c }); return false; }
      s.board[c].owner = o;
      events.push({ type: 'flip', cell: c, by: 'storm' });
      if (why) steps.push(why);
      return true;
    };
    // a card that moved or spun attacks its neighbours with the basic rule
    const attack = (c) => {
      const o = s.board[c].owner;
      for (let d = 0; d < 4; d++) {
        const n = neighbor(c, d);
        if (n < 0 || !s.board[n] || s.board[n].owner === o) continue;
        const a = value(s, c, d), b = value(s, n, opposite(d));
        if (a > b) turnTo(n, o, 'storm', { k: 'scap', from: c, n, d, a, b, flip: true });
      }
    };
    if (kind === 'fire' || kind === 'lightning' || kind === 'wind') {
      const c = t.cell;
      if (immune(c)) { steps.push({ k: 'sx', why: 'immune', n: c }); return; }
      if (kind === 'fire') {
        if (safe(c)) { steps.push({ k: 'sx', why: 'braced', n: c }); return; }
        s.board[c].mod = (s.board[c].mod || 0) - 1;
        events.push({ type: 'scorch', cell: c });
        steps.push({ k: 'scorch', n: c });
      } else if (kind === 'lightning') {
        turnTo(c, 1 - s.board[c].owner, 'storm', { k: 'bolt', n: c });
      } else {
        const r = s.board[c].card.r;
        s.board[c].card.r = [r[3], r[0], r[1], r[2]];
        events.push({ type: 'spin', cell: c });
        steps.push({ k: 'spin', n: c });
        attack(c);
      }
    } else if (kind === 'frost') {
      s.frost[t.cell] = 2;
      events.push({ type: 'freeze', cell: t.cell });
      steps.push({ k: 'freeze', n: t.cell });
    } else if (kind === 'quake') {
      const A = s.board[t.a]; s.board[t.a] = s.board[t.b]; s.board[t.b] = A;
      events.push({ type: 'shift', from: t.a, to: t.b }, { type: 'shift', from: t.b, to: t.a });
      steps.push({ k: 'swap', a: t.a, b: t.b });
      attack(t.a); if (s.board[t.b]) attack(t.b);
    } else if (kind === 'tide') {
      const mv = slideLine(s, LINES[t.line], t.dir);
      const moved = mv.map((m) => ({ ...m, slot: s.board[m.from] }));
      for (const m of moved) s.board[m.from] = null;
      for (const m of moved) s.board[m.to] = m.slot;
      for (const m of mv) events.push({ type: 'shift', from: m.from, to: m.to });
      steps.push({ k: 'tide', moves: mv });
      for (const m of mv) if (s.board[m.to]) attack(m.to);
    } else if (kind === 'dragon') {
      const path = stormCells(kind, t);
      steps.push({ k: 'dragon', path });
      for (const c of path) {
        if (!s.board[c]) continue;
        if (immune(c)) { steps.push({ k: 'sx', why: 'immune', n: c }); continue; }
        turnTo(c, 1 - s.board[c].owner, 'storm', { k: 'burn', n: c });
      }
    }
  }

  function resolveStorm(s0, seat, choice) {
    const st = s0.storm;
    if (!st) throw new Error('No storm to face');
    if (seat !== st.chooser) throw new Error('Your opponent is facing this storm');
    if (!st.options.includes(choice)) throw new Error('Not one of your choices');
    const s = clone(s0);
    const rng = mulberry(st.seed);
    const steps = [], events = [{ type: 'storm', kind: st.kind, choice, chooser: seat }];
    let kind = st.kind, target = st.target, protect = null;
    if (choice === 'ward') { s.wards[seat]--; steps.push({ k: 'warded' }); }
    else {
      if (choice === 'weather') { s.wards[seat] = Math.min(3, s.wards[seat] + 1); steps.push({ k: 'gain-ward' }); }
      if (choice === 'harness') { s.boost[seat] = (s.boost[seat] || 0) + 1; steps.push({ k: 'boost' }); }
      if (choice === 'brace') protect = seat;
      if (choice === 'deflect') {
        let best = -Infinity;
        for (const t of stormTargets(s, kind)) {
          const tmp = clone(s); strike(tmp, kind, t, null, [], []);
          const v = evaluate(tmp, seat) + rng() * 1e-6;
          if (v > best) { best = v; target = t; }
        }
        steps.push({ k: 'deflected' });
      }
      if (choice === 'defy') {
        const other = randomStorm(s, rng, kind);
        if (other) { kind = other.kind; target = other.target; steps.push({ k: 'defied', kind }); }
      }
      events.push({ type: 'strike', kind, cells: stormCells(kind, target), target });
      strike(s, kind, target, protect, steps, events);
    }
    s.storm = null;
    s.stormCooldown = 1;
    s.history = (s.history || []).concat([{ storm: true, kind, original: st.kind, choice, p: seat, target, cells: stormCells(kind, target), steps, before: snap(s0), snap: snap(s), owners: s.board.map((x) => (x ? x.owner : null)) }]);
    return { state: s, events };
  }

  // Computer's pick: simulate each response (Defy is unknowable, so it counts as neutral).
  function chooseStormResponse(s, level, rng) {
    rng = rng || Math.random;
    const st = s.storm, seat = st.chooser;
    if (level === 'easy' && rng() < 0.5) return st.options[Math.floor(rng() * st.options.length)];
    const base = evaluate(s, seat);
    let best = null, bestV = -Infinity;
    for (const o of st.options) {
      let v;
      if (o === 'defy') v = base - 1;
      else {
        v = evaluate(resolveStorm(s, seat, o).state, seat);
        if (o === 'ward') v -= 3;
        if (o === 'weather') v += 5;
        if (o === 'harness') v += 4;
      }
      if (v > bestV) { bestV = v; best = o; }
    }
    return best;
  }

  // Hide the opponent's hand from a viewer when the Open rule is off.
  function redact(s, viewer) {
    const r = clone(s);
    if (!r.rules.open && !r.over) r.hands[1 - viewer] = r.hands[1 - viewer].map(() => ({ hidden: true }));
    if (!r.rules.open && !r.over && r.startHands) r.startHands[1 - viewer] = null;
    return r;
  }

  // ---------- AI ----------
  function evaluate(s, p) {
    const sc = score(s);
    if (s.over) return (sc[p] - sc[1 - p]) * 100;
    let v = (sc[p] - sc[1 - p]) * 10;
    for (let i = 0; i < 9; i++) {
      const slot = s.board[i];
      if (!slot) continue;
      for (let d = 0; d < 4; d++) {
        const n = neighbor(i, d);
        if (n >= 0 && !s.board[n]) v += (slot.owner === p ? 1 : -1) * (value(s, i, d) - 5.5) * 0.4;
      }
    }
    return v;
  }

  function chooseMove(s, level, rng) {
    rng = rng || Math.random;
    s = Object.assign({}, s, { history: [] });   // keeps the search's state copies small
    const p = s.turn;
    const moves = legalMoves(s);
    if (!moves.length) return null;
    if (level === 'easy' && rng() < 0.6) return moves[Math.floor(rng() * moves.length)];

    const lookahead = level === 'hard' && s.rules.open; // never peeks at a hidden hand
    let best = -Infinity, bestMoves = [];
    for (const m of moves) {
      const ns = applyMove(s, p, m.hand, m.cell).state;
      let v;
      if (lookahead && !ns.over) {
        v = Infinity;
        for (const m2 of legalMoves(ns)) {
          v = Math.min(v, evaluate(applyMove(ns, 1 - p, m2.hand, m2.cell).state, p));
        }
      } else {
        v = evaluate(ns, p);
      }
      if (v > best + 1e-9) { best = v; bestMoves = [m]; }
      else if (Math.abs(v - best) < 1e-9) bestMoves.push(m);
    }
    return bestMoves[Math.floor(rng() * bestMoves.length)];
  }

  return { HAND_MODES, LEVEL_BUDGET, cardById, handLevel, setDeck, getDeck, newGame, applyMove, legalMoves, score, redact, chooseMove, normalizeRules, value, neighbor, openCells, STORMS, RESPONSES, rollStorm, resolveStorm, chooseStormResponse, stormCells };
});
