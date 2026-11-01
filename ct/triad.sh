#!/usr/bin/env bash
# Triad — Proxmox VE LXC installer
# Run on the Proxmox host as root:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/ashishkhatri/tripletriad/main/ct/triad.sh)"
#
# Non-interactive: set any of these first, e.g.  CTID=150 RAM=1024 bash -c "$(curl ...)"
#   CTID HOSTNAME_CT CORES RAM DISK BRIDGE IP(dhcp|10.0.0.50/24) GATEWAY VLAN STORAGE TEMPLATE_STORAGE PORT BRANCH UNATTENDED=1

set -Eeuo pipefail

REPO="${TRIAD_REPO:-ashishkhatri/tripletriad}"
BRANCH="${BRANCH:-main}"
APP="Triad"

# ---------- output helpers ----------
BL=$'\033[36m'; GN=$'\033[1;92m'; RD=$'\033[01;31m'; YW=$'\033[33m'; BLD=$'\033[1m'; CL=$'\033[m'
msg_info() { printf ' %s⏳ %s%s\n' "$YW" "$1" "$CL"; }
msg_ok()   { printf ' %s✔ %s%s\n' "$GN" "$1" "$CL"; }
msg_err()  { printf ' %s✖ %s%s\n' "$RD" "$1" "$CL" >&2; }
die()      { msg_err "$1"; exit 1; }
trap 'msg_err "Failed at line $LINENO: $BASH_COMMAND"' ERR

