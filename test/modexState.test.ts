import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatSummary, ChatThread } from '../src/app/types.ts';
import { defaultOpenTabs, ensureTab, setTabStatusIfOpen, setTabUnreadIfOpen, updateChatSummary } from '../src/state/modexState.ts';

test('ensureTab appends new tabs and updates existing status', () => {
  const initial = [{ chatId: 'chat-a', hasUnreadCompletion: false, status: 'idle' as const }];

  assert.deepEqual(ensureTab(initial, 'chat-b'), [
    { chatId: 'chat-a', hasUnreadCompletion: false, status: 'idle' },
    { chatId: 'chat-b', hasUnreadCompletion: false, status: 'idle' },
  ]);

  assert.deepEqual(ensureTab(initial, 'chat-a', 'running'), [{ chatId: 'chat-a', hasUnreadCompletion: false, status: 'running' }]);
});

test('setTabStatusIfOpen updates only matching tabs', () => {
  const initial = [
    { chatId: 'chat-a', hasUnreadCompletion: false, status: 'idle' as const },
    { chatId: 'chat-b', hasUnreadCompletion: false, status: 'idle' as const },
  ];

  assert.deepEqual(setTabStatusIfOpen(initial, 'chat-b', 'running'), [
    { chatId: 'chat-a', hasUnreadCompletion: false, status: 'idle' },
    { chatId: 'chat-b', hasUnreadCompletion: false, status: 'running' },
  ]);
});

test('setTabUnreadIfOpen marks completions without changing the run state', () => {
  const initial = [{ chatId: 'chat-a', hasUnreadCompletion: false, status: 'idle' as const }];

  assert.deepEqual(setTabUnreadIfOpen(initial, 'chat-a', true), [
    { chatId: 'chat-a', hasUnreadCompletion: true, status: 'idle' },
  ]);
});

test('updateChatSummary promotes and sorts updated chats', () => {
  const chats: ChatSummary[] = [
    {
      cwd: '/workspace/older',
      id: 'older',
      status: 'idle',
      title: 'Older',
      updatedAt: '2026-03-09T08:00:00.000Z',
      preview: 'Older preview',
    },
    {
      cwd: '/workspace/newer',
      id: 'newer',
      status: 'running',
      title: 'Newer',
      updatedAt: '2026-03-10T08:00:00.000Z',
      preview: 'Newer preview',
    },
  ];

  const thread: ChatThread = {
    activity: [],
    cwd: '/workspace/older',
    id: 'older',
    messages: [],
    preview: 'Latest update',
    status: 'idle',
    title: 'Older refreshed',
    tokenUsageLabel: null,
    updatedAt: '2026-03-10T09:00:00.000Z',
  };

  assert.deepEqual(updateChatSummary(chats, thread), [
    {
      cwd: '/workspace/older',
      id: 'older',
      status: 'idle',
      title: 'Older refreshed',
      updatedAt: '2026-03-10T09:00:00.000Z',
      preview: 'Latest update',
    },
    {
      cwd: '/workspace/newer',
      id: 'newer',
      status: 'running',
      title: 'Newer',
      updatedAt: '2026-03-10T08:00:00.000Z',
      preview: 'Newer preview',
    },
  ]);
});

test('defaultOpenTabs opens the first two chats for a fresh workspace', () => {
  const chats: ChatSummary[] = [
    { cwd: '/workspace/a', id: 'chat-a', title: 'A', updatedAt: '', preview: '', status: 'idle' },
    { cwd: '/workspace/b', id: 'chat-b', title: 'B', updatedAt: '', preview: '', status: 'running' },
    { cwd: '/workspace/c', id: 'chat-c', title: 'C', updatedAt: '', preview: '', status: 'idle' },
  ];

  assert.deepEqual(defaultOpenTabs(chats), [
    { chatId: 'chat-a', hasUnreadCompletion: false, status: 'idle' },
    { chatId: 'chat-b', hasUnreadCompletion: false, status: 'running' },
  ]);
});
