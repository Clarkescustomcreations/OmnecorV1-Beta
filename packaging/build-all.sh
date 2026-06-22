#!/usr/bin/env bash
# ==============================================================================
# Omnecor — Master Multi-Platform Build Script
# ==============================================================================
#
# Orchestrates all Omnecor installers from a single command.
#
# Supported targets:
#   linux   — AppImage + .deb + .rpm  (via electron-builder)
#   win     — NSIS .exe + Portable    (via electron-builder, Wine or Windows)
#   android — Omnecor HQ APK          (React Native / Expo, requires Android SDK + NDK)
#   flatpak — Flatpak bundle          (requires flatpak-builder)
#   deb     — Standalone .deb package (without Electron wrapper)
#   appimage— Standalone AppImage     (without Electron wrapper)
#
# Usage:
#   ./packaging/build-all.sh [--target all|linux|win|android|flatpak|deb|appimage]
#                            [--version X.Y.Z] [--skip-backend-build]
#
# Examples:
#   ./packaging/build-all.sh                     # builds all Linux targets
#   ./packaging/build-all.sh --target linux win  # Linux + Windows
#   ./packaging/build-all.sh --target android    # APK only
#   ./packaging/build-all.sh --target all        # everything
# ==============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ELECTRON_APP="$SCRIPT_DIR/electron-app"
VERSION="2.4.1"
TARGETS=()
SKIP_BACKEND=false

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${BLUE}[BUILD]${NC} $*"; }
ok()   { echo -e "${GREEN}[  OK ]${NC} $*"; }
warn() { echo -e "${YELLOW}[ WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL ]${NC} $*"; exit 1; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)  shift; while [[ $# -gt 0 && "$1" != --* ]]; do TARGETS+=("$1"); shift; done ;;
    --version) shift; VERSION="$1"; shift ;;
    --skip-backend-build) SKIP_BACKEND=true; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

# Default: build linux targets
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("linux")
fi

# Expand "all"
if [[ " ${TARGETS[*]} " == *" all "* ]]; then
  TARGETS=("linux" "win" "android" "flatpak" "deb" "appimage")
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Omnecor Master Builder  v${VERSION}"
echo "  Targets: ${TARGETS[*]}"
echo "  Project: $PROJECT_ROOT"
echo "═══════════════════════════════════════════════════════════════"
echo ""

mkdir -p "$PROJECT_ROOT/dist"

# ---------------------------------------------------------------------------
# Step 0: Build backend (TypeScript → dist/index.js)
# ---------------------------------------------------------------------------
if [ "$SKIP_BACKEND" = false ]; then
  log "Building Omnecor backend (TypeScript → dist/)..."
  cd "$PROJECT_ROOT"
  if command -v pnpm &>/dev/null; then
    pnpm install --frozen-lockfile
    pnpm build
  else
    npm ci
    npm run build
  fi
  ok "Backend built → dist/"
  echo ""
fi

# ---------------------------------------------------------------------------
# Step 1: Build Electron app (renderer + main)
# ---------------------------------------------------------------------------
build_electron() {
  log "Building Electron app (renderer + main process)..."
  cd "$ELECTRON_APP"
  if command -v pnpm &>/dev/null; then
    pnpm install
    pnpm build
  else
    npm install
    npm run build
  fi
  ok "Electron app built → $ELECTRON_APP/out/"
}

# ---------------------------------------------------------------------------
# Target: linux — AppImage + DEB + RPM via electron-builder
# ---------------------------------------------------------------------------
build_linux() {
  log "Building Linux installers (AppImage + .deb + .rpm)..."
  build_electron
  cd "$ELECTRON_APP"
  npx electron-builder --linux --config electron-builder.yml
  ok "Linux installers → $ELECTRON_APP/dist/"
  echo ""

  # Also build standalone AppImage (non-Electron, raw backend)
  log "Building standalone AppImage..."
  bash "$SCRIPT_DIR/build-appimage.sh" "$VERSION"
}

