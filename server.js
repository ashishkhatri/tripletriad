'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('./wslite');
const TT = require('./public/game.js');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const VERSION = require('./package.json').version;

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
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.pathname === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ version: VERSION }));
  }
  let p = decodeURIComponent(url.pathname);
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

function names(room) { return room.players.map((p) => (p ? p.name : null)); }
function connected(room) { return room.players.map((p) => !!(p && p.ws && p.ws.readyState === 1)); }

function pushState(room, events) {
  room.lastActive = Date.now();
  room.players.forEach((pl, seat) => {
    if (!pl) return;
    send(pl.ws, { t: 'state', you: seat, state: TT.redact(room.state, seat), events: events || [], names: names(room), connected: connected(room) });
  });
}
function pushPresence(room) {
  room.players.forEach((pl) => pl && send(pl.ws, { t: 'presence', names: names(room), connected: connected(room) }));
}

function startGame(room) {
  room.state = TT.newGame(room.rules, undefined, DECKS.get(room.deck));
  room.rematch = [false, false];
  pushState(room, [{ type: 'start' }]);
}

function handle(ws, msg) {
  const room = ws.room ? rooms.get(ws.room) : null;
  switch (msg.t) {
    case 'create': {
      const code = newCode();
      const token = crypto.randomBytes(16).toString('hex');
      const deck = DECKS.has(msg.deck) ? msg.deck : DEFAULT_DECK;
      const r = { code, deck, rules: TT.normalizeRules(msg.rules), players: [{ name: cleanName(msg.name), token, ws }, null], state: null, rematch: [false, false], lastActive: Date.now() };
      rooms.set(code, r);
      ws.room = code; ws.seat = 0;
      return send(ws, { t: 'room', code, you: 0, token, rules: r.rules });
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'error', msg: 'Room not found.' });
      if (r.players[1]) return send(ws, { t: 'error', msg: 'That room is full.' });
      const token = crypto.randomBytes(16).toString('hex');
      r.players[1] = { name: cleanName(msg.name), token, ws };
      ws.room = code; ws.seat = 1;
      send(ws, { t: 'room', code, you: 1, token, rules: r.rules });
      return startGame(r);
    }
    case 'resume': {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      const seat = r ? r.players.findIndex((p) => p && p.token === msg.token) : -1;
      if (seat < 0) return send(ws, { t: 'error', msg: 'Could not rejoin that room.', fatal: true });
      if (r.players[seat].ws && r.players[seat].ws !== ws) r.players[seat].ws.close();
      r.players[seat].ws = ws; ws.room = r.code; ws.seat = seat;
      send(ws, { t: 'room', code: r.code, you: seat, token: msg.token, rules: r.rules });
      if (r.state) pushState(r, []); else pushPresence(r);
      return pushPresence(r);
    }
    case 'move': {
      if (!room || !room.state) return;
      try {
        const { state, events } = TT.applyMove(room.state, ws.seat, Number(msg.hand), Number(msg.cell));
        room.state = state;
        pushState(room, events);
      } catch (e) {
        send(ws, { t: 'error', msg: e.message });
      }
      return;
    }
    case 'rematch': {
      if (!room || !room.state || !room.state.over) return;
      room.rematch[ws.seat] = true;
      if (room.rematch[0] && room.rematch[1]) return startGame(room);
      const other = room.players[1 - ws.seat];
      return other && send(other.ws, { t: 'rematch_requested' });
    }
    case 'leave': {
      if (!room) return;
      const other = room.players[1 - ws.seat];
      if (other) send(other.ws, { t: 'opponent_left' });
      rooms.delete(room.code);
      ws.room = null;
      return;
    }
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg && typeof msg.t === 'string') handle(ws, msg);
  });
  ws.on('close', () => {
    const r = ws.room && rooms.get(ws.room);
    if (r) pushPresence(r);
  });
});

// Heartbeat + cleanup of idle rooms.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = connected(r).some(Boolean);
    if (!anyone && now - r.lastActive > 30 * 60 * 1000) rooms.delete(code);
  }
}, 30000).unref();

server.listen(PORT, HOST, () => console.log(`Triad v${VERSION} on http://${HOST}:${PORT}`));
