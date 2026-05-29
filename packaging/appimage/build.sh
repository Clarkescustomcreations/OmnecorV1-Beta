#!/usr/bin/env bash
# ==============================================================================
# Omnecor AppImage Builder
# ==============================================================================
#
# Creates a portable AppImage for Omnecor HMCI Workstation.
# Bundles Node.js runtime and pre-built application assets.
#
# Usage:
#   ./packaging/appimage/build.sh
# ==============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
BUILD_DIR="$PROJECT_ROOT/packaging/appimage/build"
APP_DIR="$BUILD_DIR/Omnecor.AppDir"

# Read version from package.json
VERSION=$(node -e "console.log(require('$PROJECT_ROOT/package.json').version)")
APP_NAME="Omnecor-HMCI"
ARCH="x86_64"

# Node.js portable binary (LTS)
NODE_VERSION="20.11.1"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"

echo "═══════════════════════════════════════════════════════════════"
echo "  Omnecor AppImage Builder"
echo "  Version: $VERSION"
echo "  Root:    $PROJECT_ROOT"
echo "═══════════════════════════════════════════════════════════════"

# ---------------------------------------------------------------------------
# Build Project Assets
# ---------------------------------------------------------------------------

echo "[1/7] Building application assets..."
cd "$PROJECT_ROOT"
npm install
npm run build

# ---------------------------------------------------------------------------
# Prepare AppDir
# ---------------------------------------------------------------------------

echo "[2/7] Preparing AppDir structure..."
rm -rf "$BUILD_DIR"
mkdir -p "$APP_DIR/usr/bin"
mkdir -p "$APP_DIR/usr/lib/omnecor/backend"
mkdir -p "$APP_DIR/usr/lib/omnecor/node"
mkdir -p "$APP_DIR/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$APP_DIR/usr/share/applications"

# ---------------------------------------------------------------------------
# Download Node.js Runtime
# ---------------------------------------------------------------------------

echo "[3/7] Bundling Node.js runtime..."
NODE_ARCHIVE="$BUILD_DIR/node.tar.xz"
if [ ! -f "$NODE_ARCHIVE" ]; then
  curl -sL "$NODE_URL" -o "$NODE_ARCHIVE"
fi
tar -xJf "$NODE_ARCHIVE" -C "$APP_DIR/usr/lib/omnecor/node" --strip-components=1

# ---------------------------------------------------------------------------
# Copy Application Files
# ---------------------------------------------------------------------------

echo "[4/7] Copying built files..."

# Copy the built backend bundle (index.js and assets)
cp -r "$DIST_DIR/"* "$APP_DIR/usr/lib/omnecor/backend/"
echo "$VERSION" > "$APP_DIR/usr/lib/omnecor/backend/version.txt"

# Copy package.json for metadata
cp "$PROJECT_ROOT/package.json" "$APP_DIR/usr/lib/omnecor/backend/"

# Copy production dependencies
cp -r "$PROJECT_ROOT/node_modules" "$APP_DIR/usr/lib/omnecor/backend/" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Integration
# ---------------------------------------------------------------------------

echo "[5/7] Adding integration files..."

# Copy AppRun
cp "$SCRIPT_DIR/AppRun" "$APP_DIR/AppRun"
chmod +x "$APP_DIR/AppRun"

# Create Desktop file
cat > "$APP_DIR/omnecor.desktop" << DESKTOP
[Desktop Entry]
Name=Omnecor HMCI
Comment=Human-Machine Collaboration Interface
Exec=AppRun
Icon=omnecor
Terminal=true
Type=Application
Categories=Development;Science;ArtificialIntelligence;
X-AppImage-Version=${VERSION}
DESKTOP

cp "$APP_DIR/omnecor.desktop" "$APP_DIR/usr/share/applications/"

# Create Icon (SVG)
cat > "$APP_DIR/omnecor.svg" << 'ICON'
<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="40" fill="#1a1a2e"/>
  <circle cx="128" cy="128" r="60" fill="none" stroke="#e94560" stroke-width="4"/>
  <circle cx="128" cy="128" r="20" fill="#e94560"/>
</svg>
ICON

cp "$APP_DIR/omnecor.svg" "$APP_DIR/usr/share/icons/hicolor/256x256/apps/omnecor.svg"
ln -sf usr/share/icons/hicolor/256x256/apps/omnecor.svg "$APP_DIR/omnecor.svg"

# ---------------------------------------------------------------------------
# Build AppImage
# ---------------------------------------------------------------------------

echo "[6/7] Bundling with appimagetool..."

APPIMAGETOOL="$BUILD_DIR/appimagetool"
if [ ! -f "$APPIMAGETOOL" ]; then
  curl -sL "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" -o "$APPIMAGETOOL"
  chmod +x "$APPIMAGETOOL"
fi

OUTPUT_FILE="$PROJECT_ROOT/dist/${APP_NAME}-${VERSION}-${ARCH}.AppImage"
mkdir -p "$PROJECT_ROOT/dist"

ARCH=x86_64 "$APPIMAGETOOL" "$APP_DIR" "$OUTPUT_FILE" || echo "Warning: appimagetool failed. Check dependencies."

echo "═══════════════════════════════════════════════════════════════"
echo "  Build scaffolded successfully."
echo "  Output: $OUTPUT_FILE"
echo "═══════════════════════════════════════════════════════════════"
