import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeWorkspaceSnapshot } from '../src/state/workspaceStorage.ts';

test('sanitizeWorkspaceSnapshot filters invalid chats and restores active tabs', () => {
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
    chatSettingsByChatId: {},
    openChatIds: ['chat-a', 'chat-b'],
    draftsByChatId: {
      'chat-a': 'draft a',
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
      roots: ['/workspace/a', '/workspace/shared'],
    },
  });
});
