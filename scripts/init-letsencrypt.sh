#!/bin/sh
set -eu

# Issue or renew Let's Encrypt certificates for the video-call stack.
# Usage: ./scripts/init-letsencrypt.sh
# Requires: DOMAIN and CERTBOT_EMAIL in .env, ports 80/443 reachable from the internet.

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${DOMAIN:?Set DOMAIN in .env (e.g. meet.example.com)}"
: "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL in .env}"

STAGING="${CERTBOT_STAGING:-0}"
RSA_KEY_SIZE="${CERTBOT_RSA_KEY_SIZE:-4096}"

CERTBOT_PATH="./docker/certbot"
DATA_PATH="${CERTBOT_PATH}/conf"
WWW_PATH="${CERTBOT_PATH}/www"
COMPOSE="docker compose"

mkdir -p "$DATA_PATH" "$WWW_PATH"

if [ ! -e "$DATA_PATH/options-ssl-nginx.conf" ] || [ ! -e "$DATA_PATH/ssl-dhparams.pem" ]; then
  echo "### Downloading recommended TLS parameters ..."
  curl -sSf https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
    > "$DATA_PATH/options-ssl-nginx.conf"
  curl -sSf https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
    > "$DATA_PATH/ssl-dhparams.pem"
fi

echo "### Creating dummy certificate for ${DOMAIN} ..."
LIVE_PATH="$DATA_PATH/conf/live/${DOMAIN}"
mkdir -p "$LIVE_PATH"
$COMPOSE run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:${RSA_KEY_SIZE} -days 1\
    -keyout '/etc/letsencrypt/live/${DOMAIN}/privkey.pem' \
    -out '/etc/letsencrypt/live/${DOMAIN}/fullchain.pem' \
    -subj '/CN=${DOMAIN}'" certbot
echo

echo "### Starting nginx ..."
$COMPOSE up -d nginx
echo

echo "### Removing dummy certificate ..."
$COMPOSE run --rm --entrypoint "\
  rm -Rf /etc/letsencrypt/live/${DOMAIN} && \
  rm -Rf /etc/letsencrypt/archive/${DOMAIN} && \
  rm -Rf /etc/letsencrypt/renewal/${DOMAIN}.conf" certbot
echo

echo "### Requesting Let's Encrypt certificate ..."
DOMAIN_ARGS="-d ${DOMAIN}"
if [ -n "${CERTBOT_EXTRA_DOMAINS:-}" ]; then
  for extra in $(echo "$CERTBOT_EXTRA_DOMAINS" | tr ',' ' '); do
    DOMAIN_ARGS="$DOMAIN_ARGS -d ${extra}"
  done
fi

if [ "$STAGING" != "0" ]; then
  STAGING_ARG="--staging"
  echo "### Using Let's Encrypt staging environment"
else
  STAGING_ARG=""
fi

$COMPOSE run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $STAGING_ARG \
    --email ${CERTBOT_EMAIL} \
    $DOMAIN_ARGS \
    --rsa-key-size ${RSA_KEY_SIZE} \
    --agree-tos \
    --force-renewal \
    --non-interactive" certbot
echo

echo "### Reloading nginx ..."
$COMPOSE exec nginx nginx -s reload

echo "### Done. HTTPS is active for https://${DOMAIN}"
