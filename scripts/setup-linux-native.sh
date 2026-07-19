#!/usr/bin/env bash
set -euo pipefail

# Native Linux production setup (no Docker).
# Usage: sudo ./scripts/setup-linux-native.sh

cd "$(dirname "$0")/.."

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./scripts/setup-linux-native.sh" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and configure it first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source ./.env
set +a

: "${DOMAIN:?Set DOMAIN in .env}"
: "${TURN_SECRET:?Set TURN_SECRET in .env}"
: "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL in .env}"

APP_DIR="$(pwd)"
APP_USER="${SUDO_USER:-$USER}"

echo "Installing system packages ..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  coturn nginx certbot python3-certbot-nginx curl

echo "Building application as ${APP_USER} ..."
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build

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

echo "Installing systemd services ..."
sed \
  -e "s|__APP_DIR__|${APP_DIR}|g" \
  -e "s|__APP_USER__|${APP_USER}|g" \
  deploy/systemd/video-call.service.template \
  > /etc/systemd/system/video-call.service

cp deploy/systemd/coturn-video-call.service /etc/systemd/system/coturn-video-call.service

systemctl daemon-reload
systemctl enable coturn-video-call video-call
systemctl restart coturn-video-call
systemctl restart video-call

echo "Installing temporary HTTP nginx site for certificate issuance ..."
mkdir -p /var/www/certbot
sed "s/__DOMAIN__/${DOMAIN}/g" deploy/nginx/video-call-http.conf.template \
  > /etc/nginx/sites-available/video-call.conf
ln -sf /etc/nginx/sites-available/video-call.conf /etc/nginx/sites-enabled/video-call.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "Requesting Let's Encrypt certificate ..."
STAGING_ARG=""
if [ "${CERTBOT_STAGING:-0}" != "0" ]; then
  STAGING_ARG="--staging"
fi

certbot certonly --webroot \
  $STAGING_ARG \
  --non-interactive \
  --agree-tos \
  --email "${CERTBOT_EMAIL}" \
  -w /var/www/certbot \
  -d "${DOMAIN}"

if [ ! -f /etc/letsencrypt/options-ssl-nginx.conf ] || [ ! -f /etc/letsencrypt/ssl-dhparams.pem ]; then
  echo "Downloading recommended TLS parameters ..."
  mkdir -p /etc/letsencrypt
  curl -sSf https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
    > /etc/letsencrypt/options-ssl-nginx.conf
  curl -sSf https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
    > /etc/letsencrypt/ssl-dhparams.pem
fi

echo "Installing HTTPS nginx site ..."
sed \
  -e "s|__DOMAIN__|${DOMAIN}|g" \
  -e "s|__APP_DIR__|${APP_DIR}|g" \
  deploy/nginx/video-call.conf.template \
  > /etc/nginx/sites-available/video-call.conf
nginx -t
systemctl reload nginx

echo "Tuning nginx for low-resource servers ..."
if ! grep -q "worker_processes 1;" /etc/nginx/nginx.conf 2>/dev/null; then
  sed -i 's/worker_processes auto;/worker_processes 1;/' /etc/nginx/nginx.conf || true
  sed -i 's/worker_connections 768;/worker_connections 256;/' /etc/nginx/nginx.conf || true
  nginx -t && systemctl reload nginx || true
fi

echo "Installing certbot renewal cron ..."
cat > /etc/cron.d/certbot-video-call <<'CRON'
0 3 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
CRON

echo
echo "Native deployment complete."
echo "  App:    https://${DOMAIN}"
echo "  STUN/TURN: ${DOMAIN}:${TURN_PORT}"
echo
echo "Set in .env for clients:"
echo "  TURN_HOST=${DOMAIN}"
echo
echo "Open firewall ports if needed:"
echo "  80/tcp 443/tcp ${TURN_PORT}/tcp ${TURN_PORT}/udp ${TURN_RELAY_MIN_PORT}-${TURN_RELAY_MAX_PORT}/udp"
echo
echo "Recommended for 1 CPU / 1 GB RAM: add 512 MB swap if not already configured."
