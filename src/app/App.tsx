import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { searchSummaries, searchThreadMessages } from './search';
import type { ChatRuntimeSettings, ModelOption, PendingAttachment, ReasoningEffort } from './types';
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
const DEFAULT_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
  {
    defaultReasoningEffort: 'xhigh',
    displayName: 'GPT-5.4',
    id: 'gpt-5.4',
    isDefault: true,
    supportedReasoningEfforts: DEFAULT_REASONING_EFFORTS,
  },
];

const cloneSettings = (settings: ChatRuntimeSettings): ChatRuntimeSettings => ({
  accessMode: settings.accessMode,
  model: settings.model,
  reasoningEffort: settings.reasoningEffort,
  roots: [...settings.roots],
});

const attachmentId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isTextAttachmentFile = (file: File) =>
  file.type.startsWith('text/') ||
  /\.(c|cc|cpp|cs|css|go|h|hpp|html|ini|java|js|json|kt|log|lua|m|md|php|pl|py|rb|rs|sh|sql|svg|swift|toml|ts|tsx|txt|xml|ya?ml)$/i.test(
    file.name,
  );

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}`));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });

const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Unable to read ${file.name}`));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });

const findScrollableParent = (target: EventTarget | null, boundary: HTMLElement | null) => {
  if (!(target instanceof Element)) {
    return null;
  }

  let node: Element | null = target;
  while (node && node !== boundary) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY);
      if (canScrollY && node.scrollHeight > node.clientHeight + 1) {
        return node;
      }
    }

    node = node.parentElement;
  }

  return null;
};

