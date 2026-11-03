'use strict';
/* Per-set collections (normal + foil copies), account-wide XP and card packs, and the shard economy (scrap / craft). */
const crypto = require('crypto');
const db = require('./db');

const XP = { play: 10, win: 25, draw: 13 };     // a win earns play + win = 35; a loss 10; a draw 23 (halfway, rounded up)
const XP_PER_PACK = 100;
const PACK_SIZE = 6;                             // 5 random cards + 1 guaranteed foil
const FOIL_CHANCE = 1 / 30;                      // each of the 5 random cards: about one extra foil every 6 packs
const LEVEL_WEIGHTS = { 1: 40, 2: 30, 3: 18, 4: 9, 5: 3 };
const STARTER = { 1: 4, 2: 2, 3: 1 };            // 7 cards: four level 1, two level 2, one level 3
const MIN_CARDS = 5;
const BUDGET = 15;
// Shards: scrapping gives SCRAP[level], crafting costs CRAFT[level]; foil copies are worth FOIL_MULT times as much.
const SCRAP = { 1: 5, 2: 10, 3: 25, 4: 60, 5: 150 };
const CRAFT = { 1: 40, 2: 80, 3: 200, 4: 500, 5: 1200 };
const FOIL_MULT = 4;

const rnd = (n) => crypto.randomInt(n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const byLevel = (deck, lvl) => deck.cards.filter((c) => c.level === lvl);
const cardOf = (deck, id) => deck.cards.find((c) => c.id === Number(id));
const scrapValue = (lvl, foil) => (SCRAP[lvl] || 5) * (foil ? FOIL_MULT : 1);
const craftCost = (lvl, foil) => (CRAFT[lvl] || 40) * (foil ? FOIL_MULT : 1);

const RARE_GUARANTEE = 3;   // every pack has at least one card of this level or higher
function weightedCard(deck, minLevel = 1) {
  const levels = Object.keys(LEVEL_WEIGHTS).map(Number).filter((l) => l >= minLevel && byLevel(deck, l).length);
  const total = levels.reduce((n, l) => n + LEVEL_WEIGHTS[l], 0);
  let r = rnd(total);
  for (const l of levels) {
    if ((r -= LEVEL_WEIGHTS[l]) < 0) { const pool = byLevel(deck, l); return pool[rnd(pool.length)]; }
  }
  return deck.cards[rnd(deck.cards.length)];
}

function shardsOf(user) { if (typeof user.shards !== 'number') user.shards = 0; return user.shards; }

function ensureSet(user, deck) {
  if (!user.sets) user.sets = {};
  if (!user.sets[deck.id]) {
    const cards = {};
    for (const [lvl, n] of Object.entries(STARTER)) {
      for (const c of shuffle(byLevel(deck, Number(lvl)).slice()).slice(0, n)) cards[c.id] = (cards[c.id] || 0) + 1;
    }
    user.sets[deck.id] = { xp: 0, packsOpened: 0, games: 0, wins: 0, cards, foils: {} };
    topUp(user.sets[deck.id], deck);
    db.save();
  }
  const set = user.sets[deck.id];
  if (!set.foils) set.foils = {};          // collections from before foils existed: every copy is normal
  return set;
}

const owned = (set, id) => (set.cards[id] || 0) + (set.foils[id] || 0);
function total(set) { return Object.values(set.cards).reduce((n, v) => n + v, 0) + Object.values(set.foils || {}).reduce((n, v) => n + v, 0); }
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
function inc(map, id, n = 1) { map[id] = (map[id] || 0) + n; if (map[id] <= 0) delete map[id]; }

// XP and packs belong to the account, not to a set: every 100 XP earns one pack, which you can open from any set.
function acct(user) {
  if (typeof user.xp !== 'number') {        // older accounts kept XP per set: add it all up once
    const sets = Object.values(user.sets || {});
    user.xp = sets.reduce((n, s) => n + (s.xp || 0), 0);
    user.packsOpened = sets.reduce((n, s) => n + (s.packsOpened || 0), 0);
    db.save();
  }
  if (typeof user.packsOpened !== 'number') user.packsOpened = 0;
  return user;
}
// packs = one per 100 XP, plus any won as level rewards, minus the ones opened
function packsAvailable(user) { acct(user); return Math.max(0, Math.floor(user.xp / XP_PER_PACK) + (user.bonusPacks || 0) - user.packsOpened); }
const nextPackIn = (user) => XP_PER_PACK - (acct(user).xp % XP_PER_PACK);

function summary(user, deck) {
  const set = ensureSet(user, deck);
  const ownedIds = new Set([...Object.keys(set.cards), ...Object.keys(set.foils)]);
  return {
    deck: deck.id, xp: acct(user).xp, games: set.games, wins: set.wins, cards: set.cards, foils: set.foils,
    owned: ownedIds.size, total: deck.cards.length, copies: total(set), minCards: MIN_CARDS,
    packs: packsAvailable(user), xpPerPack: XP_PER_PACK, nextPackIn: nextPackIn(user),
    shards: shardsOf(user), scrap: SCRAP, craft: CRAFT, foilMult: FOIL_MULT,
  };
}

function openPack(user, deck) {
  const set = ensureSet(user, deck);
  if (packsAvailable(user) < 1) throw new Error('No packs to open yet — earn more XP by playing.');
  // one guaranteed foil, the rest foil once in a while
  const pulls = [];
  for (let i = 0; i < PACK_SIZE; i++) pulls.push({ c: weightedCard(deck), foil: i === 0 || crypto.randomInt(3000) < FOIL_CHANCE * 3000 });
  // every pack has at least one Rare or better: if none came up, re-roll one random card from Rare and up
  if (!pulls.some((p) => p.c.level >= RARE_GUARANTEE)) pulls[rnd(PACK_SIZE)].c = weightedCard(deck, RARE_GUARANTEE);
  // shuffle so the order gives nothing away (not sorted by rarity, foil not always last)
  for (let i = pulls.length - 1; i > 0; i--) { const j = rnd(i + 1); [pulls[i], pulls[j]] = [pulls[j], pulls[i]]; }
  const got = [];
  for (const { c, foil } of pulls) {
    const isNew = owned(set, c.id) === 0;
    inc(foil ? set.foils : set.cards, c.id);
    got.push({ id: c.id, foil, isNew, copies: owned(set, c.id), scrap: scrapValue(c.level, foil) });
  }
  set.packsOpened = (set.packsOpened || 0) + 1;   // per-set count kept for stats only
  user.packsOpened++;
  db.save();
  return got;
}

// Throws unless `ids` is a legal 5-card hand from this user's collection for the given mode.
// Returns { ids, foils } where foils[i] says whether that card is played as a foil copy.
function validateHand(user, deck, ids, mode) {
  if (!Array.isArray(ids) || ids.length !== 5) throw new Error('Choose exactly 5 cards.');
  const set = ensureSet(user, deck);
  const need = {};
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isInteger(id) || !cardOf(deck, id)) throw new Error('Unknown card.');
    need[id] = (need[id] || 0) + 1;
  }
  for (const [id, n] of Object.entries(need)) if (owned(set, id) < n) throw new Error('You don’t own enough copies of a card in that hand.');
  if (mode === 'budget') {
    const lv = ids.reduce((n, id) => n + cardOf(deck, id).level, 0);
    if (lv > BUDGET) throw new Error(`That hand is level ${lv}; the budget is ${BUDGET}.`);
  }
  return withFoils(set, ids.map(Number));
}
// Show your best copies: the first copies of each card in a hand are your foils, if you have them.
function withFoils(set, ids) {
  const used = {};
  const foils = ids.map((id) => { used[id] = (used[id] || 0) + 1; return used[id] <= (set.foils[id] || 0); });
  return { ids, foils };
}

