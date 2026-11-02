# Triad — self-hosted four-sided card duel

A browser card game using Triple Triad-style rules: play against the computer
or against a friend online. No dependencies beyond Node.js 18+.

## Features

- 3×3 board, cards with four ranks (1–9, A = 10)
- Optional rules: **Open**, **Same**, **Plus** (both with **Combo** chains), **Elemental**
- Computer opponent: Easy / Normal / Hard (Hard looks one move ahead when hands are open, and never peeks at a hidden hand)
- Online rooms with 4-letter codes and invite links, server-authoritative moves, reconnect on refresh, rematches
- Six card sets with illustrated art, chosen from the menu (the room host's choice applies to both players):
  Wilds, Arcane Order, Starfall, Tidebound, Bloomwild, Hollow Lanterns
- Accounts, per-set card collections, XP, card packs, normal and foil cards, Shards for scrapping and crafting, and daily challenges (see below)
- Trading-card-size cards on desktop with 3D tilt, swing, capture flips and a dynamic foil/glare lighting effect
- A full visual theme per card set (colours and fonts), and sealed foil card packs you tear open
- Works on phones

## Run it

```bash
node server.js            # http://localhost:8080
PORT=3000 node server.js  # different port
```

`/healthz` returns `ok` for uptime checks.

## Install on Proxmox (one line)

Run this in the **Proxmox host** shell (Datacenter → your node → Shell):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/ashishkhatri/tripletriad/main/ct/triad.sh)"
```

It asks **Default** or **Advanced**, then creates an unprivileged Debian 12 LXC
(1 core, 512 MB RAM, 4 GB disk, DHCP on `vmbr0` by default), installs Node.js,
clones this repo to `/opt/triad`, sets up the `triad` service and prints the URL.

Skip the prompts by setting options up front:

```bash
UNATTENDED=1 CTID=150 IP=192.168.1.50/24 GATEWAY=192.168.1.1 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/ashishkhatri/tripletriad/main/ct/triad.sh)"
```

Options: `CTID HOSTNAME_CT CORES RAM DISK BRIDGE IP GATEWAY VLAN STORAGE TEMPLATE_STORAGE PORT BRANCH`.

**Updating:** inside the container run `update`, or from the host `pct exec <CTID> -- update`.
It pulls the latest code from GitHub and restarts the service.

**Logs:** `pct exec <CTID> -- journalctl -u triad -f`

### Manual install (any Debian/Ubuntu box)

```bash
apt update && apt install -y nodejs git
git clone https://github.com/ashishkhatri/tripletriad.git /opt/triad
useradd --system --home /opt/triad --shell /usr/sbin/nologin triad
chown -R triad:triad /opt/triad
cp /opt/triad/triad.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now triad
```

### Docker

```bash
docker build -t triad .
docker run -d --name triad -p 8080:8080 --restart unless-stopped triad
```

## Putting it online: Nginx Proxy Manager + Cloudflare

The game uses a WebSocket at `/ws`; both NPM and Cloudflare support it, it just needs switching on in NPM.

**Cloudflare DNS**
1. Add an `A` record, e.g. `triad` → your public IP, **Proxied** (orange cloud).
2. SSL/TLS → Overview → set mode to **Full (strict)**.
3. WebSockets are on by default (Network → WebSockets). Cloudflare drops idle sockets after ~100 s; the server pings every 30 s, so games stay connected.

**Nginx Proxy Manager** → Hosts → Proxy Hosts → Add:
- Domain: `triad.yourdomain.com`
- Scheme `http`, Forward Hostname/IP: the LXC's IP, Port `8080`
- ✅ **Websockets Support** (required — without it the menu loads but online rooms never connect)
- ✅ Block Common Exploits
- SSL tab: request a Let's Encrypt certificate, ✅ Force SSL, ✅ HTTP/2.
  Behind the orange cloud, use **DNS Challenge** with a Cloudflare API token (Zone → DNS → Edit) so issuance doesn't depend on port 80.

Your router only needs 443 (and 80 if you use HTTP challenge) forwarded to NPM — never to the game container.

**Checking it:** `https://triad.yourdomain.com/healthz` should return `ok`. Create a room on your phone over mobile data and join from a computer; if the lobby never moves past "Waiting", Websockets Support is off in NPM.

**Plain nginx**, if you're not using NPM:
```
location / {
  proxy_pass http://192.168.1.50:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
}
```

## Card sets

Sets live in `public/decks/`. `index.json` lists them in menu order:

```json
{ "decks": ["wilds.json", "arcane.json", "starfall.json", "tidebound.json", "bloomwild.json", "hollow.json"] }
```

A set file:

