#!/usr/bin/env bash
# Updates Triad in place: pulls the latest code and restarts the service.
# Installed inside the container as /usr/bin/update.
set -Eeuo pipefail
self_sum=$(sha256sum < "$0" 2>/dev/null || true)
# /opt/triad is owned by the 'triad' user; let root's git work there regardless of HOME/env.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=/opt/triad
git config --system --get-all safe.directory 2>/dev/null | grep -qx /opt/triad || git config --system --add safe.directory /opt/triad
cd /opt/triad
ver() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' /opt/triad/package.json; }
before=${TRIAD_UPDATE_FROM:-$(git rev-parse --short HEAD)}; vbefore=${TRIAD_UPDATE_FROM_VER:-$(ver)}
git fetch -q --depth 1 origin
git reset -q --hard "origin/$(git rev-parse --abbrev-ref HEAD)"
after=$(git rev-parse --short HEAD); vafter=$(ver)
chown -R triad:triad /opt/triad
install -m 0755 /opt/triad/ct/update.sh /usr/bin/update
rm -f /usr/local/bin/update
# If this script itself changed, run the new version to finish the job.
if [[ -z "${TRIAD_UPDATE_FROM:-}" && "$(sha256sum < /usr/bin/update)" != "$self_sum" ]]; then
  TRIAD_UPDATE_FROM=$before TRIAD_UPDATE_FROM_VER=$vbefore exec /usr/bin/update
fi

# Player data is stored with Node's built-in SQLite (Node 22.13+). Debian's Node is older, so use NodeSource's Node 24.
node_changed=0
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "Installing Node.js 24 (needed for the SQLite database)..."
  export DEBIAN_FRONTEND=noninteractive
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  node_changed=1
fi
# the sqlite3 command line tool, for looking at the data yourself
command -v sqlite3 >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sqlite3 >/dev/null || true

# Refresh the systemd unit from the repo, keeping the port this container was set up with.
UNIT=/etc/systemd/system/triad.service
port=$(sed -n 's/^Environment=PORT=//p' "$UNIT" 2>/dev/null | head -n1); port=${port:-8080}
new_unit=$(sed -e "s/^Environment=PORT=.*/Environment=PORT=$port/" /opt/triad/triad.service)
unit_changed=0
if [[ "$new_unit" != "$(cat "$UNIT" 2>/dev/null)" ]]; then
  printf '%s\n' "$new_unit" > "$UNIT"
  systemctl daemon-reload
  unit_changed=1
fi

# Back up player data before restarting (keeps the last 10 backups).
DATA=/var/lib/triad
if [[ -f "$DATA/triad.db" ]] && command -v sqlite3 >/dev/null; then
  mkdir -p "$DATA/backups"
  sqlite3 "$DATA/triad.db" ".backup '$DATA/backups/triad-$(date +%Y%m%d-%H%M%S)-v$vbefore.db'"
  ls -1t "$DATA/backups"/triad-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
elif [[ -f "$DATA/triad.json" ]]; then
  mkdir -p "$DATA/backups"
  cp -p "$DATA/triad.json" "$DATA/backups/triad-$(date +%Y%m%d-%H%M%S)-v$vbefore.json"
  ls -1t "$DATA/backups"/triad-*.json 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

if [[ "$before" == "$after" && $unit_changed == 0 && $node_changed == 0 ]]; then
  echo "Triad is already up to date (v$vafter)."
else
  systemctl restart triad
  echo "Updated Triad v$vbefore -> v$vafter and restarted."
fi
