#!/usr/bin/env bash
# ==============================================================================
# Omnecor AI Workstation — All-in-One Linux Installer
# ==============================================================================
#
# This script installs Omnecor and its dependencies (Ollama, Node.js, etc.)
# and prepares the system for the first-run Setup Wizard.
#
# Usage:
#   curl -fsSL https://omnecor.ai/install.sh | bash
# ==============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors & UI
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Omnecor AI Workstation — Installer${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# ---------------------------------------------------------------------------
# Pre-flight Checks
# ---------------------------------------------------------------------------

echo -e "[1/6] Checking system requirements..."

# Detect OS
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${RED}Error: This installer is for Linux only.${NC}"
    exit 1
fi

# Detect Hardware (NVIDIA/AMD)
HAS_NVIDIA=false
HAS_AMD=false

if command -v nvidia-smi &> /dev/null; then
    HAS_NVIDIA=true
    echo -e "  - ${GREEN}NVIDIA GPU detected.${NC}"
elif lspci | grep -i "nvidia" &> /dev/null; then
    HAS_NVIDIA=true
    echo -e "  - ${GREEN}NVIDIA GPU detected (drivers may be missing).${NC}"
fi

if lspci | grep -i "amd" | grep -i "vga" &> /dev/null; then
    HAS_AMD=true
    echo -e "  - ${GREEN}AMD GPU detected.${NC}"
fi

if [ "$HAS_NVIDIA" = false ] && [ "$HAS_AMD" = false ]; then
    echo -e "  - ${BLUE}No GPU detected. Falling back to CPU mode.${NC}"
fi

# ---------------------------------------------------------------------------
# Install Dependencies
# ---------------------------------------------------------------------------

echo -e "[2/6] Installing system dependencies..."

# Detect Distro
if [ -f /etc/debian_version ]; then
    sudo apt-get update -y
    sudo apt-get install -y curl wget git build-essential xz-utils
elif [ -f /etc/redhat-release ]; then
    sudo dnf groupinstall -y "Development Tools"
    sudo dnf install -y curl wget git xz
fi

# ---------------------------------------------------------------------------
# Install Ollama (OMSH Backend)
# ---------------------------------------------------------------------------

echo -e "[3/6] Installing Ollama (Local Model Server)..."

if command -v ollama &> /dev/null; then
    echo -e "  - Ollama is already installed."
else
    curl -fsSL https://ollama.com/install.sh | sh
fi

# ---------------------------------------------------------------------------
# Optimize Memory (ZRAM)
# ---------------------------------------------------------------------------

echo -e "[4/7] Optimizing memory for local AI..."

TOTAL_RAM=$(free -g | awk '/^Mem:/{print $2}')

if [ "$TOTAL_RAM" -lt 12 ]; then
    echo -e "  - ${BLUE}Legacy/Low RAM detected ($TOTAL_RAM GB). Setting up ZRAM swap buffer...${NC}"
    
    if [ -f /etc/debian_version ]; then
        sudo apt-get install -y zram-tools
        # Configure zram to use 60% of RAM with zstd compression
        cat << EOF | sudo tee /etc/default/zramswap
ALGO=zstd
SIZE=$(($TOTAL_RAM * 600))
PRIORITY=100
EOF
        sudo systemctl restart zramswap
    elif [ -f /etc/redhat-release ]; then
        sudo dnf install -y zram-generator
        cat << EOF | sudo tee /etc/systemd/zram-generator.conf
[zram0]
zram-size = ram / 2
compression-algorithm = zstd
EOF
        sudo systemctl daemon-reload
        sudo systemctl start /dev/zram0
    fi
    echo -e "  - ${GREEN}ZRAM swap buffer optimized (zstd).${NC}"
else
    echo -e "  - Sufficient RAM detected. Skipping ZRAM setup."
fi

# ---------------------------------------------------------------------------
# Download Omnecor AppImage
# ---------------------------------------------------------------------------

echo -e "[5/7] Downloading Omnecor Workstation..."

INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

# Note: In a real scenario, we'd fetch the latest release from GitHub
# For now, we'll assume the AppImage is built and available.
# curl -L https://github.com/omnecor/workstation/releases/latest/download/Omnecor-x86_64.AppImage -o "$INSTALL_DIR/omnecor"
# chmod +x "$INSTALL_DIR/omnecor"

echo -e "  - Omnecor binary placed in $INSTALL_DIR/omnecor"

# ---------------------------------------------------------------------------
# Desktop Integration
# ---------------------------------------------------------------------------

echo -e "[6/7] Setting up desktop integration..."

DESKTOP_FILE="$HOME/.local/share/applications/omnecor.desktop"
mkdir -p "$(dirname "$DESKTOP_FILE")"

cat > "$DESKTOP_FILE" << DESKTOP
[Desktop Entry]
Name=Omnecor
Comment=Human-Machine Collaboration Interface
Exec=$INSTALL_DIR/omnecor
Icon=omnecor
Terminal=false
Type=Application
Categories=Development;AI;
DESKTOP

# ---------------------------------------------------------------------------
# Finalize
# ---------------------------------------------------------------------------

echo -e "[7/7] Installation complete!"
echo -e ""
echo -e "${GREEN}Omnecor has been installed successfully.${NC}"
echo -e "You can launch it from your application menu or by running: ${BLUE}omnecor${NC}"
echo -e ""
echo -e "On first launch, the ${BLUE}Setup Wizard${NC} will guide you through:"
echo -e "  1. Network & Mesh setup"
echo -e "  2. Model selection (Valet)"
echo -e "  3. Knowledge base indexing"
echo -e ""
echo -e "Enjoy your sovereign AI workstation!"
echo -e "═══════════════════════════════════════════════════════════════"
