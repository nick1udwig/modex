# Docker E2E Harness

This harness packages three pieces into one container:

- `codex app-server`, listening on an internal WebSocket port.
- `modex-sidecar`, exposing filesystem browsing and transcription proxying.
- A same-origin frontend served behind a reverse proxy, so the browser talks to `/app-server` and `/sidecar` on the same host.

The setup follows the current Modex docs in the repo root and `backend/sidecar/README.md`, plus the Codex app-server docs:

- `codex app-server --listen ws://...` exposes the JSON-RPC WebSocket endpoint.
- Modex defaults its frontend to `ws(s)://<current-host>/app-server` and `ws(s)://<current-host>/sidecar`.
- The app-server reads auth/config from `~/.codex`, so the compose setup mounts the host Codex home read-only and the entrypoint copies it into a writable container home before startup.

## Usage

Build:

```bash
docker compose -f compose.e2e.yaml build
```

Run on `http://localhost:8080`:

```bash
docker compose -f compose.e2e.yaml up
```

## Important environment

- `OPENAI_API_KEY`: optional, but required for voice transcription through the sidecar.
- `MODEX_PUBLIC_ORIGIN`: set this if you expose the container through a hostname or a non-default port. It is used to derive the sidecar origin allowlist.
- `MODEX_SIDECAR_ALLOWED_ORIGINS`: optional exact override for the sidecar origin allowlist.
- `MODEX_FS_ROOTS`: optional filesystem restriction for the sidecar. Defaults to `/workspace/modex`.
- `MODEX_APP_SERVER_EXTRA_ARGS`: optional extra `codex app-server` args, for example `--enable web_search`.

## Notes

- The image contains a copy of the current Modex repo at `/workspace/modex`.
- The served frontend comes from the image-built `dist` bundle, not a live Vite dev server.
- The compose file only mounts `~/.codex` by default. If you also want SSH or git config inside the container for agent tasks, add extra bind mounts in `compose.e2e.yaml`.
