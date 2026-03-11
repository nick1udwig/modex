import type { ChatRuntimeSettings } from '../app/types';

interface WorkspaceSnapshot {
  activeChatId: string | null;
  chatSettingsByChatId: Record<string, ChatRuntimeSettings>;
  draftsByChatId: Record<string, string>;
  openChatIds: string[];
}

interface RawWorkspaceSnapshot {
  activeChatId?: string | null;
  chatSettingsByChatId?: Record<string, unknown>;
  draftsByChatId?: Record<string, unknown>;
  openChatIds?: string[];
}

const STORAGE_KEY = 'modex.workspace.v1';

const dedupeIds = (chatIds: string[]) => {
  const seen = new Set<string>();
  return chatIds.filter((chatId) => {
    if (seen.has(chatId)) {
      return false;
    }

    seen.add(chatId);
    return true;
  });
};

const sanitizeRoots = (roots: unknown) => {
  if (!Array.isArray(roots)) {
    return [];
  }

  const seen = new Set<string>();
  return roots
    .filter((root): root is string => typeof root === 'string')
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .filter((root) => {
      if (seen.has(root)) {
        return false;
      }

      seen.add(root);
      return true;
    });
};

export const sanitizeWorkspaceSnapshot = (
  snapshot: RawWorkspaceSnapshot,
  validChatIds: string[],
): WorkspaceSnapshot => {
  const validIdSet = new Set(validChatIds);
  const openChatIds = dedupeIds(snapshot.openChatIds ?? []).filter((chatId) => validIdSet.has(chatId));
  const activeChatId =
    snapshot.activeChatId && validIdSet.has(snapshot.activeChatId) ? snapshot.activeChatId : null;

  if (activeChatId && !openChatIds.includes(activeChatId)) {
    openChatIds.unshift(activeChatId);
  }

  const draftEntries = Object.entries(snapshot.draftsByChatId ?? {}).filter(
    (entry): entry is [string, string] => {
      const [chatId, draft] = entry;
      return validIdSet.has(chatId) && typeof draft === 'string' && draft.length > 0;
    },
  );

  const draftsByChatId = Object.fromEntries(draftEntries) as Record<string, string>;
  const chatSettingsByChatId = Object.fromEntries(
    Object.entries(snapshot.chatSettingsByChatId ?? {}).flatMap(([chatId, value]) => {
      if (!validIdSet.has(chatId) || typeof value !== 'object' || value === null) {
        return [];
      }

      const accessMode =
        'accessMode' in value && (value.accessMode === 'read-only' || value.accessMode === 'workspace-write')
          ? value.accessMode
          : null;

      if (!accessMode) {
        return [];
      }

      return [
        [
          chatId,
          {
            accessMode,
            roots: sanitizeRoots('roots' in value ? value.roots : undefined),
          } satisfies ChatRuntimeSettings,
        ] satisfies [string, ChatRuntimeSettings],
      ];
    }),
  ) as Record<string, ChatRuntimeSettings>;

  return {
    activeChatId: activeChatId ?? openChatIds[0] ?? null,
    chatSettingsByChatId,
    draftsByChatId,
    openChatIds,
  };
};

export const loadWorkspaceSnapshot = (validChatIds: string[]) => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as RawWorkspaceSnapshot;
    return sanitizeWorkspaceSnapshot(parsed, validChatIds);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

export const saveWorkspaceSnapshot = ({
  activeChatId,
  chatSettingsByChatId,
  draftsByChatId,
  openChatIds,
}: WorkspaceSnapshot) => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      activeChatId,
      chatSettingsByChatId: Object.fromEntries(
        Object.entries(chatSettingsByChatId).filter(([, settings]) => settings.accessMode && settings.roots),
      ),
      draftsByChatId: Object.fromEntries(
        Object.entries(draftsByChatId).filter(([, draft]) => draft.trim().length > 0),
      ),
      openChatIds,
    } satisfies WorkspaceSnapshot),
  );
};
