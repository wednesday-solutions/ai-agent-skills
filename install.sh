#!/bin/bash

# Wednesday Agent Skills — Shell Installer
#
# Use this if you want to install without npm/npx.
#
# Usage:
#   bash install.sh                  # install into current directory
#   bash install.sh /path/to/project # install into specific directory
#   bash install.sh . --skip-config  # install without configuring agents

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${1:-.}"
EXTRA_ARGS="${@:2}"

# Check Node.js is available
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is required but not found."
  echo "Install it from https://nodejs.org (v18+)"
  exit 1
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js v18+ is required (found v$NODE_VERSION)"
  exit 1
fi

# Delegate to the CLI
node "$SCRIPT_DIR/bin/cli.js" install "$INSTALL_DIR" $EXTRA_ARGS
