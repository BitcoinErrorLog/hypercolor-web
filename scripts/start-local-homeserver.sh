#!/usr/bin/env bash
# Start a local pubky-homeserver that publishes to public pkarr relays and
# advertises localhost HTTP for the WASM client. Does not print secrets.
set -euo pipefail

DATA_DIR="${HYPERCOLOR_HS_DATA_DIR:-/tmp/hypercolor-migration-homeserver}"
LOG_FILE="${HYPERCOLOR_HS_LOG:-/tmp/hypercolor-migration-homeserver/homeserver.log}"
Z32_FILE="${HYPERCOLOR_HS_Z32:-/tmp/hypercolor-migration-homeserver/z32.txt}"
CORE_DIR="${PUBKY_CORE_DIR:-/Volumes/vibedrive/vibes-dev/pubky-core}"
BIN="${CORE_DIR}/target/release/pubky-homeserver"

mkdir -p "${DATA_DIR}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLE_CONFIG="${SCRIPT_DIR}/local-homeserver.config.toml"
if [[ ! -f "${DATA_DIR}/config.toml" ]]; then
  if [[ ! -f "${SAMPLE_CONFIG}" ]]; then
    echo "ERROR: missing ${SAMPLE_CONFIG}" >&2
    exit 1
  fi
  cp "${SAMPLE_CONFIG}" "${DATA_DIR}/config.toml"
fi

if [[ ! -x "${BIN}" ]]; then
  echo "Building pubky-homeserver (release)…" >&2
  cargo build -p pubky-homeserver --release --manifest-path "${CORE_DIR}/Cargo.toml"
fi

if lsof -nP -iTCP:6286 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ERROR: port 6286 already in use" >&2
  exit 1
fi

: > "${LOG_FILE}"
"${BIN}" --data-dir "${DATA_DIR}" >"${LOG_FILE}" 2>&1 &
echo $! > "${DATA_DIR}/homeserver.pid"

for _ in $(seq 1 90); do
  if grep -q "Homeserver Pubky TLS listening on https://" "${LOG_FILE}"; then
    break
  fi
  sleep 1
done

z32="$(sed -n 's/.*Homeserver Pubky TLS listening on https:\/\/\([a-z0-9]\{52\}\).*/\1/p' "${LOG_FILE}" | head -1 || true)"
if [[ -z "${z32}" ]]; then
  echo "ERROR: homeserver started but public key was not found in ${LOG_FILE}" >&2
  exit 1
fi
printf '%s\n' "${z32}" > "${Z32_FILE}"
echo "local homeserver z32 written to ${Z32_FILE}"
echo "admin http://127.0.0.1:6288"
echo "icann http://127.0.0.1:6286"
