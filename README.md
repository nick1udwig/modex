# Modex

Modex is a mobile-first SPA/PWA prototype for a Codex-style chat client that will eventually talk to a VPS-hosted app-server. This first increment ships a working shell with persistent chats, browser-like open tabs, and a mocked remote client boundary.

## Stack

- Vite + React + TypeScript
- CSS-first responsive UI with no component framework
- Local mock `RemoteAppClient` stored in `localStorage`
- Basic PWA shell via `manifest.webmanifest` and `public/sw.js`

## Run

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Architecture

- [`src/app/App.tsx`](/root/git/modex/src/app/App.tsx): top-level shell wiring sidebar, tabs, and active conversation.
- [`src/state/useModexApp.ts`](/root/git/modex/src/state/useModexApp.ts): UI state and async actions for bootstrapping chats, opening/closing tabs, creating chats, and sending messages.
- [`src/state/workspaceStorage.ts`](/root/git/modex/src/state/workspaceStorage.ts): persists browser-like workspace state, including open tabs, the active chat, and unsent per-chat drafts.
- [`src/services/mockAppClient.ts`](/root/git/modex/src/services/mockAppClient.ts): clear API boundary for the future VPS transport. Replace this module with a real implementation without rewriting UI components.
- [`src/components/Sidebar.tsx`](/root/git/modex/src/components/Sidebar.tsx): persistent chat list. Opening a chat from here also opens or focuses its tab.
- [`src/components/TabsBar.tsx`](/root/git/modex/src/components/TabsBar.tsx): browser-like open tab strip with running/idle indicators and close actions.
- [`src/components/ConversationView.tsx`](/root/git/modex/src/components/ConversationView.tsx): active thread renderer and composer.

## Behavior Notes

- Chats persist independently from tabs. Closing a tab does not remove the chat from the sidebar.
- Each open tab carries its own status pill: pulsing green for `running`, muted for `idle`.
- The mock client simulates remote latency and stores seeded conversations plus new chat state in browser storage.
- Open tabs, the active chat, and unsent drafts are restored after a reload so the workspace behaves more like a mobile browser session.

## Next Steps

1. Swap in a real VPS transport that implements `RemoteAppClient`.
2. Add streaming responses and optimistic partial output per tab.
3. Introduce authentication/session restoration for multiple users or workspaces.
4. Add integration tests for chat lifecycle and tab-state transitions.
