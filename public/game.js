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

  function normalizeRules(r) {
    r = r || {};
    return { open: r.open !== false, same: !!r.same, plus: !!r.plus, elemental: !!r.elemental };
  }

  function newGame(rules, rng, deck) {
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
    return {
      rules,
      board: Array(9).fill(null),
      elements,
      hands: dealHands(rng, deck),
      deck: { id: deck.id || null, name: deck.name || '' },
      glyphs: deck.elements || {},
      turn: rng() < 0.5 ? 0 : 1,
      over: false,
      winner: null,
    };
  }

  function elementMod(s, cell) {
    const e = s.elements[cell], slot = s.board[cell];
    if (!e || !slot) return 0;
    return slot.card.el === e ? 1 : -1;
  }
  const value = (s, cell, side) => s.board[cell].card.r[side] + elementMod(s, cell);

  function score(s) {
    const sc = [s.hands[0].length, s.hands[1].length];
    for (const slot of s.board) if (slot) sc[slot.owner]++;
    return sc;
  }

  function legalMoves(s) {
    if (s.over) return [];
    const moves = [];
    const hand = s.hands[s.turn];
    for (let h = 0; h < hand.length; h++)
      for (let c = 0; c < 9; c++) if (!s.board[c]) moves.push({ hand: h, cell: c });
    return moves;
  }

  function applyMove(s0, player, handIndex, cell) {
    if (s0.over) throw new Error('Game is over');
    if (player !== s0.turn) throw new Error('Not your turn');
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s0.board[cell]) throw new Error('Invalid cell');
    if (!Number.isInteger(handIndex) || !s0.hands[player][handIndex]) throw new Error('Invalid card');

    const s = clone(s0);
    const p = player;
    const card = s.hands[p].splice(handIndex, 1)[0];
    s.board[cell] = { card, owner: p };
    const events = [{ type: 'place', cell, player: p }];
    const flipped = new Set();
    const comboQueue = [];

    const flip = (n, by) => {
      if (s.board[n].owner === p || flipped.has(n)) return false;
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
        for (const x of m) if (flip(x.n, 'same')) comboQueue.push(x.n);
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
        for (const x of group) if (flip(x.n, 'plus')) comboQueue.push(x.n);
      }
    }
    // Basic captures (elemental modifiers apply).
    for (const x of nb) {
      if (s.board[x.n].owner !== p && value(s, cell, x.d) > value(s, x.n, opposite(x.d))) flip(x.n, 'basic');
    }
    // Combo: cards flipped by Same/Plus capture neighbours with basic rules, cascading.
    let comboAnnounced = false;
    while (comboQueue.length) {
      const c = comboQueue.shift();
      for (let d = 0; d < 4; d++) {
        const n = neighbor(c, d);
        if (n < 0 || !s.board[n] || s.board[n].owner === p) continue;
        if (value(s, c, d) > value(s, n, opposite(d))) {
          if (!comboAnnounced) { events.push({ type: 'rule', rule: 'combo' }); comboAnnounced = true; }
          if (flip(n, 'combo')) comboQueue.push(n);
        }
      }
    }

    s.turn = 1 - p;
    if (s.board.every(Boolean)) {
      s.over = true;
      const sc = score(s);
      s.winner = sc[0] === sc[1] ? 'draw' : sc[0] > sc[1] ? 0 : 1;
      events.push({ type: 'end', winner: s.winner, score: sc });
    }
    return { state: s, events };
  }

  // Hide the opponent's hand from a viewer when the Open rule is off.
  function redact(s, viewer) {
    const r = clone(s);
    if (!r.rules.open && !r.over) r.hands[1 - viewer] = r.hands[1 - viewer].map(() => ({ hidden: true }));
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

  return { setDeck, getDeck, newGame, applyMove, legalMoves, score, redact, chooseMove, normalizeRules, value, neighbor };
});
