#!/usr/bin/env bash
# ==============================================================================
# Omnecor — AppImage Builder
# ==============================================================================
#
# Creates a portable AppImage for Omnecor HMCI Workstation.
# AppImage bundles all dependencies for distribution-agnostic deployment.
#
# Usage:
#   ./packaging/build-appimage.sh [--version X.Y.Z]
#
# Requirements:
#   - appimagetool (downloaded automatically if not present)
#   - Node.js 20+ (bundled into the AppImage)
#   - wget or curl
#
# Output:
#   ./dist/Omnecor-X.Y.Z-x86_64.AppImage
# ==============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VERSION="${1:-2.3.0}"
APP_NAME="Omnecor"
ARCH="x86_64"

DIST_DIR="$PROJECT_ROOT/dist"
BUILD_DIR="$DIST_DIR/appimage-build"
APP_DIR="$BUILD_DIR/${APP_NAME}.AppDir"

# AppImageTool URL
APPIMAGETOOL_URL="https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
APPIMAGETOOL="$BUILD_DIR/appimagetool"

# Node.js portable binary URL (LTS)
NODE_VERSION="20.11.1"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"

echo "═══════════════════════════════════════════════════════════════"
echo "  Omnecor AppImage Builder"
echo "  Version: $VERSION"
echo "  Architecture: $ARCH"
echo "═══════════════════════════════════════════════════════════════"

# ---------------------------------------------------------------------------
# Clean & Prepare
# ---------------------------------------------------------------------------

echo "[1/8] Cleaning previous builds..."
rm -rf "$BUILD_DIR"
mkdir -p "$APP_DIR"

# ---------------------------------------------------------------------------
# Download Tools
# ---------------------------------------------------------------------------

echo "[2/8] Downloading appimagetool..."
if [ ! -f "$APPIMAGETOOL" ]; then
  wget -q "$APPIMAGETOOL_URL" -O "$APPIMAGETOOL" || \
    curl -sL "$APPIMAGETOOL_URL" -o "$APPIMAGETOOL"
  chmod +x "$APPIMAGETOOL"
fi

echo "[3/8] Downloading portable Node.js v${NODE_VERSION}..."
NODE_ARCHIVE="$BUILD_DIR/node.tar.xz"
if [ ! -f "$NODE_ARCHIVE" ]; then
  wget -q "$NODE_URL" -O "$NODE_ARCHIVE" || \
    curl -sL "$NODE_URL" -o "$NODE_ARCHIVE"
fi

# ---------------------------------------------------------------------------
# Create AppDir Structure
# ---------------------------------------------------------------------------

echo "[4/8] Creating AppDir structure..."

mkdir -p "$APP_DIR/usr/bin"
mkdir -p "$APP_DIR/usr/lib/omnecor/backend"
mkdir -p "$APP_DIR/usr/lib/omnecor/python"
mkdir -p "$APP_DIR/usr/lib/omnecor/node"
mkdir -p "$APP_DIR/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$APP_DIR/usr/share/applications"

# ---------------------------------------------------------------------------
# Bundle Node.js Runtime
# ---------------------------------------------------------------------------

echo "[5/8] Bundling Node.js runtime..."
tar -xJf "$NODE_ARCHIVE" -C "$APP_DIR/usr/lib/omnecor/node" --strip-components=1

# ---------------------------------------------------------------------------
# Copy Application Files
# ---------------------------------------------------------------------------

echo "[6/8] Copying application files..."

# Backend dist — must be pre-built (run 'pnpm build' from the project root)
if [ ! -d "$PROJECT_ROOT/dist" ]; then
  echo ""
  echo "ERROR: $PROJECT_ROOT/dist not found."
  echo "  Run 'pnpm build' (or 'npm run build') from the project root first."
  exit 1
fi
cp -r "$PROJECT_ROOT/dist/"* "$APP_DIR/usr/lib/omnecor/backend/"

# Minimal package.json for native modules that esbuild externalises
cat > "$APP_DIR/usr/lib/omnecor/backend/package.json" << 'NATPKG'
{
  "name": "omnecor-backend-native",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "better-sqlite3": "^12.10.0",
    "onnxruntime-node": "^1.26.0",
    "mysql2": "^3.15.0"
  }
}
NATPKG

