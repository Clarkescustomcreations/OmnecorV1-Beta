#!/usr/bin/env bash
# ==============================================================================
# Omnecor — Debian Package Builder (.deb)  [headless server build]
# ==============================================================================
#
# Builds omnecor-hmci-server_<version>_amd64.deb — the headless Omnecor backend that
# runs as a systemd service and serves the web workstation at localhost:3000.
# This is the non-Electron build; for the desktop GUI use the electron-builder
# deb under packaging/electron-app/ (build-all.sh --target linux).
#
# Usage:
#   ./packaging/build-deb.sh [version] [--skip-build]
#     version       Debian package version. Default: derived from package.json
#                   (e.g. 2.4.1-beta.1 → 2.4.1~beta.1, a valid pre-release order).
#     --skip-build  Reuse the existing dist/ instead of running `pnpm build`.
#
# Requirements: dpkg-deb, fakeroot (optional), node, pnpm
#
# Install layout:
#   /opt/omnecor/backend/            — bundle (dist/index.js + public), migrations,
#                                       node_modules/@libsql (native binding)
#   /opt/omnecor/python/             — optional Python AI microservice bridges
#   /opt/omnecor/packaging/scripts/  — detect_gpu.py, setup-valet-python.sh
#   /opt/omnecor/scripts/            — launcher
#   /usr/bin/omnecor                 — "open the workstation" command
#   /usr/share/applications/omnecor.desktop
#   /etc/omnecor/omnecor.conf        — configuration (conffile)
#   /etc/omnecor/omnecor.env         — generated secrets (postinst, not shipped)
#   /var/lib/omnecor/                — runtime data (DB, models, backups)
#   /var/log/omnecor/                — logs
#   /lib/systemd/system/omnecor.service
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEBIAN_DIR="$SCRIPT_DIR/deb/debian"
# Distinct from the Electron desktop deb (packageName: omnecor-hmci), so dpkg/apt
# never treats the two different products as the same package. They install to
# different paths (/opt/omnecor vs /opt/Omnecor) and can coexist.
PACKAGE_NAME="omnecor-hmci-server"
ARCH="amd64"

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
VERSION_ARG=""
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --*) echo "Unknown flag: $arg" >&2; exit 1 ;;
    *)   VERSION_ARG="$arg" ;;
  esac
done

# Derive version from package.json unless explicitly given. Debian versions may
# not contain '-' in the upstream part the way npm pre-release tags do, so
# convert '2.4.1-beta.1' → '2.4.1~beta.1' ('~' sorts *before* the release).
if [ -n "$VERSION_ARG" ]; then
  VERSION="$VERSION_ARG"
else
  RAW_VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version" 2>/dev/null || echo "2.4.1")"
  VERSION="${RAW_VERSION/-/\~}"
fi

DIST_DIR="$PROJECT_ROOT/dist"
BUILD_DIR="$PROJECT_ROOT/packaging/deb-build"
DEB_ROOT="$BUILD_DIR/${PACKAGE_NAME}_${VERSION}_${ARCH}"

echo "═══════════════════════════════════════════════════════════════"
echo "  Omnecor Debian Package Builder (server)"
echo "  Package:  $PACKAGE_NAME"
echo "  Version:  $VERSION"
echo "  Arch:     $ARCH"
echo "═══════════════════════════════════════════════════════════════"

# --- Clean ---
echo "[1/8] Cleaning previous build tree..."
rm -rf "$BUILD_DIR"
mkdir -p "$DEB_ROOT"

# --- Build backend ---
echo "[2/8] Building backend bundle (vite + esbuild)..."
cd "$PROJECT_ROOT"
if [ "$SKIP_BUILD" = true ]; then
  echo "  --skip-build: reusing existing dist/"
  [ -f "$DIST_DIR/index.js" ] || { echo "ERROR: dist/index.js missing — run without --skip-build"; exit 1; }
else
  pnpm install --frozen-lockfile
  pnpm build
fi
[ -f "$DIST_DIR/index.js" ]        || { echo "ERROR: dist/index.js not produced"; exit 1; }
[ -f "$DIST_DIR/public/index.html" ] || { echo "ERROR: dist/public/index.html missing — frontend not built"; exit 1; }

