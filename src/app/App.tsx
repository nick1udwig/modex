import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { searchSummaries, searchThreadMessages } from './search';
import type { ChatRuntimeSettings } from './types';
import { useRealtimeTranscription } from './useRealtimeTranscription';
import { Composer } from '../components/Composer';
import { ConversationView } from '../components/ConversationView';
import { Icon } from '../components/Icon';
import { RuntimeSettingsSheet } from '../components/RuntimeSettingsSheet';
import { Sidebar } from '../components/Sidebar';
import { TabsBar } from '../components/TabsBar';
import { createAppServerClient } from '../services/appServerClient';
import { createSidecarFilesystemClient } from '../services/sidecarClient';
import { useModexApp } from '../state/useModexApp';

type Surface = 'chat' | 'tabs';
type DrawerPhase = 'closed' | 'opening' | 'open' | 'closing';
type TransitionOrigin = 'tab' | 'footer-action';
type SearchContext = 'chat' | 'tabs' | 'chats';
type CreateSheetOrigin = 'chat' | 'drawer' | 'tabs';

interface PaneTransition {
  active: boolean;
  chatId: string;
  direction: 'opening' | 'closing';
  origin: TransitionOrigin;
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

interface DrawerGesture {
  engaged: boolean;
  mode: 'opening' | 'closing';
  panelWidth: number;
  pointerId: number;
  startX: number;
  startY: number;
}

type SettingsSheetState =
  | {
      open: false;
    }
  | {
      mode: 'create';
      open: true;
      origin: CreateSheetOrigin;
      settings: ChatRuntimeSettings;
    }
  | {
      chatId: string;
      mode: 'edit';
      open: true;
      settings: ChatRuntimeSettings;
    };

const TABS_TRANSITION_MS = 380;
const DRAWER_TRANSITION_MS = 240;
const DRAWER_EDGE_WIDTH = 28;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const CLOSED_SETTINGS_SHEET: SettingsSheetState = { open: false };

const cloneSettings = (settings: ChatRuntimeSettings): ChatRuntimeSettings => ({
  accessMode: settings.accessMode,
  roots: [...settings.roots],
});

export const App = () => {
  const client = useMemo(() => createAppServerClient(), []);
  const filesystemClient = useMemo(() => createSidecarFilesystemClient(), []);
  const modex = useModexApp(client);
  const transcription = useRealtimeTranscription();
  const [surface, setSurface] = useState<Surface>('chat');
  const [drawerPhase, setDrawerPhase] = useState<DrawerPhase>('closed');
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [drawerProgress, setDrawerProgress] = useState(0);
  const [paneTransition, setPaneTransition] = useState<PaneTransition | null>(null);
  const [searchActive, setSearchActive] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsSheet, setSettingsSheet] = useState<SettingsSheetState>(CLOSED_SETTINGS_SHEET);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const footerActionNodeRef = useRef<HTMLButtonElement | null>(null);
  const drawerPanelRef = useRef<HTMLElement | null>(null);
  const drawerGestureRef = useRef<DrawerGesture | null>(null);
  const drawerProgressRef = useRef(0);
  const drawerTimeoutIdRef = useRef<number | null>(null);
  const tabNodeMapRef = useRef(new Map<string, HTMLButtonElement>());
  const timeoutIdsRef = useRef<number[]>([]);
  const frameIdsRef = useRef<number[]>([]);
  const activeTab = modex.openTabs.find((tab) => tab.chatId === modex.activeChatId);
  const isBusy = activeTab?.status === 'running';
  const transitionChatId = paneTransition?.chatId ?? null;
  const liveDraft =
    transcription.session?.target === 'draft' && transcription.session.chatId === modex.activeChatId
      ? transcription.composedText
      : modex.draft;
  const liveSearchQuery = transcription.session?.target === 'search' ? transcription.composedText : searchQuery;

  useEffect(() => {
    drawerProgressRef.current = drawerProgress;
  }, [drawerProgress]);

  useEffect(
    () => () => {
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      frameIdsRef.current.forEach((frameId) => window.cancelAnimationFrame(frameId));
      if (drawerTimeoutIdRef.current !== null) {
        window.clearTimeout(drawerTimeoutIdRef.current);
      }
    },
    [],
  );

  useEffect(() => () => filesystemClient.close(), [filesystemClient]);

  const scheduleTimeout = (callback: () => void, delay: number) => {
    const timeoutId = window.setTimeout(() => {
      timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
      callback();
    }, delay);
    timeoutIdsRef.current.push(timeoutId);
  };