const playCompletionDing = () => {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) {
    return;
  }

  const context = new AudioContextConstructor();
  const now = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
  gain.connect(context.destination);

  const lead = context.createOscillator();
  lead.type = 'sine';
  lead.frequency.setValueAtTime(1_046, now);
  lead.frequency.exponentialRampToValueAtTime(1_568, now + 0.22);
  lead.connect(gain);
  lead.start(now);
  lead.stop(now + 0.28);

  const tail = context.createOscillator();
  tail.type = 'triangle';
  tail.frequency.setValueAtTime(784, now + 0.05);
  tail.frequency.exponentialRampToValueAtTime(1_174, now + 0.36);
  tail.connect(gain);
  tail.start(now + 0.05);
  tail.stop(now + 0.42);

  window.setTimeout(() => {
    void context.close().catch(() => undefined);
  }, 900);
};

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
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(FALLBACK_MODEL_OPTIONS);
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
  const previousTabSnapshotRef = useRef<Record<string, { hasUnreadCompletion: boolean; status: 'idle' | 'running' }>>({});
  const mountedRef = useRef(false);
  const activeTab = modex.openTabs.find((tab) => tab.chatId === modex.activeChatId);
  const isBusy = activeTab?.status === 'running';
  const transitionChatId = paneTransition?.chatId ?? null;
  const liveDraft =
    transcription.session?.target === 'draft' && transcription.session.chatId === modex.activeChatId
      ? transcription.composedText
      : modex.draft;
  const liveSearchQuery = transcription.session?.target === 'search' ? transcription.composedText : searchQuery;
  const defaultModel = modelOptions.find((model) => model.isDefault) ?? modelOptions[0] ?? FALLBACK_MODEL_OPTIONS[0];
  const selectedModelId = modex.activeChatSettings?.model ?? defaultModel.id;
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId) ?? defaultModel;
  const selectedReasoningEffort =
    modex.activeChatSettings?.reasoningEffort ?? selectedModel.defaultReasoningEffort ?? defaultModel.defaultReasoningEffort;

  useEffect(() => {
    drawerProgressRef.current = drawerProgress;
  }, [drawerProgress]);

  useEffect(() => {
    let cancelled = false;

    void client
      .listModels()
      .then((models) => {
        if (!cancelled && models.length > 0) {
          setModelOptions(models);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    setAttachmentError(null);
  }, [modex.activeChatId]);

  useEffect(() => {
    const previousSnapshot = previousTabSnapshotRef.current;
    const nextSnapshot = Object.fromEntries(
      modex.openTabs.map((tab) => [
        tab.chatId,
        {
          hasUnreadCompletion: tab.hasUnreadCompletion,
          status: tab.status,
        },
      ]),
    );

    if (mountedRef.current) {
      const completedTab = modex.openTabs.find((tab) => previousSnapshot[tab.chatId]?.status === 'running' && tab.status === 'idle');
      if (completedTab) {
        playCompletionDing();
      }
    } else {
      mountedRef.current = true;
    }

    previousTabSnapshotRef.current = nextSnapshot;
  }, [modex.openTabs]);

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

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    let startX = 0;
    let startY = 0;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return;
      }

      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return;
      }

      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (Math.abs(dx) > Math.abs(dy)) {
        return;
      }

      const scrollableParent = findScrollableParent(event.target, stage);
      if (!scrollableParent) {
        event.preventDefault();
        return;
      }

      const atTop = scrollableParent.scrollTop <= 0;
      const atBottom =
        scrollableParent.scrollTop + scrollableParent.clientHeight >= scrollableParent.scrollHeight - 1;

      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) {
        event.preventDefault();
      }
    };

    stage.addEventListener('touchstart', handleTouchStart, { passive: true });
    stage.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      stage.removeEventListener('touchstart', handleTouchStart);
      stage.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

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

    if ((surface !== 'chat' && surface !== 'tabs') || drawerPhase !== 'closed' || paneTransition || event.clientX > DRAWER_EDGE_WIDTH) {
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
        model: defaultModel.id,
        reasoningEffort: selectedReasoningEffort,
        roots: [modex.activeChat.cwd],
      };
    }

    return {
      accessMode: 'workspace-write',
      model: defaultModel.id,
      reasoningEffort: selectedReasoningEffort,
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
      model: modex.activeChatSettings?.model ?? defaultModel.id,
      reasoningEffort: modex.activeChatSettings?.reasoningEffort ?? selectedReasoningEffort,
      roots: modex.activeChatSettings?.roots ?? (modex.activeChat?.cwd ? [modex.activeChat.cwd] : []),
    });
  };

  const applyModelSelection = (modelId: string) => {
    if (!modex.activeChatId) {
      return;
    }

    const nextModel = modelOptions.find((model) => model.id === modelId) ?? defaultModel;
    modex.setChatSettings(modex.activeChatId, {
      accessMode: modex.activeChatSettings?.accessMode ?? 'workspace-write',
      model: nextModel.id,
      reasoningEffort: nextModel.defaultReasoningEffort ?? selectedReasoningEffort,
      roots: modex.activeChatSettings?.roots ?? (modex.activeChat?.cwd ? [modex.activeChat.cwd] : []),
    });
  };

  const applyReasoningEffort = (reasoningEffort: ReasoningEffort) => {
    if (!modex.activeChatId) {
      return;
    }

    modex.setChatSettings(modex.activeChatId, {
      accessMode: modex.activeChatSettings?.accessMode ?? 'workspace-write',
      model: modex.activeChatSettings?.model ?? defaultModel.id,
      reasoningEffort,
      roots: modex.activeChatSettings?.roots ?? (modex.activeChat?.cwd ? [modex.activeChat.cwd] : []),
    });
  };

  const handleAttachmentSelection = async (files: FileList | File[] | null) => {
    if (!modex.activeChatId || !files) {
      return;
    }

    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) {
      return;
    }

    setAttachmentError(null);
    const attachments: PendingAttachment[] = [];
    const unsupported: string[] = [];

    for (const file of selectedFiles) {
      try {
        if (file.type.startsWith('image/')) {
          attachments.push({
            id: attachmentId(),
            kind: 'image',
            mimeType: file.type || 'image/*',
            name: file.name,
            url: await readFileAsDataUrl(file),
          });
          continue;
        }

        if (isTextAttachmentFile(file)) {
          attachments.push({
            id: attachmentId(),
            kind: 'text-file',
            mimeType: file.type || 'text/plain',
            name: file.name,
            text: (await readFileAsText(file)).slice(0, 120_000),
          });
          continue;
        }

        unsupported.push(file.name);
      } catch (error) {
        unsupported.push(file.name);
        setAttachmentError(error instanceof Error ? error.message : `Unable to read ${file.name}`);
      }
    }

    if (attachments.length > 0) {
      modex.addAttachments(modex.activeChatId, attachments);
    }

    if (unsupported.length > 0) {
      setAttachmentError(`Only images and text files can be attached right now. Skipped: ${unsupported.join(', ')}`);
    }
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
                  onPointerDown={handleChatPanePointerDown}
                  onPointerMove={handleDrawerPointerMove}
                  onPointerUp={handleDrawerPointerEnd}
                  onPointerCancel={handleDrawerPointerEnd}
                >
                  <TabsBar
                    tabs={visibleTabs}
                    chats={modex.chats}
                    activeChatId={modex.activeChatId}
                    maskedChatId={transitionChatId}
                    onActivate={openChatFromTab}
                    onClose={modex.closeTab}
                    onOpenChats={openDrawer}
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

                      {showRunningBadge ? (
                        <span className="chat-header__badge">
                          <Icon name="loader" size={12} spin />
                          <span>In progress</span>
                        </span>
                      ) : null}
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
                    modelOptions={modelOptions}
                    onSelectModel={applyModelSelection}
                    onSelectReasoningEffort={applyReasoningEffort}
                    searchQuery={effectiveChatSearchQuery}
                    selectedModelId={selectedModelId}
                    selectedReasoningEffort={selectedReasoningEffort}
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
            attachments={modex.activeAttachments}
            busy={Boolean(isBusy)}
            draft={liveDraft}
            error={attachmentError ?? transcription.error ?? modex.error}
            footerAction={composerSurface === 'tabs' ? 'new-tab' : 'tabs'}
            inputDisabled={transcription.active}
            interactionRequest={modex.activeInteraction}
            maskFooterAction={paneTransition?.origin === 'footer-action'}
            onAttachFiles={(files) => void handleAttachmentSelection(files)}
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
            onRemoveAttachment={(attachmentId) => {
              if (modex.activeChatId) {
                modex.removeAttachment(modex.activeChatId, attachmentId);
              }
            }}
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
