#!/usr/bin/env bash
# Compare copied Hypercolor wire files to pin c7157aaa1b338dd1d8545e82f639007cba945631.
# The web copies may add a 2-line header (source path + pin); that header is ignored.
set -euo pipefail

PIN="c7157aaa1b338dd1d8545e82f639007cba945631"
REPO_URL="https://github.com/BitcoinErrorLog/hypercolor.git"
LOCAL_DEFAULT="/Users/johncarvalho/work/hypercolor"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FILES=(
  src/db/sql.ts
  src/db/schema.ts
  src/db/migrations.ts
  src/types/link.ts
  src/types/group.ts
  src/types/attachment.ts
  src/types/payment.ts
  src/types/index.ts
  src/flags/config.ts
  src/services/link/wotGate.ts
  src/services/link/inboundEnvelope.ts
  src/services/payments/endpointValidation.ts
  src/services/backup/snapshot.ts
  src/services/NexusClient.ts
  src/services/group/groupEvents.ts
  src/utils/bolt11.ts
  src/utils/displaySanitize.ts
  src/utils/jsonDuplicateKeys.ts
  src/utils/onchainAddress.ts
  src/utils/pubkyId.ts
  src/stores/authStore.ts
  src/stores/contactStore.ts
)

resolve_source() {
  local candidate="${HYPERCOLOR_REPO:-$LOCAL_DEFAULT}"
  if [[ -d "${candidate}/.git" ]]; then
    local head
    head="$(git -C "${candidate}" rev-parse HEAD)"
    if [[ "${head}" == "${PIN}" ]]; then
      printf 'workdir:%s\n' "${candidate}"
      return 0
    fi
    if git -C "${candidate}" cat-file -e "${PIN}^{commit}" 2>/dev/null; then
      printf 'show:%s\n' "${candidate}"
      return 0
    fi
  fi

  local cache="${ROOT}/.cache/hypercolor-pin"
  if [[ -d "${cache}/.git" ]]; then
    if git -C "${cache}" cat-file -e "${PIN}^{commit}" 2>/dev/null; then
      git -C "${cache}" checkout --detach "${PIN}" >/dev/null
      printf 'workdir:%s\n' "${cache}"
      return 0
    fi
  fi

  mkdir -p "${ROOT}/.cache"
  rm -rf "${cache}"
  git clone --filter=blob:none --no-checkout "${REPO_URL}" "${cache}"
  git -C "${cache}" fetch --depth 1 origin "${PIN}"
  git -C "${cache}" checkout --detach FETCH_HEAD
  local cloned_head
  cloned_head="$(git -C "${cache}" rev-parse HEAD)"
  if [[ "${cloned_head}" != "${PIN}" ]]; then
    echo "cloned Hypercolor HEAD ${cloned_head} does not match pin ${PIN}" >&2
    exit 1
  fi
  printf 'workdir:%s\n' "${cache}"
}

read_source() {
  local spec="$1"
  local rel="$2"
  local mode="${spec%%:*}"
  local repo="${spec#*:}"
  case "${mode}" in
    workdir)
      cat "${repo}/${rel}"
      ;;
    show)
      git -C "${repo}" show "${PIN}:${rel}"
      ;;
    *)
      echo "unknown source mode: ${mode}" >&2
      exit 1
      ;;
  esac
}

SOURCE_SPEC="$(resolve_source)"
echo "wire-drift source: ${SOURCE_SPEC} pin ${PIN}"

failed=0
for rel in "${FILES[@]}"; do
  dest="${ROOT}/${rel}"
  if [[ ! -f "${dest}" ]]; then
    echo "MISSING copied wire file: ${rel}" >&2
    failed=1
    continue
  fi

  header1="$(sed -n '1p' "${dest}")"
  header2="$(sed -n '2p' "${dest}")"
  if [[ "${header1}" != //* ]] || [[ "${header2}" != //* ]]; then
    echo "HEADER: ${rel} must start with a 2-line // comment (source path + pin)" >&2
    failed=1
    continue
  fi
  if ! grep -q "${rel}" <<<"${header1}"; then
    echo "HEADER: ${rel} line 1 must name the source path" >&2
    failed=1
    continue
  fi
  if ! grep -q "${PIN}" <<<"${header2}"; then
    echo "HEADER: ${rel} line 2 must name pin ${PIN}" >&2
    failed=1
    continue
  fi

  src_tmp="$(mktemp)"
  dst_tmp="$(mktemp)"
  read_source "${SOURCE_SPEC}" "${rel}" >"${src_tmp}"
  tail -n +3 "${dest}" >"${dst_tmp}"
  if ! diff -u --label "hypercolor:${rel}" --label "hypercolor-web:${rel}" "${src_tmp}" "${dst_tmp}"; then
    echo "DRIFT: ${rel} differs from pin ${PIN} (ignoring 2-line header)" >&2
    failed=1
  fi
  rm -f "${src_tmp}" "${dst_tmp}"
done

if [[ "${failed}" -ne 0 ]]; then
  echo "wire-contract drift check failed against ${PIN}" >&2
  exit 1
fi

echo "wire-contract matches pin ${PIN} (${#FILES[@]} files)"
