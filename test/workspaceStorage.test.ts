import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeWorkspaceSnapshot } from '../src/state/workspaceStorage.ts';

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
