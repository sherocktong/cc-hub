#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_DIR}"

echo "==> Building cc-hub..."
npm run build

echo "==> Linking cc-hub globally..."
npm link

echo "==> Verifying installed version..."
cc-hub --version

echo "==> Deploy complete."
