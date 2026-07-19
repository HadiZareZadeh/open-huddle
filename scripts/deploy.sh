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
      read -r -p "DOMAIN (public hostname, e.g. meet.example.com): " domain
    else
      echo "DOMAIN is required. Set the DOMAIN environment variable." >&2
      exit 1
    fi
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
  set_env_var HOST 0.0.0.0
  set_env_var PORT 3001

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
  APP_USER="${SUDO_USER:-${DEPLOY_USER:-$USER}}"
  if [ -z "$APP_USER" ] || [ "$APP_USER" = "root" ]; then
    APP_USER="${DEPLOY_USER:-ubuntu}"
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
  echo "Installing system packages (coturn, nginx, certbot, git, ufw) ..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    coturn nginx certbot python3-certbot-nginx curl git ufw openssl
}

warn_if_not_git_repo() {
  if [ -d .git ]; then
    return 0
  fi
  echo "Note: not a git repository — option 4 (update) will not work until you clone or init git." >&2
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
  if [ ! -f /etc/letsencrypt/options-ssl-nginx.conf ] || [ ! -f /etc/letsencrypt/ssl-dhparams.pem ]; then
    echo "Downloading recommended TLS parameters ..."
    mkdir -p /etc/letsencrypt
    curl -sSf https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
      > /etc/letsencrypt/options-ssl-nginx.conf
    curl -sSf https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
      > /etc/letsencrypt/ssl-dhparams.pem
  fi
}

obtain_certificate() {
  if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    echo "Let's Encrypt certificate for ${DOMAIN} already exists — skipping issuance."
    return 0
  fi

  configure_nginx_http

  echo "Requesting Let's Encrypt certificate ..."
  local staging_arg=""
  if [ "${CERTBOT_STAGING:-0}" != "0" ]; then
    staging_arg="--staging"
  fi

  certbot certonly --webroot \
    $staging_arg \
    --non-interactive \
    --agree-tos \
    --email "${CERTBOT_EMAIL}" \
    -w /var/www/certbot \
    -d "${DOMAIN}"
}

configure_nginx_https() {
  ensure_tls_params
  echo "Installing HTTPS nginx site ..."
  sed \
    -e "s|__DOMAIN__|${DOMAIN}|g" \
    -e "s|__APP_DIR__|${APP_DIR}|g" \
    deploy/nginx/video-call.conf.template \
    > /etc/nginx/sites-available/video-call.conf
  nginx -t
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

configure_certbot_cron() {
  if [ -f /etc/cron.d/certbot-video-call ]; then
    return 0
  fi
  echo "Installing certbot renewal cron ..."
  cat > /etc/cron.d/certbot-video-call <<'CRON'
0 3 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
CRON
}

maybe_add_swap() {
  if swapon --show | grep -q '/swapfile'; then
    return 0
  fi
  if [ "${DEPLOY_SKIP_SWAP:-0}" != "0" ]; then
    echo "Skipping swap setup (DEPLOY_SKIP_SWAP=1)."
    return 0
  fi
  echo "Adding 512 MB swap (recommended for 1 GB RAM servers) ..."
  fallocate -l 512M /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
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
  echo
  echo "Verify:"
  echo "  curl https://${DOMAIN}/api/health"
  echo "  curl https://${DOMAIN}/api/config/ice"
}

cmd_install() {
  require_root install
  ensure_app_user
  warn_if_not_git_repo
  ensure_production_env
  load_env

  install_node
  install_packages
  configure_firewall
  build_app
  configure_coturn
  configure_systemd
  obtain_certificate
  configure_nginx_https
  tune_nginx
  configure_certbot_cron
  maybe_add_swap

  systemctl restart coturn-video-call
  systemctl restart video-call
  systemctl reload nginx

  print_install_summary
}

cmd_status() {
  require_root status
  load_env_optional

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

  if [ ! -d .git ]; then
    echo "Not a git repository — cannot pull updates." >&2
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
