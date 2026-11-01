'use strict';
/* Per-set collections, XP and card packs. */
const crypto = require('crypto');
const db = require('./db');

const XP = { play: 10, win: 25, draw: 5 };      // a win earns play + win = 35; a draw 15; a loss 10
const XP_PER_PACK = 100;
const PACK_SIZE = 3;
const LEVEL_WEIGHTS = { 1: 40, 2: 30, 3: 18, 4: 9, 5: 3 };
const STARTER = { 1: 4, 2: 2, 3: 1 };            // 7 cards: four level 1, two level 2, one level 3
const MIN_CARDS = 5;
const BUDGET = 15;

const rnd = (n) => crypto.randomInt(n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const byLevel = (deck, lvl) => deck.cards.filter((c) => c.level === lvl);

function weightedCard(deck) {
  const levels = Object.keys(LEVEL_WEIGHTS).map(Number).filter((l) => byLevel(deck, l).length);
  const total = levels.reduce((n, l) => n + LEVEL_WEIGHTS[l], 0);
  let r = rnd(total);
  for (const l of levels) {
    if ((r -= LEVEL_WEIGHTS[l]) < 0) { const pool = byLevel(deck, l); return pool[rnd(pool.length)]; }
  }
  return deck.cards[rnd(deck.cards.length)];
}

function ensureSet(user, deck) {
  if (!user.sets) user.sets = {};
  if (!user.sets[deck.id]) {
    const cards = {};
    for (const [lvl, n] of Object.entries(STARTER)) {
      for (const c of shuffle(byLevel(deck, Number(lvl)).slice()).slice(0, n)) cards[c.id] = (cards[c.id] || 0) + 1;
    }
    user.sets[deck.id] = { xp: 0, packsOpened: 0, games: 0, wins: 0, cards };
    topUp(user.sets[deck.id], deck);
    db.save();
  }
  return user.sets[deck.id];
}

function total(set) { return Object.values(set.cards).reduce((n, v) => n + v, 0); }
function topUp(set, deck) {
  const added = [];
  while (total(set) < MIN_CARDS) {
    const pool = byLevel(deck, 1).length ? byLevel(deck, 1) : deck.cards;
    const c = pool[rnd(pool.length)];
    set.cards[c.id] = (set.cards[c.id] || 0) + 1;
    added.push(c.id);
  }
  return added;
}

function packsAvailable(set) { return Math.floor(set.xp / XP_PER_PACK) - set.packsOpened; }

function summary(user, deck) {
  const set = ensureSet(user, deck);
  return {
    deck: deck.id, xp: set.xp, games: set.games, wins: set.wins, cards: set.cards,
    owned: Object.keys(set.cards).length, total: deck.cards.length,
    packs: packsAvailable(set), xpPerPack: XP_PER_PACK, nextPackIn: XP_PER_PACK - (set.xp % XP_PER_PACK),
  };
}

function openPack(user, deck) {
  const set = ensureSet(user, deck);
  if (packsAvailable(set) < 1) throw new Error('No packs to open yet — earn more XP in this set.');
  const got = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const c = weightedCard(deck);
    set.cards[c.id] = (set.cards[c.id] || 0) + 1;
    got.push({ id: c.id, isNew: set.cards[c.id] === 1 });
  }
  set.packsOpened++;
  db.save();
  return got;
}

// Throws unless `ids` is a legal 5-card hand from this user's collection for the given mode.
function validateHand(user, deck, ids, mode) {
  if (!Array.isArray(ids) || ids.length !== 5) throw new Error('Choose exactly 5 cards.');
  const set = ensureSet(user, deck);
  const need = {};
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isInteger(id) || !deck.cards.some((c) => c.id === id)) throw new Error('Unknown card.');
    need[id] = (need[id] || 0) + 1;
  }
  for (const [id, n] of Object.entries(need)) if ((set.cards[id] || 0) < n) throw new Error('You don’t own enough copies of a card in that hand.');
  if (mode === 'budget') {
    const lv = ids.reduce((n, id) => n + deck.cards.find((c) => c.id === Number(id)).level, 0);
    if (lv > BUDGET) throw new Error(`That hand is level ${lv}; the budget is ${BUDGET}.`);
  }
  return ids.map(Number);
}

function randomHand(user, deck) {
  const set = ensureSet(user, deck);
  const copies = [];
  for (const [id, n] of Object.entries(set.cards)) for (let i = 0; i < n; i++) copies.push(Number(id));
  return shuffle(copies).slice(0, 5);
}

// A computer hand whose level total is as close as possible to `target`.
function cpuHand(deck, target) {
  let best = null, bestDiff = Infinity;
  for (let i = 0; i < 400 && bestDiff > 0; i++) {
    const ids = Array.from({ length: 5 }, () => deck.cards[rnd(deck.cards.length)].id);
    const lv = ids.reduce((n, id) => n + deck.cards.find((c) => c.id === id).level, 0);
    const diff = Math.abs(lv - target);
    if (diff < bestDiff) { best = ids; bestDiff = diff; }
  }
  return best;
}

function handLevel(deck, ids) { return ids.reduce((n, id) => n + deck.cards.find((c) => c.id === id).level, 0); }

// Called once per finished match for each signed-in player.
function award(user, deck, result) {   // result: 'win' | 'loss' | 'draw'
  const set = ensureSet(user, deck);
  const before = packsAvailable(set);
  const gained = XP.play + (result === 'win' ? XP.win : result === 'draw' ? XP.draw : 0);
  set.xp += gained; set.games++; if (result === 'win') set.wins++;
  db.save();
  return { gained, xp: set.xp, packs: packsAvailable(set), newPacks: packsAvailable(set) - before, nextPackIn: XP_PER_PACK - (set.xp % XP_PER_PACK) };
}

function addCard(user, deck, id) {
  const set = ensureSet(user, deck);
  set.cards[id] = (set.cards[id] || 0) + 1;
  db.save();
}
// Removes one copy; tops the collection back up to the minimum with level-1 cards if needed.
function removeCard(user, deck, id) {
  const set = ensureSet(user, deck);
  if (!set.cards[id]) return [];
  if (--set.cards[id] <= 0) delete set.cards[id];
  const added = topUp(set, deck);
  db.save();
  return added;
}

module.exports = { XP, XP_PER_PACK, PACK_SIZE, BUDGET, ensureSet, summary, openPack, validateHand, randomHand, cpuHand, handLevel, award, addCard, removeCard };
