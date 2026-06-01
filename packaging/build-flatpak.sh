#!/usr/bin/env bash
# ==============================================================================
# Omnecor — Flatpak Builder
# ==============================================================================
#
# Builds a Flatpak bundle for Omnecor HMCI Workstation using the canonical
# manifest at packaging/flatpak/org.omnecor.HMCI.yml (App ID: org.omnecor.HMCI).
#
# Usage:
#   ./packaging/build-flatpak.sh [version]
#
# Requirements:
#   flatpak-builder, flatpak (org.freedesktop.Platform//23.08 runtime)
#
# Output:
#   ./dist/org.omnecor.HMCI.flatpak
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VERSION="${1:-2.3.0}"
APP_ID="org.omnecor.HMCI"
MANIFEST="$SCRIPT_DIR/flatpak/${APP_ID}.yml"

DIST_DIR="$PROJECT_ROOT/dist"
BUILD_DIR="$DIST_DIR/flatpak-build"
REPO_DIR="$DIST_DIR/flatpak-repo"

echo "═══════════════════════════════════════════════════════════════"
echo "  Omnecor Flatpak Builder"
echo "  App ID:   $APP_ID"
echo "  Version:  $VERSION"
echo "  Manifest: $MANIFEST"
echo "═══════════════════════════════════════════════════════════════"

# --- Prerequisites ---
echo "[1/5] Checking prerequisites..."

if ! command -v flatpak-builder &>/dev/null; then
  echo "ERROR: flatpak-builder not found."
  echo "  Install: sudo apt install flatpak-builder"
  exit 1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: Manifest not found at $MANIFEST"
  exit 1
fi

# Ensure Freedesktop runtime is available
for pkg in "org.freedesktop.Platform//23.08" "org.freedesktop.Sdk//23.08"; do
  flatpak install --user -y flathub "$pkg" 2>/dev/null || \
  flatpak install --system -y flathub "$pkg" 2>/dev/null || \
    echo "  Warning: $pkg not pre-installed — flatpak-builder will attempt to fetch it."
done

# --- Prepare ---
echo "[2/5] Preparing build directories..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$DIST_DIR"

# --- Build ---
echo "[3/5] Running flatpak-builder..."
cd "$SCRIPT_DIR/flatpak"

flatpak-builder \
  --force-clean \
  --repo="$REPO_DIR" \
  --install-deps-from=flathub \
  "$BUILD_DIR/build-output" \
  "$MANIFEST" 2>&1 | tail -30 || {
    echo ""
    echo "  flatpak-builder requires SDK runtimes — generating host build script..."
    cat > "$DIST_DIR/build-flatpak-on-host.sh" << HOSTSCRIPT
#!/bin/bash
# Run on a machine with flatpak-builder + org.freedesktop.Sdk//23.08
set -e
SCRIPT_DIR="\$(cd "\$(dirname "\$0")/.." && pwd)/packaging"
cd "\$SCRIPT_DIR/flatpak"
flatpak-builder --force-clean --repo="\$SCRIPT_DIR/../dist/flatpak-repo" \\
  "\$SCRIPT_DIR/../dist/flatpak-build/build-output" org.omnecor.HMCI.yml
flatpak build-bundle "\$SCRIPT_DIR/../dist/flatpak-repo" \\
  "\$SCRIPT_DIR/../dist/org.omnecor.HMCI.flatpak" org.omnecor.HMCI \\
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
echo "Built: \$SCRIPT_DIR/../dist/org.omnecor.HMCI.flatpak"
HOSTSCRIPT
    chmod +x "$DIST_DIR/build-flatpak-on-host.sh"
    echo "  Generated: $DIST_DIR/build-flatpak-on-host.sh"
  }

# --- Bundle ---
if [ -d "$REPO_DIR" ]; then
  echo "[4/5] Creating single-file bundle..."
  flatpak build-bundle "$REPO_DIR" "$DIST_DIR/${APP_ID}.flatpak" "$APP_ID" \
    --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo 2>/dev/null || true
fi

# --- Summary ---
echo ""
echo "[5/5] Done."
echo "═══════════════════════════════════════════════════════════════"
if [ -f "$DIST_DIR/${APP_ID}.flatpak" ]; then
  echo "  Bundle: $DIST_DIR/${APP_ID}.flatpak"
  echo "  Size:   $(du -h "$DIST_DIR/${APP_ID}.flatpak" | cut -f1)"
  echo ""
  echo "  Install:  flatpak install --user $DIST_DIR/${APP_ID}.flatpak"
  echo "  Run:      flatpak run ${APP_ID}"
else
  echo "  Manifest ready at: $MANIFEST"
  echo "  To build on a compatible host: bash $DIST_DIR/build-flatpak-on-host.sh"
fi
echo "═══════════════════════════════════════════════════════════════"