```json
{
  "id": "myset",
  "name": "My Set",
  "description": "Shown under the menu picker",
  "elements": { "fire": "🔥", "ice": "❄️" },
  "cards": [
    { "id": 1, "name": "Ember Imp", "level": 1, "ranks": [5, 1, 1, 3], "element": "fire", "image": "art/myset/ember-imp.png" }
  ]
}
```

- `ranks` are `[top, right, bottom, left]`, 1–10 (10 shows as A).
- Each hand gets one card per level, so give every level at least 2 cards (8 per level across levels 1–5 works well).
  Rough rank totals per level that keep things balanced: L1 ≈ 12–14, L2 ≈ 16–18, L3 ≈ 19–21, L4 ≈ 23–25, L5 ≈ 27–30.
- `element` and `image` are optional. Images go under `public/art/`; without one, the card gets a coloured emblem with its initials.
- `form` tells the art generator what to draw (see below).
- Restart the server after adding or editing a set (the server deals online hands from its own copy).

## Card art

All the art is SVG drawn by `tools/genart.js` from each card's `form`, element and level
(level 4 gets a glow, level 5 a golden halo). To regenerate after editing or adding cards:

```bash
node tools/genart.js            # all sets
node tools/genart.js tidebound  # one set
```

Available forms: `blob`, `quad`, `bird`, `serpent`, `insect`, `golem`, `crab`, `fish`, `jelly`, `octo`,
`turtle`, `mushroom`, `flower`, `treant`, `sprout`, `cactus`, `ghost`, `wisp`, `mask`, `lantern`, `wraith`,
`hero`, `pilot`, `robot`, `ship`, `drone`, `sub`, `core`. Some details also key off the card name
(e.g. a `quad` named "Stag" gets antlers, a `wraith` named "Queen" gets a crown).

To use your own picture for a card, set its `image` to a file outside `art/<set>/`
(for example `art/custom/my-card.png`) — the generator never overwrites those.

## Accounts, collections and packs

Players can create an account (name + password) from the menu. Accounts live on your server, so
progress follows a player to any device. Guests can still play with the **Balanced** hands rule.

- **Starter collection:** the first time you use a set you get 7 of its cards (four level-1, two level-2, one level-3).
- **XP is per set:** 10 XP for playing, +25 for a win (+5 for a draw). Matches against the computer count.
- **Packs:** every 100 XP in a set unlocks a 3-card pack from that set. Higher levels are rarer
  (L1 40%, L2 30%, L3 18%, L4 9%, L5 3%). Open them from the menu, the Collection screen or the result screen.
