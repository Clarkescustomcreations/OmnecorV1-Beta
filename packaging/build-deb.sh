#!/usr/bin/env bash
# ==============================================================================
# Omnecor — Debian Package Builder (.deb)
# ==============================================================================
#
# Builds omnecor-hmci_VERSION_amd64.deb using the pre-defined control files
# in packaging/deb/debian/ (version 2.4.1, package name: omnecor-hmci).
#
# Usage:
#   ./packaging/build-deb.sh [version]
#
# Requirements:
#   dpkg-deb, fakeroot (optional), nodejs, python3
#
# Output:
#   ./dist/omnecor-hmci_VERSION_amd64.deb
#
# Install layout:
#   /opt/omnecor/           — Application files
#   /usr/bin/omnecor        — Launcher symlink
#   /usr/share/applications/omnecor.desktop
#   /etc/omnecor/           — Configuration
#   /var/lib/omnecor/       — Runtime data (VectorDB, backups)
#   /lib/systemd/system/omnecor.service
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEBIAN_DIR="$SCRIPT_DIR/deb/debian"
VERSION="${1:-2.4.1}"
PACKAGE_NAME="omnecor-hmci"
ARCH="amd64"

DIST_DIR="$PROJECT_ROOT/dist"
BUILD_DIR="$PROJECT_ROOT/packaging/deb-build"
DEB_ROOT="$BUILD_DIR/${PACKAGE_NAME}_${VERSION}_${ARCH}"

echo "═══════════════════════════════════════════════════════════════"
echo "  Omnecor Debian Package Builder"
echo "  Package:  $PACKAGE_NAME"
echo "  Version:  $VERSION"
echo "  Arch:     $ARCH"
echo "═══════════════════════════════════════════════════════════════"

# --- Clean ---
echo "[1/7] Cleaning previous builds..."
rm -rf "$BUILD_DIR"
mkdir -p "$DEB_ROOT"

# --- Build backend ---
echo "[2/7] Building backend..."
cd "$PROJECT_ROOT"
if [ -f "package.json" ]; then
  pnpm install --frozen-lockfile 2>/dev/null || npm ci 2>/dev/null || true
  pnpm build 2>/dev/null || npm run build 2>/dev/null || \
    echo "  (TypeScript build skipped — source will be bundled as-is)"
fi

# --- Directory structure ---
echo "[3/7] Creating package directory structure..."

mkdir -p "$DEB_ROOT/opt/omnecor/backend"
mkdir -p "$DEB_ROOT/opt/omnecor/python"
mkdir -p "$DEB_ROOT/opt/omnecor/scripts"
mkdir -p "$DEB_ROOT/usr/bin"
mkdir -p "$DEB_ROOT/usr/share/applications"
mkdir -p "$DEB_ROOT/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$DEB_ROOT/usr/share/icons/hicolor/512x512/apps"
mkdir -p "$DEB_ROOT/usr/share/icons/hicolor/1024x1024/apps"
mkdir -p "$DEB_ROOT/etc/omnecor"
mkdir -p "$DEB_ROOT/var/lib/omnecor"
mkdir -p "$DEB_ROOT/var/log/omnecor"
mkdir -p "$DEB_ROOT/lib/systemd/system"
mkdir -p "$DEB_ROOT/DEBIAN"
mkdir -p "$DEB_ROOT/opt/omnecor/packaging/scripts"

# --- Copy app files ---
echo "[4/7] Copying application files..."

# Icons
cp "$PROJECT_ROOT/assets/logo_mark_256.png" "$DEB_ROOT/usr/share/icons/hicolor/256x256/apps/omnecor.png"
cp "$PROJECT_ROOT/assets/logo_mark_512.png" "$DEB_ROOT/usr/share/icons/hicolor/512x512/apps/omnecor.png"
cp "$PROJECT_ROOT/assets/app_icon_1024.png" "$DEB_ROOT/usr/share/icons/hicolor/1024x1024/apps/omnecor.png"

# Backend (compiled dist + source)
[ -d "$PROJECT_ROOT/dist" ] && cp -r "$PROJECT_ROOT/dist" "$DEB_ROOT/opt/omnecor/backend/"
cp "$PROJECT_ROOT/package.json" "$DEB_ROOT/opt/omnecor/backend/" 2>/dev/null || true
cp "$PROJECT_ROOT/tsconfig.json" "$DEB_ROOT/opt/omnecor/backend/" 2>/dev/null || true

# GPU detection script (used by postinst)
cp "$SCRIPT_DIR/scripts/detect_gpu.py" "$DEB_ROOT/opt/omnecor/packaging/scripts/" 2>/dev/null || true

# Install native Node.js modules that esbuild externalises (better-sqlite3,
# onnxruntime-node, mysql2) — without these node_modules the server won't start.
cat > "$DEB_ROOT/opt/omnecor/backend/package.json" << 'NATPKG'
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
cd "$DEB_ROOT/opt/omnecor/backend"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5 || \
  echo "  Warning: npm install failed — native modules must be present on target system"
cd "$PROJECT_ROOT"

# Systemd service
cp "$SCRIPT_DIR/systemd/omnecor.service" "$DEB_ROOT/lib/systemd/system/"

# Python AI scripts
for pyfile in whisper_server.py tts_server.py localLLMfine-tuning.py; do
  [ -f "$PROJECT_ROOT/../upload/$pyfile" ] && \
    cp "$PROJECT_ROOT/../upload/$pyfile" "$DEB_ROOT/opt/omnecor/python/"
done

