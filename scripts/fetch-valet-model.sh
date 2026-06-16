#!/usr/bin/env bash
# fetch-valet-model.sh — Download a pre-built Valet Router GGUF from GitHub releases
#
# Usage:
#   ./scripts/fetch-valet-model.sh --tag v1.0.0 [--checksum sha256:<hex>] [--force]
#   ./scripts/fetch-valet-model.sh --tag v1.0.0 --dest packaging/models/valet-router
#
# Writes:
#   models/valet-router/<tag>/valet-router-q4_k_m.gguf
#   models/valet-router/<tag>/metadata.json
#   models/valet-router/current.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GITHUB_REPO="clarkescustomcreations/omnecorv1-beta"
GGUF_FILENAME="valet-router-q8_0.gguf"

# Default release tag + checksum for the current published artifact, so a bare
# `./scripts/fetch-valet-model.sh` downloads and verifies the right model.
# Override either with --tag / --checksum.
DEFAULT_TAG="valet-router-v2-q8"
DEFAULT_CHECKSUM="sha256:b0398f857ffb1dc6d9ae562304201c24e64ec4422cfb6b1b1391d66e21138eee"

TAG=""
CHECKSUM=""
FORCE=0
DEST="${REPO_ROOT}/models/valet-router"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)        TAG="$2";      shift 2 ;;
    --checksum)   CHECKSUM="$2"; shift 2 ;;
    --force)      FORCE=1;       shift   ;;
    --dest)       DEST="$2";     shift 2 ;;
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# //'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Fall back to the current published artifact when no tag/checksum is given.
if [[ -z "$TAG" ]]; then
  TAG="$DEFAULT_TAG"
fi
if [[ -z "$CHECKSUM" && "$TAG" == "$DEFAULT_TAG" ]]; then
  CHECKSUM="$DEFAULT_CHECKSUM"
fi

ARTIFACT_DIR="${DEST}/${TAG}"
GGUF_PATH="${ARTIFACT_DIR}/${GGUF_FILENAME}"
DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${TAG}/${GGUF_FILENAME}"

echo "[fetch-valet-model] Tag:    ${TAG}"
echo "[fetch-valet-model] Dest:   ${ARTIFACT_DIR}/"
echo "[fetch-valet-model] Source: ${DOWNLOAD_URL}"

# ── Early-exit if already downloaded ─────────────────────────────────────────
if [[ -f "${GGUF_PATH}" && "$FORCE" -eq 0 ]]; then
  echo "[fetch-valet-model] Already downloaded (use --force to re-download)."
else
  mkdir -p "${ARTIFACT_DIR}"
  echo "[fetch-valet-model] Downloading..."
  if command -v curl &>/dev/null; then
    curl -fL --progress-bar -o "${GGUF_PATH}" "${DOWNLOAD_URL}"
  elif command -v wget &>/dev/null; then
    wget -q --show-progress -O "${GGUF_PATH}" "${DOWNLOAD_URL}"
  else
    echo "Error: curl or wget required." >&2
    exit 1
  fi
  echo "[fetch-valet-model] Download complete."
fi

# ── Checksum verification ─────────────────────────────────────────────────────
if [[ -n "$CHECKSUM" ]]; then
  EXPECTED="${CHECKSUM#sha256:}"
  if command -v sha256sum &>/dev/null; then
    ACTUAL=$(sha256sum "${GGUF_PATH}" | awk '{print $1}')
  elif command -v shasum &>/dev/null; then
    ACTUAL=$(shasum -a 256 "${GGUF_PATH}" | awk '{print $1}')
  else
    echo "Warning: sha256sum/shasum not found; skipping checksum verification." >&2
    ACTUAL=""
  fi

  if [[ -n "$ACTUAL" && "$ACTUAL" != "$EXPECTED" ]]; then
    echo "[fetch-valet-model] ERROR: Checksum mismatch!" >&2
    echo "  Expected: ${EXPECTED}" >&2
    echo "  Got:      ${ACTUAL}" >&2
    rm -f "${GGUF_PATH}"
    exit 1
  fi
  [[ -n "$ACTUAL" ]] && echo "[fetch-valet-model] Checksum OK: ${ACTUAL}"
fi

# ── Write metadata.json ───────────────────────────────────────────────────────
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%Y-%m-%dT%H:%M:%SZ)"

cat > "${ARTIFACT_DIR}/metadata.json" <<EOF
{
  "base_model": "Qwen/Qwen2.5-1.5B-Instruct",
  "format": "gguf",
  "gguf_file": "${GGUF_FILENAME}",
  "source": "github-release",
  "tag": "${TAG}",
  "eval_scores": {},
  "created_at": "${CREATED_AT}"
}
EOF

# ── Write current.json ────────────────────────────────────────────────────────
mkdir -p "${DEST}"
cat > "${DEST}/current.json" <<EOF
{
  "artifact_path": "${ARTIFACT_DIR}/",
  "status": "ready",
  "base_model": "Qwen/Qwen2.5-1.5B-Instruct",
  "format": "gguf",
  "gguf_file": "${GGUF_FILENAME}",
  "source": "github-release",
  "tag": "${TAG}",
  "eval_scores": {},
  "created_at": "${CREATED_AT}"
}
EOF

echo "[fetch-valet-model] Done. Model registered at ${DEST}/current.json"
