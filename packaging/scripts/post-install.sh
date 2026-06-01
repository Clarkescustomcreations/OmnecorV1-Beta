#!/usr/bin/env bash
# ==============================================================================
# Omnecor Workstation — Post-Install Script
# ==============================================================================

set -e

# 1. Ensure /usr/local/bin is in PATH
# 2. Add current user to 'render' and 'video' groups for GPU access
if [ "$EUID" -eq 0 ]; then
    # Running as root during package install
    # We can't easily get the target user here unless we assume the one who ran sudo
    # But usually, we just set permissions on device nodes or add groups
    groupadd -f render || true
    groupadd -f video || true
fi

# 3. Setup systemd service for Ollama if not present
if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
    systemctl enable ollama || true
fi

echo "Omnecor post-installation steps completed."