  const scheduleFrame = (callback: () => void) => {
    const frameId = window.requestAnimationFrame(() => {
      frameIdsRef.current = frameIdsRef.current.filter((id) => id !== frameId);
      callback();
    });
    frameIdsRef.current.push(frameId);
  };

  const clearDrawerTimeout = () => {
    if (drawerTimeoutIdRef.current !== null) {
      window.clearTimeout(drawerTimeoutIdRef.current);
      drawerTimeoutIdRef.current = null;
    }
  };

  const scheduleDrawerPhase = (phase: DrawerPhase, delay: number) => {
    clearDrawerTimeout();
    drawerTimeoutIdRef.current = window.setTimeout(() => {
      drawerTimeoutIdRef.current = null;
      setDrawerPhase(phase);
      if (phase === 'closed') {
        setDrawerProgress(0);
      }
    }, delay);
  };

  const registerTabNode = (chatId: string, node: HTMLButtonElement | null) => {
    if (node) {
      tabNodeMapRef.current.set(chatId, node);
      return;
    }

    tabNodeMapRef.current.delete(chatId);
  };

  const registerFooterActionNode = (node: HTMLButtonElement | null) => {
    footerActionNodeRef.current = node;
  };

  const registerDrawerPanel = (node: HTMLElement | null) => {
    drawerPanelRef.current = node;
  };

  const getStageRect = () => stageRef.current?.getBoundingClientRect() ?? null;

  const getTransformFromRect = (
    rect: DOMRect,
    options?: {
      clampToStage?: boolean;
    },
  ): Omit<PaneTransition, 'active' | 'chatId' | 'direction' | 'origin'> | null => {
    const stageRect = getStageRect();
    if (!stageRect || stageRect.width === 0 || stageRect.height === 0) {
      return null;
    }

    return {
      x: rect.left - stageRect.left,
      y: options?.clampToStage ? clamp(rect.top - stageRect.top, 0, stageRect.height - rect.height) : rect.top - stageRect.top,
      scaleX: rect.width / stageRect.width,
      scaleY: rect.height / stageRect.height,
    };
  };

  const getTransformFromNode = (
    node: Element | null | undefined,
    options?: {
      clampToStage?: boolean;
    },
  ) => {
    if (!node) {
      return null;
    }

    return getTransformFromRect(node.getBoundingClientRect(), options);
  };

  const getDrawerPanelWidth = () => {
    const panelWidth = drawerPanelRef.current?.getBoundingClientRect().width;
    if (panelWidth && panelWidth > 0) {
      return panelWidth;
    }

    const stageWidth = getStageRect()?.width ?? 402;
    return Math.min(310, Math.max(248, stageWidth - 56));
  };

  const animateDrawerOpen = () => {
    clearDrawerTimeout();
    setDrawerDragging(false);
    setDrawerPhase('opening');

    if (drawerProgressRef.current === 0) {
      setDrawerProgress(0);
      scheduleFrame(() => {
        setDrawerProgress(1);
      });
    } else {
      setDrawerProgress(1);
    }

    scheduleDrawerPhase('open', DRAWER_TRANSITION_MS);
  };

  const animateDrawerClosed = () => {
    clearDrawerTimeout();
    setDrawerDragging(false);
    setDrawerPhase('closing');
    setDrawerProgress(0);
    scheduleDrawerPhase('closed', DRAWER_TRANSITION_MS);
  };

  const resetDrawerGesture = (mode: DrawerGesture['mode']) => {
    drawerGestureRef.current = null;
    setDrawerDragging(false);

    if (mode === 'opening' && drawerProgressRef.current === 0) {
      clearDrawerTimeout();
      setDrawerPhase('closed');
    }
  };

  const openDrawer = () => {
    if (paneTransition || drawerPhase === 'open' || drawerPhase === 'opening') {
      return;
    }

    animateDrawerOpen();
  };

  const closeDrawer = () => {
    if (drawerPhase === 'closed' || drawerPhase === 'closing') {
      return;
    }

    animateDrawerClosed();
  };

  const beginDrawerGesture = (
    event: ReactPointerEvent<HTMLElement>,
    mode: DrawerGesture['mode'],
  ) => {
    if (paneTransition) {
      return;
    }

    clearDrawerTimeout();

    if (mode === 'opening') {
      setDrawerPhase('opening');
      setDrawerProgress(0);
    }

    drawerGestureRef.current = {
      engaged: false,
      mode,
      panelWidth: getDrawerPanelWidth(),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleChatPanePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest('button, textarea, input, a')) {
      return;
    }

    if (surface !== 'chat' || drawerPhase !== 'closed' || paneTransition || event.clientX > DRAWER_EDGE_WIDTH) {
      return;
    }

    beginDrawerGesture(event, 'opening');
  };

