'use strict';
/*
 * Generates original SVG card art for every deck in public/decks.
 * Each card is drawn from its `form` (or a guess from its name), element and level,
 * using a seed from the card's name so the art is stable between runs.
 *
 *   node tools/genart.js           # regenerate art for all decks
 *   node tools/genart.js tidebound # one deck
 *
 * Cards whose "image" points outside art/<deck>/ are left alone, so your own art is never overwritten.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const DECKS = path.join(PUBLIC, 'decks');

// ---------- utilities ----------
function mulberry(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const hsl = (h, s, l, a = 1) => `hsla(${Math.round(((h % 360) + 360) % 360)},${Math.round(s)}%,${Math.round(l)}%,${a})`;
const f = (n) => Math.round(n * 10) / 10;
const EL_HUE = { fire: 12, ice: 195, thunder: 50, earth: 30, poison: 285, wind: 135, water: 212, holy: 44 };
const SKIN = ['#f6d2b5', '#eab792', '#c98e62', '#9b6440', '#6e4429', '#f1c7a1'];
const HAIR = ['#2b1d14', '#5a3a22', '#a0652f', '#d9b26a', '#e8e4da', '#7a2e2a', '#2d2d3a'];

function ctxFor(deck, card) {
  const rng = mulberry(hash(`${deck.id}:${card.id}:${card.name}`));
  const R = (a, b) => a + rng() * (b - a);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const chance = (p) => rng() < p;
  const base = card.element ? EL_HUE[card.element] : Math.floor(rng() * 360);
  const h = (base + R(-14, 14) + 360) % 360;
  const sat = card.element === 'earth' ? 42 : card.element === 'ice' ? 55 : 68;
  const ah = (h + pick([150, 180, 210])) % 360;
  const pal = {
    h, ah,
    main: hsl(h, sat, 54), light: hsl(h, sat + 10, 76), dark: hsl(h, sat - 5, 32), deep: hsl(h, sat, 20),
    ol: hsl(h, 45, 13),
    acc: hsl(ah, 72, 58), accLight: hsl(ah, 80, 76), accDark: hsl(ah, 60, 32),
    glow: hsl(card.element === 'holy' ? 48 : h, 95, 70),
  };
  const name = card.name.toLowerCase();
  const has = (re) => re.test(name);
  return { rng, R, pick, chance, card, deck, pal, el: card.element || null, lvl: card.level || 1, name, has };
}

const O = (c, w = 3) => `stroke="${c.pal.ol}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

// ---------- shared parts ----------
function eye(c, x, y, r, o = {}) {
  if (o.glow) {
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 2.2)}" fill="url(#glow)"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * (o.slit ? 0.45 : 0.8))}" fill="${o.color || c.pal.glow}"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r * 0.45)}" ry="${f(r * 0.3)}" fill="#fff"/>`;
  }
  const lx = x + (o.look || 0) * r * 0.25;
  let s = `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#fff" ${O(c, 2.2)}/>` +
    `<circle cx="${f(lx)}" cy="${f(y + r * 0.1)}" r="${f(r * 0.58)}" fill="${o.iris || '#1d1a2b'}"/>` +
    `<circle cx="${f(lx - r * 0.22)}" cy="${f(y - r * 0.2)}" r="${f(r * 0.22)}" fill="#fff"/>`;
  if (o.angry) s += `<path d="M${f(x - r * 1.1)},${f(y - r * 1.25 + (o.side || 0) * r * 0.4)} L${f(x + r * 1.1)},${f(y - r * 1.25 - (o.side || 0) * r * 0.4)}" ${O(c, 3)} fill="none"/>`;
  return s;
}
function eyes(c, y, gap, r, o = {}) {
  return eye(c, -gap, y, r, { ...o, side: -1 }) + eye(c, gap, y, r, { ...o, side: 1 });
}
function mouth(c, x, y, w, kind) {
  kind = kind || (c.lvl >= 4 ? c.pick(['fangs', 'grin', 'frown']) : c.pick(['smile', 'smile', 'o', 'fangs']));
  if (kind === 'smile') return `<path d="M${f(x - w)},${f(y)} Q${f(x)},${f(y + w * 0.9)} ${f(x + w)},${f(y)}" fill="none" ${O(c, 2.6)}/>`;
  if (kind === 'o') return `<ellipse cx="${f(x)}" cy="${f(y + 2)}" rx="${f(w * 0.45)}" ry="${f(w * 0.55)}" fill="${c.pal.deep}" ${O(c, 2.2)}/>`;
  if (kind === 'frown') return `<path d="M${f(x - w)},${f(y + 4)} Q${f(x)},${f(y - w * 0.4)} ${f(x + w)},${f(y + 4)}" fill="none" ${O(c, 2.6)}/>`;
  if (kind === 'grin') {
    return `<path d="M${f(x - w)},${f(y)} Q${f(x)},${f(y + w)} ${f(x + w)},${f(y)} Z" fill="${c.pal.deep}" ${O(c, 2.4)}/>` +
      `<path d="M${f(x - w * 0.8)},${f(y + 1)} L${f(x - w * 0.5)},${f(y + w * 0.4)} L${f(x - w * 0.2)},${f(y + 2)} M${f(x + w * 0.2)},${f(y + 2)} L${f(x + w * 0.5)},${f(y + w * 0.4)} L${f(x + w * 0.8)},${f(y + 1)}" fill="#fff" stroke="none"/>`;
  }
  // fangs
  return `<path d="M${f(x - w)},${f(y)} Q${f(x)},${f(y + w * 0.7)} ${f(x + w)},${f(y)}" fill="none" ${O(c, 2.6)}/>` +
    `<path d="M${f(x - w * 0.55)},${f(y + w * 0.22)} l3,8 l3,-7 Z M${f(x + w * 0.55 - 6)},${f(y + w * 0.22)} l3,8 l3,-8 Z" fill="#fff" ${O(c, 1.5)}/>`;
}
function horn(c, x, y, dir, len, w = 7) {
  return `<path d="M${f(x - w)},${f(y)} Q${f(x - w * 0.5 + dir * len * 0.1)},${f(y - len * 0.6)} ${f(x + dir * len * 0.45)},${f(y - len)} Q${f(x + w * 0.6 + dir * len * 0.15)},${f(y - len * 0.45)} ${f(x + w)},${f(y)} Z" fill="#efe3c4" ${O(c, 2.4)}/>`;
}
function crown(c, x, y, w) {
  const h = w * 0.55;
  return `<path d="M${f(x - w)},${f(y)} L${f(x - w)},${f(y - h)} L${f(x - w * 0.5)},${f(y - h * 0.45)} L${f(x)},${f(y - h * 1.2)} L${f(x + w * 0.5)},${f(y - h * 0.45)} L${f(x + w)},${f(y - h)} L${f(x + w)},${f(y)} Z" fill="#f2c94c" ${O(c, 2.4)}/>` +
    `<circle cx="${f(x)}" cy="${f(y - h * 0.35)}" r="${f(w * 0.16)}" fill="${c.pal.acc}" ${O(c, 1.5)}/>`;
}
function halo(c, x, y, rx) {
  return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(rx * 0.28)}" fill="none" stroke="#fff3b0" stroke-width="5" opacity=".9"/>` +
    `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(rx * 0.28)}" fill="none" stroke="#f2c94c" stroke-width="2.5"/>`;
}
function featherWings(c, y, span, color) {
  const one = (sx) => {
    let s = `<g transform="scale(${sx},1)"><path d="M-10,${y} C-40,${y - 50} -${span},${y - 60} -${span + 8},${y - 20} C-${span - 10},${y - 10} -${span - 2},${y + 5} -${span - 14},${y + 12} C-${span - 30},${y + 6} -${span - 34},${y + 22} -${span - 48},${y + 24} C-40,${y + 20} -25,${y + 18} -10,${y + 12} Z" fill="${color}" ${O(c, 2.6)}/>`;
    for (let i = 0; i < 3; i++) s += `<path d="M-${20 + i * 15},${y + 8 - i * 2} Q-${30 + i * 18},${y - 20 - i * 6} -${span - 10 + i * 4},${y - 25 + i * 14}" fill="none" stroke="${c.pal.ol}" stroke-width="1.4" opacity=".5"/>`;
    return s + '</g>';
  };
  return one(1) + one(-1);
}
function batWings(c, y, span) {
  const one = (sx) => `<g transform="scale(${sx},1)"><path d="M-6,${y} L-${span * 0.55},${y - 58} L-${span},${y - 40} L-${span * 0.86},${y - 14} L-${span * 0.95},${y + 2} L-${span * 0.66},${y + 4} L-${span * 0.6},${y + 22} L-${span * 0.3},${y + 14} L-10,${y + 22} Z" fill="${c.pal.dark}" ${O(c, 2.6)}/>` +
    `<path d="M-${span * 0.55},${y - 58} L-${span * 0.4},${y + 16} M-${span * 0.55},${y - 58} L-${span * 0.75},${y + 4}" stroke="${c.pal.ol}" stroke-width="2" fill="none"/></g>`;
  return one(1) + one(-1);
}

// ---------- backgrounds ----------
function motif(c) {
  const { R, el } = c;
  let s = '';
  if (el === 'fire') {
    for (let i = 0; i < 7; i++) {
      const x = i * 32 + R(-6, 6), h = R(35, 75), w = R(10, 16);
      s += `<path d="M${f(x - w)},252 C${f(x - w)},${f(252 - h * 0.5)} ${f(x - w * 0.2)},${f(252 - h * 0.6)} ${f(x)},${f(252 - h)} C${f(x + w * 0.2)},${f(252 - h * 0.6)} ${f(x + w)},${f(252 - h * 0.5)} ${f(x + w)},252 Z" fill="hsla(25,95%,58%,.28)"/>`;
    }
    for (let i = 0; i < 10; i++) s += `<circle cx="${f(R(5, 195))}" cy="${f(R(20, 200))}" r="${f(R(1, 2.5))}" fill="hsla(40,100%,75%,${f(R(0.3, 0.8))})"/>`;
  } else if (el === 'ice') {
    for (const [x0, dir] of [[0, 1], [200, -1]]) {
      for (let i = 0; i < 3; i++) {
        const x = x0 + dir * (10 + i * 18), h = R(40, 85), w = R(8, 14);
        s += `<polygon points="${f(x - w)},252 ${f(x + dir * 4)},${f(252 - h)} ${f(x + w)},252" fill="hsla(195,90%,85%,.22)" stroke="hsla(195,90%,92%,.35)" stroke-width="1"/>`;
      }
    }
    for (let i = 0; i < 14; i++) { const x = R(5, 195), y = R(10, 220), r = R(1.5, 3.5); s += `<path d="M${f(x - r)},${f(y)} L${f(x + r)},${f(y)} M${f(x)},${f(y - r)} L${f(x)},${f(y + r)}" stroke="hsla(195,100%,95%,.6)" stroke-width="1"/>`; }
  } else if (el === 'thunder') {
    for (let k = 0; k < 2; k++) {
      let x = R(20, 180), y = 0, pts = [`${f(x)},0`];
      while (y < 140) { y += R(18, 30); x += R(-24, 24); pts.push(`${f(x)},${f(y)}`); }
      s += `<polyline points="${pts.join(' ')}" fill="none" stroke="hsla(52,100%,75%,.35)" stroke-width="${f(R(2, 4))}" stroke-linejoin="round"/>`;
    }
  } else if (el === 'earth') {
    s += `<ellipse cx="40" cy="250" rx="90" ry="45" fill="hsla(30,35%,22%,.6)"/><ellipse cx="170" cy="255" rx="80" ry="40" fill="hsla(30,30%,18%,.6)"/>`;
    for (let i = 0; i < 5; i++) s += `<path d="M${f(R(0, 200))},${f(R(205, 240))} l${f(R(6, 14))},-${f(R(6, 12))} l${f(R(6, 12))},${f(R(6, 12))} Z" fill="hsla(30,25%,40%,.45)"/>`;
  } else if (el === 'poison') {
    for (let i = 0; i < 16; i++) s += `<circle cx="${f(R(5, 195))}" cy="${f(R(30, 245))}" r="${f(R(2, 9))}" fill="hsla(110,70%,55%,.12)" stroke="hsla(110,80%,65%,.35)" stroke-width="1"/>`;
  } else if (el === 'wind') {
    for (let i = 0; i < 5; i++) {
      const y = R(30, 230), x = R(-20, 120), w = R(40, 80);
      s += `<path d="M${f(x)},${f(y)} q${f(w / 2)},-14 ${f(w)},0 t${f(w)},0" fill="none" stroke="hsla(140,60%,85%,.25)" stroke-width="2.5" stroke-linecap="round"/>`;
    }
  } else if (el === 'water') {
    for (let i = 0; i < 4; i++) {
      const y = 185 + i * 16;
      s += `<path d="M-10,${y} q12.5,-8 25,0 t25,0 t25,0 t25,0 t25,0 t25,0 t25,0 t25,0 t25,0" fill="none" stroke="hsla(205,90%,80%,${f(0.18 + i * 0.05)})" stroke-width="2.5"/>`;
    }
    for (let i = 0; i < 8; i++) s += `<circle cx="${f(R(5, 195))}" cy="${f(R(20, 170))}" r="${f(R(1.5, 4))}" fill="none" stroke="hsla(200,90%,85%,.35)" stroke-width="1"/>`;
  } else if (el === 'holy') {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, a2 = a + 0.1;
      s += `<polygon points="100,120 ${f(100 + Math.cos(a) * 260)},${f(120 + Math.sin(a) * 260)} ${f(100 + Math.cos(a2) * 260)},${f(120 + Math.sin(a2) * 260)}" fill="hsla(48,100%,80%,.10)"/>`;
    }
  } else {
    for (let i = 0; i < 22; i++) s += `<circle cx="${f(R(3, 197))}" cy="${f(R(3, 247))}" r="${f(R(0.6, 1.8))}" fill="#fff" opacity="${f(R(0.15, 0.6))}"/>`;
  }
  return s;
}
function aura(c) {
  if (c.lvl >= 5) {
    let rays = '';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      rays += `<path d="M${f(100 + Math.cos(a) * 62)},${f(128 + Math.sin(a) * 62)} L${f(100 + Math.cos(a) * 84)},${f(128 + Math.sin(a) * 84)}" stroke="#f2d27a" stroke-width="2" opacity=".55"/>`;
    }
    return `<circle cx="100" cy="128" r="92" fill="url(#glow)" opacity=".45"/><circle cx="100" cy="128" r="72" fill="none" stroke="#f2d27a" stroke-width="1.5" opacity=".6"/>${rays}`;
  }
  if (c.lvl === 4) return `<circle cx="100" cy="128" r="80" fill="url(#glow)" opacity=".3"/>`;
  return '';
}

// ---------- subject forms ----------
const FORMS = {};

FORMS.blob = (c) => {
  const w = c.R(46, 58), h = c.R(42, 54);
  const top = c.pick(c.has(/snail|kelp/) ? ['shell'] : c.has(/urchin|bramble|thorn/) ? ['spikes'] : ['ears', 'horns', 'spikes', 'antenna', 'none', 'ears']);
  let s = '';
  if (top === 'shell') {
    s += `<circle cx="-14" cy="-${f(h * 0.5)}" r="${f(h * 0.75)}" fill="url(#ga)" ${O(c)}/><path d="M-14,-${f(h * 0.5)} m-${f(h * 0.45)},0 a${f(h * 0.45)},${f(h * 0.45)} 0 1,1 ${f(h * 0.45)},${f(h * 0.45)} a${f(h * 0.25)},${f(h * 0.25)} 0 1,1 0,-${f(h * 0.5)}" fill="none" ${O(c, 2.2)}/>`;
  }
  if (top === 'ears') s += `<path d="M-${f(w * 0.75)},-${f(h * 0.4)} L-${f(w * 0.95)},-${f(h * 1.35)} L-${f(w * 0.2)},-${f(h * 0.8)} Z M${f(w * 0.75)},-${f(h * 0.4)} L${f(w * 0.95)},-${f(h * 1.35)} L${f(w * 0.2)},-${f(h * 0.8)} Z" fill="${c.pal.dark}" ${O(c)}/>`;
  if (top === 'horns') s += horn(c, -w * 0.45, -h * 0.75, -1, 30) + horn(c, w * 0.45, -h * 0.75, 1, 30);
  if (top === 'spikes') {
    for (let i = -3; i <= 3; i++) {
      const a = -Math.PI / 2 + i * 0.35, x = Math.cos(a) * w, y = Math.sin(a) * h;
      s += `<path d="M${f(x - 7 * Math.sin(a))},${f(y + 7 * Math.cos(a))} L${f(Math.cos(a) * (w + 18))},${f(Math.sin(a) * (h + 18))} L${f(x + 7 * Math.sin(a))},${f(y - 7 * Math.cos(a))} Z" fill="${c.pal.accDark}" ${O(c, 2.2)}/>`;
    }
  }
  if (top === 'antenna') s += `<path d="M-12,-${f(h * 0.9)} Q-20,-${f(h * 1.4)} -30,-${f(h * 1.5)} M12,-${f(h * 0.9)} Q20,-${f(h * 1.4)} 30,-${f(h * 1.5)}" fill="none" ${O(c, 3)}/><circle cx="-30" cy="-${f(h * 1.5)}" r="6" fill="url(#ga)" ${O(c, 2)}/><circle cx="30" cy="-${f(h * 1.5)}" r="6" fill="url(#ga)" ${O(c, 2)}/>`;
  s += `<ellipse cx="-24" cy="${f(h - 4)}" rx="15" ry="9" fill="${c.pal.dark}" ${O(c)}/><ellipse cx="24" cy="${f(h - 4)}" rx="15" ry="9" fill="${c.pal.dark}" ${O(c)}/>`;
  s += `<ellipse cx="0" cy="0" rx="${f(w)}" ry="${f(h)}" fill="url(#gm)" ${O(c)}/>`;
  s += `<ellipse cx="0" cy="${f(h * 0.38)}" rx="${f(w * 0.6)}" ry="${f(h * 0.45)}" fill="${c.pal.light}" opacity=".55"/>`;
  for (let i = 0; i < 4; i++) s += `<circle cx="${f(c.R(-w * 0.7, w * 0.7))}" cy="${f(c.R(-h * 0.7, -h * 0.1))}" r="${f(c.R(3, 6))}" fill="${c.pal.dark}" opacity=".35"/>`;
  const one = c.chance(0.15);
  s += one ? eye(c, 0, -h * 0.25, 13) : eyes(c, -h * 0.22, w * 0.32, 10, { angry: c.lvl >= 3 });
  s += mouth(c, 0, h * 0.18, 12);
  if (c.has(/toad|newt/)) s += `<ellipse cx="-${f(w * 0.55)}" cy="${f(h * 0.05)}" rx="7" ry="4" fill="#ff9aa2" opacity=".6"/><ellipse cx="${f(w * 0.55)}" cy="${f(h * 0.05)}" rx="7" ry="4" fill="#ff9aa2" opacity=".6"/>`;
  return s;
};

FORMS.quad = (c) => {
  let s = '';
  // tail
  s += c.has(/lynx|cat/) ? `<path d="M-50,0 C-75,-10 -70,-45 -55,-55" fill="none" stroke="${c.pal.ol}" stroke-width="13" stroke-linecap="round"/><path d="M-50,0 C-75,-10 -70,-45 -55,-55" fill="none" stroke="${c.pal.main}" stroke-width="8" stroke-linecap="round"/>`
    : `<path d="M-48,5 C-70,0 -80,-25 -72,-40 C-62,-20 -55,-15 -40,-8 Z" fill="${c.pal.dark}" ${O(c)}/>`;
  // back legs
  s += `<rect x="-42" y="22" width="15" height="40" rx="7" fill="${c.pal.dark}" ${O(c)}/><rect x="14" y="22" width="15" height="40" rx="7" fill="${c.pal.dark}" ${O(c)}/>`;
  s += `<ellipse cx="-5" cy="12" rx="50" ry="29" fill="url(#gm)" ${O(c)}/>`;
  s += `<ellipse cx="-2" cy="24" rx="36" ry="13" fill="${c.pal.light}" opacity=".45"/>`;
  s += `<rect x="-28" y="26" width="15" height="40" rx="7" fill="url(#gm)" ${O(c)}/><rect x="28" y="26" width="15" height="40" rx="7" fill="url(#gm)" ${O(c)}/>`;
  if (c.has(/thorn|spine/) || c.lvl >= 4) {
    for (let i = 0; i < 5; i++) s += `<path d="M${-40 + i * 14},-12 l6,-${f(c.R(12, 20))} l7,${f(c.R(10, 16))} Z" fill="${c.pal.accDark}" ${O(c, 2)}/>`;
  }
  // neck + head
  s += `<ellipse cx="32" cy="-6" rx="17" ry="22" fill="url(#gm)" ${O(c)}/>`;
  if (c.has(/stag|deer/)) {
    s += `<path d="M30,-46 L22,-80 M24,-66 L10,-76 M26,-74 L30,-90 M50,-46 L58,-80 M56,-66 L70,-74 M57,-74 L52,-92" stroke="#efe3c4" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    s += `<path d="M30,-46 L22,-80 M24,-66 L10,-76 M26,-74 L30,-90 M50,-46 L58,-80 M56,-66 L70,-74 M57,-74 L52,-92" stroke="${c.pal.ol}" stroke-width="1.5" fill="none" opacity=".6"/>`;
  }
  s += `<path d="M24,-38 L18,-64 L38,-46 Z M48,-42 L58,-66 L60,-38 Z" fill="${c.pal.dark}" ${O(c)}/>`;
  if (c.has(/lynx|wolf/)) s += `<path d="M18,-20 C10,-40 30,-50 44,-48 C58,-50 72,-36 64,-14 C50,-4 30,-4 18,-20 Z" fill="${c.pal.light}" ${O(c, 2.4)}/>`;
  s += `<circle cx="40" cy="-26" r="24" fill="url(#gm)" ${O(c)}/>`;
  s += `<ellipse cx="60" cy="-16" rx="17" ry="12" fill="${c.pal.light}" ${O(c)}/><ellipse cx="73" cy="-20" rx="5" ry="4" fill="${c.pal.ol}"/>`;
  s += mouth(c, 60, -8, 8, c.has(/hound|wolf/) || c.lvl >= 3 ? 'fangs' : 'smile');
  s += eye(c, 42, -32, 8, { angry: c.lvl >= 3, look: 1 });
  if (c.el === 'fire') s += `<path d="M-64,-40 q-6,-14 4,-24 q2,10 8,12 q4,-8 0,-16 q14,8 8,28 Z" fill="hsla(30,100%,60%,.9)" ${O(c, 1.8)}/>`;
  return s;
};

FORMS.bird = (c) => {
  let s = featherWings(c, -10, 78, c.lvl >= 4 ? 'url(#ga)' : c.pal.dark);
  if (c.has(/phoenix/) || c.el === 'fire') {
    for (let i = -2; i <= 2; i++) s += `<path d="M${i * 9},40 Q${i * 22},62 ${i * 16},82 Q${i * 6 + 4},64 ${i * 9 + 4},40 Z" fill="hsla(${25 + i * 8},100%,60%,.95)" ${O(c, 1.8)}/>`;
  } else {
    for (let i = -1; i <= 1; i++) s += `<ellipse cx="${i * 12}" cy="58" rx="8" ry="22" transform="rotate(${i * 18} ${i * 12} 58)" fill="${c.pal.dark}" ${O(c, 2.4)}/>`;
  }
  s += `<path d="M-14,52 l-4,12 M-14,52 l2,13 M-14,52 l8,10 M14,52 l4,12 M14,52 l-2,13 M14,52 l-8,10" stroke="#e8b34a" stroke-width="3.5" stroke-linecap="round"/>`;
  s += `<ellipse cx="0" cy="12" rx="34" ry="42" fill="url(#gm)" ${O(c)}/>`;
  s += `<ellipse cx="0" cy="22" rx="22" ry="30" fill="${c.pal.light}" opacity=".5"/>`;
  for (let i = 0; i < 3; i++) s += `<path d="M${-12 + i * 12},${12 + (i % 2) * 6} q6,6 12,0" fill="none" stroke="${c.pal.dark}" stroke-width="1.6" opacity=".6"/>`;
  // crest
  for (let i = -1; i <= 1; i++) s += `<ellipse cx="${i * 8}" cy="-66" rx="5" ry="16" transform="rotate(${i * 22} ${i * 8} -56)" fill="url(#ga)" ${O(c, 2.2)}/>`;
  s += `<circle cx="0" cy="-38" r="24" fill="url(#gm)" ${O(c)}/>`;
  s += eyes(c, -42, 10, 7, { angry: c.lvl >= 3 });
  s += `<path d="M-8,-30 L8,-30 L0,-14 Z" fill="#f2b84b" ${O(c, 2.2)}/>`;
  if (c.el === 'thunder') s += `<path d="M-60,-40 l10,10 l-8,4 l12,14" fill="none" stroke="#fff27a" stroke-width="3" stroke-linejoin="round"/>`;
  return s;
};

FORMS.serpent = (c) => {
  let s = '';
  const winged = c.has(/drake|wyrm|hydra/) && !c.has(/plague/) ? true : c.has(/plague/) ? c.lvl >= 4 : false;
  if (winged) s += `<g transform="translate(0,-10)">${batWings(c, -10, 88)}</g>`;
  const vine = c.deck.id === 'bloomwild';
  const d = 'M-62,60 C-96,22 -18,34 -10,8 C-2,-18 -52,-26 -24,-48 C-6,-62 18,-58 28,-48';
  s += `<path d="${d}" fill="none" stroke="${c.pal.ol}" stroke-width="${vine ? 22 : 34}" stroke-linecap="round"/>`;
  s += `<path d="${d}" fill="none" stroke="${c.pal.main}" stroke-width="${vine ? 16 : 28}" stroke-linecap="round"/>`;
  s += `<path d="${d}" fill="none" stroke="${c.pal.light}" stroke-width="${vine ? 5 : 9}" stroke-linecap="round" stroke-dasharray="6 7" opacity=".7"/>`;
  if (vine) {
    for (const [x, y, r] of [[-70, 30, 20], [-20, 20, -30], [-40, -30, 40], [-8, -2, 10]]) s += `<ellipse cx="${x}" cy="${y}" rx="11" ry="5" transform="rotate(${r} ${x} ${y})" fill="${hsl(110, 55, 45)}" ${O(c, 2)}/>`;
  } else {
    for (const [x, y] of [[-70, 24], [-30, 28], [-20, -10], [-40, -38], [-10, -56]]) s += `<path d="M${x - 6},${y} l6,-12 l6,12 Z" fill="${c.pal.accDark}" ${O(c, 2)}/>`;
  }
  // head
  s += `<g transform="translate(40,-48) rotate(-8)">`;
  if (c.has(/wyrm|drake|hydra|leviathan/)) s += horn(c, -12, -12, -1, 26, 6) + horn(c, 6, -14, 1, 24, 6);
  s += `<path d="M-22,-16 C-6,-28 22,-22 34,-8 C38,0 30,8 18,10 L-6,12 C-20,10 -28,0 -22,-16 Z" fill="url(#gm)" ${O(c)}/>`;
  s += `<path d="M-4,12 C8,22 26,18 32,6" fill="${c.pal.light}" ${O(c, 2.4)}/>`;
  s += eye(c, 2, -8, 7, { angry: true, look: 1 });
  s += `<circle cx="28" cy="-6" r="2" fill="${c.pal.ol}"/>`;
  if (c.lvl >= 3) s += `<path d="M14,9 l2,6 l3,-5 M22,8 l2,6 l3,-6" fill="#fff" stroke="${c.pal.ol}" stroke-width="1.2"/>`;
  if (c.has(/eel|thunder/)) s += `<path d="M30,-18 l8,-10 l-2,8 l8,-6" fill="none" stroke="#fff27a" stroke-width="2.5"/>`;
  s += '</g>';
  return s;
};

FORMS.insect = (c) => {
  let s = '';
  const spider = c.has(/matriarch|weaver|spider/);
  const moth = c.has(/moth|butterfly/);
  const beetle = c.has(/beetle|mite/);
  if (moth) {
    s += `<path d="M-6,-10 C-40,-70 -92,-56 -82,-6 C-76,18 -40,8 -6,0 Z M6,-10 C40,-70 92,-56 82,-6 C76,18 40,8 6,0 Z" fill="url(#ga)" ${O(c)}/>`;
    s += `<path d="M-6,4 C-40,10 -66,40 -46,56 C-30,64 -14,40 -6,14 Z M6,4 C40,10 66,40 46,56 C30,64 14,40 6,14 Z" fill="url(#gm)" ${O(c)}/>`;
    s += `<circle cx="-50" cy="-26" r="10" fill="${c.pal.dark}" ${O(c, 2)}/><circle cx="50" cy="-26" r="10" fill="${c.pal.dark}" ${O(c, 2)}/><circle cx="-50" cy="-26" r="4" fill="#fff"/><circle cx="50" cy="-26" r="4" fill="#fff"/>`;
  }
  const legs = spider ? 4 : 3;
  for (let i = 0; i < legs; i++) {
    const y = -6 + i * 14;
    for (const sx of [-1, 1]) s += `<polyline points="${sx * 16},${y} ${sx * (48 + i * 4)},${y - 22 + i * 4} ${sx * (62 + i * 4)},${y + 22 + i * 6}" fill="none" ${O(c, 4)}/>`;
  }
  s += `<ellipse cx="0" cy="32" rx="${spider ? 36 : 28}" ry="${spider ? 34 : 30}" fill="url(#gm)" ${O(c)}/>`;
  if (!beetle) for (let i = 0; i < 3; i++) s += `<path d="M-${24 - i * 3},${22 + i * 12} Q0,${28 + i * 12} ${24 - i * 3},${22 + i * 12}" fill="none" stroke="${c.pal.dark}" stroke-width="3" opacity=".6"/>`;
  if (spider) s += `<path d="M-10,22 L10,22 L4,34 L10,46 L-10,46 L-4,34 Z" fill="${c.pal.acc}" ${O(c, 2)}/>`;
  if (beetle) s += `<path d="M0,4 C-30,4 -34,40 -24,58 C-14,64 -4,60 0,56 C4,60 14,64 24,58 C34,40 30,4 0,4 Z" fill="url(#ga)" ${O(c)}/><path d="M0,6 L0,56" ${O(c, 2.2)}/>`;
  s += `<circle cx="0" cy="-8" r="18" fill="url(#gm)" ${O(c)}/>`;
  if (!spider) s += `<path d="M-8,-50 Q-20,-78 -34,-80 M8,-50 Q20,-78 34,-80" fill="none" ${O(c, 2.6)}/><circle cx="-34" cy="-80" r="4.5" fill="${c.pal.acc}" ${O(c, 1.8)}/><circle cx="34" cy="-80" r="4.5" fill="${c.pal.acc}" ${O(c, 1.8)}/>`;
  if (beetle && c.lvl >= 1 && c.has(/beetle/)) s += horn(c, 0, -52, 1, 22, 5);
  s += `<circle cx="0" cy="-36" r="19" fill="url(#gm)" ${O(c)}/>`;
  if (spider) {
    s += eyes(c, -40, 7, 5.5, {}) + `<circle cx="-14" cy="-31" r="3.2" fill="#1d1a2b"/><circle cx="14" cy="-31" r="3.2" fill="#1d1a2b"/><circle cx="-4" cy="-28" r="2.4" fill="#1d1a2b"/><circle cx="4" cy="-28" r="2.4" fill="#1d1a2b"/>`;
    s += `<path d="M-6,-22 l-3,10 M6,-22 l3,10" ${O(c, 3)}/>`;
  } else {
    s += `<ellipse cx="-9" cy="-38" rx="8" ry="10" fill="${c.pal.deep}" ${O(c, 2)}/><ellipse cx="9" cy="-38" rx="8" ry="10" fill="${c.pal.deep}" ${O(c, 2)}/><circle cx="-11" cy="-41" r="3" fill="#fff"/><circle cx="7" cy="-41" r="3" fill="#fff"/>`;
    s += mouth(c, 0, -26, 6, 'smile');
  }
  return s;
};

FORMS.golem = (c) => {
  let s = '';
  const knight = c.has(/knight|sentinel|lancer/);
  s += `<rect x="-34" y="34" width="22" height="30" rx="5" fill="${c.pal.dark}" ${O(c)}/><rect x="12" y="34" width="22" height="30" rx="5" fill="${c.pal.dark}" ${O(c)}/>`;
  s += `<rect x="-66" y="-22" width="26" height="56" rx="10" fill="url(#gm)" ${O(c)}/><rect x="40" y="-22" width="26" height="56" rx="10" fill="url(#gm)" ${O(c)}/>`;
  s += `<circle cx="-53" cy="42" r="15" fill="${c.pal.dark}" ${O(c)}/><circle cx="53" cy="42" r="15" fill="${c.pal.dark}" ${O(c)}/>`;
  if (c.has(/lancer/)) s += `<path d="M62,60 L62,-88" stroke="${c.pal.ol}" stroke-width="7"/><path d="M62,60 L62,-88" stroke="#c9ced8" stroke-width="3.5"/><path d="M62,-108 L54,-84 L70,-84 Z" fill="#e6ebf2" ${O(c, 2)}/>`;
  s += `<path d="M-42,-28 L42,-28 L36,40 L-36,40 Z" fill="url(#gm)" ${O(c)}/>`;
  s += `<rect x="-70" y="-34" width="34" height="20" rx="8" fill="url(#ga)" ${O(c)}/><rect x="36" y="-34" width="34" height="20" rx="8" fill="url(#ga)" ${O(c)}/>`;
  s += `<circle cx="0" cy="4" r="10" fill="url(#glow)"/><polygon points="0,-6 9,4 0,14 -9,4" fill="${c.pal.glow}" ${O(c, 2)}/>`;
  for (const [x, y] of [[-30, -20], [30, -20], [-26, 30], [26, 30]]) s += `<circle cx="${x}" cy="${y}" r="2.8" fill="${c.pal.ol}"/>`;
  if (!knight) s += `<path d="M-20,-14 l8,10 l-4,8 M18,18 l-6,8 l4,6" fill="none" stroke="${c.pal.ol}" stroke-width="1.8" opacity=".7"/>`;
  // head
  if (knight) {
    s += `<path d="M-24,-30 L-24,-64 Q0,-84 24,-64 L24,-30 Z" fill="url(#gm)" ${O(c)}/>`;
    s += `<rect x="-17" y="-56" width="34" height="7" rx="3" fill="${c.pal.deep}"/><circle cx="-7" cy="-52.5" r="2.4" fill="${c.pal.glow}"/><circle cx="7" cy="-52.5" r="2.4" fill="${c.pal.glow}"/>`;
    s += `<path d="M0,-46 L0,-32" ${O(c, 2.4)}/>`;
    s += `<path d="M0,-78 C10,-100 30,-102 40,-92 C26,-92 16,-86 8,-74 Z" fill="${c.pal.acc}" ${O(c, 2.2)}/>`;
  } else {
    s += `<rect x="-24" y="-66" width="48" height="40" rx="8" fill="url(#gm)" ${O(c)}/>`;
    s += eye(c, -10, -48, 5, { glow: true, slit: true }) + eye(c, 10, -48, 5, { glow: true, slit: true });
    s += `<path d="M-10,-36 L10,-36" ${O(c, 2.6)}/>`;
  }
  if (c.has(/king|colossus|titan/) && c.lvl >= 3) s += crown(c, 0, c.has(/king/) ? -64 : -66, 20);
  if (c.has(/clockwork/)) s += `<circle cx="0" cy="4" r="22" fill="none" stroke="#f2c94c" stroke-width="3" stroke-dasharray="5 4"/>`;
  return s;
};

FORMS.crab = (c) => {
  let s = '';
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) s += `<polyline points="${sx * 36},${10 + i * 9} ${sx * (66 + i * 4)},${2 + i * 10} ${sx * (74 + i * 3)},${28 + i * 10}" fill="none" ${O(c, 4.5)}/>`;
  for (const sx of [-1, 1]) {
    s += `<path d="M${sx * 30},-4 Q${sx * 52},-8 ${sx * 56},-24" fill="none" stroke="${c.pal.ol}" stroke-width="11" stroke-linecap="round"/><path d="M${sx * 30},-4 Q${sx * 52},-8 ${sx * 56},-24" fill="none" stroke="${c.pal.main}" stroke-width="6" stroke-linecap="round"/>`;
    s += `<g transform="translate(${sx * 60},-40) scale(${sx},1)"><path d="M-12,18 C-30,6 -26,-26 -4,-30 L6,-12 L-6,-10 L12,-2 C16,12 4,22 -12,18 Z" fill="url(#gm)" ${O(c)}/><path d="M-4,-30 C10,-34 22,-24 18,-12 L6,-12 Z" fill="url(#gm)" ${O(c)}/></g>`;
  }
  s += `<path d="M-14,-18 L-16,-44 M14,-18 L16,-44" ${O(c, 4)}/>`;
  s += `<ellipse cx="0" cy="10" rx="${c.lvl >= 4 ? 54 : 46}" ry="30" fill="url(#gm)" ${O(c)}/>`;
  if (c.has(/hermit|shell/)) s += `<path d="M-40,0 C-40,-50 40,-60 44,0 Z" fill="url(#ga)" ${O(c)}/><path d="M-20,-4 C-16,-30 20,-34 24,-4 M-4,-4 C-2,-18 10,-20 12,-4" fill="none" ${O(c, 2)}/>`;
  if (c.has(/coral/)) for (let i = 0; i < 3; i++) s += `<path d="M${-24 + i * 22},-10 l0,-18 m0,8 l-8,-8 m8,4 l8,-10" stroke="${hsl(350, 70, 65)}" stroke-width="5" stroke-linecap="round" fill="none"/>`;
  if (c.has(/pearl/)) s += `<circle cx="0" cy="-30" r="12" fill="#f4f1ff" ${O(c, 2)}/><circle cx="-4" cy="-34" r="4" fill="#fff"/>`;
  s += eye(c, -16, -46, 7, { look: 0 }) + eye(c, 16, -46, 7, { look: 0 });
  s += `<ellipse cx="0" cy="18" rx="30" ry="10" fill="${c.pal.light}" opacity=".45"/>`;
  s += mouth(c, 0, 14, 10, c.lvl >= 3 ? 'frown' : 'smile');
  return s;
};

FORMS.fish = (c) => {
  let s = '';
  if (c.has(/ray|manta/)) {
    s += `<path d="M0,-40 C30,-30 60,-10 82,6 C60,8 30,14 0,40 C-30,14 -60,8 -82,6 C-60,-10 -30,-30 0,-40 Z" fill="url(#gm)" ${O(c)}/>`;
    s += `<path d="M0,40 Q4,62 14,80" fill="none" ${O(c, 3)}/><ellipse cx="0" cy="8" rx="22" ry="18" fill="${c.pal.light}" opacity=".5"/>`;
    s += eyes(c, -16, 14, 7, { angry: c.lvl >= 3 }) + mouth(c, 0, 4, 9, 'smile');
    if (c.el === 'thunder') s += `<path d="M-70,0 l10,-10 l0,8 l10,-8" fill="none" stroke="#fff27a" stroke-width="3"/>`;
    return s;
  }
  const whale = c.has(/whale/);
  const puffer = c.has(/puffer/);
  const shark = c.has(/shark|jaw/);
  const rx = whale ? 54 : puffer ? 46 : 56, ry = whale ? 36 : puffer ? 44 : 32;
  // tail
  s += `<path d="M${-rx + 8},0 L${-rx - 30},-30 Q${-rx - 20},0 ${-rx - 30},30 Z" fill="url(#ga)" ${O(c)}/>`;
  // dorsal fin
  s += shark ? `<path d="M-14,${-ry + 4} L4,${-ry - 34} L22,${-ry + 6} Z" fill="url(#gm)" ${O(c)}/>`
    : `<path d="M-30,${-ry + 6} C-20,${-ry - 22} 16,${-ry - 22} 22,${-ry + 4} Z" fill="url(#ga)" ${O(c)}/>`;
  if (puffer) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; s += `<path d="M${f(Math.cos(a) * rx)},${f(Math.sin(a) * ry)} L${f(Math.cos(a) * (rx + 12))},${f(Math.sin(a) * (ry + 12))}" ${O(c, 3)}/>`; }
  s += `<ellipse cx="0" cy="0" rx="${rx}" ry="${ry}" fill="url(#gm)" ${O(c)}/>`;
  s += `<path d="M${-rx + 10},${ry * 0.3} Q0,${ry * 1.1} ${rx - 6},${ry * 0.25}" fill="${c.pal.light}" opacity=".55"/>`;
  if (!shark && !whale) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) s += `<path d="M${-30 + i * 16},${-10 + j * 14} q6,6 0,12" fill="none" stroke="${c.pal.dark}" stroke-width="1.6" opacity=".55"/>`;
  if (whale) for (let i = 0; i < 5; i++) s += `<path d="M${-10 + i * 12},${ry * 0.45} l0,${f(ry * 0.4)}" stroke="${c.pal.dark}" stroke-width="2" opacity=".5"/>`;
  s += `<path d="M-6,${ry * 0.35} Q-20,${ry + 12} 6,${ry * 0.6} Z" fill="url(#ga)" ${O(c, 2.4)}/>`;
  s += eye(c, rx * 0.45, -ry * 0.25, whale ? 7 : 10, { angry: shark || c.lvl >= 4, look: 1 });
  s += shark ? `<path d="M${rx * 0.4},${ry * 0.35} Q${rx * 0.8},${ry * 0.45} ${rx},${ry * 0.1}" fill="#fff" ${O(c, 2.4)}/><path d="M${rx * 0.5},${ry * 0.38} l3,-5 l3,5 l3,-5 l3,5 l3,-5 l3,4" fill="none" stroke="${c.pal.ol}" stroke-width="1.3"/>`
    : mouth(c, rx * 0.82, ry * 0.2, 7, 'smile');
  if (c.has(/angler|lantern/)) s += `<path d="M${rx * 0.3},${-ry} Q${rx * 0.5},${-ry - 40} ${rx + 14},${-ry - 26}" fill="none" ${O(c, 2.5)}/><circle cx="${rx + 14}" cy="${-ry - 26}" r="16" fill="url(#glow)"/><circle cx="${rx + 14}" cy="${-ry - 26}" r="6" fill="${c.pal.glow}" ${O(c, 1.6)}/>`;
  if (whale) for (let i = 0; i < 4; i++) s += `<path d="M${-10 + i * 14},${-ry - 6} q4,-14 0,-24" fill="none" stroke="hsla(190,100%,90%,.6)" stroke-width="2.4"/>`;
  return s;
};

FORMS.jelly = (c) => {
  let s = '';
  const n = 6 + Math.min(c.lvl, 4);
  for (let i = 0; i < n; i++) {
    const x = -38 + (i * 76) / (n - 1), len = c.R(40, 75);
    const d = `M${f(x)},0 q${f(c.R(-12, 12))},${f(len * 0.3)} 0,${f(len * 0.5)} t0,${f(len * 0.5)}`;
    s += `<path d="${d}" fill="none" stroke="${c.pal.ol}" stroke-width="6" stroke-linecap="round" opacity=".8"/><path d="${d}" fill="none" stroke="${i % 2 ? c.pal.light : c.pal.acc}" stroke-width="3" stroke-linecap="round"/>`;
  }
  s += `<path d="M-50,4 C-52,-72 52,-72 50,4 Q38,14 25,4 Q12,14 0,4 Q-12,14 -25,4 Q-38,14 -50,4 Z" fill="url(#gm)" opacity=".92" ${O(c)}/>`;
  s += `<ellipse cx="-14" cy="-38" rx="16" ry="9" fill="#fff" opacity=".35"/>`;
  s += `<ellipse cx="0" cy="-20" rx="26" ry="20" fill="url(#glow)" opacity=".6"/>`;
  s += eyes(c, -18, 13, 7) + mouth(c, 0, -6, 7, 'smile');
  if (c.el === 'holy') s += halo(c, 0, -70, 28);
  if (c.el === 'ice') for (let i = 0; i < 5; i++) s += `<path d="M${-40 + i * 20},-52 l4,-12 l4,12" fill="#eaffff" ${O(c, 1.4)}/>`;
  return s;
};

FORMS.octo = (c) => {
  let s = '';
  const n = 6, big = c.lvl >= 4;
  for (let i = 0; i < n; i++) {
    const sx = i < n / 2 ? -1 : 1, k = i % (n / 2);
    const x0 = sx * (8 + k * 12), x1 = sx * (40 + k * 18), y1 = 30 + k * 10;
    const d = `M${x0},0 C${x0},30 ${x1},${y1 - 20} ${x1},${y1 + 20} C${x1},${y1 + 34} ${x1 - sx * 16},${y1 + 34} ${x1 - sx * 12},${y1 + 22}`;
    s += `<path d="${d}" fill="none" stroke="${c.pal.ol}" stroke-width="${big ? 17 : 14}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${c.pal.main}" stroke-width="${big ? 11 : 8}" stroke-linecap="round"/>`;
    s += `<circle cx="${f((x0 + x1) / 2)}" cy="${f(y1 - 2)}" r="2.6" fill="${c.pal.light}"/><circle cx="${x1}" cy="${y1 + 12}" r="2.4" fill="${c.pal.light}"/>`;
  }
  s += `<ellipse cx="0" cy="-26" rx="${big ? 44 : 38}" ry="${big ? 48 : 42}" fill="url(#gm)" ${O(c)}/>`;
  for (let i = 0; i < 5; i++) s += `<circle cx="${f(c.R(-28, 28))}" cy="${f(c.R(-62, -36))}" r="${f(c.R(3, 6))}" fill="${c.pal.dark}" opacity=".35"/>`;
  s += eyes(c, -18, 16, big ? 11 : 10, { angry: c.lvl >= 3 });
  s += mouth(c, 0, 2, 10, c.lvl >= 4 ? 'grin' : 'o');
  if (c.has(/sovereign|kraken/) && c.lvl >= 5) s += crown(c, 0, -68, 22);
  if (c.el === 'thunder') s += `<path d="M-50,-60 l8,12 l-8,2 l10,14 M50,-60 l-8,12 l8,2 l-10,14" fill="none" stroke="#fff27a" stroke-width="3"/>`;
  return s;
};

FORMS.turtle = (c) => {
  let s = '';
  s += `<ellipse cx="-38" cy="34" rx="20" ry="10" transform="rotate(20 -38 34)" fill="${c.pal.light}" ${O(c)}/><ellipse cx="30" cy="36" rx="20" ry="10" transform="rotate(-20 30 36)" fill="${c.pal.light}" ${O(c)}/>`;
  s += `<path d="M-60,22 L52,22 Q48,36 -56,36 Z" fill="${c.pal.light}" ${O(c)}/>`;
  s += `<path d="M44,6 C56,-6 72,-6 78,6 C82,18 70,26 56,22 Z" fill="${c.pal.light}" ${O(c)}/>`;
  s += eye(c, 66, 4, 6, { angry: c.lvl >= 3, look: 1 }) + mouth(c, 72, 14, 5, 'smile');
  s += `<path d="M-64,24 C-64,-56 52,-56 52,24 Z" fill="url(#ga)" ${O(c)}/>`;
  const cells = [[-6, -14], [-34, -6], [22, -6], [-20, 12], [8, 12], [-46, 14], [36, 14], [-6, -36]];
  for (const [x, y] of cells) {
    const r = 11;
    const pts = Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * Math.PI * 2; return `${f(x + Math.cos(a) * r)},${f(y + Math.sin(a) * r * 0.85)}`; }).join(' ');
    s += `<polygon points="${pts}" fill="${c.pal.dark}" opacity=".45" ${O(c, 1.6)}/>`;
  }
  if (c.el === 'fire') for (let i = 0; i < 3; i++) s += `<path d="M${-30 + i * 22},-42 q-6,-14 2,-24 q2,10 8,10 q2,-8 -2,-14 q14,10 4,28 Z" fill="hsla(25,100%,58%,.95)" ${O(c, 1.6)}/>`;
  if (c.el === 'ice') for (let i = 0; i < 4; i++) s += `<polygon points="${-36 + i * 22},-40 ${-30 + i * 22},-64 ${-24 + i * 22},-40" fill="#e6fbff" ${O(c, 1.6)}/>`;
  if (c.el === 'holy') s += halo(c, -6, -58, 30);
  if (c.el === 'earth') s += `<path d="M-30,-44 l10,-14 l12,12 l10,-8 l8,14 Z" fill="${hsl(110, 40, 40)}" ${O(c, 1.8)}/>`;
  return s;
};

FORMS.mushroom = (c) => {
  let s = '';
  s += `<path d="M-20,30 Q-34,42 -40,34 M20,30 Q34,42 40,34" fill="none" ${O(c, 5)}/>`;
  s += `<path d="M-24,-4 C-28,30 -26,52 -16,60 L16,60 C26,52 28,30 24,-4 Z" fill="#f2e6cf" ${O(c)}/>`;
  s += eyes(c, 18, 9, 7, { angry: c.lvl >= 4 }) + mouth(c, 0, 34, 7);
  s += `<ellipse cx="-14" cy="28" rx="5" ry="3" fill="#ff9aa2" opacity=".6"/><ellipse cx="14" cy="28" rx="5" ry="3" fill="#ff9aa2" opacity=".6"/>`;
  const w = c.lvl >= 4 ? 66 : 58;
  s += `<path d="M-${w},0 C-${w},-${w + 10} ${w},-${w + 10} ${w},0 Q0,14 -${w},0 Z" fill="url(#gm)" ${O(c)}/>`;
  s += `<path d="M-${w - 8},4 Q0,16 ${w - 8},4" fill="none" stroke="${c.pal.dark}" stroke-width="2" opacity=".6"/>`;
  for (const [x, y, r] of [[-30, -30, 9], [6, -46, 11], [32, -22, 8], [-8, -16, 6], [-44, -10, 5], [44, -6, 5]]) s += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".85" ${O(c, 1.4)}/>`;
  if (c.has(/queen|overlord|matron/)) s += crown(c, 0, -60, 20);
  if (c.has(/knight/)) s += `<path d="M44,60 L44,-4" stroke="${c.pal.ol}" stroke-width="5"/><path d="M44,60 L44,-4" stroke="#d7dbe4" stroke-width="2.5"/><path d="M36,46 L52,46" ${O(c, 4)}/>`;
  if (c.el === 'poison' || c.has(/spore|puff/)) for (let i = 0; i < 6; i++) s += `<circle cx="${f(c.R(-70, 70))}" cy="${f(c.R(-90, -50))}" r="${f(c.R(2, 4))}" fill="${c.pal.light}" opacity=".7"/>`;
  return s;
};

FORMS.flower = (c) => {
  let s = '';
  const green = hsl(110, 50, 42);
  s += `<path d="M0,10 C-6,40 6,52 0,72" fill="none" stroke="${c.pal.ol}" stroke-width="9"/><path d="M0,10 C-6,40 6,52 0,72" fill="none" stroke="${green}" stroke-width="5"/>`;
  s += `<path d="M-2,44 C-30,30 -46,44 -50,54 C-34,58 -16,54 -2,46 Z M2,36 C28,22 46,32 50,42 C34,48 16,44 2,38 Z" fill="${green}" ${O(c, 2.4)}/>`;
  const cy = -24;
  if (c.has(/snapper|venus/)) {
    s += `<path d="M-50,${cy} C-50,${cy - 50} 50,${cy - 50} 50,${cy} Z" fill="url(#gm)" ${O(c)}/><path d="M-50,${cy + 4} C-50,${cy + 40} 50,${cy + 40} 50,${cy + 4} Z" fill="url(#gm)" ${O(c)}/>`;
    s += `<path d="M-46,${cy} L46,${cy}" stroke="${c.pal.deep}" stroke-width="8"/>`;
    for (let i = 0; i < 8; i++) s += `<path d="M${-40 + i * 11},${cy - 3} l5,-9 l5,9 M${-40 + i * 11},${cy + 6} l5,9 l5,-9" fill="#fff" stroke="${c.pal.ol}" stroke-width="1.2"/>`;
    s += eye(c, -16, cy - 26, 6, { angry: true }) + eye(c, 16, cy - 26, 6, { angry: true });
    return s;
  }
  const n = c.has(/rafflesia/) ? 5 : c.has(/daisy|dandelion|sunpetal/) ? 12 : c.pick([5, 6, 8]);
  const pr = c.has(/rafflesia/) ? 34 : n > 8 ? 26 : 30;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    s += `<ellipse cx="0" cy="${cy - pr}" rx="${n > 8 ? 9 : 17}" ry="${pr * 0.75}" transform="rotate(${f(a)} 0 ${cy})" fill="url(#gm)" ${O(c, 2.4)}/>`;
  }
  if (c.has(/rafflesia/)) for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; s += `<circle cx="${f(Math.cos(a) * 46)}" cy="${f(cy + Math.sin(a) * 46)}" r="5" fill="#fff" opacity=".8"/>`; }
  if (c.has(/dandelion/)) for (let i = 0; i < 8; i++) s += `<path d="M${f(c.R(30, 70))},${f(c.R(-90, -40))} l4,-4 m-4,4 l-4,-4 m4,4 l0,8" stroke="#fff" stroke-width="1.4" opacity=".8"/>`;
  s += `<circle cx="0" cy="${cy}" r="${c.has(/sun/) ? 26 : 22}" fill="url(#ga)" ${O(c)}/>`;
  s += eyes(c, cy - 4, 8, 5.5, { angry: c.lvl >= 4 }) + mouth(c, 0, cy + 8, 6, c.lvl >= 4 ? 'grin' : 'smile');
  if (c.el === 'holy') s += halo(c, 0, cy - 62, 26);
  if (c.el === 'ice') for (let i = 0; i < 4; i++) s += `<path d="M${-60 + i * 40},${cy - 70} l0,10 m-5,-5 l10,0" stroke="#eaffff" stroke-width="2"/>`;
  return s;
};

FORMS.treant = (c) => {
  let s = '';
  const bark = hsl(28, 32, 36), barkD = hsl(28, 32, 22);
  // canopy behind
  const leaf = c.el === 'ice' ? hsl(195, 50, 82) : c.el === 'fire' ? hsl(18, 80, 52) : c.el === 'holy' ? hsl(50, 80, 62) : c.el === 'thunder' ? hsl(55, 75, 55) : hsl(105, 48, 40);
  for (const [x, y, r] of [[-40, -50, 26], [0, -66, 32], [40, -50, 26], [-22, -30, 22], [24, -30, 22]]) s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${leaf}" ${O(c)}/>`;
  for (let i = 0; i < 6; i++) s += `<circle cx="${f(c.R(-50, 50))}" cy="${f(c.R(-80, -30))}" r="${f(c.R(4, 8))}" fill="#fff" opacity=".18"/>`;
  // branch arms
  s += `<path d="M-24,-4 C-50,-4 -60,-24 -70,-36 M-60,-24 L-76,-20 M24,-4 C50,-4 60,-24 70,-36 M60,-24 L76,-20" fill="none" stroke="${c.pal.ol}" stroke-width="12" stroke-linecap="round"/>`;
  s += `<path d="M-24,-4 C-50,-4 -60,-24 -70,-36 M-60,-24 L-76,-20 M24,-4 C50,-4 60,-24 70,-36 M60,-24 L76,-20" fill="none" stroke="${bark}" stroke-width="7" stroke-linecap="round"/>`;
  // trunk
  s += `<path d="M-26,-24 C-30,20 -34,46 -50,64 L50,64 C34,46 30,20 26,-24 Z" fill="${bark}" ${O(c)}/>`;
  s += `<path d="M-14,-10 C-18,20 -16,40 -22,58 M12,-14 C16,10 14,34 22,58 M0,30 L0,60" fill="none" stroke="${barkD}" stroke-width="2.2"/>`;
  s += `<ellipse cx="-11" cy="2" rx="8" ry="10" fill="#120c06"/><ellipse cx="11" cy="2" rx="8" ry="10" fill="#120c06"/>`;
  s += `<circle cx="-11" cy="3" r="3.6" fill="${c.pal.glow}"/><circle cx="11" cy="3" r="3.6" fill="${c.pal.glow}"/>`;
  s += `<ellipse cx="0" cy="26" rx="10" ry="6" fill="#120c06"/>`;
  if (c.el === 'holy' || c.lvl >= 5) s += `<circle cx="0" cy="-66" r="10" fill="url(#glow)"/>`;
  if (c.el === 'thunder') s += `<path d="M30,-90 l-8,14 l8,0 l-10,16" fill="none" stroke="#fff27a" stroke-width="3"/>`;
  return s;
};

FORMS.sprout = (c) => {
  let s = '';
  const green = hsl(110, 55, 45);
  s += `<path d="M0,-34 C0,-50 2,-58 0,-66" fill="none" ${O(c, 5)}/>`;
  s += `<path d="M0,-62 C-24,-84 -44,-66 -40,-56 C-24,-50 -10,-54 0,-62 Z M0,-62 C24,-84 44,-66 40,-56 C24,-50 10,-54 0,-62 Z" fill="${green}" ${O(c, 2.5)}/>`;
  if (c.el === 'fire') s += `<path d="M0,-68 q-8,-14 0,-26 q8,12 0,26 Z" fill="hsla(25,100%,60%,.95)" ${O(c, 1.6)}/>`;
  if (c.el === 'thunder') s += `<circle cx="0" cy="-76" r="9" fill="url(#glow)"/><circle cx="0" cy="-76" r="5" fill="#fff27a" ${O(c, 1.4)}/>`;
  s += `<ellipse cx="-18" cy="40" rx="12" ry="8" fill="${c.pal.dark}" ${O(c)}/><ellipse cx="18" cy="40" rx="12" ry="8" fill="${c.pal.dark}" ${O(c)}/>`;
  s += `<path d="M0,-40 C40,-40 46,10 38,26 C30,44 -30,44 -38,26 C-46,10 -40,-40 0,-40 Z" fill="url(#gm)" ${O(c)}/>`;
  s += eyes(c, 0, 13, 8) + mouth(c, 0, 16, 8, 'smile');
  s += `<ellipse cx="-24" cy="12" rx="6" ry="3.5" fill="#ff9aa2" opacity=".6"/><ellipse cx="24" cy="12" rx="6" ry="3.5" fill="#ff9aa2" opacity=".6"/>`;
  if (c.el === 'ice') s += `<path d="M-30,-30 l6,-8 l6,8 M14,-34 l6,-8 l6,8" fill="#eaffff" ${O(c, 1.4)}/>`;
  return s;
};

FORMS.cactus = (c) => {
  let s = '';
  const g = 'url(#gm)';
  s += `<path d="M-24,0 L-44,0 C-54,0 -56,-8 -56,-14 L-56,-36" fill="none" stroke="${c.pal.ol}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/><path d="M-24,0 L-44,0 C-54,0 -56,-8 -56,-14 L-56,-36" fill="none" stroke="${c.pal.main}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="M24,14 L44,14 C54,14 56,6 56,0 L56,-20" fill="none" stroke="${c.pal.ol}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/><path d="M24,14 L44,14 C54,14 56,6 56,0 L56,-20" fill="none" stroke="${c.pal.main}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<rect x="-28" y="-60" width="56" height="124" rx="28" fill="${g}" ${O(c)}/>`;
  s += `<path d="M-10,-54 L-10,58 M10,-54 L10,58" stroke="${c.pal.dark}" stroke-width="2" opacity=".55"/>`;
  for (let i = 0; i < 14; i++) { const x = c.R(-24, 24), y = c.R(-50, 56); s += `<path d="M${f(x)},${f(y)} l${f(c.R(-5, 5))},-5" stroke="#f6f0d8" stroke-width="1.6"/>`; }
  s += eyes(c, -24, 11, 7, { angry: c.lvl >= 3 }) + mouth(c, 0, -6, 9, c.has(/brawler|king|inferno/) ? 'grin' : 'smile');
  const fl = c.el === 'fire' ? hsl(18, 90, 58) : c.pal.acc;
  for (let i = 0; i < 5; i++) s += `<ellipse cx="0" cy="-72" rx="7" ry="13" transform="rotate(${i * 72} 0 -62)" fill="${fl}" ${O(c, 2)}/>`;
  s += `<circle cx="0" cy="-62" r="6" fill="#ffe27a" ${O(c, 1.6)}/>`;
  if (c.has(/king/)) s += crown(c, 0, -82, 18);
  if (c.has(/brawler/)) s += `<rect x="-66" y="-46" width="20" height="16" rx="5" fill="#d44" ${O(c, 2)}/><rect x="46" y="-30" width="20" height="16" rx="5" fill="#d44" ${O(c, 2)}/>`;
  return s;
};

FORMS.ghost = (c) => {
  const body = c.el ? hsl(c.pal.h, 45, 86) : '#eef0fa';
  let s = `<ellipse cx="0" cy="-10" rx="62" ry="70" fill="url(#glow)" opacity=".35"/>`;
  s += `<path d="M-44,-10 C-44,-82 44,-82 44,-10 L44,52 Q33,64 22,52 Q11,64 0,52 Q-11,64 -22,52 Q-33,64 -44,52 Z" fill="${body}" opacity=".95" ${O(c)}/>`;
  s += `<path d="M-44,10 C-60,6 -66,-6 -62,-16 C-54,-6 -50,-2 -44,-2 M44,10 C60,6 66,-6 62,-16 C54,-6 50,-2 44,-2" fill="${body}" ${O(c, 2.6)}/>`;
  s += `<ellipse cx="-15" cy="-26" rx="9" ry="13" fill="#1d1a2b"/><ellipse cx="15" cy="-26" rx="9" ry="13" fill="#1d1a2b"/>`;
  s += `<circle cx="-18" cy="-31" r="3" fill="#fff"/><circle cx="12" cy="-31" r="3" fill="#fff"/>`;
  s += c.lvl >= 3 ? `<path d="M-16,0 Q0,22 16,0 Q0,8 -16,0 Z" fill="#1d1a2b"/>` : `<ellipse cx="0" cy="2" rx="6" ry="8" fill="#1d1a2b"/>`;
  if (c.has(/bell/)) s += `<path d="M-14,-74 C-14,-96 14,-96 14,-74 L18,-66 L-18,-66 Z" fill="#c9a24a" ${O(c, 2.2)}/><circle cx="0" cy="-62" r="4" fill="#c9a24a" ${O(c, 1.6)}/>`;
  if (c.has(/choir/)) s += `<path d="M48,-40 l0,-20 l10,-4 l0,18 M48,-40 a4,3 0 1,1 -1,0" fill="none" ${O(c, 2.2)}/>`;
  if (c.has(/mother|rot/)) s += crown(c, 0, -70, 18);
  if (c.el === 'ice') s += `<path d="M-30,40 l4,10 l4,-10 M10,42 l4,10 l4,-10" fill="#eaffff" ${O(c, 1.4)}/>`;
  if (c.el === 'water' || c.has(/drown|puddle/)) for (let i = 0; i < 3; i++) s += `<path d="M${-20 + i * 20},58 q-4,8 0,12 q4,-4 0,-12 Z" fill="${hsl(205, 90, 70)}" ${O(c, 1.4)}/>`;
  return s;
};

FORMS.wisp = (c) => {
  const inner = c.el === 'fire' ? hsl(45, 100, 70) : c.pal.light;
  let s = `<circle cx="0" cy="0" r="70" fill="url(#glow)" opacity=".55"/>`;
  s += `<path d="M0,-80 C26,-46 52,-22 46,16 C40,54 -40,54 -46,16 C-52,-22 -22,-30 -6,-56 C-2,-40 6,-36 10,-42 C12,-56 6,-66 0,-80 Z" fill="url(#gm)" ${O(c)}/>`;
  s += `<path d="M0,-40 C18,-18 30,0 26,20 C22,40 -22,40 -26,20 C-30,0 -14,-12 0,-40 Z" fill="${inner}" opacity=".9"/>`;
  s += eyes(c, 6, 11, 7, { angry: c.lvl >= 4 }) + mouth(c, 0, 24, 7, c.lvl >= 4 ? 'grin' : 'smile');
  for (let i = 0; i < 6; i++) { const x = c.R(-70, 70), y = c.R(-70, 50); s += `<path d="M${f(x)},${f(y - 4)} L${f(x)},${f(y + 4)} M${f(x - 4)},${f(y)} L${f(x + 4)},${f(y)}" stroke="${c.pal.glow}" stroke-width="2"/>`; }
  if (c.has(/fox/)) s += `<path d="M-30,-20 L-40,-50 L-16,-34 Z M30,-20 L40,-50 L16,-34 Z" fill="url(#gm)" ${O(c, 2.4)}/>`;
  if (c.el === 'holy' || c.has(/kami/)) s += halo(c, 0, -84, 26);
  if (c.el === 'thunder') s += `<path d="M-60,-30 l10,10 l-8,4 l12,14 M54,-40 l-8,10 l8,4 l-10,14" fill="none" stroke="#fff27a" stroke-width="3"/>`;
  if (c.has(/djinn/)) s += crown(c, 0, -76, 16);
  return s;
};

FORMS.mask = (c) => {
  let s = '';
  const face = c.el === 'fire' ? '#f6e1d0' : c.el === 'thunder' ? '#f3e9c6' : c.el === 'poison' ? '#e4daf2' : '#f4eee2';
  const oni = c.has(/oni|drum|thousand|grin/) || c.lvl >= 4;
  if (c.has(/thousand/)) for (const [x, y, r] of [[-62, -20, -15], [62, -20, 15], [-56, 40, -25], [56, 40, 25]]) s += `<g transform="translate(${x},${y}) rotate(${r}) scale(.4)"><ellipse cx="0" cy="0" rx="45" ry="58" fill="${face}" ${O(c, 6)}/><ellipse cx="-16" cy="-8" rx="10" ry="6" fill="#1d1a2b"/><ellipse cx="16" cy="-8" rx="10" ry="6" fill="#1d1a2b"/></g>`;
  for (const sx of [-1, 1]) s += `<path d="M${sx * 40},10 Q${sx * 50},40 ${sx * 46},70" fill="none" stroke="${c.pal.acc}" stroke-width="4"/><circle cx="${sx * 46}" cy="72" r="6" fill="${c.pal.acc}" ${O(c, 1.6)}/>`;
  if (oni) s += horn(c, -26, -50, -1, 32, 8) + horn(c, 26, -50, 1, 32, 8);
  s += `<ellipse cx="0" cy="-4" rx="46" ry="60" fill="${face}" ${O(c)}/>`;
  s += `<path d="M-38,-30 Q-16,-24 -6,-10 M38,-30 Q16,-24 6,-10" fill="none" stroke="${c.pal.main}" stroke-width="5" stroke-linecap="round"/>`;
  s += `<path d="M-32,6 L-20,24 M32,6 L20,24" stroke="${c.pal.main}" stroke-width="4" stroke-linecap="round"/>`;
  s += `<path d="M-30,-14 Q-18,-26 -6,-14 Q-18,-6 -30,-14 Z M30,-14 Q18,-26 6,-14 Q18,-6 30,-14 Z" fill="#14101c" ${O(c, 2)}/>`;
  s += eye(c, -18, -15, 3, { glow: true }) + eye(c, 18, -15, 3, { glow: true });
  s += `<circle cx="0" cy="-42" r="7" fill="${c.pal.acc}" ${O(c, 2)}/>`;
  s += oni ? `<path d="M-22,24 Q0,46 22,24 Q0,32 -22,24 Z" fill="#7a1c22" ${O(c, 2.2)}/><path d="M-14,27 l3,8 l3,-7 M8,27 l3,7 l3,-8" fill="#fff" stroke="${c.pal.ol}" stroke-width="1"/>`
    : `<path d="M-14,28 Q0,38 14,28" fill="none" ${O(c, 2.6)}/>`;
  if (c.has(/temple|shrine/)) s += halo(c, 0, -72, 28);
  if (c.has(/drum/)) s += `<ellipse cx="0" cy="70" rx="34" ry="8" fill="${c.pal.acc}" ${O(c, 2)}/>`;
  return s;
};

FORMS.lantern = (c) => {
  let s = '';
  const paper = c.el === 'poison' ? hsl(120, 60, 70) : c.el === 'thunder' ? hsl(55, 90, 72) : c.el === 'holy' ? hsl(48, 90, 80) : c.el === 'ice' ? hsl(195, 70, 82) : hsl(c.el ? c.pal.h : 20, 85, 64);
  s += `<path d="M-14,-74 Q0,-100 14,-74" fill="none" ${O(c, 4)}/>`;
  s += `<circle cx="0" cy="0" r="66" fill="url(#glow)" opacity=".6"/>`;
  s += `<rect x="-26" y="-76" width="52" height="12" rx="4" fill="#2a2030" ${O(c, 2.4)}/>`;
  s += `<path d="M-26,-64 C-58,-50 -58,40 -26,54 L26,54 C58,40 58,-50 26,-64 Z" fill="${paper}" ${O(c)}/>`;
  for (let i = 1; i < 5; i++) { const y = -64 + i * 23.6; s += `<path d="M${-46 + Math.abs(i - 2.5) * 6},${f(y)} Q0,${f(y + 6)} ${46 - Math.abs(i - 2.5) * 6},${f(y)}" fill="none" stroke="${c.pal.ol}" stroke-width="1.4" opacity=".45"/>`; }
  s += `<rect x="-22" y="54" width="44" height="10" rx="4" fill="#2a2030" ${O(c, 2.4)}/>`;
  s += `<path d="M-8,64 L-8,80 M0,64 L0,84 M8,64 L8,80" stroke="${c.pal.acc}" stroke-width="3"/>`;
  s += `<path d="M-26,-12 Q-16,-24 -6,-12 Q-16,-4 -26,-12 Z M26,-12 Q16,-24 6,-12 Q16,-4 26,-12 Z" fill="#2a1306"/>`;
  s += `<path d="M-22,12 Q0,${c.lvl >= 3 ? 40 : 28} 22,12 Q0,22 -22,12 Z" fill="#2a1306"/>`;
  if (c.lvl >= 2) s += `<path d="M-4,20 Q4,40 10,24" fill="#e2506a" ${O(c, 1.6)}/>`;
  if (c.has(/lord|saint/)) s += c.has(/saint/) ? halo(c, 0, -94, 26) : crown(c, 0, -76, 18);
  if (c.has(/keeper|grave/)) s += `<path d="M52,70 L52,-40 Q52,-58 36,-58" fill="none" ${O(c, 5)}/>`;
  return s;
};

FORMS.wraith = (c) => {
  let s = '';
  const robe = c.el === 'holy' ? '#f3efe2' : 'url(#gm)';
  if (c.has(/seraph|archon|angel/)) s += featherWings(c, -16, 86, '#f6f3ea');
  s += `<path d="M0,-74 C36,-74 46,-32 50,18 L62,64 Q32,52 16,66 Q0,52 -16,66 Q-32,52 -62,64 L-50,18 C-46,-32 -36,-74 0,-74 Z" fill="${robe}" ${O(c)}/>`;
  s += `<path d="M-24,-18 L-30,40 M24,-18 L30,40 M0,0 L0,56" stroke="${c.pal.ol}" stroke-width="1.8" opacity=".4"/>`;
  s += `<ellipse cx="0" cy="-36" rx="22" ry="26" fill="#0c0a14" ${O(c, 2.4)}/>`;
  s += eye(c, -9, -38, 4, { glow: true, slit: c.lvl >= 3 }) + eye(c, 9, -38, 4, { glow: true, slit: c.lvl >= 3 });
  for (const sx of [-1, 1]) s += `<path d="M${sx * 48},${-2} C${sx * 66},4 ${sx * 70},20 ${sx * 64},30 l${sx * -6},-6 l${sx * -2},10 l${sx * -6},-8" fill="${c.el === 'holy' ? '#f3efe2' : c.pal.light}" ${O(c, 2.4)}/>`;
  if (c.has(/empress|queen|king|lord|drowned/)) s += crown(c, 0, -70, 20);
  if (c.has(/shogun|storm/)) s += horn(c, -18, -66, -1, 28, 6) + horn(c, 18, -66, 1, 28, 6);
  if (c.el === 'holy' || c.has(/seraph|archon|monk/)) s += halo(c, 0, -86, 26);
  if (c.el === 'fire') for (let i = -2; i <= 2; i++) s += `<path d="M${i * 22},62 q-8,10 0,22 q8,-12 0,-22 Z" fill="hsla(25,100%,58%,.95)" ${O(c, 1.4)}/>`;
  if (c.el === 'poison') for (let i = 0; i < 5; i++) s += `<circle cx="${f(c.R(-60, 60))}" cy="${f(c.R(40, 70))}" r="${f(c.R(4, 8))}" fill="hsla(110,70%,55%,.5)"/>`;
  if (c.has(/scythe|plague|grave/)) s += `<path d="M66,70 L66,-60" stroke="${c.pal.ol}" stroke-width="5"/><path d="M66,-60 Q30,-70 20,-40 Q40,-56 66,-48 Z" fill="#cfd4dd" ${O(c, 2)}/>`;
  return s;
};

// ---------- heroes ----------
function heroBust(c, opt = {}) {
  let s = '';
  const skin = opt.skin || c.pick(SKIN);
  const hair = c.chance(0.2) ? c.pal.dark : c.pick(HAIR);
  const n = c.name;
  const gear = opt.gear || (/witch|mage|sorceress|archmage|alchemist|tinker|windcaller/.test(n) ? 'hat'
    : /knight|paladin|champion|templar|lancer|squire|warden|duelist|pretender|captain|admiral/.test(n) ? 'helm'
      : /assassin|ranger|scout|archer|wanderer|ferryman|monk|acolyte|torchbearer|corsair/.test(n) ? 'hood'
        : /priest|cleric|oracle|saint/.test(n) ? 'holy'
          : /king|queen|regent|lord|chancellor|mother|empress|emberlord/.test(n) ? 'crown' : 'hair');
  const item = opt.item || (/mage|sorceress|witch|priest|cleric|oracle|acolyte|saint|archmage|alchemist|windcaller|chancellor|mother|monk/.test(n) ? 'staff'
    : /knight|paladin|champion|templar|squire|duelist|captain|admiral|pretender|king|corsair|stonewarden|warden/.test(n) ? 'sword'
      : /archer|ranger|scout/.test(n) ? 'bow' : /assassin/.test(n) ? 'dagger' : /torch/.test(n) ? 'torch' : /lancer/.test(n) ? 'spear' : /ferryman/.test(n) ? 'oar' : 'none');
  const longHair = /witch|queen|sorceress|mother|oracle|empress|orla|seren|thessaly|maiden/.test(n) || c.chance(0.3);
  const beard = !longHair && /king|archmage|chancellor|admiral|wanderer|hand|monk|doctor|ferryman|kass/.test(n) && c.chance(0.75);

  // items behind body
  if (item === 'staff') s += `<path d="M58,80 L58,-70" stroke="${c.pal.ol}" stroke-width="8" stroke-linecap="round"/><path d="M58,80 L58,-70" stroke="#8a5a32" stroke-width="4.5"/><circle cx="58" cy="-80" r="20" fill="url(#glow)"/><circle cx="58" cy="-80" r="9" fill="${c.pal.glow}" ${O(c, 2.2)}/>`;
  if (item === 'spear') s += `<path d="M60,80 L60,-74" stroke="${c.pal.ol}" stroke-width="7"/><path d="M60,80 L60,-74" stroke="#8a5a32" stroke-width="3.5"/><path d="M60,-100 L51,-74 L69,-74 Z" fill="#dfe5ee" ${O(c, 2)}/>`;
  if (item === 'oar') s += `<path d="M-58,80 L-58,-50" stroke="${c.pal.ol}" stroke-width="7"/><path d="M-58,80 L-58,-50" stroke="#8a5a32" stroke-width="3.5"/><ellipse cx="-58" cy="-62" rx="9" ry="22" fill="#a77446" ${O(c, 2.2)}/>`;
  if (item === 'bow') s += `<path d="M-60,-70 Q-20,0 -60,70" fill="none" ${O(c, 5)}/><path d="M-60,-70 Q-20,0 -60,70" fill="none" stroke="#a77446" stroke-width="2.5"/><path d="M-60,-70 L-60,70" stroke="#e6e0d0" stroke-width="1.2"/>`;
  // shoulders / cloak
  if (gear === 'hood' || gear === 'holy') s += `<path d="M-40,-56 C-50,-90 50,-90 40,-56 L44,-10 L-44,-10 Z" fill="${gear === 'holy' ? '#f1ece0' : c.pal.dark}" ${O(c)}/>`;
  if (longHair && gear !== 'hood' && gear !== 'holy' && gear !== 'helm') s += `<path d="M-30,-40 C-40,-10 -40,20 -30,30 L30,30 C40,20 40,-10 30,-40 Z" fill="${hair}" ${O(c)}/>`;
  s += `<path d="M-80,82 C-76,24 -44,8 0,8 C44,8 76,24 80,82 Z" fill="${gear === 'holy' ? '#f1ece0' : 'url(#gm)'}" ${O(c)}/>`;
  if (gear === 'helm') s += `<path d="M-70,40 C-64,16 -40,10 -28,14 L-30,40 Z M70,40 C64,16 40,10 28,14 L30,40 Z" fill="#c8cfda" ${O(c)}/>`;
  s += `<path d="M-30,14 L0,44 L30,14" fill="none" stroke="${c.pal.acc}" stroke-width="6" stroke-linejoin="round"/>`;
  s += `<circle cx="0" cy="44" r="7" fill="${c.pal.acc}" ${O(c, 2)}/>`;
  s += `<rect x="-11" y="-4" width="22" height="20" fill="${skin}" ${O(c, 2.4)}/>`;
  // head
  s += `<ellipse cx="-27" cy="-28" rx="6" ry="9" fill="${skin}" ${O(c, 2.4)}/><ellipse cx="27" cy="-28" rx="6" ry="9" fill="${skin}" ${O(c, 2.4)}/>`;
  s += `<ellipse cx="0" cy="-28" rx="27" ry="31" fill="${skin}" ${O(c)}/>`;
  if (beard) s += `<path d="M-26,-26 C-26,10 -10,22 0,22 C10,22 26,10 26,-26 C18,-8 -18,-8 -26,-26 Z" fill="${hair}" ${O(c, 2.4)}/>`;
  // face
  const ey = -30;
  s += `<ellipse cx="-10" cy="${ey}" rx="3.6" ry="4.6" fill="#1d1a2b"/><ellipse cx="10" cy="${ey}" rx="3.6" ry="4.6" fill="#1d1a2b"/><circle cx="-11" cy="${ey - 1.6}" r="1.3" fill="#fff"/><circle cx="9" cy="${ey - 1.6}" r="1.3" fill="#fff"/>`;
  const bt = c.lvl >= 3 ? 2 : 0;
  s += `<path d="M-16,${ey - 9 + bt} L-5,${ey - 8 - bt}" ${O(c, 2.6)}/><path d="M16,${ey - 9 + bt} L5,${ey - 8 - bt}" ${O(c, 2.6)}/>`;
  s += `<path d="M0,${ey + 3} L-3,${ey + 11} L1,${ey + 12}" fill="none" stroke="${c.pal.ol}" stroke-width="1.8" opacity=".7"/>`;
  if (!beard) s += c.lvl >= 4 ? `<path d="M-7,${ey + 20} L7,${ey + 20}" ${O(c, 2.4)}/>` : `<path d="M-7,${ey + 18} Q0,${ey + 23} 7,${ey + 18}" fill="none" ${O(c, 2.4)}/>`;
  else s += `<path d="M-6,${ey + 18} L6,${ey + 18}" stroke="${c.pal.ol}" stroke-width="2"/>`;
  s += `<ellipse cx="-17" cy="${ey + 10}" rx="5" ry="3" fill="#e88" opacity=".35"/><ellipse cx="17" cy="${ey + 10}" rx="5" ry="3" fill="#e88" opacity=".35"/>`;
  // hair / headgear
  if (gear === 'hair' || gear === 'crown' || gear === 'hat') {
    s += `<path d="M-28,-30 C-32,-62 -6,-70 4,-64 C22,-66 34,-52 28,-30 C24,-44 14,-50 4,-46 C-6,-52 -20,-46 -28,-30 Z" fill="${hair}" ${O(c)}/>`;
  }
  if (gear === 'hat') {
    s += `<path d="M-30,-52 C-20,-70 -4,-110 18,-124 C14,-100 22,-74 30,-52 Z" fill="url(#gm)" ${O(c)}/>`;
    s += `<ellipse cx="0" cy="-52" rx="46" ry="10" fill="${c.pal.dark}" ${O(c)}/>`;
    s += `<path d="M-26,-60 L28,-60" stroke="${c.pal.acc}" stroke-width="5"/>`;
    s += `<path d="M6,-90 l2,5 l5,0 l-4,3 l2,5 l-5,-3 l-5,3 l2,-5 l-4,-3 l5,0 Z" fill="#f2d27a"/>`;
  }
  if (gear === 'crown') s += crown(c, 0, -54, 22);
  if (gear === 'helm') {
    s += `<path d="M-30,-30 C-34,-76 34,-76 30,-30 L24,-30 L24,-44 L-24,-44 L-24,-30 Z" fill="#c8cfda" ${O(c)}/>`;
    s += `<path d="M-3,-44 L-3,-22 L3,-22 L3,-44 Z" fill="#aab3c2" ${O(c, 2)}/>`;
    s += `<path d="M0,-66 C8,-92 30,-96 40,-84 C24,-84 14,-78 6,-64 Z" fill="${c.pal.acc}" ${O(c, 2.2)}/>`;
  }
  if (gear === 'hood' || gear === 'holy') {
    s += `<path d="M-36,-10 C-46,-50 -36,-82 0,-84 C36,-82 46,-50 36,-10 C30,-30 30,-56 0,-58 C-30,-56 -30,-30 -36,-10 Z" fill="${gear === 'holy' ? '#f1ece0' : c.pal.dark}" ${O(c)}/>`;
    if (/assassin/.test(n)) s += `<path d="M-26,-22 C-10,-12 10,-12 26,-22 L26,-4 C10,6 -10,6 -26,-4 Z" fill="${c.pal.deep}" ${O(c, 2.2)}/>`;
  }
  if (gear === 'holy') s += halo(c, 0, -94, 30);
  if (opt.helmet === 'space') {
    s += `<circle cx="0" cy="-28" r="44" fill="hsla(195,80%,80%,.18)" stroke="#dfe8f2" stroke-width="5"/><path d="M-28,-52 Q-20,-64 -6,-66" fill="none" stroke="#fff" stroke-width="4" opacity=".7" stroke-linecap="round"/>`;
    s += `<rect x="-40" y="12" width="80" height="12" rx="6" fill="#aab3c2" ${O(c, 2.4)}/>`;
  }
  // items in front
  if (item === 'sword') s += `<path d="M-46,80 L-46,-10" stroke="${c.pal.ol}" stroke-width="10" stroke-linecap="round"/><path d="M-46,74 L-46,-10" stroke="#e1e6ee" stroke-width="6"/><path d="M-60,50 L-32,50" ${O(c, 6)}/><path d="M-60,50 L-32,50" stroke="#f2c94c" stroke-width="3"/>`;
  if (item === 'dagger') s += `<path d="M-40,70 L-50,20" stroke="${c.pal.ol}" stroke-width="8" stroke-linecap="round"/><path d="M-40,66 L-50,20" stroke="#e1e6ee" stroke-width="4"/>`;
  if (item === 'torch') s += `<path d="M-50,80 L-50,10" stroke="${c.pal.ol}" stroke-width="9"/><path d="M-50,80 L-50,10" stroke="#8a5a32" stroke-width="5"/><circle cx="-50" cy="-6" r="22" fill="url(#glow)"/><path d="M-50,-26 C-38,-12 -38,0 -50,6 C-62,0 -62,-12 -50,-26 Z" fill="hsla(30,100%,60%,.95)" ${O(c, 1.6)}/>`;
  if (/plague doctor/.test(n)) s += `<path d="M-6,-24 Q30,-12 34,4 Q12,-6 -6,-12 Z" fill="#e8e1cf" ${O(c, 2.2)}/><circle cx="-10" cy="-30" r="7" fill="#7fbf8f" ${O(c, 2)}/><circle cx="10" cy="-30" r="7" fill="#7fbf8f" ${O(c, 2)}/>`;
  return s;
}
FORMS.hero = (c) => heroBust(c);
FORMS.pilot = (c) => heroBust(c, { gear: 'hair', item: 'none', helmet: 'space' });

// ---------- machines ----------
FORMS.robot = (c) => {
  let s = '';
  const M = 'url(#met)';
  const tank = c.has(/tank|rover|hauler|turret|sprayer/);
  const walker = c.has(/walker|strider|patrol|titan|colossus/);
  if (tank) {
    s += `<rect x="-62" y="34" width="124" height="28" rx="14" fill="#3a3f4a" ${O(c)}/>`;
    for (let i = 0; i < 5; i++) s += `<circle cx="${-46 + i * 23}" cy="48" r="9" fill="#8a93a3" ${O(c, 2)}/>`;
  } else if (walker) {
    s += `<path d="M-22,22 L-36,46 L-28,66 M22,22 L36,46 L28,66" fill="none" stroke="${c.pal.ol}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round"/><path d="M-22,22 L-36,46 L-28,66 M22,22 L36,46 L28,66" fill="none" stroke="#9aa3b3" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<rect x="-44" y="62" width="30" height="10" rx="4" fill="#5d6574" ${O(c, 2.4)}/><rect x="14" y="62" width="30" height="10" rx="4" fill="#5d6574" ${O(c, 2.4)}/>`;
  } else {
    s += `<rect x="-26" y="30" width="18" height="32" rx="5" fill="#7c8595" ${O(c)}/><rect x="8" y="30" width="18" height="32" rx="5" fill="#7c8595" ${O(c)}/>`;
  }
  // arms
  for (const sx of [-1, 1]) {
    s += `<path d="M${sx * 40},-10 L${sx * 58},16 L${sx * 54},40" fill="none" stroke="${c.pal.ol}" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/><path d="M${sx * 40},-10 L${sx * 58},16 L${sx * 54},40" fill="none" stroke="#a8b0be" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>`;
    s += `<circle cx="${sx * 54}" cy="44" r="9" fill="${c.pal.dark}" ${O(c, 2.4)}/>`;
  }
  if (c.has(/turret|gunship|plasma|cannon/) || tank) s += `<rect x="20" y="-34" width="56" height="12" rx="4" fill="#5d6574" ${O(c, 2.4)}/><circle cx="78" cy="-28" r="6" fill="${c.pal.glow}"/>`;
  s += `<path d="M-42,-24 L42,-24 L34,${tank ? 36 : 32} L-34,${tank ? 36 : 32} Z" fill="${M}" ${O(c)}/>`;
  s += `<path d="M-42,-24 L42,-24 L40,-12 L-40,-12 Z" fill="url(#gm)" ${O(c, 2.4)}/>`;
  s += `<circle cx="0" cy="8" r="16" fill="url(#glow)"/><circle cx="0" cy="8" r="8" fill="${c.pal.glow}" ${O(c, 2.2)}/>`;
  for (const [x, y] of [[-30, -4], [30, -4], [-26, 24], [26, 24]]) s += `<circle cx="${x}" cy="${y}" r="2.6" fill="${c.pal.ol}"/>`;
  // head
  const hk = c.has(/medic|unit/) ? 'dome' : c.has(/sentry|crab|bot|mite/) ? 'dome' : c.pick(['box', 'dome', 'wedge']);
  if (hk === 'box') {
    s += `<rect x="-24" y="-62" width="48" height="36" rx="7" fill="${M}" ${O(c)}/><rect x="-18" y="-52" width="36" height="12" rx="6" fill="#0f141c" ${O(c, 2)}/>`;
    s += `<rect x="-14" y="-49" width="28" height="6" rx="3" fill="${c.pal.glow}"/>`;
  } else if (hk === 'dome') {
    s += `<path d="M-26,-26 C-26,-70 26,-70 26,-26 Z" fill="${M}" ${O(c)}/>`;
    s += eye(c, 0, -44, 9, { glow: true });
  } else {
    s += `<path d="M-28,-28 L0,-72 L28,-28 Z" fill="${M}" ${O(c)}/><path d="M-14,-40 L14,-40 L8,-48 L-8,-48 Z" fill="${c.pal.glow}" ${O(c, 1.8)}/>`;
  }
  s += `<path d="M14,-64 L22,-84" ${O(c, 3)}/><circle cx="22" cy="-86" r="4" fill="${c.pal.acc}" ${O(c, 1.6)}/>`;
  if (c.has(/medic/)) s += `<path d="M-6,-6 h12 M0,-12 v12" stroke="#e33" stroke-width="5"/>`;
  if (c.has(/titan|colossus|prime/)) s += crown(c, 0, c.has(/prime/) ? -62 : -62, 20);
  if (c.el === 'ice') s += `<path d="M-40,-24 l4,-10 l4,10 M20,-24 l4,-10 l4,10" fill="#eaffff" ${O(c, 1.4)}/>`;
  if (c.has(/mother|hive/)) for (let i = 0; i < 4; i++) s += `<circle cx="${f(c.R(-70, 70))}" cy="${f(c.R(-80, -40))}" r="5" fill="${c.pal.acc}" ${O(c, 1.6)}/>`;
  return s;
};

FORMS.ship = (c) => {
  let s = '<g transform="rotate(-18)">';
  const big = c.has(/dreadnought|carrier|ark|skybreaker/) || c.lvl >= 4;
  const L = big ? 78 : 64;
  // thrust
  for (let i = -1; i <= 1; i += big ? 1 : 2) s += `<path d="M${-L + 4},${i * 10} L${-L - 30 - c.R(0, 12)},${i * 10} L${-L + 4},${i * 10 + 8} Z" fill="hsla(${c.el === 'ice' ? 195 : 30},100%,62%,.95)"/><circle cx="${-L + 2}" cy="${i * 10 + 4}" r="8" fill="url(#glow)"/>`;
  // wings
  s += `<path d="M-20,8 L-40,48 L-6,48 L20,10 Z" fill="url(#gm)" ${O(c)}/><path d="M-20,-8 L-40,-42 L-10,-42 L16,-8 Z" fill="${c.pal.dark}" ${O(c)}/>`;
  // hull
  s += `<path d="M${L + 14},0 C${L - 10},-20 20,-${big ? 28 : 22} -${L - 10},-${big ? 22 : 16} L-${L},-8 L-${L},18 C-30,${big ? 30 : 24} 30,${big ? 26 : 20} ${L + 14},0 Z" fill="url(#met)" ${O(c)}/>`;
  s += `<path d="M-${L - 6},2 L${L - 6},2" stroke="${c.pal.acc}" stroke-width="5"/>`;
  s += `<ellipse cx="${L * 0.45}" cy="-8" rx="${L * 0.28}" ry="9" fill="${c.pal.glow}" opacity=".85" ${O(c, 2.4)}/><path d="M${L * 0.35},-12 Q${L * 0.45},-16 ${L * 0.6},-12" stroke="#fff" stroke-width="2" fill="none" opacity=".8"/>`;
  if (big) for (let i = 0; i < 4; i++) s += `<rect x="${-40 + i * 18}" y="-20" width="12" height="7" rx="2" fill="#5d6574" ${O(c, 1.6)}/>`;
  if (c.has(/gunship|dreadnought|interceptor|skybreaker/)) s += `<path d="M20,14 L${L + 4},20" ${O(c, 4)}/><circle cx="${L + 6}" cy="20" r="3" fill="${c.pal.glow}"/>`;
  if (c.has(/carrier|hive/)) for (let i = 0; i < 3; i++) s += `<path d="M${-20 + i * 28},${-56 - i * 4} l10,4 l-10,4 Z" fill="${c.pal.acc}" ${O(c, 1.4)}/>`;
  return s + '</g>';
};

FORMS.drone = (c) => {
  let s = '';
  const sat = c.has(/satellite/);
  if (sat) {
    for (const sx of [-1, 1]) {
      s += `<path d="M${sx * 30},0 L${sx * 44},0" ${O(c, 4)}/><rect x="${sx > 0 ? 44 : -88}" y="-22" width="44" height="44" fill="${hsl(215, 70, 40)}" ${O(c, 2.6)}/>`;
      s += `<path d="M${sx > 0 ? 58.7 : -73.3},-22 L${sx > 0 ? 58.7 : -73.3},22 M${sx > 0 ? 73.3 : -58.7},-22 L${sx > 0 ? 73.3 : -58.7},22 M${sx > 0 ? 44 : -88},0 L${sx > 0 ? 88 : -44},0" stroke="${hsl(215, 70, 70)}" stroke-width="1.2"/>`;
    }
  } else {
    for (const [x, y] of [[-52, -40], [52, -40], [-52, 40], [52, 40]]) {
      s += `<path d="M0,0 L${x},${y}" ${O(c, 6)}/><path d="M0,0 L${x},${y}" stroke="#a8b0be" stroke-width="3"/>`;
      s += `<ellipse cx="${x}" cy="${y - 6}" rx="22" ry="4" fill="#d9dee6" opacity=".7" ${O(c, 1.6)}/><circle cx="${x}" cy="${y}" r="5" fill="#5d6574" ${O(c, 2)}/>`;
    }
  }
  s += `<circle cx="0" cy="0" r="34" fill="url(#met)" ${O(c)}/>`;
  s += `<path d="M-34,6 Q0,18 34,6" fill="none" stroke="${c.pal.acc}" stroke-width="5"/>`;
  s += `<circle cx="0" cy="-6" r="15" fill="#0f141c" ${O(c, 2.4)}/>` + eye(c, 0, -6, 8, { glow: true });
  if (c.has(/probe/)) s += `<path d="M0,-34 L0,-58" ${O(c, 3)}/><path d="M-14,-62 Q0,-50 14,-62" fill="none" ${O(c, 3)}/>`;
  if (c.has(/halo|seraph/) || c.el === 'holy') s += halo(c, 0, -46, 28);
  if (c.has(/repair/)) s += `<path d="M20,30 L34,52 M28,48 l10,-2 l-4,10" fill="none" ${O(c, 4)}/>`;
  if (c.has(/sprite|fuel/)) s += `<path d="M0,34 q-10,14 0,26 q10,-12 0,-26 Z" fill="hsla(25,100%,60%,.95)" ${O(c, 1.6)}/>`;
  return s;
};

FORMS.sub = (c) => {
  let s = '';
  for (let i = 0; i < 6; i++) s += `<circle cx="${f(c.R(-70, 70))}" cy="${f(c.R(-80, -20))}" r="${f(c.R(2, 5))}" fill="none" stroke="hsla(200,90%,85%,.6)" stroke-width="1.4"/>`;
  s += `<path d="M-70,0 L-86,-16 L-86,16 Z" fill="#5d6574" ${O(c)}/>`;
  s += `<rect x="-16" y="-44" width="34" height="22" rx="6" fill="url(#gm)" ${O(c)}/><path d="M6,-44 L6,-64 L18,-64" fill="none" ${O(c, 4)}/>`;
  s += `<ellipse cx="0" cy="0" rx="70" ry="28" fill="url(#gm)" ${O(c)}/>`;
  s += `<path d="M-60,10 Q0,26 60,10" fill="none" stroke="${c.pal.dark}" stroke-width="3" opacity=".6"/>`;
  for (let i = 0; i < 3; i++) s += `<circle cx="${-28 + i * 24}" cy="-2" r="8" fill="${c.pal.glow}" ${O(c, 3)}/>`;
  if (c.has(/dredger|leviathan/)) s += `<path d="M64,6 L88,22 L76,30 L58,18 Z" fill="#8a93a3" ${O(c, 2.4)}/><path d="M80,26 l4,8 l4,-6" fill="none" ${O(c, 2)}/>`;
  if (c.has(/skimmer|bilge/)) s += `<path d="M-50,-28 Q0,-44 50,-28" fill="none" ${O(c, 3)}/>`;
  return s;
};

FORMS.core = (c) => {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    s += `<path d="M${f(Math.cos(a) * 36)},${f(Math.sin(a) * 36)} L${f(Math.cos(a) * 70)},${f(Math.sin(a) * 70)}" ${O(c, 6)}/><path d="M${f(Math.cos(a) * 36)},${f(Math.sin(a) * 36)} L${f(Math.cos(a) * 70)},${f(Math.sin(a) * 70)}" stroke="#a8b0be" stroke-width="3"/>`;
  }
  const hex = Array.from({ length: 6 }, (_, k) => { const a = (k / 6) * Math.PI * 2; return `${f(Math.cos(a) * 72)},${f(Math.sin(a) * 72)}`; }).join(' ');
  s += `<polygon points="${hex}" fill="none" ${O(c, 7)}/><polygon points="${hex}" fill="none" stroke="#8a93a3" stroke-width="3.5"/>`;
  s += `<circle cx="0" cy="0" r="58" fill="url(#glow)"/>`;
  s += `<ellipse cx="0" cy="0" rx="54" ry="14" transform="rotate(-25)" fill="none" stroke="${c.pal.acc}" stroke-width="3"/>`;
  s += `<ellipse cx="0" cy="0" rx="54" ry="14" transform="rotate(35)" fill="none" stroke="${c.pal.light}" stroke-width="2.5"/>`;
  s += `<circle cx="0" cy="0" r="26" fill="url(#gm)" ${O(c)}/><circle cx="-8" cy="-8" r="8" fill="#fff" opacity=".6"/>`;
  if (c.has(/mind/)) s += `<path d="M-14,-4 q4,-10 10,-4 q6,-8 10,2 q8,0 4,10" fill="none" stroke="${c.pal.ol}" stroke-width="2.2"/>`;
  if (c.has(/null/)) s += `<circle cx="0" cy="0" r="12" fill="#05060a"/>`;
  return s;
};

// ---------- form guesser (used when a card has no "form") ----------
function guessForm(deck, card) {
  const n = card.name.toLowerCase();
  const rules = [
    [/pilot/, 'pilot'], [/gunship|frigate|dreadnought|carrier|interceptor|glider|ark\b|skybreaker/, 'ship'],
    [/sub\b|dredger|skimmer/, 'sub'], [/drone|probe|satellite|sprite$/, 'drone'], [/core|engine|starforge|last light|ocean mind|reactor/, 'core'],
    [/wyrm|drake|serpent|eel|leviathan|hydra/, 'serpent'], [/moth|beetle|mite|hopper|matriarch|weaver/, 'insect'],
    [/roc|kite|phoenix|sovereign|warden/, 'bird'], [/wolf|hound|lynx|stag|thornback/, 'quad'], [/golem|titan|knight|sentinel|colossus|king|lancer/, 'golem'],
    [/crab/, 'crab'], [/treant/, 'treant'], [/wisp|djinn/, 'wisp'], [/seraph|archon|empress/, 'wraith'],
  ];
  for (const [re, form] of rules) if (re.test(n)) return form;
  return deck.artStyle === 'hero' ? 'hero' : deck.artStyle === 'mech' ? 'robot' : 'blob';
}

function render(deck, card) {
  const c = ctxFor(deck, card);
  const form = card.form || guessForm(deck, card);
  const fn = FORMS[form] || FORMS.blob;
  const subject = fn(c);
  const scale = form === 'hero' || form === 'pilot' ? 1 : 0.88 + Math.min(c.lvl, 5) * 0.03;
  const ty = form === 'hero' || form === 'pilot' ? 150 : 132;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250" width="200" height="250">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(c.pal.h, 35, 36)}"/><stop offset="1" stop-color="${hsl(c.pal.h, 40, 10)}"/></linearGradient>
<radialGradient id="gm" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${c.pal.light}"/><stop offset=".55" stop-color="${c.pal.main}"/><stop offset="1" stop-color="${c.pal.dark}"/></radialGradient>
<radialGradient id="ga" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${c.pal.accLight}"/><stop offset=".6" stop-color="${c.pal.acc}"/><stop offset="1" stop-color="${c.pal.accDark}"/></radialGradient>
<linearGradient id="met" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e8ef"/><stop offset=".5" stop-color="#9aa3b3"/><stop offset="1" stop-color="#5a6272"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="${c.pal.glow}" stop-opacity=".55"/><stop offset="1" stop-color="${c.pal.glow}" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" cx=".5" cy=".45" r=".75"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
</defs>
<rect width="200" height="250" fill="url(#bg)"/>
${motif(c)}
${aura(c)}
<ellipse cx="100" cy="212" rx="58" ry="9" fill="#000" opacity=".3"/>
<g transform="translate(100 ${ty}) scale(${f(scale * 100) / 100})">${subject}</g>
<rect width="200" height="250" fill="url(#vig)"/>
</svg>
`;
}

// ---------- main ----------
function main() {
  const only = process.argv[2];
  const index = JSON.parse(fs.readFileSync(path.join(DECKS, 'index.json'), 'utf8'));
  let total = 0;
  for (const file of index.decks) {
    const deckPath = path.join(DECKS, path.basename(file));
    const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
    deck.id = deck.id || path.basename(file, '.json');
    if (only && deck.id !== only) continue;
    const dir = path.join(PUBLIC, 'art', deck.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const card of deck.cards) {
      const rel = `art/${deck.id}/${card.id}.svg`;
      if (card.image && !card.image.startsWith(`art/${deck.id}/`)) continue; // custom art: leave alone
      fs.writeFileSync(path.join(PUBLIC, rel), render(deck, card));
      card.image = rel;
      total++;
    }
    fs.writeFileSync(deckPath, JSON.stringify(deck, null, 1) + '\n');
  }
  console.log(`Generated ${total} card images.`);
}

if (require.main === module) main();
module.exports = { render, FORMS };
