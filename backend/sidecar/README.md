# Modex Sidecar

`modex-sidecar` is a Go WebSocket service that runs next to `codex app-server`.

It provides two capabilities:

- Remote filesystem browsing/search for the frontend's directory picker.
- A realtime transcription WebSocket proxy that forwards browser audio events to OpenAI's Realtime API without exposing the API key to the browser.

## Endpoints

- `GET /healthz`
- `GET /ws/filesystem`
- `GET /ws/transcription`

## Filesystem Protocol

Connect a WebSocket client to `/ws/filesystem` and send JSON messages:

```json
{ "id": "1", "type": "fs.roots" }
{ "id": "2", "type": "fs.list", "path": "/srv", "showHidden": false, "directoriesOnly": true }
{ "id": "3", "type": "fs.stat", "path": "/srv/modex" }
{ "id": "4", "type": "fs.search", "query": "modex", "path": "/srv", "directoriesOnly": true, "maxResults": 25 }
```

Responses are correlated by `id`:

```json
{
  "id": "2",
  "type": "fs.list.result",
  "path": "/srv",
  "parent": "/",
  "roots": ["/", "/home/nick"],
  "entries": [
    {
      "name": "modex",
      "path": "/srv/modex",
      "kind": "directory",
      "directory": true,
      "selectable": true,
      "hidden": false,
      "size": 4096,
      "modTime": "2026-03-11T18:10:00Z"
    }
  ]
}
```

Error responses:

```json
{
  "id": "2",
  "type": "fs.error",
  "error": {
    "code": "forbidden",
    "message": "path is outside configured filesystem roots"
  }
}
```

## Transcription Proxy

Connect a WebSocket client to `/ws/transcription`. The sidecar will:

1. Dial OpenAI's realtime transcription backend.
2. Attach the server-side API key.
3. Optionally send a default `transcription_session.update`.
4. Proxy text/binary WebSocket frames in both directions.

That means the frontend can send the same payloads described in OpenAI's realtime transcription guide, for example:

```json
{
  "type": "input_audio_buffer.append",
  "audio": "Base64EncodedAudioData"
}
```

and it will receive OpenAI's transcription events back unchanged.

## Configuration

See [`.env.example`](/home/nick/git/modex/backend/sidecar/.env.example) for the full environment variable template.

The sidecar automatically loads `.env.local` and `.env` if present. It checks the current working directory first, then `backend/sidecar/` relative to the current working directory. Existing process environment variables still win over values from dotenv files.

## Run

```bash
cd backend/sidecar
go run ./cmd/modex-sidecar
```

## Notes

- The filesystem endpoint only supports browsing/searching the filesystem visible to the sidecar host.
- If `MODEX_FS_ROOTS` is set, all list/stat/search requests are constrained to those roots after symlink resolution.
- If `MODEX_SIDECAR_AUTH_TOKEN` is set, clients must provide it as `?token=...` or `Authorization: Bearer ...`.
- `MODEX_SIDECAR_LOG_LEVEL` defaults to `warn`. Supported values are `debug`, `info`, `warn`, and `error`.
- The transcription proxy is transport-level. It does not reinterpret OpenAI event payloads; it forwards them.
