#!/usr/bin/env bash
# Updates Triad in place: pulls the latest code and restarts the service.
# Installed inside the container as /usr/local/bin/update.
set -Eeuo pipefail
cd /opt/triad
before=$(git rev-parse --short HEAD)
git config --global --add safe.directory /opt/triad 2>/dev/null || true
git fetch -q --depth 1 origin
git reset -q --hard "origin/$(git rev-parse --abbrev-ref HEAD)"
after=$(git rev-parse --short HEAD)
chown -R triad:triad /opt/triad
install -m 0755 /opt/triad/ct/update.sh /usr/local/bin/update
if [[ "$before" == "$after" ]]; then
  echo "Triad is already up to date ($after)."
else
  systemctl restart triad
  echo "Updated Triad $before -> $after and restarted."
fi