- **Hands rule** (in the Rules box; the room host's choice applies to both players):
  - *Balanced* — everyone is dealt a fair random hand; no account needed.
  - *Random from collection* — 5 random cards you own.
  - *Build from collection* — choose any 5 cards you own.
  - *Build — level budget 15* — choose 5 you own whose levels add up to 15 or less.
  The computer gets a hand of about the same total level as yours.
- **Normal and foil cards:** every card exists as a normal and a rarer foil version (about 1 in 10 pack cards).
  Only foils get the holographic layer. Foil copies are played first when they're in your hand.
- **Card frames:** the outer border shows rarity — iron (common), bronze, silver, gold, prismatic (legendary) —
  and the inner border shows the element. On the board, the name plate shows whose card it is (blue / red).
- **Shards** (one balance per account): earned from daily challenges and by scrapping cards; spent on crafting.
  | Rarity | Scrap | Craft |
  |---|---|---|
  | Common | 5 | 40 |
  | Uncommon | 10 | 80 |
  | Rare | 25 | 200 |
  | Epic | 60 | 500 |
  | Legendary | 150 | 1200 |
  Foil copies are worth 4× either way. Scrap from the pack reveal or the Collection screen (click a card),
  or use **Scrap extras** to keep one normal and one foil of each card. You can't scrap below 5 cards in a set.
- **Collection:** every card in a set is shown, owned or not, with its crafting cost.
- **Daily challenges:** three a day (e.g. "Win 2 games", "Trigger a Combo", "Beat the computer on Hard"),
  worth 30–100 shards each, paid automatically when completed. They reset at midnight in the server's time zone
  (`DAILY_TZ` overrides it; new containers use the Proxmox host's time zone).
- **Wager rule:** the winner takes one card of their choice from the loser's hand into their collection
  (the computer always takes your highest-level card). Nobody can drop below 5 cards in a set —
  a spare level-1 card is added if needed.

All matches, including against the computer, are played on the server, so XP, packs and wagers
can't be edited in the browser.

### Where the data lives

`/var/lib/triad/triad.json` in the container (set by `DATA_DIR`; Docker uses the `/data` volume).
It's separate from the code, so `update` never touches it, and `update` keeps the last 10 backups in
`/var/lib/triad/backups/` before each restart. To back up the whole thing, copy that folder
(or snapshot the container in Proxmox).

## Music

Each card set has its own original background theme in `public/music/` (MP3, 128 kbps, ~0.5–1 MB each),
played as a seamless loop. The menu plays the selected set's theme; a game plays its set's theme.
The ♫ button and slider in the corner mute it and set the volume, remembered per browser.
Browsers only allow sound after the first click or tap, so music starts then.

| Set | Theme |
|---|---|
| Wilds | Over the Wild Ridge |
| Arcane Order | The Archmage's Court |
| Starfall | Lights Beyond the Sky |
| Tidebound | Song of the Tidewaters |
| Bloomwild | Dance of the Greenwood |
| Hollow Lanterns | Lanterns in the Hollow |

The tracks are composed and synthesized by `tools/genmusic.py` (needs `numpy`, `scipy`, `ffmpeg`):

```bash
python3 tools/genmusic.py            # re-render all
python3 tools/genmusic.py tidebound  # one
```

To give a set different music, put any MP3 in `public/music/` and point the set's `music` field at it:

```json
"music": { "file": "music/my-theme.mp3", "title": "My Theme" }
```

## Cards, foil and themes

- **Size:** cards use real trading-card proportions (63 × 88 mm) and, on desktop, scale up to
  2.5 × 3.5 in (240 × 336 px), shrinking to fit smaller windows. Phones keep the compact layout.
- **3D:** cards tilt toward the pointer, a dragged card lifts and swings with your hand's motion,
  and captured cards flip over in 3D (showing their back) in the direction they were hit from.
- **Foil lighting** (`public/foil.js`): the pointer is treated as a point light above the screen.
  Each card's surface normal comes from its tilt; Blinn-Phong shading places a specular glare at the
  reflection point, and a Fresnel term drives a holographic foil layer (spectrum + grain) that is
  colour-dodged over the art, so it works on any picture. Touch screens get a slow drifting light instead.
- **Themes** (`public/themes.css`): each set restyles the whole site — background, board, panels,
  buttons, card frames and backs, accent colours and its own sans-serif fonts. The theme follows the set
  chosen in the menu or Collection screen and is remembered; a match uses its own set's theme.
- **Card packs:** each set has its own sealed foil pack (`public/packs/`, made by `node tools/genpacks.js`).
  Click it to tear it open, then click each card to reveal it. A pack is only used once it's torn.

## Sound effects

Original sound effects live in `public/sfx/` (MP3, ~560 KB total): card pick-up, placement, flips,
putting a card back, Same/Plus/Combo chimes, your-turn bell, win/lose/draw stings, XP, pack unlocks,
wagers, pack opening and a reveal sound per card level (grander for rarer cards).
The 🔔 button and slider next to the music control mute them and set their volume (remembered per browser).
They're synthesized by `tools/gensfx.py` (`python3 tools/gensfx.py`), and any file can be swapped for your own MP3
with the same name.

## Versions and releases

The running version is shown at the bottom of the main menu and at `/version`.
Each change gets a version bump and a [GitHub release](https://github.com/ashishkhatri/tripletriad/releases);
see `CHANGELOG.md`. Run `update` in the container to move to the latest release.

## Files

| File | What it is |
|---|---|
| `server.js` | Static file server + online rooms |
| `wslite.js` | Built-in WebSocket implementation (no npm install needed) |
| `public/game.js` | Rules engine and AI, shared by browser and server |
| `public/client.js` | Browser UI |
| `public/decks/` | Card sets |
| `public/art/` | Card art (generated SVGs) |
| `tools/genart.js` | Art generator |
| `public/music/` | Set themes (MP3) |
| `public/music.js` | Music player |
| `tools/genmusic.py` | Music composer/renderer |
| `public/sfx/` | Sound effects (MP3) |
| `public/sfx.js` | Sound-effects player |
| `tools/gensfx.py` | Sound-effects synthesizer |
| `public/foil.js` | Card tilt and foil lighting |
| `public/themes.css` | Per-set themes |
| `public/packs/` | Pack art (SVG) |
| `tools/genpacks.js` | Pack art generator |
| `public/backs/` | Card backs per set (SVG) |
| `tools/genbacks.js` | Card back generator |
| `lib/daily.js` | Daily challenges |
| `ct/triad.sh` | Proxmox LXC installer (run on the host) |
| `ct/update.sh` | In-container updater (`update`) |
| `triad.service` | systemd unit |
| `CHANGELOG.md` | Release notes |
| `tools/release.sh` | Tags and publishes a release |