  const handleDrawerPanelPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (drawerPhase !== 'open' || paneTransition) {
      return;
    }

    beginDrawerGesture(event, 'closing');
  };

  const handleDrawerPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = drawerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - gesture.startX;
    const dy = Math.abs(event.clientY - gesture.startY);

    if (!gesture.engaged) {
      if (Math.abs(dx) < 8 && dy < 8) {
        return;
      }

      if (Math.abs(dx) <= dy) {
        resetDrawerGesture(gesture.mode);
        return;
      }

      gesture.engaged = true;
      setDrawerDragging(true);
    }

    event.preventDefault();

    const progress =
      gesture.mode === 'opening'
        ? clamp(dx / gesture.panelWidth, 0, 1)
        : clamp(1 + dx / gesture.panelWidth, 0, 1);

    setDrawerProgress(progress);
  };

  const handleDrawerPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = drawerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const engaged = gesture.engaged;
    const mode = gesture.mode;
    drawerGestureRef.current = null;

    if (!engaged) {
      resetDrawerGesture(mode);
      return;
    }

    setDrawerDragging(false);
    if (drawerProgressRef.current > 0.5) {
      animateDrawerOpen();
      return;
    }

    animateDrawerClosed();
  };

  const runChatExpandTransition = (
    chatId: string,
    transform: Omit<PaneTransition, 'active' | 'chatId' | 'direction' | 'origin'> | null,
    origin: TransitionOrigin,
  ) => {
    setSurface('chat');

    if (!transform) {
      return;
    }

    setPaneTransition({
      ...transform,
      active: false,
      chatId,
      direction: 'closing',
      origin,
    });

    scheduleFrame(() => {
      setPaneTransition((current) => (current ? { ...current, active: true } : current));
    });

    scheduleTimeout(() => {
      setPaneTransition(null);
    }, TABS_TRANSITION_MS);
  };

  const openChat = async (chatId: string) => {
    if (paneTransition) {
      return;
    }

    commitTranscription();
    closeDrawer();
    await modex.activateChat(chatId);
    setSurface('chat');
  };

  const createChat = async (settings: ChatRuntimeSettings) => {
    if (paneTransition) {
      return null;
    }

    commitTranscription();
    closeDrawer();
    const thread = await modex.createChat(settings);
    if (thread) {
      setSurface('chat');
    }
    return thread;
  };

  const createChatFromTabs = async (settings: ChatRuntimeSettings) => {
    if (paneTransition || surface !== 'tabs') {
      return;
    }

    commitTranscription();
    const transform = getTransformFromNode(footerActionNodeRef.current, { clampToStage: true });
    const thread = await modex.createChat(settings);
    if (!thread) {
      return;
    }

    runChatExpandTransition(thread.id, transform, 'footer-action');
  };

  const openTabs = () => {
    if (surface === 'tabs' || paneTransition) {
      return;
    }

    commitTranscription();
    closeDrawer();

    const chatId = modex.activeChatId ?? modex.openTabs[0]?.chatId;
    if (!chatId) {
      setSurface('tabs');
      return;
    }

    setPaneTransition({
      active: false,
      chatId,
      direction: 'opening',
      origin: 'tab',
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
    });

    scheduleFrame(() => {
      const transform = getTransformFromNode(tabNodeMapRef.current.get(chatId));
      if (!transform) {
        setPaneTransition(null);
        setSurface('tabs');
        return;
      }

      setPaneTransition({
        ...transform,
        active: false,
        chatId,
        direction: 'opening',
        origin: 'tab',
      });

      scheduleFrame(() => {
        setPaneTransition((current) => (current ? { ...current, active: true } : current));
      });

      scheduleTimeout(() => {
        setSurface('tabs');
        setPaneTransition(null);
      }, TABS_TRANSITION_MS);
    });
  };

  const openChatFromTab = (chatId: string) => {
    if (paneTransition) {
      return;
    }

    commitTranscription();
    closeDrawer();
    void modex.activateChat(chatId);
    runChatExpandTransition(chatId, getTransformFromNode(tabNodeMapRef.current.get(chatId)), 'tab');
  };

  const seedSettings = (): ChatRuntimeSettings => {
    if (modex.activeChatSettings) {
      return cloneSettings(modex.activeChatSettings);
    }

    if (modex.activeChat?.cwd) {
      return {
        accessMode: 'workspace-write',
        roots: [modex.activeChat.cwd],
      };
    }

    return {
      accessMode: 'workspace-write',
      roots: [],
    };
  };

  const requestCreateChat = (origin: CreateSheetOrigin) => {
    commitTranscription();
    setSettingsSheet({
      mode: 'create',
      open: true,
      origin,
      settings: seedSettings(),
    });
  };

  const requestEditDirectories = () => {
    if (!modex.activeChatId) {
      return;
    }

    commitTranscription();
    setSettingsSheet({
      chatId: modex.activeChatId,
      mode: 'edit',
      open: true,
      settings: modex.activeChatSettings ? cloneSettings(modex.activeChatSettings) : seedSettings(),
    });
  };

  const applyAccessMode = (accessMode: ChatRuntimeSettings['accessMode']) => {
    if (!modex.activeChatId) {
      return;
    }

    modex.setChatSettings(modex.activeChatId, {
      accessMode,
      roots: modex.activeChatSettings?.roots ?? (modex.activeChat?.cwd ? [modex.activeChat.cwd] : []),
    });
  };

  const submitSettingsSheet = async (settings: ChatRuntimeSettings) => {
    const current = settingsSheet;
    setSettingsSheet(CLOSED_SETTINGS_SHEET);

    if (!current.open) {
      return;
    }

    if (current.mode === 'edit') {
      modex.setChatSettings(current.chatId, settings);
      return;
    }

    if (current.origin === 'tabs' && surface === 'tabs') {
      await createChatFromTabs(settings);
      return;
    }

    await createChat(settings);
  };

  const showRunningBadge = Boolean(isBusy);
  const showTabsPane = surface === 'tabs' || paneTransition !== null;
  const showChatPane = surface === 'chat' || paneTransition !== null;
  const drawerVisible = drawerPhase !== 'closed';
  const composerSurface = paneTransition ? (paneTransition.direction === 'opening' ? 'chat' : 'tabs') : surface;
  const paneStyle = paneTransition
    ? ({
        '--pane-scale-x': `${paneTransition.scaleX}`,
        '--pane-scale-y': `${paneTransition.scaleY}`,
        '--pane-x': `${paneTransition.x}px`,
        '--pane-y': `${paneTransition.y}px`,
      } as CSSProperties)
    : undefined;
  const drawerStyle = {
    '--drawer-progress': `${drawerProgress}`,
  } as CSSProperties;
  const commitTranscription = (persist = true) => {
    const activeSession = transcription.session;
    if (!activeSession) {
      return '';
    }

    const nextText = transcription.stop();
    if (!persist) {
      return nextText;
    }

    if (activeSession.target === 'search') {
      setSearchQuery(nextText);
      return nextText;
    }

    if (activeSession.chatId) {
      modex.setDraftForChat(activeSession.chatId, nextText);
    }

    return nextText;
  };
  const toggleVoiceInput = () => {
    if (transcription.active) {
      commitTranscription();
      return;
    }

    if (searchActive) {
      void transcription.start({
        baseText: liveSearchQuery,
        target: 'search',
      });
      return;
    }

    if (!modex.activeChatId) {
      return;
    }

    void transcription.start({
      baseText: modex.draft,
      chatId: modex.activeChatId,
      target: 'draft',
    });
  };

  const searchContext: SearchContext = drawerVisible ? 'chats' : surface === 'tabs' ? 'tabs' : 'chat';
  const effectiveChatSearchQuery = searchActive && searchContext === 'chat' ? liveSearchQuery : '';
  const effectiveChatsSearchQuery = searchActive && searchContext === 'chats' ? liveSearchQuery : '';
  const effectiveTabsSearchQuery = searchActive && searchContext === 'tabs' ? liveSearchQuery : '';
  const chatSearch = useMemo(
    () => searchThreadMessages(modex.activeChat, effectiveChatSearchQuery),
    [effectiveChatSearchQuery, modex.activeChat],
  );
  const chatsSearch = useMemo(
    () => searchSummaries(modex.chats, effectiveChatsSearchQuery),
    [effectiveChatsSearchQuery, modex.chats],
  );
  const tabsSearch = useMemo(
    () =>
      searchSummaries(
        modex.openTabs
          .map((tab) => modex.chats.find((chat) => chat.id === tab.chatId))
          .filter((chat): chat is NonNullable<typeof chat> => Boolean(chat)),
        effectiveTabsSearchQuery,
      ),
    [effectiveTabsSearchQuery, modex.chats, modex.openTabs],
  );

  useEffect(() => {
    if (!searchActive) {
      return;
    }

    setSearchIndex(0);
  }, [effectiveChatSearchQuery, effectiveChatsSearchQuery, effectiveTabsSearchQuery, searchActive, searchContext]);

  const visibleChats =
    effectiveChatsSearchQuery.trim().length > 0
      ? modex.chats.filter((chat) => chatsSearch.some((result) => result.chatId === chat.id))
      : modex.chats;
  const visibleTabs =
    effectiveTabsSearchQuery.trim().length > 0
      ? modex.openTabs.filter((tab) => tabsSearch.some((result) => result.chatId === tab.chatId))
      : modex.openTabs;

  useEffect(() => {
    const activeSession = transcription.session;
    if (!activeSession || activeSession.target !== 'draft' || !activeSession.chatId) {
      return;
    }

    if (activeSession.chatId === modex.activeChatId) {
      return;
    }

    commitTranscription();
  }, [modex.activeChatId, transcription.session]);

  const searchTotal =
    searchContext === 'chat'
      ? chatSearch.totalHits
      : searchContext === 'chats'
        ? chatsSearch.length
        : tabsSearch.length;
  const normalizedSearchIndex = searchTotal === 0 ? 0 : searchIndex % searchTotal;
  const activeSearchHitId =
    searchContext === 'chat' ? chatSearch.hitOrder[normalizedSearchIndex]?.anchorId ?? null : null;
  const selectedSearchChatId =
    searchContext === 'chats'
      ? chatsSearch[normalizedSearchIndex]?.chatId ?? null
      : searchContext === 'tabs'
        ? tabsSearch[normalizedSearchIndex]?.chatId ?? null
        : null;
  const searchHitLabel = searchActive ? `${searchTotal === 0 ? 0 : normalizedSearchIndex + 1}/${searchTotal}` : null;

  const stepSearch = (direction: -1 | 1) => {
    if (!searchActive || searchTotal === 0) {
      return;
    }

    setSearchIndex((current) => (current + direction + searchTotal) % searchTotal);
  };

  const recentRoots = useMemo(() => {
    const seen = new Set<string>();
    return Object.values(modex.chatSettingsByChatId)
      .flatMap((settings) => settings.roots)
      .concat(modex.activeChat?.cwd ? [modex.activeChat.cwd] : [])
      .filter((root) => {
        if (seen.has(root)) {
          return false;
        }

        seen.add(root);
        return true;
      });
  }, [modex.activeChat?.cwd, modex.chatSettingsByChatId]);

  return (
    <div className="app-shell">
      <div className="mobile-shell">
        <div className="workspace-shell">
          <main className="workspace-main">
            <div className="workspace-stage" ref={stageRef}>
              {showTabsPane ? (
                <div
                  className={`workspace-pane workspace-pane--tabs ${
                    paneTransition?.direction === 'opening'
                      ? paneTransition.active
                        ? 'workspace-pane--tabs-enter-active'
                        : 'workspace-pane--tabs-enter'
                      : ''
                  } ${
                    paneTransition?.direction === 'closing'
                      ? paneTransition.active
                        ? 'workspace-pane--tabs-exit-active'
                        : 'workspace-pane--tabs-exit'
                      : ''
                  } ${surface === 'tabs' && !paneTransition ? 'workspace-pane--tabs-active' : ''}`}
                >
                  <TabsBar
                    tabs={visibleTabs}
                    chats={modex.chats}
                    activeChatId={modex.activeChatId}
                    maskedChatId={transitionChatId}
                    onActivate={openChatFromTab}
                    onClose={modex.closeTab}
                    registerTabNode={registerTabNode}
                    searchQuery={effectiveTabsSearchQuery}
                    selectedSearchChatId={selectedSearchChatId}
                  />
                </div>
              ) : null}

              {showChatPane ? (
                <div
                  className={`workspace-pane workspace-pane--chat ${
                    paneTransition?.direction === 'opening'
                      ? paneTransition.active
                        ? 'workspace-pane--opening-tabs-active'
                        : 'workspace-pane--opening-tabs'
                      : ''
                  } ${
                    paneTransition?.direction === 'closing'
                      ? paneTransition.active
                        ? 'workspace-pane--closing-tabs-active'
                        : 'workspace-pane--closing-tabs'
                      : ''
                  }`}
                  style={paneStyle}
                  onPointerDown={handleChatPanePointerDown}
                  onPointerMove={handleDrawerPointerMove}
                  onPointerUp={handleDrawerPointerEnd}
                  onPointerCancel={handleDrawerPointerEnd}
                >
                  <header className="chat-header">
                    <div className="chat-header__left">
                      <button className="header-icon" type="button" onClick={openDrawer} aria-label="Open chats">
                        <Icon name="menu" size={18} />
                      </button>

                      <span className="chat-header__dot" aria-hidden="true" />
                      <span className="chat-header__title">Modex Auto</span>

                      {showRunningBadge ? <span className="chat-header__badge">RUNNING</span> : null}
                    </div>

                    <button className="header-icon" type="button" onClick={openTabs} aria-label="Open tabs">
                      <Icon name="panel-right-open" size={18} />
                    </button>
                  </header>

                  <ConversationView
                    activeSearchHitId={activeSearchHitId}
                    busy={Boolean(isBusy)}
                    chat={modex.activeChat}
                    loading={modex.loading}
                    searchQuery={effectiveChatSearchQuery}
                  />
                </div>
              ) : null}

              {drawerVisible ? (
                <Sidebar
                  dragging={drawerDragging}
                  phase={drawerPhase}
                  style={drawerStyle}
                  chats={visibleChats}
                  activeChatId={modex.activeChatId}
                  onClose={closeDrawer}
                  onCreateChat={() => requestCreateChat('drawer')}
                  onPanelPointerDown={handleDrawerPanelPointerDown}
                  onPointerCancel={handleDrawerPointerEnd}
                  onPointerMove={handleDrawerPointerMove}
                  onPointerUp={handleDrawerPointerEnd}
                  onSelectChat={(chatId) => void openChat(chatId)}
                  registerPanel={registerDrawerPanel}
                  searchQuery={effectiveChatsSearchQuery}
                  selectedSearchChatId={selectedSearchChatId}
                />
              ) : null}
            </div>
          </main>

          <Composer
            accessMode={modex.activeChatSettings?.accessMode ?? null}
            busy={Boolean(isBusy)}
            draft={liveDraft}
            error={transcription.error ?? modex.error}
            footerAction={composerSurface === 'tabs' ? 'new-tab' : 'tabs'}
            inputDisabled={transcription.active}
            interactionRequest={modex.activeInteraction}
            maskFooterAction={paneTransition?.origin === 'footer-action'}
            onApprovalDecision={(decision) => void modex.respondToApproval(decision)}
            onCloseSearch={() => {
              commitTranscription(false);
              setSearchActive(false);
              setSearchIndex(0);
              setSearchQuery('');
            }}
            onCreateChat={() => requestCreateChat(surface === 'tabs' ? 'tabs' : 'chat')}
            onDraftChange={modex.setDraft}
            onEditDirectories={requestEditDirectories}
            onOpenSearch={() => {
              commitTranscription();
              setSearchActive(true);
            }}
            onOpenTabs={openTabs}
            onSearchNext={() => stepSearch(1)}
            onSearchPrevious={() => stepSearch(-1)}
            onSearchQueryChange={setSearchQuery}
            onSend={() => void modex.sendMessage()}
            onStopRun={() => void modex.interruptTurn()}
            onSubmitUserInput={(answers) => void modex.submitUserInput(answers)}
            onToggleVoiceInput={toggleVoiceInput}
            onToggleAccessMode={applyAccessMode}
            openTabCount={modex.openTabs.length}
            recording={transcription.active}
            recordingStatus={transcription.session?.status ?? null}
            registerFooterActionNode={registerFooterActionNode}
            searchActive={searchActive}
            searchHitLabel={searchHitLabel}
            searchQuery={liveSearchQuery}
          />
        </div>

        <RuntimeSettingsSheet
          filesystemClient={filesystemClient}
          mode={settingsSheet.open && settingsSheet.mode === 'edit' ? 'edit' : 'create'}
          open={settingsSheet.open}
          recentRoots={recentRoots}
          settings={settingsSheet.open ? settingsSheet.settings : seedSettings()}
          onClose={() => setSettingsSheet(CLOSED_SETTINGS_SHEET)}
          onSubmit={(settings) => void submitSettingsSheet(settings)}
        />
      </div>
    </div>
  );
};