function randomHand(user, deck) {
  const set = ensureSet(user, deck);
  const copies = [];
  for (const [id, n] of Object.entries(set.cards)) for (let i = 0; i < n; i++) copies.push(Number(id));
  for (const [id, n] of Object.entries(set.foils)) for (let i = 0; i < n; i++) copies.push(Number(id));
  return withFoils(set, shuffle(copies).slice(0, 5));
}

// A computer hand whose level total is as close as possible to `target`.
function cpuHand(deck, target) {
  let best = null, bestDiff = Infinity;
  for (let i = 0; i < 400 && bestDiff > 0; i++) {
    const ids = Array.from({ length: 5 }, () => deck.cards[rnd(deck.cards.length)].id);
    const lv = ids.reduce((n, id) => n + cardOf(deck, id).level, 0);
    const diff = Math.abs(lv - target);
    if (diff < bestDiff) { best = ids; bestDiff = diff; }
  }
  return best;
}

function handLevel(deck, ids) { return ids.reduce((n, id) => n + cardOf(deck, id).level, 0); }

// Called once per finished match for each signed-in player.
// Big wins pay more: the whole match XP is multiplied by how lopsided the final score was (out of 10 cards).
const WIN_BONUS = { 7: 1.2, 8: 1.5, 9: 2, 10: 2 };
const winMultiplier = (myScore) => WIN_BONUS[myScore] || 1;
function award(user, deck, result, myScore = 0) {   // result: 'win' | 'loss' | 'draw'
  const set = ensureSet(user, deck);
  const before = packsAvailable(user);
  const base = XP.play + (result === 'win' ? XP.win : result === 'draw' ? XP.draw : 0);
  const mult = result === 'win' ? winMultiplier(myScore) : 1;
  const gained = Math.round(base * mult);
  user.xp += gained; set.games++; if (result === 'win') set.wins++;
  db.save();
  return { gained, base, mult, xp: user.xp, packs: packsAvailable(user), newPacks: packsAvailable(user) - before, nextPackIn: nextPackIn(user) };
}

