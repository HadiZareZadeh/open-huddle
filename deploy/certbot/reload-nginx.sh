#!/bin/bash
# Runs after a successful certbot renewal (deploy hook).
set -e
nginx -t
systemctl reload nginx
