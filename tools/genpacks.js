'use strict';
/*
 * Generates the sealed card-pack art for every set: public/packs/<set>.svg (original artwork).
 * Each pack is a foil wrapper in the set's palette with its own pattern, crimped ends,
 * a window showing one of the set's level-5 creatures, and the set name.
 *
 *   node tools/genpacks.js
 */
const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');

const STYLE = {
  wilds:     { c1: '#3a2414', c2: '#7a4a24', c3: '#e6c56c', ink: '#fff3c4', motif: 'claws',    tag: 'BEASTS & MONSTERS' },
  arcane:    { c1: '#16113a', c2: '#4b3a9a', c3: '#dfe6f7', ink: '#ffffff', motif: 'runes',    tag: 'WIZARDS & WANDERERS' },
  starfall:  { c1: '#04081a', c2: '#123a6e', c3: '#6fd2f2', ink: '#e8fbff', motif: 'stars',    tag: 'MECHS & SPACEFARERS' },
  tidebound: { c1: '#04262d', c2: '#0e6676', c3: '#ffd2bd', ink: '#fffaf3', motif: 'waves',    tag: 'REEF & DEEP' },
  bloomwild: { c1: '#13280e', c2: '#3c7a2a', c3: '#ffc7da', ink: '#fff6f9', motif: 'leaves',   tag: 'FLORA & FUNGI' },
  hollow:    { c1: '#0d0a18', c2: '#3a2457', c3: '#ffb35c', ink: '#fff4df', motif: 'lanterns', tag: 'SPIRITS & MASKS' },
};
const FALLBACK = { c1: '#222', c2: '#555', c3: '#ddd', ink: '#fff', motif: 'stars', tag: 'CARD PACK' };

const W = 300, H = 460;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function crimp(y, up) {   // zig-zag sealed edge
  let d = `M0,${y}`;
  for (let x = 0; x <= W; x += 10) d += ` L${x},${y + (x % 20 === 0 ? 0 : up ? -7 : 7)}`;
  return d;
}

function motif(kind, color) {
  let s = '';
  const R = (a, b, i) => a + ((i * 9301 + 49297) % 233280) / 233280 * (b - a);
  for (let i = 0; i < 26; i++) {
    const x = R(10, W - 10, i * 3 + 1), y = R(60, H - 60, i * 7 + 2), k = R(0.6, 1.3, i * 11 + 3), rot = R(-40, 40, i * 13 + 5);
    const t = `transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)}) scale(${k.toFixed(2)})"`;
    if (kind === 'claws') s += `<g ${t}><path d="M-8,-12 q4,12 0,24 M0,-14 q4,14 0,28 M8,-12 q4,12 0,24" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`;
    if (kind === 'runes') s += `<g ${t}><path d="M-6,-10 L6,-10 M0,-10 L0,10 M-6,4 L6,10" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/><circle r="14" fill="none" stroke="${color}" stroke-width="1"/></g>`;
    if (kind === 'stars') s += `<g ${t}><path d="M0,-9 L2.5,-2.5 L9,0 L2.5,2.5 L0,9 L-2.5,2.5 L-9,0 L-2.5,-2.5 Z" fill="${color}"/></g>`;
    if (kind === 'waves') s += `<g ${t}><path d="M-18,0 q6,-8 12,0 t12,0 t12,0" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`;
    if (kind === 'leaves') s += `<g ${t}><path d="M0,-14 C10,-6 10,6 0,14 C-10,6 -10,-6 0,-14 Z M0,-12 L0,12" fill="${color}" stroke="${color}" stroke-width="1"/></g>`;
    if (kind === 'lanterns') s += `<g ${t}><rect x="-6" y="-9" width="12" height="16" rx="5" fill="${color}"/><path d="M-3,-9 v-4 h6 v4 M0,7 v5" stroke="${color}" stroke-width="1.6" fill="none"/></g>`;
  }
  return s;
}

