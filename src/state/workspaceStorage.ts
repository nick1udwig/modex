interface WorkspaceSnapshot {
  activeChatId: string | null;
  draftsByChatId: Record<string, string>;
  openChatIds: string[];
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

export const loadWorkspaceSnapshot = (validChatIds: string[]) => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    const validIdSet = new Set(validChatIds);
    const openChatIds = dedupeIds(parsed.openChatIds ?? []).filter((chatId) => validIdSet.has(chatId));
    const activeChatId =
      parsed.activeChatId && validIdSet.has(parsed.activeChatId) ? parsed.activeChatId : null;

    if (activeChatId && !openChatIds.includes(activeChatId)) {
      openChatIds.unshift(activeChatId);
    }

    const draftsByChatId = Object.fromEntries(
      Object.entries(parsed.draftsByChatId ?? {}).filter(([chatId, draft]) => {
        return validIdSet.has(chatId) && typeof draft === 'string' && draft.length > 0;
      }),
    );

    return {
      activeChatId: activeChatId ?? openChatIds[0] ?? null,
      draftsByChatId,
      openChatIds,
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

export const saveWorkspaceSnapshot = ({
  activeChatId,
  draftsByChatId,
  openChatIds,
}: WorkspaceSnapshot) => {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      activeChatId,
      draftsByChatId: Object.fromEntries(
        Object.entries(draftsByChatId).filter(([, draft]) => draft.trim().length > 0),
      ),
      openChatIds,
    } satisfies WorkspaceSnapshot),
  );
};
