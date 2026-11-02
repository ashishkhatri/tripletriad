'use strict';
/*
 * Generates an original card back for every set: public/backs/<set>.svg (63:88, trading-card shape).
 *   node tools/genbacks.js
 */
const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');
const W = 315, H = 440;

const STYLE = {
  wilds:     { a: '#3b2516', b: '#6b3f1f', m: '#e6c56c', pattern: 'scales',  emblem: 'claw' },
  arcane:    { a: '#1c1546', b: '#3d2f80', m: '#dfe6f7', pattern: 'stars',   emblem: 'eye' },
  starfall:  { a: '#040a1c', b: '#103060', m: '#6fd2f2', pattern: 'grid',    emblem: 'planet' },
  tidebound: { a: '#062e36', b: '#0f6474', m: '#ffd2bd', pattern: 'waves',   emblem: 'shell' },
  bloomwild: { a: '#16300f', b: '#356b25', m: '#ffc7da', pattern: 'leaves',  emblem: 'flower' },
  hollow:    { a: '#100c1c', b: '#3a2457', m: '#ffb35c', pattern: 'paper',   emblem: 'lantern' },
};
const FALLBACK = { a: '#2a1640', b: '#3a1f4f', m: '#d9b45a', pattern: 'stars', emblem: 'star' };

function pattern(kind, c) {
  if (kind === 'scales') return `<pattern id="p" width="24" height="16" patternUnits="userSpaceOnUse"><path d="M0,16 a12,12 0 0 1 24,0 M-12,8 a12,12 0 0 1 24,0 M12,8 a12,12 0 0 1 24,0" fill="none" stroke="${c}" stroke-width="1.2" opacity=".35"/></pattern>`;
  if (kind === 'stars') return `<pattern id="p" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M19,9 l2,8 l8,2 l-8,2 l-2,8 l-2,-8 l-8,-2 l8,-2 Z" fill="${c}" opacity=".3"/><circle cx="5" cy="31" r="1.2" fill="${c}" opacity=".5"/><circle cx="33" cy="6" r="1" fill="${c}" opacity=".5"/></pattern>`;
  if (kind === 'grid') return `<pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20,0 H0 V20" fill="none" stroke="${c}" stroke-width=".8" opacity=".3"/><circle cx="0" cy="0" r="1.4" fill="${c}" opacity=".6"/></pattern>`;
  if (kind === 'waves') return `<pattern id="p" width="40" height="18" patternUnits="userSpaceOnUse"><path d="M0,9 q10,-8 20,0 t20,0" fill="none" stroke="${c}" stroke-width="1.6" opacity=".35"/></pattern>`;
  if (kind === 'leaves') return `<pattern id="p" width="34" height="34" patternUnits="userSpaceOnUse"><path d="M17,4 C25,10 25,20 17,28 C9,20 9,10 17,4 Z M17,6 V27" fill="none" stroke="${c}" stroke-width="1.2" opacity=".35"/></pattern>`;
  return `<pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M0,14 H28 M14,0 V28" stroke="${c}" stroke-width=".7" opacity=".25"/><circle cx="14" cy="14" r="3" fill="none" stroke="${c}" stroke-width=".8" opacity=".35"/></pattern>`;
}

function emblem(kind, c, a) {
  const g = (inner) => `<g transform="translate(${W / 2} ${H / 2})">${inner}</g>`;
  if (kind === 'claw') return g(`<circle r="58" fill="${a}" stroke="${c}" stroke-width="4"/><path d="M-24,-30 q14,30 0,60 M0,-36 q14,36 0,72 M24,-30 q14,30 0,60" stroke="${c}" stroke-width="9" fill="none" stroke-linecap="round"/>`);
  if (kind === 'eye') return g(`<circle r="60" fill="${a}" stroke="${c}" stroke-width="3"/><circle r="48" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="3 5"/><path d="M-44,0 Q0,-36 44,0 Q0,36 -44,0 Z" fill="none" stroke="${c}" stroke-width="4"/><circle r="13" fill="${c}"/><circle r="5" fill="${a}"/>`);
  if (kind === 'planet') return g(`<circle r="60" fill="${a}" stroke="${c}" stroke-width="3"/><circle r="26" fill="${c}" opacity=".9"/><ellipse rx="52" ry="13" fill="none" stroke="${c}" stroke-width="4" transform="rotate(-20)"/><circle cx="34" cy="-34" r="4" fill="${c}"/>`);
  if (kind === 'shell') return g(`<circle r="60" fill="${a}" stroke="${c}" stroke-width="3"/><path d="M0,34 L-40,-6 Q-30,-40 0,-42 Q30,-40 40,-6 Z" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>${[-24, -12, 0, 12, 24].map((x) => `<path d="M0,32 L${x},-38" stroke="${c}" stroke-width="2.5"/>`).join('')}`);
  if (kind === 'flower') return g(`<circle r="60" fill="${a}" stroke="${c}" stroke-width="3"/>${Array.from({ length: 6 }, (_, i) => `<ellipse cy="-26" rx="12" ry="22" fill="none" stroke="${c}" stroke-width="3.5" transform="rotate(${i * 60})"/>`).join('')}<circle r="10" fill="${c}"/>`);
  if (kind === 'lantern') return g(`<circle r="60" fill="${a}" stroke="${c}" stroke-width="3"/><circle r="40" fill="${c}" opacity=".18"/><rect x="-18" y="-30" width="36" height="52" rx="16" fill="none" stroke="${c}" stroke-width="4"/><path d="M-10,-30 v-8 h20 v8 M-14,-12 h28 M-14,4 h28 M0,22 v12" stroke="${c}" stroke-width="3" fill="none"/>`);
  return g(`<circle r="58" fill="${a}" stroke="${c}" stroke-width="3"/><path d="M0,-40 L10,-10 L40,0 L10,10 L0,40 L-10,10 L-40,0 L-10,-10 Z" fill="${c}"/>`);
}

function backSvg(id) {
  const st = STYLE[id] || FALLBACK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <radialGradient id="bg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="${st.b}"/><stop offset="1" stop-color="${st.a}"/></radialGradient>
  ${pattern(st.pattern, st.m)}
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${st.m}"/><stop offset=".65" stop-color="${st.m}" stop-opacity=".6"/><stop offset="1" stop-color="#fff"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#p)"/>
<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="10" fill="none" stroke="url(#rim)" stroke-width="3"/>
<rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="6" fill="none" stroke="${st.m}" stroke-width="1" opacity=".55"/>
${[[30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30]].map(([x, y]) => `<path d="M${x},${y - 8} L${x + 8},${y} L${x},${y + 8} L${x - 8},${y} Z" fill="${st.m}"/>`).join('')}
<circle cx="${W / 2}" cy="${H / 2}" r="92" fill="${st.m}" opacity=".08"/>
${emblem(st.emblem, st.m, st.a)}
<text x="${W / 2}" y="${H - 44}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="15" font-weight="800" letter-spacing="8" fill="${st.m}" text-anchor="middle" opacity=".85">TRIAD</text>
</svg>
`;
}

const index = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'decks', 'index.json'), 'utf8'));
fs.mkdirSync(path.join(PUBLIC, 'backs'), { recursive: true });
for (const f of index.decks) {
  const id = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'decks', f), 'utf8')).id || f.replace(/\.json$/, '');
  fs.writeFileSync(path.join(PUBLIC, 'backs', `${id}.svg`), backSvg(id));
  console.log('back', id);
}