function packSvg(deck) {
  const st = STYLE[deck.id] || FALLBACK;
  const featured = deck.cards.filter((c) => c.level === Math.max(...deck.cards.map((x) => x.level)))[0] || deck.cards[0];
  let art = '';
  if (featured && featured.image) {
    const file = path.join(PUBLIC, featured.image);
    if (fs.existsSync(file)) art = 'data:image/svg+xml;base64,' + fs.readFileSync(file).toString('base64');
  }
  const name = esc(deck.name.toUpperCase());
  const fs1 = name.length > 12 ? 24 : name.length > 9 ? 28 : 32;
  const fit = name.length > 9 ? ` textLength="${W - 56}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${st.c2}"/><stop offset=".45" stop-color="${st.c1}"/><stop offset="1" stop-color="${st.c2}"/>
  </linearGradient>
  <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="${st.c3}"/><stop offset=".6" stop-color="${st.c3}" stop-opacity=".7"/><stop offset="1" stop-color="#ffffff"/>
  </linearGradient>
  <linearGradient id="seal" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${st.c3}"/><stop offset="1" stop-color="${st.c2}"/>
  </linearGradient>
  <radialGradient id="vig" cx=".5" cy=".45" r=".7"><stop offset=".55" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
  <clipPath id="win"><rect x="58" y="112" width="184" height="236" rx="16"/></clipPath>
  <clipPath id="packShape"><path d="${crimp(14, false)} L${W},${H - 14} ${crimp(H - 14, true).replace(/^M[^L]+/, '').split(' L').reverse().join(' L')} Z"/></clipPath>
</defs>
<g clip-path="url(#packShape)">
  <rect width="${W}" height="${H}" fill="url(#body)"/>
  <g opacity=".22">${motif(st.motif, st.c3)}</g>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  <!-- foil seal bands -->
  <rect y="0" width="${W}" height="54" fill="url(#seal)"/>
  <rect y="${H - 54}" width="${W}" height="54" fill="url(#seal)"/>
  ${Array.from({ length: 30 }, (_, i) => `<rect x="${i * 10}" y="2" width="1.5" height="48" fill="#ffffff" opacity=".18"/><rect x="${i * 10}" y="${H - 50}" width="1.5" height="48" fill="#ffffff" opacity=".18"/>`).join('')}
  <path d="M0,52 H${W} M0,${H - 52} H${W}" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
  <!-- tear notch -->
  <path d="M${W - 26},46 l8,8 l-8,8" fill="none" stroke="${st.ink}" stroke-width="2" opacity=".8"/>
  <text x="${W - 34}" y="50" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="9" font-weight="700" fill="${st.ink}" text-anchor="end" opacity=".8" letter-spacing="1">TEAR HERE</text>
  <!-- window with the featured creature -->
  <rect x="50" y="104" width="200" height="252" rx="22" fill="url(#metal)"/>
  <rect x="56" y="110" width="188" height="240" rx="18" fill="${st.c1}"/>
  ${art ? `<image href="${art}" xlink:href="${art}" x="58" y="98" width="184" height="270" preserveAspectRatio="xMidYMid slice" clip-path="url(#win)"/>` : ''}
  <rect x="58" y="112" width="184" height="236" rx="16" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
  <!-- title -->
  <text x="${W / 2}" y="88" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="${fs1}" font-weight="800" fill="${st.ink}" text-anchor="middle" letter-spacing="3" stroke="#000" stroke-opacity=".35" stroke-width="1"${fit}>${name}</text>
  <text x="${W / 2}" y="378" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="700" fill="${st.ink}" text-anchor="middle" letter-spacing="3" opacity=".9">${esc(st.tag)}</text>
  <!-- badge -->
  <g transform="translate(${W / 2} 402)">
    <rect x="-72" y="-12" width="144" height="24" rx="12" fill="url(#metal)" stroke="#000" stroke-opacity=".3"/>
    <text y="5" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="800" fill="${st.c1}" text-anchor="middle" letter-spacing="1" textLength="128" lengthAdjust="spacingAndGlyphs">5 CARDS + 1 FOIL</text>
  </g>
</g>
</svg>
`;
}

