'use strict';
/*
 * Tiny JSON-file database. Everything lives in memory and is written to disk
 * (atomically: temp file + rename) shortly after each change, and on shutdown.
 * Location: $DATA_DIR/triad.json (default ./data).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'triad.json');

let data = { version: 1, users: {}, sessions: {} };
let timer = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data.users = data.users || {};
    data.sessions = data.sessions || {};
  }
  return data;
}

function flush() {
  clearTimeout(timer); timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}

function save() {
  if (!timer) timer = setTimeout(() => { try { flush(); } catch (e) { console.error('DB save failed:', e.message); } }, 300);
}

function get() { return data; }

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { if (timer) flush(); } catch (e) { /* ignore */ } process.exit(0); });
}

module.exports = { load, save, flush, get, DATA_DIR, FILE };
