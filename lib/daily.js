'use strict';
/*
 * Daily challenges: three per player per day, picked from the pool below with a seed of
 * (player, date) so they're stable all day. Progress comes from finished matches and opened packs;
 * a completed challenge pays its shards straight away. Days roll over at midnight in DAILY_TZ
 * (default: the server's time zone).
 */
const crypto = require('crypto');
const db = require('./db');
const col = require('./collection');

const TZ = process.env.DAILY_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const PER_DAY = 3;

// m = match report: { result, vsAI, aiLevel, online, rules, margin, same, plus, combo, flips, deck }
const POOL = [
  { id: 'play3',     text: 'Play 3 games',                         goal: 3, reward: 40,  on: 'match', count: () => 1 },
  { id: 'win1',      text: 'Win a game',                           goal: 1, reward: 30,  on: 'match', count: (m) => m.result === 'win' },
  { id: 'win2',      text: 'Win 2 games',                          goal: 2, reward: 50,  on: 'match', count: (m) => m.result === 'win' },
  { id: 'win4',      text: 'Win 4 games',                          goal: 4, reward: 90,  on: 'match', count: (m) => m.result === 'win' },
  { id: 'flips8',    text: 'Capture 8 cards',                      goal: 8, reward: 40,  on: 'match', count: (m) => m.flips },
  { id: 'flips20',   text: 'Capture 20 cards',                     goal: 20, reward: 70, on: 'match', count: (m) => m.flips },
  { id: 'same',      text: 'Trigger the Same rule',                goal: 1, reward: 50,  on: 'match', count: (m) => m.same },
  { id: 'plus',      text: 'Trigger the Plus rule',                goal: 1, reward: 50,  on: 'match', count: (m) => m.plus },
  { id: 'combo',     text: 'Trigger a Combo',                      goal: 1, reward: 70,  on: 'match', count: (m) => m.combo },
  { id: 'elemental', text: 'Win a game with the Elemental rule',   goal: 1, reward: 50,  on: 'match', count: (m) => m.result === 'win' && m.rules.elemental },
  { id: 'hidden',    text: 'Win a game with Open turned off',      goal: 1, reward: 50,  on: 'match', count: (m) => m.result === 'win' && !m.rules.open },
  { id: 'hard',      text: 'Beat the computer on Hard',            goal: 1, reward: 100, on: 'match', count: (m) => m.result === 'win' && m.vsAI && m.aiLevel === 'hard' },
  { id: 'margin',    text: 'Win by 3 or more cards',               goal: 1, reward: 60,  on: 'match', count: (m) => m.result === 'win' && m.margin >= 3 },
  { id: 'built',     text: 'Win with a hand you built',            goal: 1, reward: 50,  on: 'match', count: (m) => m.result === 'win' && (m.rules.handMode === 'build' || m.rules.handMode === 'budget') },
  { id: 'online',    text: 'Play an online match',                 goal: 1, reward: 60,  on: 'match', count: (m) => m.online },
  { id: 'pack',      text: 'Open a card pack',                     goal: 1, reward: 30,  on: 'pack',  count: () => 1 },
];
const byId = Object.fromEntries(POOL.map((c) => [c.id, c]));

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function msUntilReset() {
  // next midnight in TZ: walk forward in 1-minute steps from the top of the next hour boundary search
  const now = Date.now(), d0 = today();
  let lo = now, hi = now + 26 * 3600e3;
  const dateAt = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  while (hi - lo > 30e3) { const mid = (lo + hi) / 2; if (dateAt(mid) === d0) lo = mid; else hi = mid; }
  return Math.max(0, Math.round(hi - now));
}

function pick(seedStr) {
  const h = crypto.createHash('sha256').update(seedStr).digest();
  const ids = POOL.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = h[i % h.length] % (i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  // keep only one of each "win N" so a day isn't all win-counting
  const out = [], wins = new Set(['win1', 'win2', 'win4']), flips = new Set(['flips8', 'flips20']);
  let hadWin = false, hadFlips = false;
  for (const id of ids) {
    if (wins.has(id)) { if (hadWin) continue; hadWin = true; }
    if (flips.has(id)) { if (hadFlips) continue; hadFlips = true; }
    out.push(id);
    if (out.length === PER_DAY) break;
  }
  return out;
}

function ensure(user, key) {
  const d = today();
  if (!user.daily || user.daily.date !== d) {
    user.daily = { date: d, list: pick(`${key}|${d}`).map((id) => ({ id, progress: 0, done: false })) };
    db.save();
  }
  return user.daily;
}

function view(user, key) {
  const daily = ensure(user, key);
  return {
    date: daily.date, resetsIn: msUntilReset(), shards: col.shardsOf(user),
    challenges: daily.list.map((x) => ({ id: x.id, text: byId[x.id].text, goal: byId[x.id].goal, reward: byId[x.id].reward, progress: Math.min(x.progress, byId[x.id].goal), done: x.done })),
  };
}

// Feed an event in; returns the challenges it completed (their shards are already paid).
function record(user, key, kind, report = {}) {
  const daily = ensure(user, key);
  const completed = [];
  for (const x of daily.list) {
    const c = byId[x.id];
    if (!c || x.done || c.on !== kind) continue;
    const n = Number(c.count(report)) || 0;
    if (!n) continue;
    x.progress = Math.min(c.goal, x.progress + n);
    if (x.progress >= c.goal) {
      x.done = true;
      col.addShards(user, c.reward);
      completed.push({ id: c.id, text: c.text, reward: c.reward });
    }
  }
  db.save();
  return completed;
}

module.exports = { view, record, today, POOL, TZ };
