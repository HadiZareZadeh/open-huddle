#!/usr/bin/env bash
set -euo pipefail

# Video Call — native Ubuntu deployment helper.
# Usage:
#   sudo ./scripts/deploy.sh              # interactive menu
#   sudo ./scripts/deploy.sh install      # fresh install (idempotent, safe re-run)
#   sudo ./scripts/deploy.sh status       # view service status
#   sudo ./scripts/deploy.sh restart      # restart services
#   sudo ./scripts/deploy.sh update       # pull latest code, rebuild, restart

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICES=(video-call coturn-video-call nginx)
DEPLOY_IP_MODE=0

is_ip_address() {
  [[ "${1:-}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

detect_deploy_mode() {
  if [ "${DEPLOY_USE_IP:-0}" = "1" ] || is_ip_address "${DOMAIN:-}"; then
    DEPLOY_IP_MODE=1
  else
    DEPLOY_IP_MODE=0
  fi
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "This command must run as root. Try: sudo ./scripts/deploy.sh $*" >&2
    exit 1
  fi
}

set_env_var() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

generate_turn_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    tr -dc 'a-f0-9' </dev/urandom | head -c 64
  fi
}

needs_new_turn_secret() {
  if [ ! -f .env ]; then
    return 0
  fi
  local current
  current="$(grep '^TURN_SECRET=' .env 2>/dev/null | cut -d= -f2- || true)"
  [ -z "$current" ] || [ "$current" = "change-me-to-a-long-random-secret" ]
}

ensure_production_env() {
  local domain="${DOMAIN:-}"
  local email="${CERTBOT_EMAIL:-}"
  local turn_secret=""
  local fresh_env=0

  if [ ! -f .env ]; then
    if [ ! -f .env.example ]; then
      echo "Missing .env.example — cannot create production .env." >&2
      exit 1
    fi
    echo "Creating production .env ..."
    cp .env.example .env
    sed -i 's/\r$//' .env 2>/dev/null || true
    fresh_env=1
  fi

  if [ -z "$domain" ]; then
    domain="$(grep '^DOMAIN=' .env 2>/dev/null | cut -d= -f2- || true)"
    if [ "$domain" = "meet.example.com" ]; then
      domain=""
    fi
  fi
  if [ -z "$email" ]; then
    email="$(grep '^CERTBOT_EMAIL=' .env 2>/dev/null | cut -d= -f2- || true)"
    if [ "$email" = "admin@example.com" ]; then
      email=""
    fi
  fi

  if [ -z "$domain" ]; then
    if [ -t 0 ]; then
      read -r -p "DOMAIN or public IP (e.g. meet.example.com or 203.0.113.10): " domain
    else
      echo "DOMAIN is required. Set the DOMAIN environment variable." >&2
      exit 1
    fi
  fi

  if is_ip_address "$domain"; then
    DEPLOY_IP_MODE=1
    echo "IP-only mode: trusted HTTPS via Let's Encrypt IP certificate (~6 day validity)."
  fi

  if [ -z "$email" ]; then
    if [ -t 0 ]; then
      read -r -p "CERTBOT_EMAIL (Let's Encrypt notifications): " email
    else
      echo "CERTBOT_EMAIL is required. Set the CERTBOT_EMAIL environment variable." >&2
      exit 1
    fi
  fi

  if [ -z "$domain" ] || [ -z "$email" ]; then
    echo "DOMAIN and CERTBOT_EMAIL are required." >&2
    exit 1
  fi

  if [ "$fresh_env" -eq 1 ] || needs_new_turn_secret; then
    turn_secret="$(generate_turn_secret)"
    echo "Generated new TURN_SECRET."
  else
    turn_secret="$(grep '^TURN_SECRET=' .env | cut -d= -f2-)"
    echo "Keeping existing TURN_SECRET."
  fi

  set_env_var NODE_ENV production
  set_env_var DOMAIN "$domain"
  set_env_var CERTBOT_EMAIL "$email"
  set_env_var TURN_SECRET "$turn_secret"
  set_env_var TURN_HOST "$domain"
  set_env_var CORS_ORIGINS "https://${domain}"
  set_env_var RATE_LIMIT_MAX 100
  set_env_var REQUIRE_HOST_APPROVAL 1
  set_env_var HOST 0.0.0.0
  set_env_var PORT 3001
  sed -i 's/\r$//' .env 2>/dev/null || true
  if [ "$DEPLOY_IP_MODE" -eq 1 ]; then
    set_env_var DEPLOY_USE_IP 1
  else
    set_env_var DEPLOY_USE_IP 0
  fi

  chown "${APP_USER}:${APP_USER}" .env
  chmod 600 .env
  mkdir -p data
  chown "${APP_USER}:${APP_USER}" data

  echo "Production .env ready for ${domain}"
}

load_env() {
  if [ ! -f .env ]; then
    echo "Missing .env — run fresh install first." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a

  : "${DOMAIN:?Set DOMAIN in .env}"
  : "${TURN_SECRET:?Set TURN_SECRET in .env}"

  detect_deploy_mode

  : "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL in .env}"
}

load_env_optional() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source ./.env
    set +a
  fi
}

ensure_app_user() {
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    APP_USER="$SUDO_USER"
  elif [ -n "${DEPLOY_USER:-}" ]; then
    APP_USER="$DEPLOY_USER"
  elif id "${USER:-root}" >/dev/null 2>&1; then
    APP_USER="${USER:-root}"
  elif id ubuntu >/dev/null 2>&1; then
    APP_USER=ubuntu
  else
    APP_USER=root
  fi
  APP_DIR="$ROOT"
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    local version
    version="$(node -p "process.versions.node.split('.')[0]")"
    if [ "$version" -ge 20 ] 2>/dev/null; then
      echo "Node.js $(node -v) already installed."
      return 0
    fi
    echo "Node.js $(node -v) is too old; installing Node.js 20 ..."
  else
    echo "Installing Node.js 20 ..."
  fi

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  echo "Node.js $(node -v), npm $(npm -v)"
}

install_packages() {
  echo "Installing system packages (coturn, nginx, certbot, git, ufw, build tools) ..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    coturn nginx certbot python3-certbot-nginx curl git ufw openssl \
    build-essential python3 snapd
  ensure_certbot_ip_support
}

ensure_certbot_ip_support() {
  if command -v certbot >/dev/null 2>&1 && certbot --help certonly 2>&1 | grep -q '\-\-ip-address'; then
    return 0
  fi

  echo "Upgrading Certbot via snap for IP address certificate support ..."
  systemctl enable --now snapd.socket 2>/dev/null || true
  snap install core 2>/dev/null || snap refresh core
  snap install certbot --classic
  ln -sf /snap/bin/certbot /usr/bin/certbot

  if ! certbot --help certonly 2>&1 | grep -q '\-\-ip-address'; then
    echo "ERROR: Installed Certbot does not support --ip-address." >&2
    exit 1
  fi
}

warn_if_not_git_repo() {
  if [ -d .git ]; then
    return 0
  fi
  echo "Note: not a git repository — option 4 (update) will not work until you clone or init git." >&2
}

ensure_git_repo() {
  local repo_url="${GIT_REPO:-}"
  if [ -z "$repo_url" ]; then
    return 0
  fi

  ensure_app_user
  git config --global --add safe.directory "$ROOT" 2>/dev/null || true

  if [ -d .git ]; then
    if ! sudo -u "$APP_USER" git -C "$ROOT" remote get-url origin >/dev/null 2>&1; then
      sudo -u "$APP_USER" git -C "$ROOT" remote add origin "$repo_url"
    fi
    echo "Fetching latest from ${repo_url} ..."
    sudo -u "$APP_USER" git -C "$ROOT" fetch origin main
    sudo -u "$APP_USER" git -C "$ROOT" reset --hard origin/main
    sudo -u "$APP_USER" git -C "$ROOT" branch -M main
    sudo -u "$APP_USER" git -C "$ROOT" branch --set-upstream-to=origin/main main
    sudo -u "$APP_USER" git -C "$ROOT" config pull.ff only
    return 0
  fi

  if [ -n "$(ls -A "$ROOT" 2>/dev/null | grep -v '^\.env$' | grep -v '^data$' || true)" ]; then
    echo "Linking existing deployment at ${ROOT} to ${repo_url} ..."
    sudo -u "$APP_USER" git -C "$ROOT" init
    if sudo -u "$APP_USER" git -C "$ROOT" remote get-url origin >/dev/null 2>&1; then
      sudo -u "$APP_USER" git -C "$ROOT" remote set-url origin "$repo_url"
    else
      sudo -u "$APP_USER" git -C "$ROOT" remote add origin "$repo_url"
    fi
    sudo -u "$APP_USER" git -C "$ROOT" fetch origin main
    sudo -u "$APP_USER" git -C "$ROOT" add -A
    sudo -u "$APP_USER" git -C "$ROOT" reset --hard origin/main
    sudo -u "$APP_USER" git -C "$ROOT" branch -M main
    sudo -u "$APP_USER" git -C "$ROOT" branch --set-upstream-to=origin/main main
    sudo -u "$APP_USER" git -C "$ROOT" config pull.ff only
    chown -R "${APP_USER}:${APP_USER}" "$ROOT/.git"
    echo "Git repository ready — option 4 (update) is enabled."
    return 0
  fi

  echo "Cloning ${repo_url} into ${ROOT} ..."
  sudo -u "$APP_USER" git clone "$repo_url" "$ROOT"
  sudo -u "$APP_USER" git -C "$ROOT" config pull.ff only
}

configure_firewall() {
  TURN_PORT="${TURN_PORT:-3478}"
  TURN_RELAY_MIN_PORT="${TURN_RELAY_MIN_PORT:-49152}"
  TURN_RELAY_MAX_PORT="${TURN_RELAY_MAX_PORT:-49202}"

  if ! command -v ufw >/dev/null 2>&1; then
    echo "UFW not available — skipping firewall configuration." >&2
    return 0
  fi

  echo "Configuring UFW firewall ..."
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow "${TURN_PORT}/tcp"
  ufw allow "${TURN_PORT}/udp"
  ufw allow "${TURN_RELAY_MIN_PORT}:${TURN_RELAY_MAX_PORT}/udp"
  ufw --force enable
  ufw status verbose || true
}

fix_nginx_no_ipv6() {
  if [ -f /proc/net/if_inet6 ] && [ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null || echo 1)" = "0" ]; then
    return 0
  fi

  echo "Disabling IPv6 nginx listeners (IPv6 unavailable on this host) ..."
  local f
  for f in /etc/nginx/nginx.conf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default; do
    [ -f "$f" ] || continue
    sed -i 's/^[[:space:]]*listen \[::\]:/# listen [::]:/g' "$f"
  done
  if command -v nginx >/dev/null 2>&1; then
    nginx -t 2>/dev/null && systemctl restart nginx 2>/dev/null || true
  fi
  dpkg --configure -a 2>/dev/null || true
}

build_app() {
  echo "Installing npm dependencies and building as ${APP_USER} ..."
  sudo -u "$APP_USER" npm ci
  sudo -u "$APP_USER" npm run build
}

configure_coturn() {
  echo "Generating coturn config ..."
  mkdir -p /etc/coturn
  TURN_REALM="${TURN_REALM:-video-call.local}"
  TURN_PORT="${TURN_PORT:-3478}"
  TURN_RELAY_MIN_PORT="${TURN_RELAY_MIN_PORT:-49152}"
  TURN_RELAY_MAX_PORT="${TURN_RELAY_MAX_PORT:-49202}"
  TURN_TOTAL_QUOTA="${TURN_TOTAL_QUOTA:-20}"

  cat > /etc/coturn/video-call.conf <<EOF
listening-port=${TURN_PORT}
listening-ip=0.0.0.0
relay-ip=0.0.0.0
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${TURN_REALM}
min-port=${TURN_RELAY_MIN_PORT}
max-port=${TURN_RELAY_MAX_PORT}
total-quota=${TURN_TOTAL_QUOTA}
stale-nonce=600
no-cli
no-tls
no-dtls
log-file=/var/log/turnserver/video-call.log
EOF

  if [ -n "${TURN_EXTERNAL_IP:-}" ]; then
    echo "external-ip=${TURN_EXTERNAL_IP}" >> /etc/coturn/video-call.conf
  fi

  mkdir -p /var/log/turnserver
  chown turnserver:turnserver /var/log/turnserver /etc/coturn/video-call.conf
}

disable_default_coturn() {
  if systemctl list-unit-files coturn.service >/dev/null 2>&1; then
    echo "Disabling default coturn service (using coturn-video-call instead) ..."
    systemctl stop coturn 2>/dev/null || true
    systemctl disable coturn 2>/dev/null || true
  fi
}

configure_systemd() {
  echo "Installing systemd services ..."
  sed \
    -e "s|__APP_DIR__|${APP_DIR}|g" \
    -e "s|__APP_USER__|${APP_USER}|g" \
    deploy/systemd/video-call.service.template \
    > /etc/systemd/system/video-call.service

  cp deploy/systemd/coturn-video-call.service /etc/systemd/system/coturn-video-call.service

  systemctl daemon-reload
  systemctl enable coturn-video-call video-call
}

configure_nginx_http() {
  echo "Installing temporary HTTP nginx site for certificate issuance ..."
  mkdir -p /var/www/certbot
  sed "s/__DOMAIN__/${DOMAIN}/g" deploy/nginx/video-call-http.conf.template \
    > /etc/nginx/sites-available/video-call.conf
  ln -sf /etc/nginx/sites-available/video-call.conf /etc/nginx/sites-enabled/video-call.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
}

ensure_tls_params() {
  mkdir -p /etc/letsencrypt

  local packaged_options="/usr/lib/python3/dist-packages/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf"
  local packaged_dhparams="/usr/lib/python3/dist-packages/certbot/ssl-dhparams.pem"

  if [ ! -s /etc/letsencrypt/options-ssl-nginx.conf ]; then
    echo "Installing recommended TLS parameters ..."
    if [ -f "$packaged_options" ]; then
      cp "$packaged_options" /etc/letsencrypt/options-ssl-nginx.conf
    elif curl -sSf https://raw.githubusercontent.com/certbot/certbot/v5.2.2/certbot-nginx/src/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
      > /etc/letsencrypt/options-ssl-nginx.conf; then
      :
    else
      cat > /etc/letsencrypt/options-ssl-nginx.conf <<'EOF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
EOF
    fi
  fi

  if [ ! -s /etc/letsencrypt/ssl-dhparams.pem ]; then
    if [ -f "$packaged_dhparams" ]; then
      cp "$packaged_dhparams" /etc/letsencrypt/ssl-dhparams.pem
    elif curl -sSf https://raw.githubusercontent.com/certbot/certbot/v5.2.2/certbot/src/certbot/ssl-dhparams.pem \
      > /etc/letsencrypt/ssl-dhparams.pem; then
      :
    else
      openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
    fi
  fi
}

obtain_certificate() {
  local cert_dir="/etc/letsencrypt/live/${DOMAIN}"
  if [ -f "${cert_dir}/fullchain.pem" ] && openssl x509 -checkend 86400 -noout -in "${cert_dir}/fullchain.pem" 2>/dev/null; then
    echo "Let's Encrypt certificate for ${DOMAIN} still valid — skipping issuance."
    return 0
  fi

  configure_nginx_http

  local staging_arg=""
  local profile_args=()
  if [ "${CERTBOT_STAGING:-0}" != "0" ]; then
    staging_arg="--staging"
  fi
  if [ "$DEPLOY_IP_MODE" -eq 1 ]; then
    echo "Requesting Let's Encrypt IP certificate (short-lived, ~6 days) ..."
    profile_args=(--preferred-profile shortlived)
  else
    echo "Requesting Let's Encrypt certificate ..."
  fi

  if [ "$DEPLOY_IP_MODE" -eq 1 ]; then
    certbot certonly --webroot \
      $staging_arg \
      "${profile_args[@]}" \
      --non-interactive \
      --agree-tos \
      --email "${CERTBOT_EMAIL}" \
      -w /var/www/certbot \
      --ip-address "${DOMAIN}" \
      --cert-name "${DOMAIN}"
  else
    certbot certonly --webroot \
      $staging_arg \
      --non-interactive \
      --agree-tos \
      --email "${CERTBOT_EMAIL}" \
      -w /var/www/certbot \
      -d "${DOMAIN}"
  fi
}

configure_nginx_https() {
  ensure_tls_params
  echo "Installing HTTPS nginx site ..."
  sed \
    -e "s|__DOMAIN__|${DOMAIN}|g" \
    -e "s|__APP_DIR__|${APP_DIR}|g" \
    deploy/nginx/video-call.conf.template \
    > /etc/nginx/sites-available/video-call.conf
  ln -sf /etc/nginx/sites-available/video-call.conf /etc/nginx/sites-enabled/video-call.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
}

tune_nginx() {
  echo "Tuning nginx for low-resource servers ..."
  if ! grep -q "worker_processes 1;" /etc/nginx/nginx.conf 2>/dev/null; then
    sed -i 's/worker_processes auto;/worker_processes 1;/' /etc/nginx/nginx.conf || true
    sed -i 's/worker_connections 768;/worker_connections 256;/' /etc/nginx/nginx.conf || true
    nginx -t && systemctl reload nginx || true
  fi
}

configure_certbot_renewal() {
  echo "Configuring Let's Encrypt auto-renewal ..."

  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  install -m 755 deploy/certbot/reload-nginx.sh \
    /etc/letsencrypt/renewal-hooks/deploy/video-call-reload-nginx.sh

  systemctl disable certbot.timer 2>/dev/null || true

  if [ "$DEPLOY_IP_MODE" -eq 1 ]; then
    cat > /etc/cron.d/certbot-video-call <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
# Let's Encrypt IP certificates expire in ~6 days
0 3 1-31/5 * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
CRON
    chmod 644 /etc/cron.d/certbot-video-call
    echo "IP certificate renewal scheduled every 5 days (days 1,6,11,16,21,26,31)."
    return 0
  fi

  if systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
    systemctl enable certbot.timer
    systemctl start certbot.timer
    echo "Enabled certbot.timer (checks for renewal twice daily)."
    rm -f /etc/cron.d/certbot-video-call
  else
    echo "certbot.timer not found — using cron fallback (3:00 and 15:00 daily)."
    cat > /etc/cron.d/certbot-video-call <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 3,15 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
CRON
    chmod 644 /etc/cron.d/certbot-video-call
  fi
}

show_cert_renewal_status() {
  detect_deploy_mode

  echo
  if [ "$DEPLOY_IP_MODE" -eq 1 ]; then
    echo "=== Let's Encrypt IP certificate ==="
  else
    echo "=== Let's Encrypt auto-renewal ==="
  fi

  if [ -n "${DOMAIN:-}" ] && [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    certbot certificates 2>/dev/null | sed -n "/Certificate Name: ${DOMAIN}/,/Expiry/p" || true
    openssl x509 -in "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" -noout -subject -dates 2>/dev/null || true
  elif command -v certbot >/dev/null 2>&1; then
    certbot certificates 2>/dev/null || true
  fi

  if [ -f /etc/cron.d/certbot-video-call ]; then
    echo "Renewal schedule: /etc/cron.d/certbot-video-call"
    cat /etc/cron.d/certbot-video-call
  elif systemctl is-enabled certbot.timer >/dev/null 2>&1; then
    systemctl status certbot.timer --no-pager -l || true
  else
    echo "WARNING: No certbot renewal schedule found." >&2
  fi

  if [ -x /etc/letsencrypt/renewal-hooks/deploy/video-call-reload-nginx.sh ]; then
    echo "Deploy hook: reloads nginx after successful renewal."
  fi
}

ensure_swap() {
  local swapfile=/swapfile
  local swap_mb="${DEPLOY_SWAP_MB:-512}"

  if [ "${DEPLOY_SKIP_SWAP:-0}" != "0" ]; then
    echo "Skipping swap setup (DEPLOY_SKIP_SWAP=1)."
    return 0
  fi

  if [ ! -f "$swapfile" ]; then
    echo "Creating ${swap_mb} MB swap at ${swapfile} ..."
    if ! fallocate -l "${swap_mb}M" "$swapfile" 2>/dev/null; then
      dd if=/dev/zero of="$swapfile" bs=1M count="$swap_mb" status=none
    fi
    chmod 600 "$swapfile"
    mkswap "$swapfile"
  fi

  if ! grep -q "^${swapfile}[[:space:]]" /etc/fstab; then
    echo "${swapfile} none swap sw 0 0" >> /etc/fstab
    echo "Registered ${swapfile} in /etc/fstab (swap persists across reboots)."
  fi

  if ! swapon --show | grep -q "${swapfile}"; then
    swapon "$swapfile"
  fi

  echo "Swap ready: $(swapon --show | grep "${swapfile}" || swapon --show)"
}

wait_for_backend() {
  echo "Waiting for backend to become ready ..."
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

verify_deployment() {
  echo "Verifying browser readiness ..."
  local failed=0

  if ! wait_for_backend; then
    echo "  FAIL: backend did not become ready within 30s" >&2
    failed=1
  fi

  for svc in "${SERVICES[@]}"; do
    if ! systemctl is-active --quiet "$svc"; then
      echo "  FAIL: ${svc} is not running" >&2
      failed=1
    fi
  done

  if systemctl is-active --quiet coturn 2>/dev/null; then
    echo "  FAIL: default coturn service is still running (conflicts with coturn-video-call)" >&2
    failed=1
  fi

  if ! curl -fsS "https://${DOMAIN}/api/health" >/dev/null; then
    echo "  FAIL: /api/health" >&2
    failed=1
  else
    echo "  OK: /api/health"
  fi

  if ! curl -fsS "https://${DOMAIN}/api/config/ice" | grep -q '"iceServers"'; then
    echo "  FAIL: /api/config/ice" >&2
    failed=1
  else
    echo "  OK: /api/config/ice"
  fi

  if ! curl -fsS -o /dev/null "https://${DOMAIN}/"; then
    echo "  FAIL: frontend (/) " >&2
    failed=1
  else
    echo "  OK: frontend (/)"
  fi

  if ! curl -fsS -o /dev/null \
    "https://${DOMAIN}/socket.io/?EIO=4&transport=polling"; then
    echo "  FAIL: socket.io" >&2
    failed=1
  else
    echo "  OK: socket.io"
  fi

  if ! curl -fsS -X POST "https://${DOMAIN}/api/meetings" \
    -H 'Content-Type: application/json' -d '{}' | grep -q '"id"'; then
    echo "  FAIL: POST /api/meetings" >&2
    failed=1
  else
    echo "  OK: POST /api/meetings"
  fi

  if [ "$failed" -ne 0 ]; then
    echo "Deployment verification failed — site is not ready." >&2
    exit 1
  fi

  echo "All checks passed — site is ready to use in the browser."
}

print_install_summary() {
  TURN_PORT="${TURN_PORT:-3478}"
  TURN_RELAY_MIN_PORT="${TURN_RELAY_MIN_PORT:-49152}"
  TURN_RELAY_MAX_PORT="${TURN_RELAY_MAX_PORT:-49202}"
  echo
  echo "Deployment complete."
  echo "  App:       https://${DOMAIN}"
  echo "  STUN/TURN: ${DOMAIN}:${TURN_PORT}"
  echo
  echo "Firewall (UFW): 22, 80, 443, ${TURN_PORT}/tcp+udp, ${TURN_RELAY_MIN_PORT}-${TURN_RELAY_MAX_PORT}/udp"
  if swapon --show | grep -q '/swapfile'; then
    echo "Swap: /swapfile enabled permanently via /etc/fstab"
  fi
  echo
  echo "Verify:"
  echo "  curl https://${DOMAIN}/api/health"
  echo "  curl https://${DOMAIN}/api/config/ice"
  echo
  if [ "$DEPLOY_IP_MODE" -eq 1 ]; then
    echo "TLS: Let's Encrypt IP certificate (trusted, ~6 day lifetime)."
    echo "  Auto-renewal every 5 days via /etc/cron.d/certbot-video-call"
  else
    echo "TLS: Let's Encrypt auto-renewal enabled (certbot.timer + nginx reload hook)."
  fi
  echo "  Test renewal: sudo certbot renew --dry-run"
}

cmd_install() {
  require_root install
  ensure_app_user
  ensure_git_repo
  ensure_production_env
  load_env

  install_node
  install_packages
  fix_nginx_no_ipv6
  configure_firewall
  ensure_swap
  build_app
  configure_coturn
  configure_systemd
  obtain_certificate
  configure_nginx_https
  tune_nginx
  configure_certbot_renewal

  disable_default_coturn
  systemctl restart coturn-video-call
  systemctl restart video-call
  systemctl reload nginx

  verify_deployment
  print_install_summary
}

cmd_status() {
  require_root status
  load_env_optional
  detect_deploy_mode

  echo "=== systemd services ==="
  for svc in "${SERVICES[@]}"; do
    echo
    systemctl status "$svc" --no-pager -l || true
  done

  if [ -n "${DOMAIN:-}" ]; then
    echo
    echo "=== HTTP health check ==="
    if curl -fsS "https://${DOMAIN}/api/health" 2>/dev/null; then
      echo
    else
      echo "Health check failed for https://${DOMAIN}/api/health" >&2
    fi
  fi

  show_cert_renewal_status
}

cmd_restart() {
  require_root restart

  echo "Restarting services ..."
  systemctl restart coturn-video-call
  systemctl restart video-call
  systemctl reload nginx

  echo "Done."
  cmd_status
}

cmd_update() {
  require_root update
  ensure_app_user
  load_env
  detect_deploy_mode

  ensure_git_repo
  if [ ! -d .git ]; then
    echo "Not a git repository — set GIT_REPO and re-run install, or clone manually." >&2
    exit 1
  fi

  echo "Pulling latest changes ..."
  sudo -u "$APP_USER" git pull --ff-only

  echo "Rebuilding ..."
  sudo -u "$APP_USER" npm ci
  sudo -u "$APP_USER" npm run build

  configure_coturn
  systemctl daemon-reload
  systemctl restart coturn-video-call
  systemctl restart video-call
  configure_nginx_https
  configure_certbot_renewal

  echo "Update complete."
}

show_menu() {
  require_root

  while true; do
    echo
    echo "Video Call — Ubuntu Deployment"
    echo "=============================="
    echo "  1) Fresh install (idempotent, safe re-run)"
    echo "  2) View services status"
    echo "  3) Restart services"
    echo "  4) Update project from repo"
    echo "  0) Exit"
    echo
    read -r -p "Choose an option: " choice
    case "$choice" in
      1) cmd_install ;;
      2) cmd_status ;;
      3) cmd_restart ;;
      4) cmd_update ;;
      0) exit 0 ;;
      *) echo "Invalid option." ;;
    esac
    echo
    read -r -p "Press Enter to continue ..."
  done
}

case "${1:-}" in
  install) cmd_install ;;
  status) cmd_status ;;
  restart) cmd_restart ;;
  update) cmd_update ;;
  "") show_menu ;;
  -h|--help)
    echo "Usage: sudo ./scripts/deploy.sh [install|status|restart|update]"
    exit 0
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Usage: sudo ./scripts/deploy.sh [install|status|restart|update]" >&2
    exit 1
    ;;
esac