function addCard(user, deck, id, foil = false) {
  const set = ensureSet(user, deck);
  inc(foil ? set.foils : set.cards, id);
  db.save();
}
// Removes one copy (the given variant if they have it); tops the collection back up to the minimum if needed.
function removeCard(user, deck, id, foil = false) {
  const set = ensureSet(user, deck);
  let from = foil ? set.foils : set.cards;
  if (!from[id]) from = foil ? set.cards : set.foils;
  if (!from[id]) return { removed: false, refill: [] };
  const wasFoil = from === set.foils;
  inc(from, id, -1);
  const refill = topUp(set, deck);
  db.save();
  return { removed: true, foil: wasFoil, refill };
}

// ---- shards ----
function scrap(user, deck, id, foil, count = 1) {
  const set = ensureSet(user, deck);
  const c = cardOf(deck, id);
  if (!c) throw new Error('Unknown card.');
  count = Math.max(1, Math.min(99, Math.floor(Number(count) || 1)));
  const map = foil ? set.foils : set.cards;
  if ((map[c.id] || 0) < count) throw new Error(`You don’t have ${count > 1 ? 'that many' : 'a'} ${foil ? 'foil ' : ''}${c.name} to scrap.`);
  if (total(set) - count < MIN_CARDS) throw new Error(`You need at least ${MIN_CARDS} cards in a set to play, so you can’t scrap that.`);
  inc(map, c.id, -count);
  const gained = scrapValue(c.level, foil) * count;
  user.shards = shardsOf(user) + gained;
  db.save();
  return { gained, shards: user.shards };
}
// Scraps everything beyond one normal and one foil copy of each card.
function extrasOf(set, deck) {
  const list = [];
  for (const foil of [false, true]) {
    const map = foil ? set.foils : set.cards;
    for (const [id, n] of Object.entries(map)) if (n > 1) list.push({ id: Number(id), foil, count: n - 1, value: scrapValue(cardOf(deck, id).level, foil) * (n - 1) });
  }
  return list;
}
function scrapExtras(user, deck) {
  const set = ensureSet(user, deck);
  const list = extrasOf(set, deck);
  let gained = 0, count = 0;
  for (const x of list) { inc(x.foil ? set.foils : set.cards, x.id, -x.count); gained += x.value; count += x.count; }
  user.shards = shardsOf(user) + gained;
  db.save();
  return { gained, count, shards: user.shards };
}
function craft(user, deck, id, foil) {
  const set = ensureSet(user, deck);
  const c = cardOf(deck, id);
  if (!c) throw new Error('Unknown card.');
  const cost = craftCost(c.level, foil);
  if (shardsOf(user) < cost) throw new Error(`Crafting ${foil ? 'a foil ' : ''}${c.name} costs ${cost} shards; you have ${user.shards}.`);
  user.shards -= cost;
  inc(foil ? set.foils : set.cards, c.id);
  db.save();
  return { cost, shards: user.shards };
}
function addShards(user, n) { user.shards = shardsOf(user) + n; db.save(); return user.shards; }

module.exports = {
  XP, XP_PER_PACK, PACK_SIZE, BUDGET, FOIL_CHANCE, SCRAP, CRAFT, FOIL_MULT, MIN_CARDS,
  ensureSet, summary, openPack, validateHand, randomHand, cpuHand, handLevel, award, addCard, removeCard,
  scrap, scrapExtras, extrasOf, craft, addShards, shardsOf, scrapValue, craftCost, packsAvailable, winMultiplier, WIN_BONUS,
};
