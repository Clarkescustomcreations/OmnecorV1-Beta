#!/usr/bin/env bash
# Omnecor Flatpak Launcher

export OMNECOR_HOME="/app/lib/omnecor"
export OMNECOR_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/omnecor"
export OMNECOR_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/omnecor"

# Create user directories
mkdir -p "$OMNECOR_DATA"/{vectordb,backups,models,projects}
mkdir -p "$OMNECOR_CONFIG"

export NODE_ENV=production

echo "═══════════════════════════════════════════════════════════════"
echo "  Omnecor HMCI — Flatpak Mode"
echo "  Data:   $OMNECOR_DATA"
echo "  Config: $OMNECOR_CONFIG"
echo "═══════════════════════════════════════════════════════════════"

cd "$OMNECOR_HOME"
# dist/index.js is the entry point
exec node index.js "$@"
