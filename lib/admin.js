'use strict';
/* Admin API (/api/admin/...): view and edit every account, plus a SQL console. Admins only. */
const db = require('./db');
const auth = require('./auth');
const col = require('./collection');
const levels = require('./levels');

const intOr = (v, d = null) => (v === '' || v === null || v === undefined ? d : Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

function userRow(key, u) {
  const sets = Object.values(u.sets || {});
  const cards = sets.reduce((n, s) => n + Object.values(s.cards || {}).reduce((a, b) => a + b, 0) + Object.values(s.foils || {}).reduce((a, b) => a + b, 0), 0);
  const sessions = Object.values(db.get().sessions).filter((s) => s.user === key && s.expires > Date.now()).length;
  return {
    key, name: u.name, admin: !!u.admin, created: u.created || null, lastSeen: u.lastSeen || null,
    level: levels.levelOf(u.xp || 0), xp: u.xp || 0, shards: u.shards || 0, packs: col.packsAvailable(u),
    games: sets.reduce((n, s) => n + (s.games || 0), 0), wins: sets.reduce((n, s) => n + (s.wins || 0), 0),
    sets: sets.length, cards, sessions,
  };
}

function userDetail(key, u, DECKS) {
  const sets = {};
  for (const [id, s] of Object.entries(u.sets || {})) {
    const deck = DECKS.get(id);
    const cards = (deck ? deck.cards : []).map((c) => ({ id: c.id, name: c.name, level: c.level, normal: s.cards[c.id] || 0, foil: (s.foils || {})[c.id] || 0 }));
    if (!deck) for (const cid of new Set([...Object.keys(s.cards), ...Object.keys(s.foils || {})])) cards.push({ id: Number(cid), name: `#${cid}`, level: 0, normal: s.cards[cid] || 0, foil: (s.foils || {})[cid] || 0 });
    sets[id] = { name: deck ? deck.name : id, games: s.games || 0, wins: s.wins || 0, cards };
  }
  return {
    ...userRow(key, u),
    bonusPacks: u.bonusPacks || 0, packsOpened: u.packsOpened || 0, levelClaimed: u.levelClaimed || 1,
    sets, levelLog: u.levelLog || {}, daily: u.daily || null,
    decks: [...DECKS.values()].map((d) => ({ id: d.id, name: d.name })),
  };
}

async function handle(route, req, res, url, a, { json, readBody, DECKS }) {
  if (!a || !a.user.admin) return json(res, 403, { error: 'Admins only.' });
  const users = db.get().users;
  const target = (k) => { const u = users[String(k || '')]; if (!u) throw new Error('No such account.'); return u; };

  if (route === 'GET /api/admin/users') {
    return json(res, 200, { mode: db.mode, file: db.FILE, users: Object.entries(users).map(([k, u]) => userRow(k, u)) });
  }
  if (route === 'GET /api/admin/user') {
    const key = url.searchParams.get('key');
    return json(res, 200, userDetail(key, target(key), DECKS));
  }
  if (route === 'POST /api/admin/user') {   // edit account numbers, display name, admin flag
    const b = await readBody(req);
    const u = target(b.key);
    const f = b.fields || {};
    if (f.name !== undefined) {
      const name = String(f.name).trim();
      if (auth.keyOf(name) !== b.key) throw new Error('The name can only change in upper/lowercase (it is also the sign-in name).');
      u.name = name;
    }
    for (const k of ['xp', 'shards', 'bonusPacks', 'packsOpened', 'levelClaimed']) {
      if (f[k] !== undefined) { const v = intOr(f[k]); if (v === null || v < 0) throw new Error(`${k} must be a number ≥ 0.`); u[k] = v; }
    }
    if (f.admin !== undefined) {
      if (!f.admin && b.key === a.key) throw new Error("You can't remove your own admin access.");
      if (f.admin) u.admin = true; else delete u.admin;
    }
    db.save();
    return json(res, 200, userDetail(b.key, u, DECKS));
  }
  if (route === 'POST /api/admin/cards') {   // set the number of normal/foil copies of one card
    const b = await readBody(req);
    const u = target(b.key);
    const deck = DECKS.get(b.deck);
    if (!deck) throw new Error('Unknown set.');
    const set = col.ensureSet(u, deck);
    const id = intOr(b.card);
    if (!deck.cards.some((c) => c.id === id)) throw new Error('Unknown card.');
    for (const [k, map] of [['normal', set.cards], ['foil', set.foils]]) {
      if (b[k] === undefined) continue;
      const v = intOr(b[k]);
      if (v === null || v < 0 || v > 999) throw new Error('Counts must be 0–999.');
      if (v) map[id] = v; else delete map[id];
    }
    db.save();
    return json(res, 200, userDetail(b.key, u, DECKS));
  }
  if (route === 'POST /api/admin/addset') {   // start a set for the account (with the usual starter cards)
    const b = await readBody(req);
    const u = target(b.key);
    const deck = DECKS.get(b.deck);
    if (!deck) throw new Error('Unknown set.');
    col.ensureSet(u, deck);
    db.save();
    return json(res, 200, userDetail(b.key, u, DECKS));
  }
  if (route === 'POST /api/admin/password') {
    const b = await readBody(req);
    const u = target(b.key);
    if (String(b.password || '').length < 6) throw new Error('Passwords need at least 6 characters.');
    Object.assign(u, auth.hashPassword(b.password));
    db.save();
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/admin/signout') {
    const b = await readBody(req);
    target(b.key);
    const sessions = db.get().sessions;
    for (const [t, s] of Object.entries(sessions)) if (s.user === b.key && t !== a.token) delete sessions[t];
    db.save();
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/admin/delete') {
    const b = await readBody(req);
    target(b.key);
    if (b.key === a.key) throw new Error("You can't delete your own account here.");
    delete users[b.key];
    const sessions = db.get().sessions;
    for (const [t, s] of Object.entries(sessions)) if (s.user === b.key) delete sessions[t];
    db.save();
    return json(res, 200, { ok: true });
  }
  if (route === 'GET /api/admin/tables') return json(res, 200, { mode: db.mode, tables: db.tables() });
  if (route === 'POST /api/admin/sql') {
    const b = await readBody(req);
    return json(res, 200, db.sql(b.sql));
  }
  return json(res, 404, { error: 'Not found.' });
}

module.exports = { handle };
