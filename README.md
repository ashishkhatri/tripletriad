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
| `ct/triad.sh` | Proxmox LXC installer (run on the host) |
| `ct/update.sh` | In-container updater (`update`) |
| `triad.service` | systemd unit |
