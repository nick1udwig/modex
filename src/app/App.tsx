import { useMemo } from 'react';
import { ConversationView } from '../components/ConversationView';
import { Sidebar } from '../components/Sidebar';
import { TabsBar } from '../components/TabsBar';
import { createMockAppClient } from '../services/mockAppClient';
import { useModexApp } from '../state/useModexApp';

export const App = () => {
  const client = useMemo(() => createMockAppClient(), []);
  const modex = useModexApp(client);
  const activeTab = modex.openTabs.find((tab) => tab.chatId === modex.activeChatId);

  return (
    <div className="app-shell">
      <Sidebar
        chats={modex.chats}
        activeChatId={modex.activeChatId}
        openTabs={modex.openTabs.map((tab) => tab.chatId)}
        isOpen={modex.sidebarOpen}
        loading={modex.loading}
        onClose={() => modex.setSidebarOpen(false)}
        onCreateChat={() => void modex.createChat()}
        onSelectChat={(chatId) => void modex.activateChat(chatId)}
      />

      <main className="workspace">
        <header className="topbar">
          <button
            className="topbar__menu"
            type="button"
            onClick={() => modex.setSidebarOpen(!modex.sidebarOpen)}
          >
            Chats
          </button>
          <div>
            <p className="eyebrow">VPS session shell</p>
            <h1>Codex mobile prototype</h1>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void modex.createChat()}
            disabled={modex.loading}
          >
            New
          </button>
        </header>

        <TabsBar
          tabs={modex.openTabs}
          chats={modex.chats}
          activeChatId={modex.activeChatId}
          onActivate={(chatId) => void modex.activateChat(chatId)}
          onClose={modex.closeTab}
        />

        {modex.loading ? (
          <section className="conversation conversation--empty">
            <p className="eyebrow">Loading</p>
            <h2>Preparing chats from the remote workspace stub.</h2>
          </section>
        ) : (
          <ConversationView
            chat={modex.activeChat}
            draft={modex.draft}
            busy={activeTab?.status === 'running'}
            error={modex.error}
            onDraftChange={modex.setDraft}
            onSend={() => void modex.sendMessage()}
          />
        )}
      </main>
    </div>
  );
};
