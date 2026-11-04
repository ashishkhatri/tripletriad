'use strict';
/*
 * Gifts: packs, shards and/or cards given to an account (from the admin page, or by inserting a row into
 * the gifts table with SQL). A gift is added to the account straight away; the player sees a popup about
 * it the next time they open the game, and it's marked seen once they close that popup.
 *
 *   INSERT INTO gifts (user, packs, note) VALUES ('bob', 2, 'Thanks for testing!');
 *   INSERT INTO gifts (user, shards, cards) VALUES ('bob', 500, '[{"deck":"wilds","id":12,"foil":true}]');
 *   INSERT INTO gifts (user, packs, note) SELECT key, 1, 'A gift for everyone' FROM users;
 */
const db = require('./db');
const col = require('./collection');

let seq = 0;
const newId = () => Date.now() * 100 + (seq++ % 100);
const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

// cards: [{deck, id, foil, count}] -> one entry per copy, only real cards
function cleanCards(cards, DECKS) {
  const out = [];
  for (const c of Array.isArray(cards) ? cards : []) {
    const deck = DECKS.get(c && c.deck);
    const id = Number(c && c.id);
    if (!deck || !deck.cards.some((x) => x.id === id)) continue;
    const n = Math.min(99, Math.max(1, int(c.count || 1)));
    for (let i = 0; i < n; i++) out.push({ deck: deck.id, id, foil: !!c.foil });
  }
  return out;
}

function apply(user, g, DECKS) {
  g.packs = int(g.packs); g.shards = int(g.shards);
  g.cards = cleanCards(g.cards, DECKS);
  if (g.packs) user.bonusPacks = (user.bonusPacks || 0) + g.packs;
  if (g.shards) col.addShards(user, g.shards);
  for (const c of g.cards) col.addCard(user, DECKS.get(c.deck), c.id, c.foil);
  g.applied = true;
  if (!g.created) g.created = Date.now();
}

function give(user, { packs, shards, cards, note }, DECKS) {
  const g = { id: newId(), created: Date.now(), packs: int(packs), shards: int(shards), cards: cleanCards(cards, DECKS), note: String(note || '').trim().slice(0, 200) || null, applied: false, seen: false };
  if (!g.packs && !g.shards && !g.cards.length) throw new Error('Add some packs, shards or cards to the gift.');
  apply(user, g, DECKS);
  (user.gifts = user.gifts || []).push(g);
  db.save();
  return g;
}

// Gifts added straight into the database (with SQL) arrive unapplied: apply them now.
function applyPending(DECKS) {
  let n = 0;
  for (const u of Object.values(db.get().users)) {
    for (const g of u.gifts || []) if (!g.applied) { apply(u, g, DECKS); n++; }
  }
  if (n) { db.save(); console.log(`Applied ${n} gift${n === 1 ? '' : 's'} added to the database.`); }
}

const unseen = (user) => (user.gifts || []).filter((g) => g.applied && !g.seen)
  .map((g) => ({ id: g.id, note: g.note || null, packs: g.packs || 0, shards: g.shards || 0, cards: g.cards || [] }));

function markSeen(user, ids) {
  const want = new Set((Array.isArray(ids) ? ids : []).map(Number));
  for (const g of user.gifts || []) if (want.has(Number(g.id))) g.seen = true;
  db.save();
}

module.exports = { give, applyPending, unseen, markSeen };
