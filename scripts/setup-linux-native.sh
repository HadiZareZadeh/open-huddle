#!/usr/bin/env bash
set -euo pipefail

# Native Linux production setup (no Docker).
# Usage: sudo ./scripts/setup-linux-native.sh
#
# Delegates to deploy.sh for a single maintained install path.

exec "$(dirname "$0")/deploy.sh" install