function packBackSvg(deck) {
  const st = STYLE[deck.id] || FALLBACK;
  const name = esc(deck.name.toUpperCase());
  const fit = name.length > 9 ? ` textLength="${W - 120}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <linearGradient id="body" x1="1" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${st.c2}"/><stop offset=".5" stop-color="${st.c1}"/><stop offset="1" stop-color="${st.c2}"/>
  </linearGradient>
  <linearGradient id="seal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${st.c3}"/><stop offset="1" stop-color="${st.c2}"/></linearGradient>
  <clipPath id="packShape"><path d="${crimp(14, false)} L${W},${H - 14} ${crimp(H - 14, true).replace(/^M[^L]+/, '').split(' L').reverse().join(' L')} Z"/></clipPath>
</defs>
<g clip-path="url(#packShape)">
  <rect width="${W}" height="${H}" fill="url(#body)"/>
  <g opacity=".16">${motif(st.motif, st.c3)}</g>
  <rect y="0" width="${W}" height="54" fill="url(#seal)"/>
  <rect y="${H - 54}" width="${W}" height="54" fill="url(#seal)"/>
  ${Array.from({ length: 30 }, (_, i) => `<rect x="${i * 10}" y="2" width="1.5" height="48" fill="#ffffff" opacity=".18"/><rect x="${i * 10}" y="${H - 50}" width="1.5" height="48" fill="#ffffff" opacity=".18"/>`).join('')}
  <!-- fin seal down the middle, like a real flow-wrapped pack -->
  <rect x="${W / 2 - 14}" y="54" width="28" height="${H - 108}" fill="${st.c3}" opacity=".55"/>
  <rect x="${W / 2 - 14}" y="54" width="28" height="${H - 108}" fill="none" stroke="#000" stroke-opacity=".25"/>
  ${Array.from({ length: 34 }, (_, i) => `<rect x="${W / 2 - 13}" y="${58 + i * 10}" width="26" height="1.4" fill="#fff" opacity=".22"/>`).join('')}
  <g transform="translate(${W / 2 - 72} 120)">
    <rect width="${-2}" height="0"/>
  </g>
  <text x="${W / 4}" y="150" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" font-weight="800" fill="${st.ink}" text-anchor="middle" letter-spacing="2" transform="rotate(-90 ${W / 4} 150)">TRIAD</text>
  <text x="${W * 0.75}" y="230" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="20" font-weight="800" fill="${st.ink}" text-anchor="middle" letter-spacing="3" transform="rotate(90 ${W * 0.75} 230)"${fit}>${name}</text>
  <g font-family="Segoe UI, Helvetica, Arial, sans-serif" fill="${st.ink}" opacity=".75" font-size="9.5" text-anchor="middle">
    <text x="${W / 4}" y="270">5 CARDS + 1 FOIL</text>
    <text x="${W / 4}" y="286">FOIL GUARANTEED</text>
    <text x="${W / 4}" y="302">ONE SET · ${deck.cards.length} CARDS</text>
  </g>
  <g transform="translate(${W / 4 - 34} 320)" opacity=".8">
    ${Array.from({ length: 22 }, (_, i) => `<rect x="${i * 3.1}" y="0" width="${(i * 7) % 3 === 0 ? 2 : 1}" height="34" fill="${st.ink}"/>`).join('')}
  </g>
</g>
</svg>
`;
}

const index = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'decks', 'index.json'), 'utf8'));
fs.mkdirSync(path.join(PUBLIC, 'packs'), { recursive: true });
for (const f of index.decks) {
  const deck = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'decks', f), 'utf8'));
  deck.id = deck.id || f.replace(/\.json$/, '');
  const out = path.join(PUBLIC, 'packs', `${deck.id}.svg`);
  fs.writeFileSync(out, packSvg(deck));
  fs.writeFileSync(path.join(PUBLIC, 'packs', `${deck.id}-back.svg`), packBackSvg(deck));
  console.log(`${deck.id.padEnd(10)} ${Math.round(fs.statSync(out).size / 1024)} KB`);
}
