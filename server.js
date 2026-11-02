'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('./wslite');
const TT = require('./public/game.js');
const db = require('./lib/db');
const auth = require('./lib/auth');
const col = require('./lib/collection');
const daily = require('./lib/daily');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const VERSION = require('./package.json').version;
const AI_LEVELS = ['easy', 'normal', 'hard'];

db.load();
console.log(`Data: ${db.FILE}`);

// Load every deck listed in public/decks/index.json.
const DECK_DIR = path.join(PUBLIC, 'decks');
const DECKS = new Map();
for (const f of JSON.parse(fs.readFileSync(path.join(DECK_DIR, 'index.json'), 'utf8')).decks) {
  const d = JSON.parse(fs.readFileSync(path.join(DECK_DIR, path.basename(f)), 'utf8'));
  d.id = d.id || path.basename(f, '.json');
  DECKS.set(d.id, d);
}
const DEFAULT_DECK = DECKS.keys().next().value;
console.log(`Loaded decks: ${[...DECKS.keys()].join(', ')}`);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
};

// ---------- HTTP ----------
function json(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 8192) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}
const me = (a) => ({ name: a.user.name, shards: col.shardsOf(a.user) });

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  // Only accept JSON POSTs: browsers can't send these cross-site without a CORS preflight, which we never allow.
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' });
  try {
    if (route === 'POST /api/register' || route === 'POST /api/login') {
      const body = await readBody(req);
      const r = route.endsWith('register') ? auth.register(body.name, body.password) : auth.login(body.name, body.password);
      return json(res, 200, { name: db.get().users[r.key].name }, { 'Set-Cookie': auth.cookieHeader(req, r.token) });
    }
    if (route === 'POST /api/logout') {
      const a = auth.fromRequest(req);
      if (a) auth.logout(a.token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': auth.cookieHeader(req, '', true) });
    }
    const a = auth.fromRequest(req);
    if (route === 'GET /api/me') return a ? json(res, 200, me(a)) : json(res, 200, { guest: true });
    if (!a) return json(res, 401, { error: 'Sign in first.' });
    if (route === 'GET /api/collection') {
      const deck = DECKS.get(url.searchParams.get('deck'));
      if (!deck) return json(res, 404, { error: 'Unknown set.' });
      return json(res, 200, col.summary(a.user, deck));
    }
    if (route === 'GET /api/collections') {
      const out = {};
      for (const d of DECKS.values()) { const s = a.user.sets && a.user.sets[d.id]; if (s) out[d.id] = col.summary(a.user, d); }
      return json(res, 200, out);
    }
    if (route === 'POST /api/packs/open') {
      const body = await readBody(req);
      const deck = DECKS.get(body.deck);
      if (!deck) return json(res, 404, { error: 'Unknown set.' });
      const cards = col.openPack(a.user, deck);
      const completed = daily.record(a.user, a.key, 'pack');
      return json(res, 200, { cards, summary: col.summary(a.user, deck), daily: completed });
    }
    if (route === 'GET /api/daily') return json(res, 200, daily.view(a.user, a.key));
    if (route === 'POST /api/scrap' || route === 'POST /api/scrap/extras' || route === 'POST /api/craft') {
      const body = await readBody(req);
      const deck = DECKS.get(body.deck);
      if (!deck) return json(res, 404, { error: 'Unknown set.' });
      let r;
      if (route === 'POST /api/scrap') r = col.scrap(a.user, deck, body.card, !!body.foil, body.count);
      else if (route === 'POST /api/scrap/extras') r = col.scrapExtras(a.user, deck);
      else r = col.craft(a.user, deck, body.card, !!body.foil);
      return json(res, 200, { ...r, summary: col.summary(a.user, deck) });
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.pathname === '/version') return json(res, 200, { version: VERSION });
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- rooms ----------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Player';
const userOf = (pl) => (pl && pl.user ? db.get().users[pl.user] : null);
const usesCollections = (rules) => rules.handMode !== 'balanced';

function names(room) { return room.players.map((p) => (p ? p.name : null)); }
function connected(room) { return room.players.map((p) => !!(p && (p.ai || (p.ws && p.ws.readyState === 1)))); }
function humans(room) { return room.players.map((p, seat) => ({ p, seat })).filter((x) => x.p && !x.p.ai); }

function pushState(room, events) {
  room.lastActive = Date.now();
  for (const { p, seat } of humans(room)) {
    send(p.ws, { t: 'state', you: seat, state: TT.redact(room.state, seat), events: events || [], names: names(room), connected: connected(room), vsAI: room.vsAI });
  }
}
function pushPresence(room) {
  for (const { p } of humans(room)) send(p.ws, { t: 'presence', names: names(room), connected: connected(room) });
}

function sendChoose(room, seat) {
  const pl = room.players[seat];
  const deck = DECKS.get(room.deck);
  send(pl.ws, {
    t: 'choose', mode: room.rules.handMode, budget: col.BUDGET, deck: room.deck,
    cards: col.ensureSet(userOf(pl), deck).cards, foils: col.ensureSet(userOf(pl), deck).foils, done: !!room.hands[seat], names: names(room),
  });
}

// Starts a round: deals or asks for hands depending on the Hands rule.
function beginRound(room) {
  const deck = DECKS.get(room.deck);
  room.state = null; room.hands = [null, null]; room.rematch = [false, false];
  room.wager = null; room.results = [null, null]; room.finished = false;
  clearTimeout(room.aiTimer); clearTimeout(room.wagerTimer); clearTimeout(room.stormTimer);
  const mode = room.rules.handMode;
  if (mode === 'balanced') return startGame(room, null);
  if (mode === 'random') {
    for (const { p, seat } of humans(room)) room.hands[seat] = col.randomHand(userOf(p), deck);
    return fillAIAndStart(room);
  }
  room.phase = 'choosing';
  for (const { seat } of humans(room)) sendChoose(room, seat);
}

function fillAIAndStart(room) {
  const deck = DECKS.get(room.deck);
  const humanHands = humans(room).map(({ seat }) => room.hands[seat]).filter(Boolean);
  const target = humanHands.length ? col.handLevel(deck, humanHands[0].ids) : 15;
  room.players.forEach((p, seat) => {
    if (p && p.ai) room.hands[seat] = { ids: col.cpuHand(deck, room.rules.handMode === 'budget' ? Math.min(target, col.BUDGET) : target), foils: [false, false, false, false, false] };
  });
  startGame(room, room.hands);
}

function startGame(room, hands) {
  room.state = TT.newGame(room.rules, undefined, DECKS.get(room.deck), hands ? hands.map((h) => h.ids) : undefined);
  // foil copies are cosmetic but follow the card around the board
  room.foilFlags = hands ? hands.map((h) => h.foils) : [[], []];
  room.state.hands.forEach((h, seat) => h.forEach((c, i) => { if (room.foilFlags[seat][i]) c.foil = true; }));
  room.stats = [0, 1].map(() => ({ same: 0, plus: 0, combo: 0, flips: 0 }));
  room.phase = 'playing';
  pushState(room, [{ type: 'start' }]);
  scheduleAI(room);
}

function scheduleAI(room) {
  const s = room.state;
  if (!s || s.over) return;
  const pl = room.players[s.turn];
  if (!pl || !pl.ai) return;
  clearTimeout(room.aiTimer);
  room.aiTimer = setTimeout(() => {
    if (room.state !== s || !rooms.has(room.code)) return;
    try {
      const m = TT.chooseMove(s, pl.level);
      applyMove(room, s.turn, m.hand, m.cell);
    } catch (e) { console.error('AI move failed:', e); }
  }, s.board.every((x) => !x) ? 1400 : 900);
}

function applyMove(room, seat, hand, cell) {
  const { state, events } = TT.applyMove(room.state, seat, hand, cell);
  room.state = state;
  const st = room.stats && room.stats[seat];
  if (st) for (const e of events) {
    if (e.type === 'flip') st.flips++;
    else if (e.type === 'rule' && st[e.rule] !== undefined) st[e.rule]++;
  }
  if (!state.over && room.rules.storms) {
    room.state = TT.rollStorm(room.state, Math.random, process.env.STORM_CHANCE ? Number(process.env.STORM_CHANCE) : undefined);
    if (room.state.storm) return beginStorm(room, events);
  }
  pushState(room, events);
  if (state.over) finish(room); else scheduleAI(room);
}

// ---------- Storms: a pending choice between moves ----------
const STORM_SECONDS = 25;
function beginStorm(room, events) {
  const st = room.state.storm;
  st.deadline = Date.now() + STORM_SECONDS * 1000;
  room.phase = 'storm';
  pushState(room, events.concat([{ type: 'storm-warn', kind: st.kind }]));
  clearTimeout(room.stormTimer);
  const pl = room.players[st.chooser];
  const auto = () => {
    if (room.phase !== 'storm' || !room.state.storm || !rooms.has(room.code)) return;
    pickStorm(room, st.chooser, TT.chooseStormResponse(room.state, pl && pl.ai ? pl.level : 'normal'));
  };
  // the computer takes a few seconds to "read" the cards, so you can see what it was dealt
  room.stormTimer = setTimeout(auto, pl && pl.ai ? 4500 + Math.random() * 1500 : STORM_SECONDS * 1000);
}
// Shows everyone which response was picked, then resolves it after a short pause.
const STORM_REVEAL_MS = 1800;
function pickStorm(room, seat, choice) {
  const st = room.state.storm;
  if (!st || st.picked) return;
  if (seat !== st.chooser) throw new Error('Your opponent is facing this storm');
  if (!st.options.includes(choice)) throw new Error('Not one of your choices');
  st.picked = choice;
  clearTimeout(room.stormTimer);
  pushState(room, [{ type: 'storm-pick', choice, chooser: seat }]);
  room.stormTimer = setTimeout(() => {
    if (room.phase !== 'storm' || room.state.storm !== st || !rooms.has(room.code)) return;
    resolveStorm(room, seat, choice);
  }, STORM_REVEAL_MS);
}
function resolveStorm(room, seat, choice) {
  const { state, events } = TT.resolveStorm(room.state, seat, choice);
  clearTimeout(room.stormTimer);
  room.state = state;
  room.phase = 'playing';
  const st = room.stats && room.stats[seat];
  if (st) st.storms = (st.storms || 0) + 1;
  pushState(room, events);
  scheduleAI(room);
}

// End of a match: XP for signed-in players, then the wager (if on).
function finish(room) {
  if (room.finished) return;
  room.finished = true;
  room.phase = 'over';
  const deck = DECKS.get(room.deck);
  const w = room.state.winner;
  const score = TT.score(room.state);
  room.players.forEach((p, seat) => {
    const u = userOf(p);
    if (!u) return;
    const result = w === 'draw' ? 'draw' : w === seat ? 'win' : 'loss';
    const other = room.players[1 - seat];
    const report = {
      result, rules: room.rules, deck: room.deck, vsAI: !!(other && other.ai), aiLevel: other && other.ai ? other.level : null,
      online: !!(other && !other.ai), margin: score[seat] - score[1 - seat], ...(room.stats ? room.stats[seat] : {}),
    };
    room.results[seat] = { rewards: col.award(u, deck, result), daily: daily.record(u, p.user, 'match', report) };
  });
  if (room.rules.wager && w !== 'draw') {
    const loser = 1 - w;
    const flags = (room.foilFlags && room.foilFlags[loser]) || [];
    room.wager = { winner: w, loser, options: room.state.startHands[loser].map((id, i) => ({ id, foil: !!flags[i] })) };
    if (room.players[w].ai) return settleWager(room, bestOption(room));   // the computer takes the best card
    room.phase = 'wager';
    sendWagerPrompt(room);
    room.wagerTimer = setTimeout(() => { if (room.phase === 'wager') settleWager(room, bestOption(room)); }, 90_000);
    return;
  }
  sendResults(room);
}

// index of the most valuable card on offer: highest level, foil first
function bestOption(room) {
  const deck = DECKS.get(room.deck);
  let best = 0, bestScore = -1;
  room.wager.options.forEach((o, i) => { const sc = TT.cardById(deck, o.id).level * 2 + (o.foil ? 1 : 0); if (sc > bestScore) { best = i; bestScore = sc; } });
  return best;
}

function sendWagerPrompt(room) {
  const { winner, loser, options } = room.wager;
  send(room.players[winner].ws, { t: 'wager_pick', options });
  if (!room.players[loser].ai) send(room.players[loser].ws, { t: 'wager_wait', options });
}

function settleWager(room, index) {
  const deck = DECKS.get(room.deck);
  const { winner, loser } = room.wager;
  clearTimeout(room.wagerTimer);
  const opt = room.wager.options[index] || room.wager.options[0];
  const id = opt.id;
  const wu = userOf(room.players[winner]), lu = userOf(room.players[loser]);
  let refill = [], foil = opt.foil;
  if (lu) { const r = col.removeCard(lu, deck, id, opt.foil); refill = r.refill; if (r.removed) foil = r.foil; }
  if (wu) col.addCard(wu, deck, id, foil);
  room.wager.taken = id;
  if (room.results[winner]) room.results[winner].wager = { won: id, foil };
  if (room.results[loser]) room.results[loser].wager = { lost: id, foil, refill };
  room.phase = 'over';
  sendResults(room);
}

function sendResults(room) {
  const deck = DECKS.get(room.deck);
  for (const { p, seat } of humans(room)) {
    const r = room.results[seat];
    const u = userOf(p);
    send(p.ws, { t: 'result', you: seat, rewards: r ? r.rewards : null, daily: r ? r.daily || [] : [], wager: r ? r.wager || null : null, taken: room.wager ? room.wager.taken : null, collection: u ? col.summary(u, deck) : null, shards: u ? col.shardsOf(u) : null });
  }
}

function handle(ws, msg) {
  const room = ws.room ? rooms.get(ws.room) : null;
  const a = auth.fromRequest(ws.req);
  switch (msg.t) {
    case 'create': {
      const rules = TT.normalizeRules(msg.rules);
      if (usesCollections(rules) && !a) return send(ws, { t: 'error', msg: 'Sign in to play with collection hands.' });
      const code = newCode();
      const token = crypto.randomBytes(16).toString('hex');
      const deck = DECKS.has(msg.deck) ? msg.deck : DEFAULT_DECK;
      const vsAI = msg.vs === 'ai';
      const level = AI_LEVELS.includes(msg.level) ? msg.level : 'normal';
      const host = { name: a ? a.user.name : cleanName(msg.name), user: a ? a.key : null, token, ws };
      const r = { code, deck, rules, vsAI, players: [host, vsAI ? { ai: true, level, name: `CPU (${level})` } : null], state: null, phase: 'waiting', hands: [null, null], rematch: [false, false], results: [null, null], lastActive: Date.now() };
      rooms.set(code, r);
      ws.room = code; ws.seat = 0;
      send(ws, { t: 'room', code, you: 0, token, rules, vsAI, deck });
      if (vsAI) beginRound(r);
      return;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r || r.vsAI) return send(ws, { t: 'error', msg: 'Room not found.' });
      if (r.players[1]) return send(ws, { t: 'error', msg: 'That room is full.' });
      if (usesCollections(r.rules) && !a) return send(ws, { t: 'error', msg: 'This room uses collection hands — sign in to join.' });
      const token = crypto.randomBytes(16).toString('hex');
      r.players[1] = { name: a ? a.user.name : cleanName(msg.name), user: a ? a.key : null, token, ws };
      ws.room = code; ws.seat = 1;
      send(ws, { t: 'room', code, you: 1, token, rules: r.rules, vsAI: false, deck: r.deck });
      pushPresence(r);
      return beginRound(r);
    }
    case 'resume': {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      const seat = r ? r.players.findIndex((p) => p && !p.ai && p.token === msg.token) : -1;
      if (seat < 0) return send(ws, { t: 'error', msg: 'Could not rejoin that room.', fatal: true });
      const pl = r.players[seat];
      if (pl.ws && pl.ws !== ws) pl.ws.close();
      pl.ws = ws; ws.room = r.code; ws.seat = seat;
      send(ws, { t: 'room', code: r.code, you: seat, token: msg.token, rules: r.rules, vsAI: r.vsAI, deck: r.deck, resumed: true });
      if (r.phase === 'choosing') sendChoose(r, seat);
      else if (r.state) {
        send(ws, { t: 'state', you: seat, state: TT.redact(r.state, seat), events: [], names: names(r), connected: connected(r), vsAI: r.vsAI });
        if (r.phase === 'wager' && r.wager.winner === seat) send(ws, { t: 'wager_pick', options: r.wager.options });
        else if (r.phase === 'wager') send(ws, { t: 'wager_wait', options: r.wager.options });
        else if (r.phase === 'over') sendResults(r);
      }
      return pushPresence(r);
    }
    case 'hand': {
      if (!room || room.phase !== 'choosing' || room.hands[ws.seat]) return;
      const u = userOf(room.players[ws.seat]);
      try {
        room.hands[ws.seat] = col.validateHand(u, DECKS.get(room.deck), msg.cards, room.rules.handMode);
      } catch (e) { return send(ws, { t: 'error', msg: e.message }); }
      send(ws, { t: 'hand_ok' });
      for (const { p, seat } of humans(room)) if (seat !== ws.seat) send(p.ws, { t: 'opponent_ready' });
      if (humans(room).every(({ seat }) => room.hands[seat]) && room.players.every(Boolean)) fillAIAndStart(room);
      return;
    }
    case 'move': {
      if (!room || !room.state || room.phase !== 'playing') return;
      try { applyMove(room, ws.seat, Number(msg.hand), Number(msg.cell)); }
      catch (e) { send(ws, { t: 'error', msg: e.message }); }
      return;
    }
    case 'storm': {
      if (!room || room.phase !== 'storm' || !room.state || !room.state.storm) return;
      try { pickStorm(room, ws.seat, String(msg.choice)); }
      catch (e) { send(ws, { t: 'error', msg: e.message }); }
      return;
    }
    case 'wager': {
      if (!room || room.phase !== 'wager' || room.wager.winner !== ws.seat) return;
      let idx = Number.isInteger(msg.index) ? msg.index : room.wager.options.findIndex((o) => o.id === Number(msg.card));
      if (!(idx >= 0 && idx < room.wager.options.length)) return send(ws, { t: 'error', msg: 'Pick one of the cards they played.' });
      return settleWager(room, idx);
    }
    case 'rematch': {
      if (!room || room.phase !== 'over') return;
      if (room.vsAI) return beginRound(room);
      room.rematch[ws.seat] = true;
      if (room.rematch[0] && room.rematch[1]) return beginRound(room);
      const other = room.players[1 - ws.seat];
      return other && send(other.ws, { t: 'rematch_requested' });
    }
    case 'leave': {
      if (!room) return;
      const other = room.players[1 - ws.seat];
      if (other && !other.ai) send(other.ws, { t: 'opponent_left' });
      // Leaving mid-wager settles it so the winner still gets their card.
      if (room.phase === 'wager') settleWager(room, bestOption(room));
      clearTimeout(room.aiTimer); clearTimeout(room.wagerTimer); clearTimeout(room.stormTimer);
      rooms.delete(room.code);
      ws.room = null;
      return;
    }
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws, req) => {
  ws.req = req;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg && typeof msg.t === 'string') {
      try { handle(ws, msg); } catch (e) { console.error('Message failed:', e); send(ws, { t: 'error', msg: 'Something went wrong.' }); }
    }
  });
  ws.on('close', () => {
    const r = ws.room && rooms.get(ws.room);
    if (r) pushPresence(r);
  });
});

// Heartbeat, idle-room cleanup, expired sessions.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = humans(r).some(({ p }) => p.ws && p.ws.readyState === 1);
    if (!anyone && now - r.lastActive > 30 * 60 * 1000) {
      if (r.phase === 'wager') { try { settleWager(r, bestOption(r)); } catch { /* ignore */ } }
      clearTimeout(r.aiTimer); clearTimeout(r.wagerTimer); clearTimeout(r.stormTimer); rooms.delete(code);
    }
  }
  auth.pruneSessions();
}, 30000).unref();

server.listen(PORT, HOST, () => console.log(`Triad v${VERSION} on http://${HOST}:${PORT}`));
