#!/usr/bin/env bash
# Updates Triad in place: pulls the latest code and restarts the service.
# Installed inside the container as /usr/bin/update.
set -Eeuo pipefail
# /opt/triad is owned by the 'triad' user; let root's git work there regardless of HOME/env.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=/opt/triad
git config --system --get-all safe.directory 2>/dev/null | grep -qx /opt/triad || git config --system --add safe.directory /opt/triad
cd /opt/triad
ver() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' /opt/triad/package.json; }
before=$(git rev-parse --short HEAD); vbefore=$(ver)
git fetch -q --depth 1 origin
git reset -q --hard "origin/$(git rev-parse --abbrev-ref HEAD)"
after=$(git rev-parse --short HEAD); vafter=$(ver)
chown -R triad:triad /opt/triad
install -m 0755 /opt/triad/ct/update.sh /usr/bin/update
rm -f /usr/local/bin/update

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
if [[ -f "$DATA/triad.json" ]]; then
  mkdir -p "$DATA/backups"
  cp -p "$DATA/triad.json" "$DATA/backups/triad-$(date +%Y%m%d-%H%M%S)-v$vbefore.json"
  ls -1t "$DATA/backups"/triad-*.json 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

if [[ "$before" == "$after" && $unit_changed == 0 ]]; then
  echo "Triad is already up to date (v$vafter)."
else
  systemctl restart triad
  echo "Updated Triad v$vbefore -> v$vafter and restarted."
fi