header() {
  clear 2>/dev/null || true
  cat <<'EOF'
  ______     _           __
 /_  __/____(_)___ _____/ /
  / / / ___/ / __ `/ __  /
 / / / /  / / /_/ / /_/ /
/_/ /_/  /_/\__,_/\__,_/   four-sided card duel
EOF
  echo
}

# ---------- checks ----------
[[ $EUID -eq 0 ]] || die "Run this as root on the Proxmox host."
command -v pct >/dev/null && command -v pveam >/dev/null || die "This must run on a Proxmox VE host (pct/pveam not found)."
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "Repository not set. Set TRIAD_REPO=owner/name."

header

# ---------- defaults ----------
CTID="${CTID:-$(pvesh get /cluster/nextid)}"
HN="${HOSTNAME_CT:-${HOSTNAME_OVERRIDE:-triad}}"
CORES="${CORES:-1}"
RAM="${RAM:-512}"
DISK="${DISK:-4}"
BRIDGE="${BRIDGE:-vmbr0}"
IP="${IP:-dhcp}"
GATEWAY="${GATEWAY:-}"
VLAN="${VLAN:-}"
PORT="${PORT:-8080}"
UNATTENDED="${UNATTENDED:-0}"

pick_storage() { # $1 = content type (rootdir|vztmpl)
  local content="$1" list
  list=$(pvesm status -content "$content" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}')
  [[ -n "$list" ]] || die "No active storage supports '$content'."
  if [[ $(wc -l <<<"$list") -eq 1 || "$UNATTENDED" == 1 ]] || ! command -v whiptail >/dev/null; then
    head -n1 <<<"$list"; return
  fi
  local opts=() s
  while read -r s; do opts+=("$s" "$(pvesm status -storage "$s" 2>/dev/null | awk 'NR==2{printf "%.1f GB free", $6/1048576}')" OFF); done <<<"$list"
  opts[2]=ON
  whiptail --title "Storage" --radiolist "Storage for the ${content/rootdir/container disk}${content/vztmpl/ template}:" 16 60 6 "${opts[@]}" 3>&1 1>&2 2>&3 || exit 1
}

ask() { # title prompt default -> value
  whiptail --title "$1" --inputbox "$2" 9 60 "$3" 3>&1 1>&2 2>&3 || exit 1
}

if [[ "$UNATTENDED" != 1 ]] && command -v whiptail >/dev/null; then
  if whiptail --title "$APP LXC" --yesno "Create a new $APP container?\n\nDefaults: CT $CTID, $CORES core, ${RAM}MB RAM, ${DISK}GB disk, $BRIDGE, IP $IP, port $PORT" 12 64 \
      --yes-button "Default" --no-button "Advanced"; then
    :
  else
    CTID=$(ask "Container ID" "Container ID" "$CTID")
    HN=$(ask "Hostname" "Hostname" "$HN")
    CORES=$(ask "CPU" "CPU cores" "$CORES")
    RAM=$(ask "Memory" "RAM in MB" "$RAM")
    DISK=$(ask "Disk" "Disk size in GB" "$DISK")
    BRIDGE=$(ask "Network" "Bridge" "$BRIDGE")
    IP=$(ask "Network" "IPv4: 'dhcp' or CIDR like 192.168.1.50/24" "$IP")
    [[ "$IP" != dhcp ]] && GATEWAY=$(ask "Network" "Gateway" "$GATEWAY")
    VLAN=$(ask "Network" "VLAN tag (blank for none)" "$VLAN")
    PORT=$(ask "App" "Port the game listens on" "$PORT")
  fi
fi

[[ "$CTID" =~ ^[0-9]+$ ]] || die "Invalid container ID: $CTID"
pct status "$CTID" &>/dev/null && die "Container $CTID already exists."
[[ "$IP" == dhcp || "$IP" =~ ^[0-9.]+/[0-9]+$ ]] || die "IP must be 'dhcp' or CIDR (e.g. 192.168.1.50/24)."
[[ "$PORT" =~ ^[0-9]+$ ]] || die "Invalid port: $PORT"

STORAGE="${STORAGE:-$(pick_storage rootdir)}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(pick_storage vztmpl)}"

# ---------- template ----------
msg_info "Updating template list"
pveam update >/dev/null
TEMPLATE=$(pveam available -section system | awk '{print $2}' | grep -E '^debian-12-standard_.*_amd64\.tar\.(zst|gz|xz)$' | sort -V | tail -n1)
[[ -n "$TEMPLATE" ]] || die "Could not find a Debian 12 template."
msg_ok "Using $TEMPLATE"
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  msg_info "Downloading template to $TEMPLATE_STORAGE"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
  msg_ok "Template downloaded"
fi

# ---------- create ----------
NET="name=eth0,bridge=$BRIDGE,ip=$IP"
[[ -n "$GATEWAY" ]] && NET+=",gw=$GATEWAY"
[[ -n "$VLAN" ]] && NET+=",tag=$VLAN"

msg_info "Creating LXC $CTID ($HN)"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$HN" --cores "$CORES" --memory "$RAM" --swap 256 \
  --rootfs "$STORAGE:$DISK" --net0 "$NET" \
  --unprivileged 1 --features nesting=1 --onboot 1 \
  --ostype debian --tags "triad;game" \
  --description "<div align='center'><h2>Triad</h2><p>Card game · port $PORT</p><a href='https://github.com/$REPO'>github.com/$REPO</a></div>" >/dev/null
msg_ok "Created LXC $CTID"

msg_info "Starting container"
pct start "$CTID"
for _ in $(seq 1 30); do
  pct exec "$CTID" -- sh -c 'getent hosts deb.debian.org >/dev/null 2>&1' && break
  sleep 2
done
pct exec "$CTID" -- sh -c 'getent hosts deb.debian.org >/dev/null 2>&1' || die "Container has no network/DNS. Check the bridge and IP settings."
msg_ok "Container is online"

# ---------- install inside ----------
msg_info "Installing $APP (this takes a minute)"
pct exec "$CTID" -- env LANG=C.UTF-8 LC_ALL=C.UTF-8 LANGUAGE= REPO="$REPO" BRANCH="$BRANCH" PORT="$PORT" bash -c "$(cat <<'INNER'
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git nodejs >/dev/null
id triad &>/dev/null || useradd --system --home /opt/triad --shell /usr/sbin/nologin triad
rm -rf /opt/triad
git clone -q --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" /opt/triad
chown -R triad:triad /opt/triad
sed -e "s/^Environment=PORT=.*/Environment=PORT=$PORT/" /opt/triad/triad.service > /etc/systemd/system/triad.service
systemctl daemon-reload
systemctl enable -q --now triad
install -m 0755 /opt/triad/ct/update.sh /usr/bin/update
cat > /etc/motd <<EOF

  Triad card game  ->  http://$(hostname -I | awk '{print $1}'):$PORT
  Update: run 'update'   Logs: journalctl -u triad -f

EOF
INNER
)"
msg_ok "Installed $APP"

msg_info "Checking the service"
ok=0
for _ in $(seq 1 15); do
  if pct exec "$CTID" -- sh -c "curl -fsS http://127.0.0.1:$PORT/healthz >/dev/null 2>&1"; then ok=1; break; fi
  sleep 1
done
[[ $ok == 1 ]] || die "Service did not respond. Check: pct exec $CTID -- journalctl -u triad -n 50"
CT_IP=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')
msg_ok "$APP is running"

echo
APP_VER=$(pct exec "$CTID" -- sh -c "curl -fsS http://127.0.0.1:$PORT/version" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
echo "  ${GN}${APP} v${APP_VER} is ready.${CL}"
echo "  Open:   ${BL}http://${CT_IP}:${PORT}${CL}"
echo "  Update: ${BLD}pct exec $CTID -- update${CL}   (or run 'update' inside the container)"
echo
echo "  Nginx Proxy Manager: forward to ${CT_IP}:${PORT} and turn on 'Websockets Support'."
echo