# Launcher script
cat > "$DEB_ROOT/opt/omnecor/scripts/omnecor-launcher.sh" << 'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail
OMNECOR_HOME="/opt/omnecor"
OMNECOR_DATA="/var/lib/omnecor"
export OMNECOR_HOME OMNECOR_DATA NODE_ENV=production

mkdir -p "$OMNECOR_DATA"/{vectordb,backups,models,projects}

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install: sudo apt install nodejs"
  exit 1
fi

cd "$OMNECOR_HOME/backend"
node dist/index.js >> /var/log/omnecor/backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > /tmp/omnecor-backend.pid
echo "[Omnecor] Backend started (PID: $BACKEND_PID) — http://localhost:3000"

# If Electron frontend is installed, launch it; otherwise open browser
if [ -f "$OMNECOR_HOME/frontend/omnecor" ]; then
  "$OMNECOR_HOME/frontend/omnecor" &
else
  xdg-open "http://localhost:3000" 2>/dev/null || \
    echo "[Omnecor] Open http://localhost:3000 in your browser."
  wait $BACKEND_PID
fi
LAUNCHER
chmod +x "$DEB_ROOT/opt/omnecor/scripts/omnecor-launcher.sh"

cat > "$DEB_ROOT/usr/bin/omnecor" << 'BIN'
#!/usr/bin/env bash
exec /opt/omnecor/scripts/omnecor-launcher.sh "$@"
BIN
chmod +x "$DEB_ROOT/usr/bin/omnecor"

# Default config
cat > "$DEB_ROOT/etc/omnecor/omnecor.conf" << 'CONFIG'
[server]
host = 127.0.0.1
port = 3000

[voice]
whisper_url = http://127.0.0.1:8001
tts_url = http://127.0.0.1:8002

[vectordb]
url = http://127.0.0.1:6333
collection_prefix = omnecor_

[security]
encryption_algorithm = aes-256-gcm
max_file_size_mb = 500

[paths]
data_dir = /var/lib/omnecor
log_dir = /var/log/omnecor
backup_dir = /var/lib/omnecor/backups
models_dir = /var/lib/omnecor/models
CONFIG

# Desktop entry
cat > "$DEB_ROOT/usr/share/applications/omnecor.desktop" << 'DESKTOP'
[Desktop Entry]
Name=Omnecor HMCI
Comment=Human-Machine Collaboration Interface
Exec=/usr/bin/omnecor
Icon=omnecor
Terminal=false
Type=Application
Categories=Development;Science;ArtificialIntelligence;
Keywords=AI;LLM;MachineLearning;
StartupWMClass=omnecor
DESKTOP

# --- DEBIAN control files (use pre-existing) ---
echo "[5/7] Installing DEBIAN control files..."

INSTALLED_SIZE=$(du -sk "$DEB_ROOT" | cut -f1)

# Use the pre-defined control from deb/debian/control as base, update version/size
sed "s/^Version:.*/Version: ${VERSION}/" "$DEBIAN_DIR/control" | \
  sed "s/^Installed-Size:.*/Installed-Size: ${INSTALLED_SIZE}/" \
  > "$DEB_ROOT/DEBIAN/control" 2>/dev/null || \
  cp "$DEBIAN_DIR/control" "$DEB_ROOT/DEBIAN/control"

# Copy the rest of the debian scripts
cp "$DEBIAN_DIR/postinst" "$DEB_ROOT/DEBIAN/postinst" && chmod 755 "$DEB_ROOT/DEBIAN/postinst"
cp "$DEBIAN_DIR/compat"   "$DEB_ROOT/DEBIAN/compat"   2>/dev/null || echo "10" > "$DEB_ROOT/DEBIAN/compat"

# prerm — stop service before removal
cat > "$DEB_ROOT/DEBIAN/prerm" << 'PRERM'
#!/bin/bash
set -e
systemctl is-active --quiet omnecor 2>/dev/null && systemctl stop omnecor || true
systemctl is-enabled --quiet omnecor 2>/dev/null && systemctl disable omnecor || true
PRERM
chmod 755 "$DEB_ROOT/DEBIAN/prerm"

# postrm — purge data on full remove
cat > "$DEB_ROOT/DEBIAN/postrm" << 'POSTRM'
#!/bin/bash
set -e
if [ "$1" = "purge" ]; then
  rm -rf /var/lib/omnecor /var/log/omnecor /etc/omnecor
  id -u omnecor >/dev/null 2>&1 && userdel omnecor 2>/dev/null || true
fi
systemctl daemon-reload 2>/dev/null || true
POSTRM
chmod 755 "$DEB_ROOT/DEBIAN/postrm"

echo "/etc/omnecor/omnecor.conf" > "$DEB_ROOT/DEBIAN/conffiles"

# --- Build ---
echo "[6/7] Building .deb package..."
mkdir -p "$DIST_DIR"

if command -v fakeroot &>/dev/null; then
  fakeroot dpkg-deb --build "$DEB_ROOT" "$DIST_DIR/${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"
else
  dpkg-deb --build "$DEB_ROOT" "$DIST_DIR/${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"
fi

# --- Verify ---
echo "[7/7] Verifying..."
DEB_FILE="$DIST_DIR/${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"

if [ -f "$DEB_FILE" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  Package built successfully!"
  echo "  Output: $DEB_FILE"
  echo "  Size:   $(du -h "$DEB_FILE" | cut -f1)"
  echo ""
  echo "  Install: sudo dpkg -i $DEB_FILE"
  echo "           sudo apt-get install -f   # resolve deps"
  echo "═══════════════════════════════════════════════════════════════"
  dpkg-deb --info "$DEB_FILE" 2>/dev/null || true
else
  echo "ERROR: Package build failed!"
  exit 1
fi
