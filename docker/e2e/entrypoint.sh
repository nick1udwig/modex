#!/usr/bin/env bash
set -euo pipefail

declare -a PIDS=()

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

derive_sidecar_origins() {
  local public_origin=${MODEX_PUBLIC_ORIGIN:-http://localhost:8080}
  local origins=${MODEX_SIDECAR_ALLOWED_ORIGINS:-}

  if [ -n "$origins" ]; then
    printf '%s' "$origins"
    return
  fi

  printf '%s,%s,%s' "$public_origin" 'http://localhost:8080' 'http://127.0.0.1:8080'
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

  export MODEX_FS_ROOTS=${MODEX_FS_ROOTS:-/workspace/modex}
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

  cd /workspace/modex

  start_service "codex app-server" codex app-server --listen "$listen_url" "${app_server_args[@]}"
  start_service "modex-sidecar" modex-sidecar
  start_service "caddy" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile

  wait -n "${PIDS[@]}"
}

main "$@"
