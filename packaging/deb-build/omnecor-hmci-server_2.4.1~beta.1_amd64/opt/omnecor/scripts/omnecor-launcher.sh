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
