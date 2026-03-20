#!/usr/bin/env bash
set -euo pipefail

declare -a PIDS=()
WORKSPACE=${MODEX_WORKSPACE:-/workspace/modex}

log() {
  printf '[modex-e2e] %s\n' "$*"
}

sync_tree() {
  local source_path=$1
  local target_path=$2

  if [ ! -d "$source_path" ]; then
    return
  fi

  mkdir -p "$target_path"
  cp -a "$source_path"/. "$target_path"/
}

prepare_codex_home() {
  mkdir -p /root/.codex

  if [ -d /host-codex ]; then
    log "Syncing host Codex home into the container"
    sync_tree /host-codex /root/.codex
  fi
}

seed_node_modules() {
  if [ -d node_modules ]; then
    return
  fi

  if [ -d /opt/modex-node_modules ]; then
    log "Seeding node_modules from the image cache"
    cp -a /opt/modex-node_modules ./node_modules
    return
  fi

  log "Installing frontend dependencies"
  npm ci
}

build_frontend() {
  seed_node_modules
  log "Building frontend from ${WORKSPACE}"
  npm run build
}

build_sidecar() {
  log "Building sidecar from ${WORKSPACE}"
  (
    cd "${WORKSPACE}/backend/sidecar"
    GOCACHE=/tmp/modex-go-build go build -o /usr/local/bin/modex-sidecar-live ./cmd/modex-sidecar
  )
}

derive_sidecar_origins() {
  local public_origin=${MODEX_PUBLIC_ORIGIN:-http://localhost:8080}
  local origins=${MODEX_SIDECAR_ALLOWED_ORIGINS:-}
  local public_scheme=
  local public_hostport=
  local public_host=
  local public_port=
  local alternate_origin=

  if [ -n "$origins" ]; then
    printf '%s' "$origins"
    return
  fi

  public_scheme=${public_origin%%://*}
  public_hostport=${public_origin#*://}
  public_host=${public_hostport%%:*}
  if [ "$public_hostport" = "$public_host" ]; then
    if [ "$public_scheme" = "https" ]; then
      public_port=443
    else
      public_port=80
    fi
  else
    public_port=${public_hostport##*:}
  fi

  case "$public_host" in
    localhost)
      alternate_origin="${public_scheme}://127.0.0.1:${public_port}"
      ;;
    127.0.0.1)
      alternate_origin="${public_scheme}://localhost:${public_port}"
      ;;
    *)
      alternate_origin=
      ;;
  esac

  if [ -n "$alternate_origin" ]; then
    printf '%s,%s' "$public_origin" "$alternate_origin"
    return
  fi

  printf '%s' "$public_origin"
}

cleanup() {
  trap - EXIT INT TERM

  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  wait || true
}

start_service() {
  local name=$1
  shift

  "$@" &
  local pid=$!
  PIDS+=("$pid")
  log "Started $name (pid $pid)"
}

main() {
  trap cleanup EXIT INT TERM

  prepare_codex_home

  if [ ! -f "${WORKSPACE}/package.json" ]; then
    log "Workspace missing package.json at ${WORKSPACE}"
    exit 1
  fi

  export MODEX_FS_ROOTS=${MODEX_FS_ROOTS:-$WORKSPACE}
  export MODEX_SIDECAR_ADDR=${MODEX_SIDECAR_ADDR:-:4230}
  export MODEX_SIDECAR_ALLOWED_ORIGINS
  MODEX_SIDECAR_ALLOWED_ORIGINS=$(derive_sidecar_origins)

  if [ -z "${OPENAI_API_KEY:-}" ]; then
    log "OPENAI_API_KEY is unset; transcription will stay disabled in the sidecar"
  fi

  local listen_url=${MODEX_APP_SERVER_LISTEN:-ws://0.0.0.0:4222}
  local -a app_server_args=()
  if [ -n "${MODEX_APP_SERVER_EXTRA_ARGS:-}" ]; then
    # shellcheck disable=SC2206
    app_server_args=(${MODEX_APP_SERVER_EXTRA_ARGS})
  fi

  cd "$WORKSPACE"

  build_frontend
  build_sidecar

  start_service "codex app-server" codex app-server --listen "$listen_url" "${app_server_args[@]}"
  start_service "modex-sidecar" /usr/local/bin/modex-sidecar-live
  start_service "caddy" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile

  wait -n "${PIDS[@]}"
}

main "$@"
