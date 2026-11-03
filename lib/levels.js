'use strict';
/*
 * Account levels: they come from lifetime XP (the same XP that earns a pack every 100) and never cap.
 * Each level needs a little more XP than the last. Every level has a reward, claimed on the Rewards screen
 * (and kept a surprise until then):
 *   Fibonacci levels (2, 3, 5, 8, 13, 21, 34, 55, 89, …) → a card pack (opens from any set, like XP packs)
 *   every 5th level  → two cards, Rare or better
 *   every 10th level → a foil card, Rare or better
 *   every 20th level → a Legendary card
 *   every 50th level → a foil Legendary card
 *   any other level  → shards (more at higher levels)
 * Each level has one reward: the biggest card reward that applies, else a pack on Fibonacci levels, else shards.
 * Rewards are claimed one level at a time, and the player picks which set each one comes from.
 */
const crypto = require('crypto');
const db = require('./db');
const col = require('./collection');

const FIRST_STEP = 100;   // XP from level 1 to 2
const STEP_GROWTH = 25;   // each level after that needs this much more

const stepXp = (level) => FIRST_STEP + STEP_GROWTH * (level - 1);   // XP to go from `level` to `level + 1`
function levelOf(xp) {
  let level = 1, need = stepXp(1), left = Math.max(0, xp || 0);
  while (left >= need) { left -= need; level++; need = stepXp(level); }
  return level;
}

function isFibonacci(n) {
  let a = 1, b = 2;
  while (b < n) [a, b] = [b, a + b];
  return b === n;
}
function rewardFor(level) {   // one reward per level: card milestones first, then Fibonacci packs, else shards
  const cards = level % 50 === 0 ? 'foil-legendary' : level % 20 === 0 ? 'legendary' : level % 10 === 0 ? 'foil-rare' : level % 5 === 0 ? 'two-rare' : null;
  if (cards) return { kind: cards, cards, packs: 0, shards: 0 };
  if (isFibonacci(level)) return { kind: 'pack', cards: null, packs: 1, shards: 0 };
  return { kind: 'shards', cards: null, packs: 0, shards: 20 + 5 * level };
}

const rnd = (n) => crypto.randomInt(n);
const byLevel = (deck, l) => deck.cards.filter((c) => c.level === l);
function pickRarePlus(deck) {
  // weighted like packs, but only Rare (level 3) and up
  const w = { 3: 18, 4: 9, 5: 3 };
  const levels = Object.keys(w).map(Number).filter((l) => byLevel(deck, l).length);
  let r = rnd(levels.reduce((n, l) => n + w[l], 0));
  for (const l of levels) { if ((r -= w[l]) < 0) { const pool = byLevel(deck, l); return pool[rnd(pool.length)]; } }
  return deck.cards[rnd(deck.cards.length)];
}
function pickLegendary(deck) {
  const pool = byLevel(deck, 5).length ? byLevel(deck, 5) : byLevel(deck, 4).length ? byLevel(deck, 4) : deck.cards;
  return pool[rnd(pool.length)];
}

function state(user) {
  if (typeof user.levelClaimed !== 'number') user.levelClaimed = 1;   // level 1 is where everyone starts
  if (!user.levelLog) user.levelLog = {};
  return user;
}

// What the Rewards screen shows: every level from 2 to a little past the current one.
function view(user) {
  state(user);
  const xp = user.xp || 0, level = levelOf(xp);
  const until = Math.max(level + 15, Math.ceil((level + 1) / 10) * 10 + 10);
  const track = [];
  for (let l = 2; l <= until; l++) {
    const got = user.levelLog[l];
    const entry = { level: l, state: l <= user.levelClaimed ? 'claimed' : l <= level ? 'ready' : 'locked' };
    if (got) {   // what they actually received (rewards stay a surprise until claimed, so nothing is sent for other levels)
      entry.kind = got.kind; entry.deck = got.deck; entry.shards = got.shards || 0; entry.packs = got.packs || 0;
      entry.cards = (got.cards || []).map((c) => ({ id: c.id, foil: c.foil }));
    } else entry.kind = 'mystery';
    track.push(entry);
  }
  // whether the next reward needs a set picked (cards do; shards and packs don't)
  const next = user.levelClaimed + 1;
  return { level, ready: Math.max(0, level - user.levelClaimed), nextNeedsSet: next <= level && !!rewardFor(next).cards, track };
}

// Claims the next reached level that hasn't been claimed yet; its cards (or pack art) come from `deck`.
function claim(user, deck) {
  state(user);
  const level = levelOf(user.xp || 0);
  const l = user.levelClaimed + 1;
  if (l > level) throw new Error('No rewards to claim yet — keep playing to level up.');
  const r = rewardFor(l);
  if (r.cards && !deck) throw new Error('Choose a set for this reward.');
  const entry = { level: l, kind: r.kind, deck: deck ? deck.id : null, cards: [], shards: 0, packs: 0 };
  if (r.shards) { entry.shards = r.shards; col.addShards(user, r.shards); }
  if (r.packs) { entry.packs = r.packs; user.bonusPacks = (user.bonusPacks || 0) + r.packs; }
  if (r.cards) {
    const picks = r.cards === 'two-rare' ? [[pickRarePlus(deck), false], [pickRarePlus(deck), false]]
      : r.cards === 'foil-rare' ? [[pickRarePlus(deck), true]]
      : r.cards === 'legendary' ? [[pickLegendary(deck), false]]
      : [[pickLegendary(deck), true]];
    for (const [c, foil] of picks) {
      const set = col.ensureSet(user, deck);
      const isNew = foil ? !(set.foils[c.id] > 0) : ((set.cards[c.id] || 0) + (set.foils[c.id] || 0)) === 0;   // foils: new unless you have that foil
      col.addCard(user, deck, c.id, foil);
      entry.cards.push({ id: c.id, foil, isNew, scrap: col.scrapValue(c.level, foil) });
    }
  }
  user.levelLog[l] = { kind: entry.kind, deck: entry.deck, cards: entry.cards.map(({ id, foil }) => ({ id, foil })), shards: entry.shards, packs: entry.packs };
  user.levelClaimed = l;
  db.save();
  return { claimed: entry, level, shards: col.shardsOf(user), packs: col.packsAvailable(user) };
}

module.exports = { levelOf, stepXp, rewardFor, isFibonacci, view, claim, FIRST_STEP, STEP_GROWTH };