# --- Directory structure ---
echo "[3/8] Creating package directory structure..."
mkdir -p "$DEB_ROOT/opt/omnecor/backend"
mkdir -p "$DEB_ROOT/opt/omnecor/python"
mkdir -p "$DEB_ROOT/opt/omnecor/scripts"
mkdir -p "$DEB_ROOT/opt/omnecor/packaging/scripts"
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

# --- Copy app files ---
echo "[4/8] Copying application files..."

# Backend bundle (dist/index.js + dist/package.json + dist/public). The server
# resolves dist/public and ../node_modules/@libsql relative to the bundle file.
# Copy ONLY the bundle artifacts — never `cp -r dist/` wholesale, because dist/
# is also this script's output directory (the built .deb lands there) and would
# otherwise be packaged recursively inside the new deb.
mkdir -p "$DEB_ROOT/opt/omnecor/backend/dist"
cp "$DIST_DIR/index.js"     "$DEB_ROOT/opt/omnecor/backend/dist/index.js"
cp "$DIST_DIR/package.json" "$DEB_ROOT/opt/omnecor/backend/dist/package.json"
cp -r "$DIST_DIR/public"    "$DEB_ROOT/opt/omnecor/backend/dist/public"

# Drizzle migrations — applied on first boot (MIGRATIONS_DIR points here).
mkdir -p "$DEB_ROOT/opt/omnecor/backend/drizzle"
cp -r "$PROJECT_ROOT/drizzle/migrations" "$DEB_ROOT/opt/omnecor/backend/drizzle/migrations"

# Native libSQL binding. The server bundle inlines @libsql/client's JS but loads
# the platform binding via a runtime require(`@libsql/${target}`) the bundler
# cannot follow, so the .node must ship on disk, resolvable one level up from the
# bundle (node_modules/@libsql/linux-x64-gnu). This is the ONLY native dependency
# the headless server needs — onnxruntime/better-sqlite3/mysql2 are not in the
# bundle (verified: 0 references) and are intentionally not shipped.
GNU_BINDING="$PROJECT_ROOT/node_modules/@libsql/linux-x64-gnu"
if [ ! -f "$GNU_BINDING/index.node" ]; then
  echo "ERROR: $GNU_BINDING/index.node not found. Run \`pnpm install\` in the project root first."
  exit 1
fi
mkdir -p "$DEB_ROOT/opt/omnecor/backend/node_modules/@libsql"
cp -r "$GNU_BINDING" "$DEB_ROOT/opt/omnecor/backend/node_modules/@libsql/linux-x64-gnu"

# Minimal package marker for the backend root (version + ESM module type).
cat > "$DEB_ROOT/opt/omnecor/backend/package.json" << PKG
{
  "name": "omnecor-backend",
  "version": "${VERSION}",
  "private": true,
  "type": "module"
}
PKG

# Icons
cp "$PROJECT_ROOT/assets/logo_mark_256.png"  "$DEB_ROOT/usr/share/icons/hicolor/256x256/apps/omnecor.png"
cp "$PROJECT_ROOT/assets/logo_mark_512.png"  "$DEB_ROOT/usr/share/icons/hicolor/512x512/apps/omnecor.png"
cp "$PROJECT_ROOT/assets/app_icon_1024.png"  "$DEB_ROOT/usr/share/icons/hicolor/1024x1024/apps/omnecor.png"

# Optional Python AI microservice bridges (run as separate processes; the Node
# server proxies to them and degrades gracefully when offline). Shipping the
# scripts is cheap; the heavy pip deps are installed on demand via the setup
# scripts and requirements.txt.
if compgen -G "$PROJECT_ROOT/server/python_bridges/*.py" > /dev/null; then
  cp "$PROJECT_ROOT/server/python_bridges/"*.py "$DEB_ROOT/opt/omnecor/python/"
fi
[ -f "$PROJECT_ROOT/requirements.txt" ] && \
  cp "$PROJECT_ROOT/requirements.txt" "$DEB_ROOT/opt/omnecor/python/requirements.txt"

# GPU detection (postinst) + Python venv provisioner.
cp "$SCRIPT_DIR/scripts/detect_gpu.py"          "$DEB_ROOT/opt/omnecor/packaging/scripts/"
cp "$SCRIPT_DIR/scripts/setup-valet-python.sh"  "$DEB_ROOT/opt/omnecor/packaging/scripts/" 2>/dev/null || true

