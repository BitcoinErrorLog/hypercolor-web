#!/usr/bin/env bash
# Compare copied Hypercolor wire files to pin a0937be84efffe2a1be08aef3cbe2f541588a4ca.
# The web copies may add a 2-line header (source path + pin); that header is ignored.
# Default oracle is vendor/hypercolor-wire-pin (committed). Override with
# HYPERCOLOR_REPO=/Users/johncarvalho/work/hypercolor for a local git checkout.
set -euo pipefail

PIN="a0937be84efffe2a1be08aef3cbe2f541588a4ca"
LOCAL_DEFAULT="/Users/johncarvalho/work/hypercolor"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DEFAULT="${ROOT}/vendor/hypercolor-wire-pin"

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

resolve_repo_path() {
  local raw="$1"
  if [[ "${raw}" == /* ]]; then
    printf '%s\n' "${raw}"
  else
    printf '%s\n' "${ROOT}/${raw}"
  fi
}

vendor_tree_ok() {
  local dir="$1"
  [[ -d "${dir}" ]] || return 1
  local rel
  for rel in "${FILES[@]}"; do
    [[ -f "${dir}/${rel}" ]] || return 1
  done
  return 0
}

resolve_git_candidate() {
  local candidate="$1"
  if [[ ! -d "${candidate}/.git" ]]; then
    return 1
  fi
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
  echo "HYPERCOLOR_REPO ${candidate} does not contain pin ${PIN}" >&2
  exit 1
}

resolve_source() {
  if [[ -n "${HYPERCOLOR_REPO:-}" ]]; then
    local candidate
    candidate="$(resolve_repo_path "${HYPERCOLOR_REPO}")"
    if [[ -d "${candidate}/.git" ]]; then
      resolve_git_candidate "${candidate}"
      return
    fi
    if vendor_tree_ok "${candidate}"; then
      printf 'workdir:%s\n' "${candidate}"
      return 0
    fi
    echo "HYPERCOLOR_REPO ${candidate} is not a pin checkout or vendor tree" >&2
    exit 1
  fi

  if vendor_tree_ok "${VENDOR_DEFAULT}"; then
    printf 'workdir:%s\n' "${VENDOR_DEFAULT}"
    return 0
  fi

  if [[ -d "${LOCAL_DEFAULT}/.git" ]]; then
    resolve_git_candidate "${LOCAL_DEFAULT}"
    return
  fi

  echo "no Hypercolor wire pin found; expected ${VENDOR_DEFAULT} (or HYPERCOLOR_REPO)" >&2
  exit 1
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