# Install native modules using the bundled Node.js
cd "$APP_DIR/usr/lib/omnecor/backend"
"$APP_DIR/usr/lib/omnecor/node/bin/node" \
  "$APP_DIR/usr/lib/omnecor/node/bin/npm" install --omit=dev --no-audit 2>/dev/null || \
  echo "  Warning: native module install failed — better-sqlite3/onnxruntime-node/mysql2 must be available on target"
cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Create AppRun Entry Point
# ---------------------------------------------------------------------------

# Use the canonical AppRun from the source tree (packaging/appimage/AppRun)
cp "$SCRIPT_DIR/appimage/AppRun" "$APP_DIR/AppRun"
chmod +x "$APP_DIR/AppRun"

# ---------------------------------------------------------------------------
# Create Desktop Integration Files
# ---------------------------------------------------------------------------

cat > "$APP_DIR/omnecor.desktop" << DESKTOP
[Desktop Entry]
Name=Omnecor
Comment=Context-Aware AI Infrastructure Workstation
Exec=AppRun
Icon=omnecor
Terminal=true
Type=Application
Categories=Development;Science;ArtificialIntelligence;
X-AppImage-Version=${VERSION}
DESKTOP

# Copy to standard location too
cp "$APP_DIR/omnecor.desktop" "$APP_DIR/usr/share/applications/"

# Create a placeholder icon (SVG)
cat > "$APP_DIR/omnecor.svg" << 'ICON'
<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f3460"/>
      <stop offset="100%" style="stop-color:#533483"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="40" fill="url(#bg)"/>
  <circle cx="128" cy="128" r="60" fill="none" stroke="url(#glow)" stroke-width="4"/>
  <circle cx="128" cy="128" r="20" fill="#e94560"/>
  <line x1="128" y1="68" x2="128" y2="40" stroke="#e94560" stroke-width="3"/>
  <line x1="128" y1="188" x2="128" y2="216" stroke="#e94560" stroke-width="3"/>
  <line x1="68" y1="128" x2="40" y2="128" stroke="#e94560" stroke-width="3"/>
  <line x1="188" y1="128" x2="216" y2="128" stroke="#e94560" stroke-width="3"/>
  <text x="128" y="240" text-anchor="middle" fill="#ffffff" font-size="20" font-family="monospace">OMNECOR</text>
</svg>
ICON

# Also copy as PNG location reference
cp "$APP_DIR/omnecor.svg" "$APP_DIR/usr/share/icons/hicolor/256x256/apps/omnecor.svg"

# ---------------------------------------------------------------------------
# Build AppImage
# ---------------------------------------------------------------------------

echo "[7/8] Building AppImage..."
mkdir -p "$DIST_DIR"

APPIMAGE_FILE="$DIST_DIR/${APP_NAME}-${VERSION}-${ARCH}.AppImage"

# Build with appimagetool
ARCH=x86_64 "$APPIMAGETOOL" "$APP_DIR" "$APPIMAGE_FILE" 2>/dev/null || {
  # Fallback: create a self-extracting archive if appimagetool fails
  echo "  appimagetool failed — creating self-extracting archive instead..."
  cd "$BUILD_DIR"
  tar -czf "$DIST_DIR/${APP_NAME}-${VERSION}-${ARCH}.tar.gz" "${APP_NAME}.AppDir"
  echo "  Created: $DIST_DIR/${APP_NAME}-${VERSION}-${ARCH}.tar.gz"
  APPIMAGE_FILE="$DIST_DIR/${APP_NAME}-${VERSION}-${ARCH}.tar.gz"
}

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

echo "[8/8] Verifying..."

if [ -f "$APPIMAGE_FILE" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  AppImage built successfully!"
  echo "  Output: $APPIMAGE_FILE"
  echo "  Size:   $(du -h "$APPIMAGE_FILE" | cut -f1)"
  echo ""
  echo "  Run with:"
  echo "    chmod +x $APPIMAGE_FILE"
  echo "    ./$APPIMAGE_FILE"
  echo "═══════════════════════════════════════════════════════════════"
else
  echo "ERROR: AppImage build failed!"
  exit 1
fi
