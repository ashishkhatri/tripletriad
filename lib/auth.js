'use strict';
/* Accounts: scrypt-hashed passwords, random session tokens in an HttpOnly cookie. */
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'triad_session';
const SESSION_DAYS = 180;
const NAME_RE = /^[\p{L}\p{N} _.\-]{3,16}$/u;

const keyOf = (name) => String(name).trim().toLowerCase();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

// Simple brute-force brake: after 5 failures, a name is locked for a minute.
const failures = new Map();
function locked(key) {
  const f = failures.get(key);
  return f && f.count >= 5 && Date.now() - f.last < 60_000;
}
function fail(key) {
  const f = failures.get(key) || { count: 0, last: 0 };
  if (Date.now() - f.last > 60_000) f.count = 0;
  f.count++; f.last = Date.now();
  failures.set(key, f);
}

function newSession(key) {
  const token = crypto.randomBytes(32).toString('hex');
  db.get().sessions[token] = { user: key, expires: Date.now() + SESSION_DAYS * 864e5 };
  db.save();
  return token;
}

function register(name, password) {
  name = String(name || '').trim();
  if (!NAME_RE.test(name)) throw new Error('Names are 3–16 letters, numbers, spaces, dots, dashes or underscores.');
  if (String(password || '').length < 6) throw new Error('Passwords need at least 6 characters.');
  if (String(password).length > 200) throw new Error('That password is too long.');
  const key = keyOf(name);
  const users = db.get().users;
  if (users[key]) throw new Error('That name is taken.');
  users[key] = { name, ...hashPassword(password), created: Date.now(), sets: {} };
  db.save();
  db.seedAdmin();
  return { key, token: newSession(key) };
}

function login(name, password) {
  const key = keyOf(name || '');
  if (locked(key)) throw new Error('Too many attempts. Wait a minute and try again.');
  const user = db.get().users[key];
  if (!user || !checkPassword(user, password || '')) { fail(key); throw new Error('Wrong name or password.'); }
  failures.delete(key);
  return { key, token: newSession(key) };
}

function logout(token) {
  if (token && db.get().sessions[token]) { delete db.get().sessions[token]; db.save(); }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Returns { key, user, token } for a request/upgrade with a valid session cookie, else null.
function fromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = db.get().sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.get().sessions[token]; db.save(); return null; }
  const user = db.get().users[s.user];
  if (user && Date.now() - (user.lastSeen || 0) > 5 * 60_000) { user.lastSeen = Date.now(); db.save(); }   // roughly, for the admin page
  return user ? { key: s.user, user, token } : null;
}

function cookieHeader(req, token, clear = false) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  const parts = [`${COOKIE}=${clear ? '' : token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function pruneSessions() {
  const now = Date.now(), sessions = db.get().sessions;
  let n = 0;
  for (const [t, s] of Object.entries(sessions)) if (s.expires < now) { delete sessions[t]; n++; }
  if (n) db.save();
}

module.exports = { hashPassword, keyOf, register, login, logout, fromRequest, cookieHeader, pruneSessions };
