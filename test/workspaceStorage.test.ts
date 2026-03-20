import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeWorkspaceSnapshot, saveWorkspaceSnapshot } from '../src/state/workspaceStorage.ts';

test('sanitizeWorkspaceSnapshot preserves recoverable local chats while restoring valid tabs', () => {
  const snapshot = sanitizeWorkspaceSnapshot(
    {
      activeChatId: 'chat-b',
      openChatIds: ['chat-a', 'chat-b', 'chat-a', 'missing'],
      draftsByChatId: {
        'chat-a': 'draft a',
        'chat-b': '',
        missing: 'ignore me',
      },
    },
    ['chat-a', 'chat-b'],
  );

  assert.deepEqual(snapshot, {
    activeChatId: 'chat-b',
    cachedChats: [],
    cachedThreadsByChatId: {},
    chatSettingsByChatId: {},
    openChatIds: ['chat-a', 'chat-b', 'missing'],
    draftsByChatId: {
      'chat-a': 'draft a',
      missing: 'ignore me',
    },
  });
});

test('sanitizeWorkspaceSnapshot falls back to the first valid open tab when active chat is missing', () => {
  const snapshot = sanitizeWorkspaceSnapshot(
    {
      activeChatId: 'missing',
      openChatIds: ['chat-z', 'chat-a', 'chat-b'],
      draftsByChatId: {},
    },
    ['chat-a', 'chat-b'],
  );

  assert.deepEqual(snapshot, {
    activeChatId: 'chat-a',
    cachedChats: [],
    cachedThreadsByChatId: {},
    chatSettingsByChatId: {},
    openChatIds: ['chat-a', 'chat-b'],
    draftsByChatId: {},
  });
});

test('sanitizeWorkspaceSnapshot keeps valid runtime settings per chat', () => {
  const snapshot = sanitizeWorkspaceSnapshot(
    {
      chatSettingsByChatId: {
        'chat-a': {
          accessMode: 'workspace-write',
          approvalPolicy: 'never',
          model: 'gpt-5.4',
          reasoningEffort: 'xhigh',
          roots: ['/workspace/a', '/workspace/shared', '/workspace/a'],
        },
        'chat-b': {
          accessMode: 'invalid',
          roots: ['/workspace/b'],
        },
      },
      openChatIds: ['chat-a'],
    },
    ['chat-a', 'chat-b'],
  );

  assert.deepEqual(snapshot.chatSettingsByChatId, {
    'chat-a': {
      accessMode: 'workspace-write',
      approvalPolicy: 'never',
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      roots: ['/workspace/a', '/workspace/shared'],
    },
  });
});

test('sanitizeWorkspaceSnapshot restores cached chats and hydrated threads for immediate boot', () => {
  const snapshot = sanitizeWorkspaceSnapshot(
    {
      activeChatId: 'chat-a',
      cachedChats: [
        {
          cwd: '/workspace/a',
          id: 'chat-a',
          preview: 'Cached summary',
          status: 'idle',
          title: 'Cached A',
          updatedAt: '2026-03-14T10:00:00.000Z',
        },
      ],
      cachedThreadsByChatId: {
        'chat-a': {
          activity: [
            {
              detail: 'Inspecting the failure before I change any files.',
              id: 'activity-0',
              kind: 'commentary',
              status: 'completed',
              summary: 'Inspecting the failure before I change any files.',
              title: 'Agent update',
              turnId: 'turn-1',
            },
            {
              detail: 'Command: npm test',
              id: 'activity-1',
              kind: 'command',
              status: 'completed',
              summary: 'npm test',
              title: 'npm test',
              turnId: 'turn-1',
            },
          ],
          cwd: '/workspace/a',
          id: 'chat-a',
          messages: [
            {
              content: 'Cached message',
              createdAt: '2026-03-14T10:00:00.000Z',
              id: 'msg-1',
              role: 'assistant',
              turnId: 'turn-1',
            },
          ],
          preview: 'Thread preview',
          status: 'running',
          title: 'Cached A',
          tokenUsageLabel: '1.2k tokens',
          updatedAt: '2026-03-14T10:01:00.000Z',
        },
      },
      openChatIds: ['chat-a'],
    },
    ['chat-a'],
  );

  assert.deepEqual(snapshot.cachedChats, [
    {
      cwd: '/workspace/a',
      id: 'chat-a',
      preview: 'Thread preview',
      status: 'running',
      title: 'Cached A',
      updatedAt: '2026-03-14T10:01:00.000Z',
    },
  ]);
  assert.equal(snapshot.cachedThreadsByChatId['chat-a']?.messages[0]?.content, 'Cached message');
  assert.equal(snapshot.cachedThreadsByChatId['chat-a']?.messages[0]?.turnId, 'turn-1');
  assert.equal(snapshot.cachedThreadsByChatId['chat-a']?.activity[0]?.id, 'activity-0');
  assert.equal(snapshot.cachedThreadsByChatId['chat-a']?.activity[0]?.kind, 'commentary');
});

