# Modex

Modex is a mobile-first SPA/PWA client for a VPS-hosted Codex app-server. It renders real thread data over the app-server WebSocket JSON-RPC interface and keeps browser-style open tabs on top of persisted thread history.

## Stack

- Vite + React + TypeScript
- CSS-first responsive UI with no component framework
- Browser WebSocket client for `codex app-server`
- Basic PWA shell via `manifest.webmanifest` and `public/sw.js`

## Run

```bash
npm install
npm run dev
```

Environment:

```bash
VITE_CODEX_APP_SERVER_URL=ws://127.0.0.1:4222
# Optional:
# VITE_CODEX_APP_SERVER_CWD=/path/on/vps
# VITE_CODEX_APP_SERVER_MODEL=gpt-5.2-codex
# VITE_CODEX_APP_SERVER_MODEL_PROVIDER=openai
# VITE_CODEX_APP_SERVER_SANDBOX=workspace-write
# VITE_CODEX_APP_SERVER_APPROVAL_POLICY=never
# VITE_MODEX_SIDECAR_URL=ws://127.0.0.1:4230
# VITE_MODEX_SIDECAR_TOKEN=
```

Notes:

- `VITE_CODEX_APP_SERVER_URL` should be `wss://...` in production.
- The frontend defaults `VITE_CODEX_APP_SERVER_APPROVAL_POLICY` to `never` because this UI does not yet implement app-server approval prompts.
- The frontend defaults `VITE_MODEX_SIDECAR_URL` to `ws://127.0.0.1:4230`.
- For sidecar auth without rebuilding, the app also accepts `?sidecarToken=...` / `?sidecarUrl=...` query params or `localStorage` keys `modex.sidecar.token` / `modex.sidecar.url`.

Build for production:

```bash
npm run build
```

## Go Sidecar

The repo now also contains `modex-sidecar`, a Go WebSocket service for capabilities that the Codex app-server does not currently expose directly:

- Remote filesystem browsing for the directory picker.
- Server-side proxying to OpenAI Realtime transcription WebSockets.

Run it with:

```bash
cd backend/sidecar
go run ./cmd/modex-sidecar
```

Protocol and env details: [backend/sidecar/README.md](/home/nick/git/modex/backend/sidecar/README.md)

## Architecture

- [`src/app/App.tsx`](/root/git/modex/src/app/App.tsx): top-level shell wiring sidebar, tabs, and active conversation.
- [`src/state/useModexApp.ts`](/root/git/modex/src/state/useModexApp.ts): UI state and async actions for bootstrapping chats, opening/closing tabs, creating chats, and sending messages.
- [`src/state/workspaceStorage.ts`](/root/git/modex/src/state/workspaceStorage.ts): persists browser-like workspace state, including open tabs, the active chat, and unsent per-chat drafts.
- [`src/services/appServerClient.ts`](/root/git/modex/src/services/appServerClient.ts): WebSocket JSON-RPC transport for `codex app-server`, including thread list/read/start/resume and turn start/completion handling.
- [`src/components/Sidebar.tsx`](/root/git/modex/src/components/Sidebar.tsx): persistent chat list. Opening a chat from here also opens or focuses its tab.
- [`src/components/TabsBar.tsx`](/root/git/modex/src/components/TabsBar.tsx): browser-like open tab strip with running/idle indicators and close actions.
- [`src/components/ConversationView.tsx`](/root/git/modex/src/components/ConversationView.tsx): active thread renderer and composer.

## Behavior Notes

- Chats persist independently from tabs. Closing a tab does not remove the chat from the sidebar.
- Each open tab carries its own status from the app-server thread state, with active threads mapped to `running`.
- Thread history comes from `thread/list` and `thread/read`; sending a prompt uses `turn/start` directly for active threads and falls back to `thread/resume` only when the server reports the thread is unloaded.
- Open tabs, the active chat, and unsent drafts are restored after a reload so the workspace behaves more like a mobile browser session.

## Next Steps

1. Add streaming assistant text from `item/agentMessage/delta` instead of waiting for `turn/completed`.
2. Implement approval and `waitingOnUserInput` flows in the mobile UI.
3. Introduce authentication/session restoration for multiple users or workspaces.
4. Add integration tests against a live local `codex app-server`.
