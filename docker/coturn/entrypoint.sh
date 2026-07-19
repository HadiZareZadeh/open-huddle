#!/bin/sh
set -e

SECRET="${TURN_SECRET:?TURN_SECRET is required}"
REALM="${TURN_REALM:-video-call.local}"

set -- turnserver -c /etc/coturn/turnserver.conf \
  --static-auth-secret="${SECRET}" \
  --realm="${REALM}"

if [ -n "${TURN_EXTERNAL_IP:-}" ]; then
  set -- "$@" --external-ip="${TURN_EXTERNAL_IP}"
fi

exec "$@"