# Systemd service
cp "$SCRIPT_DIR/systemd/omnecor.service" "$DEB_ROOT/lib/systemd/system/omnecor.service"

# Launcher — opens the workstation in a browser, starting the service if needed.
# It does NOT spawn its own backend (that would collide with the systemd service
# on the same port and could not read the root-owned JWT secret).
cat > "$DEB_ROOT/opt/omnecor/scripts/omnecor-launcher.sh" << 'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

URL="http://localhost:3000"
if [ -r /etc/omnecor/omnecor.conf ]; then
  port="$(sed -n 's/^[[:space:]]*port[[:space:]]*=[[:space:]]*//p' /etc/omnecor/omnecor.conf | head -1)"
  [ -n "${port:-}" ] && URL="http://localhost:${port}"
fi

is_up() { curl -fsS "${URL}/health" >/dev/null 2>&1; }

if ! is_up; then
  if command -v systemctl >/dev/null 2>&1 && \
     systemctl list-unit-files omnecor.service >/dev/null 2>&1; then
    echo "[Omnecor] Starting backend service…"
    systemctl start omnecor 2>/dev/null || sudo systemctl start omnecor 2>/dev/null || true
    for _ in $(seq 1 30); do is_up && break; sleep 1; done
  fi
fi

if is_up; then
  echo "[Omnecor] Workstation ready at ${URL}"
  xdg-open "$URL" >/dev/null 2>&1 || echo "[Omnecor] Open ${URL} in your browser."
else
  echo "[Omnecor] Backend not reachable at ${URL}." >&2
  echo "          Start it:  sudo systemctl start omnecor" >&2
  echo "          Logs:      journalctl -u omnecor -e" >&2
  exit 1
fi
LAUNCHER
chmod 755 "$DEB_ROOT/opt/omnecor/scripts/omnecor-launcher.sh"

cat > "$DEB_ROOT/usr/bin/omnecor" << 'BIN'
#!/usr/bin/env bash
exec /opt/omnecor/scripts/omnecor-launcher.sh "$@"
BIN
chmod 755 "$DEB_ROOT/usr/bin/omnecor"

# Default config (conffile — preserved across upgrades if the admin edits it).
cat > "$DEB_ROOT/etc/omnecor/omnecor.conf" << 'CONFIG'
[server]
host = 127.0.0.1
port = 3000

[voice]
whisper_url = http://127.0.0.1:8001
tts_url = http://127.0.0.1:8002

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
Comment=Context-Aware AI Infrastructure Workstation
Exec=/usr/bin/omnecor
Icon=omnecor
Terminal=false
Type=Application
Categories=Development;Science;
Keywords=AI;LLM;MachineLearning;Automation;
StartupWMClass=omnecor
DESKTOP

# --- DEBIAN control files ---
echo "[5/8] Writing DEBIAN control files..."
INSTALLED_SIZE="$(du -sk "$DEB_ROOT" | cut -f1)"

# Base control from deb/debian/control; override Version + Installed-Size.
{
  sed -e "s/^Version:.*/Version: ${VERSION}/" "$DEBIAN_DIR/control"
  echo "Installed-Size: ${INSTALLED_SIZE}"
} > "$DEB_ROOT/DEBIAN/control"

echo "10" > "$DEB_ROOT/DEBIAN/compat"
echo "/etc/omnecor/omnecor.conf" > "$DEB_ROOT/DEBIAN/conffiles"

# postinst — create system user, generate a persistent JWT secret, detect GPU,
# enable + start the service. The JWT secret is generated once and preserved on
# upgrade so existing sessions survive (Operational Memory: data must persist).
cat > "$DEB_ROOT/DEBIAN/postinst" << 'POSTINST'
#!/bin/bash
set -e