# ---------------------------------------------------------------------------
# Target: win — NSIS + Portable via electron-builder (Wine or Windows)
# ---------------------------------------------------------------------------
build_win() {
  log "Building Windows installer (.exe + portable)..."

  if [[ "$(uname -s)" != "MINGW"* ]] && [[ "$(uname -s)" != "CYGWIN"* ]]; then
    if ! command -v wine &>/dev/null && ! command -v docker &>/dev/null; then
      warn "Not on Windows and Wine/Docker not found."
      warn "Windows builds require one of:"
      warn "  - Run on a Windows 10/11 machine with Node.js"
      warn "  - Install Wine: sudo apt install wine"
      warn "  - Use Docker:   docker run --rm -v \$PWD:/project electronuserland/builder:wine"
      warn "Skipping Windows build."
      return 0
    fi

    if command -v wine &>/dev/null; then
      log "Using Wine for cross-compilation..."
      build_electron
      cd "$ELECTRON_APP"
      npx electron-builder --win --config electron-builder.yml
    elif command -v docker &>/dev/null; then
      log "Using Docker (electronuserland/builder:wine)..."
      build_electron
      docker run --rm \
        -v "$PROJECT_ROOT:/project" \
        -v ~/.cache/electron:/root/.cache/electron \
        -v ~/.cache/electron-builder:/root/.cache/electron-builder \
        -e ELECTRON_CACHE="/root/.cache/electron" \
        -e ELECTRON_BUILDER_CACHE="/root/.cache/electron-builder" \
        electronuserland/builder:wine \
        bash -c "cd /project/packaging/electron-app && npm install && npx electron-builder --win"
    fi
  else
    # Native Windows
    build_electron
    cd "$ELECTRON_APP"
    npx electron-builder --win --config electron-builder.yml
  fi

  ok "Windows installer → $ELECTRON_APP/dist/"
}

# ---------------------------------------------------------------------------
# Target: android — Omnecor HQ APK (React Native / Expo)
# ---------------------------------------------------------------------------
build_android() {
  log "Building Android APK (Omnecor HQ — React Native / Expo)..."

  local HQ_DIR="$SCRIPT_DIR/android/omnecor-hq"

  if ! command -v pnpm &>/dev/null; then
    fail "pnpm required to build Omnecor HQ — install pnpm first"
  fi

  cd "$HQ_DIR"
  pnpm install
  pnpm prebuild:android   # regenerate the (git-ignored) android/ Gradle project
  pnpm apk:release

  ok "Android APK built (Omnecor HQ):"
  echo "       $HQ_DIR/android/app/build/outputs/apk/release/app-release.apk"
  echo ""
  echo "  • Debug APK instead:         (cd $HQ_DIR && pnpm apk:debug)"
  echo "  • Build + install over USB:  (cd $HQ_DIR && pnpm apk:install)"
  echo "  • The release APK is debug-signed — sign it via Android Studio"
  echo "    (Build → Generate Signed Bundle / APK) for Play Store distribution."
}

# ---------------------------------------------------------------------------
# Target: flatpak — Flatpak bundle
# ---------------------------------------------------------------------------
build_flatpak() {
  log "Building Flatpak bundle..."
  bash "$SCRIPT_DIR/build-flatpak.sh" "$VERSION"
}

# ---------------------------------------------------------------------------
# Target: deb — Standalone .deb (raw backend, no Electron wrapper)
# ---------------------------------------------------------------------------
build_deb() {
  log "Building standalone .deb package..."
  bash "$SCRIPT_DIR/build-deb.sh" "$VERSION"
}

# ---------------------------------------------------------------------------
# Target: appimage — Standalone AppImage (raw backend, no Electron wrapper)
# ---------------------------------------------------------------------------
build_appimage() {
  log "Building standalone AppImage..."
  bash "$SCRIPT_DIR/build-appimage.sh" "$VERSION"
}

# ---------------------------------------------------------------------------
# Dispatch targets
# ---------------------------------------------------------------------------
BUILT=()
FAILED=()

for TARGET in "${TARGETS[@]}"; do
  echo "─── Target: $TARGET ───────────────────────────────────────────"
  case "$TARGET" in
    linux)   build_linux   && BUILT+=("linux")   || FAILED+=("linux") ;;
    win)     build_win     && BUILT+=("win")     || FAILED+=("win") ;;
    android) build_android && BUILT+=("android") || FAILED+=("android") ;;
    flatpak) build_flatpak && BUILT+=("flatpak") || FAILED+=("flatpak") ;;
    deb)     build_deb     && BUILT+=("deb")     || FAILED+=("deb") ;;
    appimage)build_appimage&& BUILT+=("appimage")|| FAILED+=("appimage") ;;
    *)       warn "Unknown target: $TARGET. Valid: linux win android flatpak deb appimage all" ;;
  esac
  echo ""
done

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
echo "═══════════════════════════════════════════════════════════════"
echo "  Build Summary"
echo "═══════════════════════════════════════════════════════════════"

if [ ${#BUILT[@]} -gt 0 ]; then
  ok "Succeeded: ${BUILT[*]}"
fi
if [ ${#FAILED[@]} -gt 0 ]; then
  fail "Failed:    ${FAILED[*]}"
fi

echo ""
echo "  Output artifacts in: $PROJECT_ROOT/dist/"
ls -lh "$PROJECT_ROOT/dist/" 2>/dev/null | grep -E '\.(AppImage|deb|rpm|exe|flatpak|tar\.gz)$' || true
echo "═══════════════════════════════════════════════════════════════"