test('sanitizeWorkspaceSnapshot preserves the active cached chat when the server list omits a new empty thread', () => {
  const snapshot = sanitizeWorkspaceSnapshot(
    {
      activeChatId: 'chat-new',
      cachedChats: [
        {
          cwd: '/workspace/new',
          id: 'chat-new',
          preview: 'Start a new request',
          status: 'idle',
          title: 'New session',
          updatedAt: '2026-03-17T09:30:00.000Z',
        },
      ],
      cachedThreadsByChatId: {
        'chat-new': {
          activity: [],
          cwd: '/workspace/new',
          id: 'chat-new',
          messages: [],
          preview: 'Start a new request',
          status: 'idle',
          title: 'New session',
          tokenUsageLabel: null,
          updatedAt: '2026-03-17T09:30:00.000Z',
        },
      },
      openChatIds: ['chat-new'],
    },
    ['chat-existing'],
  );

  assert.equal(snapshot.activeChatId, 'chat-new');
  assert.deepEqual(snapshot.openChatIds, ['chat-new']);
  assert.equal(snapshot.cachedChats[0]?.id, 'chat-new');
  assert.equal(snapshot.cachedThreadsByChatId['chat-new']?.id, 'chat-new');
});

test('saveWorkspaceSnapshot compacts persisted thread history to avoid blowing past browser storage', () => {
  const captured = new Map<string, string>();
  const previousWindow = (globalThis as { window?: unknown }).window;

  (globalThis as { window: { localStorage: { getItem: (key: string) => string | null; removeItem: (key: string) => void; setItem: (key: string, value: string) => void } } }).window = {
    localStorage: {
      getItem: (key: string) => captured.get(key) ?? null,
      removeItem: (key: string) => {
        captured.delete(key);
      },
      setItem: (key: string, value: string) => {
        captured.set(key, value);
      },
    },
  };

  try {
    saveWorkspaceSnapshot({
      activeChatId: 'chat-a',
      cachedChats: [
        {
          cwd: '/workspace/project',
          id: 'chat-a',
          preview: 'p'.repeat(8_000),
          status: 'idle',
          title: 'Very long cached chat title '.repeat(12),
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
      cachedThreadsByChatId: {
        'chat-a': {
          activity: Array.from({ length: 90 }, (_, index) => ({
            detail: `detail-${index}-`.repeat(600),
            id: `activity-${index}`,
            kind: 'commentary' as const,
            status: 'completed' as const,
            summary: `summary-${index}-`.repeat(60),
            title: `Agent update ${index}`.repeat(12),
            turnId: 'turn-1',
          })),
          cwd: '/workspace/project',
          id: 'chat-a',
          messages: Array.from({ length: 70 }, (_, index) => ({
            content: `message-${index}-`.repeat(700),
            createdAt: '2026-03-20T00:00:00.000Z',
            id: `message-${index}`,
            role: 'assistant' as const,
            turnId: 'turn-1',
          })),
          preview: 'p'.repeat(8_000),
          status: 'idle',
          title: 'Very long cached chat title '.repeat(12),
          tokenUsageLabel: '1'.repeat(200),
          updatedAt: '2026-03-20T00:00:01.000Z',
        },
      },
      chatSettingsByChatId: {
        'chat-a': {
          accessMode: 'workspace-write',
          approvalPolicy: null,
          model: null,
          reasoningEffort: null,
          roots: ['/workspace/project'],
        },
      },
      draftsByChatId: {},
      openChatIds: ['chat-a'],
    });

    const stored = JSON.parse(captured.get('modex.workspace.v1') ?? '{}') as {
      cachedChats?: Array<{ preview?: string; title?: string }>;
      cachedThreadsByChatId?: Record<
        string,
        {
          activity?: Array<{ detail?: string; summary?: string; title?: string }>;
          messages?: Array<{ content?: string }>;
          preview?: string;
          tokenUsageLabel?: string | null;
        }
      >;
    };
    const storedThread = stored.cachedThreadsByChatId?.['chat-a'];

    assert.ok(storedThread);
    assert.equal(storedThread?.messages?.length, 40);
    assert.equal(storedThread?.activity?.length, 60);
    assert.ok((storedThread?.messages?.[0]?.content?.length ?? 0) <= 4_000);
    assert.ok((storedThread?.activity?.[0]?.detail?.length ?? 0) <= 4_000);
    assert.ok((storedThread?.activity?.[0]?.summary?.length ?? 0) <= 320);
    assert.ok((storedThread?.activity?.[0]?.title?.length ?? 0) <= 120);
    assert.ok((storedThread?.preview?.length ?? 0) <= 4_000);
    assert.ok((storedThread?.tokenUsageLabel?.length ?? 0) <= 64);
    assert.ok((stored.cachedChats?.[0]?.title?.length ?? 0) <= 120);
    assert.ok((stored.cachedChats?.[0]?.preview?.length ?? 0) <= 4_000);
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});