case "$1" in
  configure)
    # 1) System user owning the runtime data.
    if ! id omnecor >/dev/null 2>&1; then
      useradd --system --user-group --create-home --home-dir /var/lib/omnecor \
              --shell /usr/sbin/nologin omnecor
    fi
    install -d -o omnecor -g omnecor -m 0750 /var/lib/omnecor /var/log/omnecor
    chown -R omnecor:omnecor /opt/omnecor || true

    # 2) Persistent secrets file. Generate JWT_SECRET only if absent so it is
    #    stable across upgrades (session cookies stay valid).
    ENV_FILE=/etc/omnecor/omnecor.env
    if [ ! -f "$ENV_FILE" ]; then
      if command -v openssl >/dev/null 2>&1; then
        SECRET="$(openssl rand -hex 32)"
      else
        SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      fi
      umask 077
      {
        echo "# Generated by omnecor-hmci on first install — do not share or commit."
        echo "JWT_SECRET=${SECRET}"
      } > "$ENV_FILE"
    fi
    chown omnecor:omnecor "$ENV_FILE" || true
    chmod 600 "$ENV_FILE" || true

    # 3) GPU detection (configures local model layer offload). Best-effort.
    if command -v python3 >/dev/null 2>&1 && \
       [ -f /opt/omnecor/packaging/scripts/detect_gpu.py ]; then
      python3 /opt/omnecor/packaging/scripts/detect_gpu.py || true
    fi

    # 4) Enable + (re)start the service.
    if [ -d /run/systemd/system ]; then
      systemctl daemon-reload || true
      systemctl enable omnecor.service || true
      systemctl restart omnecor.service || true
      echo "Omnecor HMCI is starting → http://localhost:3000"
    else
      echo "systemd not detected — start manually: node /opt/omnecor/backend/dist/index.js"
    fi
  ;;
  abort-upgrade|abort-remove|abort-deconfigure) ;;
  *) echo "postinst called with unknown argument \`$1'" >&2; exit 1 ;;
esac
exit 0
POSTINST
chmod 755 "$DEB_ROOT/DEBIAN/postinst"

# prerm — stop + disable before removal.
cat > "$DEB_ROOT/DEBIAN/prerm" << 'PRERM'
#!/bin/bash
set -e
if [ -d /run/systemd/system ]; then
  systemctl stop omnecor.service 2>/dev/null || true
  systemctl disable omnecor.service 2>/dev/null || true
fi
exit 0
PRERM
chmod 755 "$DEB_ROOT/DEBIAN/prerm"

# postrm — purge data + secrets + user on full purge.
cat > "$DEB_ROOT/DEBIAN/postrm" << 'POSTRM'
#!/bin/bash
set -e
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload 2>/dev/null || true
fi
if [ "$1" = "purge" ]; then
  rm -rf /var/lib/omnecor /var/log/omnecor
  rm -f  /etc/omnecor/omnecor.env
  rmdir  /etc/omnecor 2>/dev/null || true
  if id omnecor >/dev/null 2>&1; then
    userdel omnecor 2>/dev/null || true
  fi
fi
exit 0
POSTRM
chmod 755 "$DEB_ROOT/DEBIAN/postrm"

# --- md5sums (dpkg integrity manifest) ---
echo "[6/8] Generating md5sums..."
( cd "$DEB_ROOT" && find . -type f -not -path './DEBIAN/*' -printf '%P\0' \
    | xargs -0 md5sum > DEBIAN/md5sums )

# --- Build ---
echo "[7/8] Building .deb package (xz-compressed)..."
mkdir -p "$DIST_DIR"
DEB_FILE="$DIST_DIR/${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"
if command -v fakeroot >/dev/null 2>&1; then
  fakeroot dpkg-deb --build -Zxz "$DEB_ROOT" "$DEB_FILE"
else
  dpkg-deb --build -Zxz "$DEB_ROOT" "$DEB_FILE"
fi

# --- Verify ---
echo "[8/8] Verifying..."
if [ -f "$DEB_FILE" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  Package built successfully!"
  echo "  Output: $DEB_FILE"
  echo "  Size:   $(du -h "$DEB_FILE" | cut -f1)"
  echo ""
  echo "  Install: sudo apt install $DEB_FILE   # resolves deps automatically"
  echo "       or: sudo dpkg -i $DEB_FILE && sudo apt-get install -f"
  echo "═══════════════════════════════════════════════════════════════"
  dpkg-deb --info "$DEB_FILE"
  echo "── contents (selected) ──"
  contents="$(dpkg-deb --contents "$DEB_FILE" | awk '{print $1, $6}')"
  printf '%s\n' "$contents" | grep -E '/(backend/dist/index\.js|@libsql/linux-x64-gnu/index\.node|drizzle/migrations/|omnecor\.service|usr/bin/omnecor|omnecor\.conf)$' || true
else
  echo "ERROR: Package build failed!"
  exit 1
fi
