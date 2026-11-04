'use strict';
/*
 * Storage: a SQLite database at $DATA_DIR/triad.db (default ./data), using Node's built-in node:sqlite
 * (Node 22.13 or newer). The game works on plain objects in memory (db.get().users / .sessions);
 * changes are written to SQLite shortly after each db.save(), in one transaction, only for the
 * accounts that actually changed.
 *
 * Tables (see SCHEMA below): users, user_sets, user_cards, level_log, sessions, meta.
 * You can query or edit the file with the sqlite3 command line tool or the admin page, even while
 * the server runs: it notices commits from other connections within a couple of seconds and reloads.
 *
 * On first start, an old triad.json is imported and renamed to triad.json.imported.
 * If node:sqlite isn't available (older Node), it falls back to the old triad.json file and says so.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'triad.db');
const JSON_FILE = path.join(DATA_DIR, 'triad.json');
const BOOTSTRAP_ADMIN = 'ashishduh';   // made an admin the first time this account exists

let sqlite = null;
{
  const emit = process.emitWarning;   // node:sqlite prints an "experimental" warning on load; skip just that one
  process.emitWarning = function (w, ...rest) { if (String(w && w.message || w).includes('SQLite')) return; return emit.call(this, w, ...rest); };
  try { sqlite = process.env.TRIAD_FORCE_JSON ? null : require('node:sqlite'); } catch { sqlite = null; }
  process.emitWarning = emit;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  key TEXT PRIMARY KEY,               -- lowercase name, used to sign in
  name TEXT NOT NULL,                 -- name as shown
  is_admin INTEGER NOT NULL DEFAULT 0,
  created INTEGER,                    -- ms since 1970
  last_seen INTEGER,
  xp INTEGER,                         -- lifetime XP (level and packs come from this)
  shards INTEGER,
  packs_opened INTEGER,
  bonus_packs INTEGER,                -- packs won as level rewards
  level_claimed INTEGER,              -- highest level whose reward was claimed
  daily TEXT,                         -- today's challenges (JSON)
  extra TEXT,                         -- any other account fields (JSON)
  salt TEXT, hash TEXT                -- password (scrypt)
);
CREATE TABLE IF NOT EXISTS user_sets (
  user TEXT NOT NULL REFERENCES users(key) ON DELETE CASCADE ON UPDATE CASCADE,
  deck TEXT NOT NULL,
  games INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, packs_opened INTEGER DEFAULT 0,
  extra TEXT,
  PRIMARY KEY (user, deck)
);
CREATE TABLE IF NOT EXISTS user_cards (
  user TEXT NOT NULL, deck TEXT NOT NULL, card INTEGER NOT NULL,
  normal INTEGER NOT NULL DEFAULT 0,  -- normal copies
  foil INTEGER NOT NULL DEFAULT 0,    -- foil copies
  PRIMARY KEY (user, deck, card),
  FOREIGN KEY (user, deck) REFERENCES user_sets(user, deck) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS level_log (
  user TEXT NOT NULL REFERENCES users(key) ON DELETE CASCADE ON UPDATE CASCADE,
  level INTEGER NOT NULL, kind TEXT, deck TEXT, shards INTEGER DEFAULT 0, packs INTEGER DEFAULT 0,
  cards TEXT,                         -- JSON [{id, foil}]
  PRIMARY KEY (user, level)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES users(key) ON DELETE CASCADE ON UPDATE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL REFERENCES users(key) ON DELETE CASCADE ON UPDATE CASCADE,
  created INTEGER,                    -- ms since 1970
  packs INTEGER DEFAULT 0, shards INTEGER DEFAULT 0,
  cards TEXT,                         -- JSON [{"deck":"wilds","id":12,"foil":false}]
  note TEXT,                          -- shown to the player
  applied INTEGER NOT NULL DEFAULT 0, -- added to the account (rows inserted with SQL get applied within seconds)
  seen INTEGER NOT NULL DEFAULT 0     -- the player has seen the gift popup
);
-- Unopened packs aren't stored: they're worked out as one per 100 XP + bonus packs - packs opened. This view shows them.
CREATE VIEW IF NOT EXISTS user_packs AS
  SELECT key, name, xp, bonus_packs, packs_opened,
    MAX(0, COALESCE(xp, 0) / 100 + COALESCE(bonus_packs, 0) - COALESCE(packs_opened, 0)) AS unopened_packs
  FROM users;
`;

let data = { users: {}, sessions: {} };
let timer = null;
let conn = null;
let mode = 'sqlite';
let FILE = DB_FILE;
const snap = new Map();       // user key -> JSON of what's in the database
let sessSnap = new Map();     // token -> "user|expires"
let dataVersion = 0;

// ---------- objects <-> rows ----------
const USER_COLS = { created: 'created', lastSeen: 'last_seen', xp: 'xp', shards: 'shards', packsOpened: 'packs_opened', bonusPacks: 'bonus_packs', levelClaimed: 'level_claimed' };
const SET_COLS = { games: 'games', wins: 'wins', xp: 'xp', packsOpened: 'packs_opened' };
const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function writeUser(key, u) {
  const extra = {};
  for (const [k, v] of Object.entries(u)) {
    if (!(k in USER_COLS) && !['name', 'admin', 'daily', 'sets', 'levelLog', 'gifts', 'salt', 'hash'].includes(k)) extra[k] = v;
  }
  conn.prepare(`INSERT INTO users (key, name, is_admin, created, last_seen, xp, shards, packs_opened, bonus_packs, level_claimed, daily, extra, salt, hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET name=excluded.name, is_admin=excluded.is_admin, created=excluded.created, last_seen=excluded.last_seen,
      xp=excluded.xp, shards=excluded.shards, packs_opened=excluded.packs_opened, bonus_packs=excluded.bonus_packs,
      level_claimed=excluded.level_claimed, daily=excluded.daily, extra=excluded.extra, salt=excluded.salt, hash=excluded.hash`)
    .run(key, String(u.name || key), u.admin ? 1 : 0, num(u.created), num(u.lastSeen), num(u.xp), num(u.shards), num(u.packsOpened),
      num(u.bonusPacks), num(u.levelClaimed), u.daily ? JSON.stringify(u.daily) : null,
      Object.keys(extra).length ? JSON.stringify(extra) : null, u.salt || null, u.hash || null);
  conn.prepare('DELETE FROM user_sets WHERE user = ?').run(key);   // cascades to user_cards
  conn.prepare('DELETE FROM level_log WHERE user = ?').run(key);
  const insSet = conn.prepare('INSERT INTO user_sets (user, deck, games, wins, xp, packs_opened, extra) VALUES (?,?,?,?,?,?,?)');
  const insCard = conn.prepare('INSERT INTO user_cards (user, deck, card, normal, foil) VALUES (?,?,?,?,?)');
  for (const [deck, s] of Object.entries(u.sets || {})) {
    const sx = {};
    for (const [k, v] of Object.entries(s)) if (!(k in SET_COLS) && k !== 'cards' && k !== 'foils') sx[k] = v;
    insSet.run(key, deck, num(s.games) || 0, num(s.wins) || 0, num(s.xp) || 0, num(s.packsOpened) || 0, Object.keys(sx).length ? JSON.stringify(sx) : null);
    const ids = new Set([...Object.keys(s.cards || {}), ...Object.keys(s.foils || {})]);
    for (const id of ids) {
      const n = num((s.cards || {})[id]) || 0, f = num((s.foils || {})[id]) || 0;
      if (n > 0 || f > 0) insCard.run(key, deck, Number(id), Math.max(0, n), Math.max(0, f));
    }
  }
  const insLog = conn.prepare('INSERT INTO level_log (user, level, kind, deck, shards, packs, cards) VALUES (?,?,?,?,?,?,?)');
  for (const [lvl, e] of Object.entries(u.levelLog || {})) {
    insLog.run(key, Number(lvl), e.kind || null, e.deck || null, num(e.shards) || 0, num(e.packs) || 0, JSON.stringify(e.cards || []));
  }
  // gifts are upserted, never cleared, so rows someone just inserted with SQL survive this account being saved
  const insGift = conn.prepare(`INSERT INTO gifts (id, user, created, packs, shards, cards, note, applied, seen) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET user=excluded.user, created=excluded.created, packs=excluded.packs, shards=excluded.shards,
      cards=excluded.cards, note=excluded.note, applied=excluded.applied, seen=excluded.seen`);
  for (const g of u.gifts || []) {
    insGift.run(num(g.id), key, num(g.created), num(g.packs) || 0, num(g.shards) || 0, JSON.stringify(g.cards || []), g.note || null, g.applied ? 1 : 0, g.seen ? 1 : 0);
  }
}

function readAll() {
  const users = {};
  for (const r of conn.prepare('SELECT * FROM users').all()) {
    const u = { name: r.name, salt: r.salt, hash: r.hash, ...parse(r.extra, {}) };
    for (const [k, c] of Object.entries(USER_COLS)) if (r[c] !== null && r[c] !== undefined) u[k] = Number(r[c]);
    if (r.is_admin) u.admin = true;
    if (r.daily) u.daily = parse(r.daily, undefined);
    u.sets = {};
    users[r.key] = u;
  }
  for (const r of conn.prepare('SELECT * FROM user_sets').all()) {
    const u = users[r.user]; if (!u) continue;
    u.sets[r.deck] = { xp: Number(r.xp) || 0, packsOpened: Number(r.packs_opened) || 0, games: Number(r.games) || 0, wins: Number(r.wins) || 0, ...parse(r.extra, {}), cards: {}, foils: {} };
  }
  for (const r of conn.prepare('SELECT * FROM user_cards').all()) {
    const s = users[r.user] && users[r.user].sets[r.deck]; if (!s) continue;
    if (r.normal > 0) s.cards[r.card] = Number(r.normal);
    if (r.foil > 0) s.foils[r.card] = Number(r.foil);
  }
  for (const r of conn.prepare('SELECT * FROM level_log ORDER BY level').all()) {
    const u = users[r.user]; if (!u) continue;
    (u.levelLog = u.levelLog || {})[r.level] = { kind: r.kind, deck: r.deck, cards: parse(r.cards, []), shards: Number(r.shards) || 0, packs: Number(r.packs) || 0 };
  }
  for (const r of conn.prepare('SELECT * FROM gifts ORDER BY id').all()) {
    const u = users[r.user]; if (!u) continue;
    (u.gifts = u.gifts || []).push({ id: Number(r.id), created: r.created === null ? null : Number(r.created), packs: Number(r.packs) || 0, shards: Number(r.shards) || 0,
      cards: parse(r.cards, []), note: r.note, applied: !!r.applied, seen: !!r.seen });
  }
  const sessions = {};
  for (const r of conn.prepare('SELECT * FROM sessions').all()) sessions[r.token] = { user: r.user, expires: Number(r.expires) };
  return { users, sessions };
}

// Puts freshly read data into the live objects (keeping the same objects, so open games keep working).
function adopt(fresh) {
  for (const key of Object.keys(data.users)) if (!fresh.users[key]) delete data.users[key];
  for (const [key, u] of Object.entries(fresh.users)) {
    const cur = data.users[key];
    if (cur) { for (const k of Object.keys(cur)) delete cur[k]; Object.assign(cur, u); } else data.users[key] = u;
  }
  for (const t of Object.keys(data.sessions)) delete data.sessions[t];
  Object.assign(data.sessions, fresh.sessions);
  snap.clear();
  for (const [key, u] of Object.entries(data.users)) snap.set(key, JSON.stringify(u));
  sessSnap = new Map(Object.entries(data.sessions).map(([t, s]) => [t, `${s.user}|${s.expires}`]));
}

function tx(fn) {
  conn.exec('BEGIN IMMEDIATE');
  try { const r = fn(); conn.exec('COMMIT'); return r; } catch (e) { try { conn.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
}

// ---------- public API ----------
function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!sqlite) {
    mode = 'json'; FILE = JSON_FILE;
    console.warn('WARNING: this Node version has no built-in SQLite (needs Node 22.13+). Using the old triad.json file instead.');
    if (fs.existsSync(JSON_FILE)) data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    data.users = data.users || {}; data.sessions = data.sessions || {};
    seedAdmin();
    return data;
  }
  const fresh = !fs.existsSync(DB_FILE);
  conn = new sqlite.DatabaseSync(DB_FILE);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  conn.exec(SCHEMA);
  if (fresh && fs.existsSync(JSON_FILE)) {   // one-time import of the old JSON file
    const old = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    tx(() => {
      for (const [key, u] of Object.entries(old.users || {})) writeUser(key, u);
      for (const [k, v] of Object.entries(old.meta || {})) meta(k, v);
      const ins = conn.prepare('INSERT OR IGNORE INTO sessions (token, user, expires) VALUES (?,?,?)');
      for (const [t, s] of Object.entries(old.sessions || {})) if (old.users && old.users[s.user]) ins.run(t, s.user, num(s.expires) || 0);
    });
    fs.renameSync(JSON_FILE, JSON_FILE + '.imported');
    console.log(`Imported ${Object.keys(old.users || {}).length} accounts from triad.json (renamed to triad.json.imported).`);
  }
  adopt(readAll());
  seedAdmin();
  dataVersion = Number(conn.prepare('PRAGMA data_version').get().data_version);
  setInterval(checkOutside, 2000).unref();
  return data;
}

// The bootstrap admin account becomes an admin once, the first time it exists.
function seedAdmin() {
  const u = data.users[BOOTSTRAP_ADMIN];
  if (!u || meta('admin_seeded')) return;
  u.admin = true;
  meta('admin_seeded', '1');
  save();
}
const metaJson = {};
function meta(key, value) {
  if (mode === 'json') { data.meta = data.meta || metaJson; if (value === undefined) return data.meta[key]; data.meta[key] = value; return value; }
  if (value === undefined) { const r = conn.prepare('SELECT value FROM meta WHERE key = ?').get(key); return r ? r.value : undefined; }
  conn.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  return value;
}

function flush() {
  clearTimeout(timer); timer = null;
  if (mode === 'json') {
    const tmp = JSON_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, JSON_FILE);
    return;
  }
  const changed = [];
  for (const [key, u] of Object.entries(data.users)) { const j = JSON.stringify(u); if (snap.get(key) !== j) changed.push([key, u, j]); }
  const gone = [...snap.keys()].filter((k) => !data.users[k]);
  const sessNow = new Map(Object.entries(data.sessions).filter(([, s]) => data.users[s.user]).map(([t, s]) => [t, `${s.user}|${s.expires}`]));
  const sessAdd = [...sessNow].filter(([t, v]) => sessSnap.get(t) !== v);
  const sessDel = [...sessSnap.keys()].filter((t) => !sessNow.has(t));
  if (!changed.length && !gone.length && !sessAdd.length && !sessDel.length) return;
  tx(() => {
    for (const key of gone) conn.prepare('DELETE FROM users WHERE key = ?').run(key);
    for (const [key, u] of changed) writeUser(key, u);
    for (const t of sessDel) conn.prepare('DELETE FROM sessions WHERE token = ?').run(t);
    const ins = conn.prepare('INSERT INTO sessions (token, user, expires) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET user = excluded.user, expires = excluded.expires');
    for (const [t] of sessAdd) ins.run(t, data.sessions[t].user, data.sessions[t].expires);
  });
  for (const key of gone) snap.delete(key);
  for (const [key, , j] of changed) snap.set(key, j);
  sessSnap = sessNow;
}

function save() {
  if (!timer) timer = setTimeout(() => { try { flush(); } catch (e) { console.error('DB save failed:', e.message); } }, 300);
}

// Someone else (sqlite3, a script) changed the file: save what we have pending, then reload.
function checkOutside() {
  try {
    const v = Number(conn.prepare('PRAGMA data_version').get().data_version);
    if (v === dataVersion) return;
    dataVersion = v;
    if (timer) flush();
    adopt(readAll());
    console.log('Database changed outside the server; reloaded.');
    for (const fn of reloadHooks) fn();
  } catch (e) { console.error('DB reload failed:', e.message); }
}
function reload() { if (mode !== 'sqlite') return; if (timer) flush(); adopt(readAll()); }

// Admin SQL console: runs one or more statements. Returns the rows of the last statement that returns rows.
function sql(text) {
  if (mode !== 'sqlite') throw new Error('SQL needs the SQLite database (Node 22.13 or newer).');
  flush();   // so queries see the latest data
  const stmts = splitSql(text);
  if (!stmts.length) throw new Error('Nothing to run.');
  let out = { columns: [], rows: [], changes: 0 };
  let wrote = false;
  tx(() => {
    for (const s of stmts) {
      const st = conn.prepare(s);
      const cols = typeof st.columns === 'function' ? st.columns() : null;
      if ((cols && cols.length) || /^\s*(select|with|pragma|explain|values)\b/i.test(s)) {
        const rows = st.all();
        const columns = cols && cols.length ? cols.map((c) => c.name) : rows.length ? Object.keys(rows[0]) : [];
        out = { columns, rows: rows.slice(0, 1000).map((r) => columns.map((c) => (typeof r[c] === 'bigint' ? Number(r[c]) : r[c]))), total: rows.length, changes: out.changes };
      } else { const r = st.run(); out.changes += Number(r.changes) || 0; wrote = true; }
    }
  });
  if (wrote) { adopt(readAll()); for (const fn of reloadHooks) fn(); }
  return out;
}
function splitSql(text) {   // split on semicolons outside quotes
  const out = []; let cur = '', q = null;
  for (const ch of String(text)) {
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function tables() {
  if (mode !== 'sqlite') return [];
  return conn.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
    .map((t) => ({ name: t.name, view: t.type === 'view', columns: conn.prepare(`PRAGMA table_info("${t.name}")`).all().map((c) => c.name) }));
}

function get() { return data; }
const reloadHooks = [];
const onReload = (fn) => reloadHooks.push(fn);   // runs after data is reloaded from the database

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { if (timer) flush(); } catch (e) { /* ignore */ } process.exit(0); });
}

module.exports = {
  load, save, flush, get, reload, onReload, sql, tables, meta, seedAdmin, BOOTSTRAP_ADMIN, DATA_DIR,
  get FILE() { return FILE; }, get mode() { return mode; },
};
