import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatSummary, ChatThread } from '../src/app/types.ts';
import {
  appendLiveActivityDelta,
  defaultOpenTabs,
  deriveLiveActivity,
  ensureTab,
  mergeLiveActivity,
  mergeBootstrapThread,
  mergeThreadSummary,
  setTabStatusIfOpen,
  setTabUnreadIfOpen,
  upsertLiveActivity,
  updateChatSummary,
} from '../src/state/modexState.ts';

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

test('mergeThreadSummary refreshes cached metadata without discarding messages', () => {
  const thread: ChatThread = {
    activity: [],
    cwd: '/workspace/cached',
    id: 'chat-a',
    messages: [
      {
        content: 'Existing cached reply',
        createdAt: '2026-03-16T10:00:00.000Z',
        id: 'msg-1',
        role: 'assistant',
        turnId: 'turn-1',
      },
    ],
    preview: 'Cached preview',
    status: 'running',
    title: 'Cached title',
    tokenUsageLabel: null,
    updatedAt: '2026-03-16T10:00:00.000Z',
  };

  const summary: ChatSummary = {
    cwd: '/workspace/live',
    id: 'chat-a',
    preview: 'Fresh summary preview',
    status: 'idle',
    title: 'Fresh summary title',
    updatedAt: '2026-03-16T10:05:00.000Z',
  };

  assert.deepEqual(mergeThreadSummary(thread, summary), {
    ...thread,
    cwd: '/workspace/live',
    preview: 'Fresh summary preview',
    status: 'idle',
    title: 'Fresh summary title',
    updatedAt: '2026-03-16T10:05:00.000Z',
  });
});

test('mergeBootstrapThread preserves optimistic or streamed messages that arrived after reopen', () => {
  const hydrated: ChatThread = {
    activity: [],
    cwd: '/workspace/live',
    id: 'chat-a',
    messages: [
      {
        content: 'Earlier reply',
        createdAt: '2026-03-17T12:00:00.000Z',
        id: 'msg-1',
        role: 'assistant',
        turnId: 'turn-1',
      },
    ],
    preview: 'Earlier reply',
    status: 'idle',
    title: 'Chat A',
    tokenUsageLabel: null,
    updatedAt: '2026-03-17T12:01:00.000Z',
  };

  const current: ChatThread = {
    ...hydrated,
    activity: [],
    messages: [
      ...hydrated.messages,
      {
        content: 'Follow-up question',
        createdAt: '2026-03-17T12:01:05.000Z',
        id: 'optimistic-1',
        role: 'user',
        turnId: null,
      },
      {
        content: 'Working on it',
        createdAt: '2026-03-17T12:01:06.000Z',
        id: 'assistant-live',
        role: 'assistant',
        turnId: null,
      },
    ],
    preview: 'Working on it',
    status: 'running',
    updatedAt: '2026-03-17T12:01:00.000Z',
  };

  assert.deepEqual(mergeBootstrapThread(hydrated, current), {
    ...hydrated,
    activity: current.activity,
    messages: current.messages,
    preview: 'Working on it',
    status: 'running',
    tokenUsageLabel: null,
    updatedAt: '2026-03-17T12:01:00.000Z',
  });
});

test('mergeBootstrapThread prefers hydrated backend state when cached data is older and fully synced', () => {
  const current: ChatThread = {
    activity: [],
    cwd: '/workspace/cached',
    id: 'chat-a',
    messages: [
      {
        content: 'Old cached reply',
        createdAt: '2026-03-17T11:59:00.000Z',
        id: 'msg-old',
        role: 'assistant',
        turnId: 'turn-1',
      },
    ],
    preview: 'Old cached reply',
    status: 'running',
    title: 'Cached title',
    tokenUsageLabel: null,
    updatedAt: '2026-03-17T11:59:00.000Z',
  };

  const hydrated: ChatThread = {
    activity: [],
    cwd: '/workspace/live',
    id: 'chat-a',
    messages: [
      {
        content: 'Fresh backend reply',
        createdAt: '2026-03-17T12:02:00.000Z',
        id: 'msg-fresh',
        role: 'assistant',
        turnId: 'turn-2',
      },
    ],
    preview: 'Fresh backend reply',
    status: 'idle',
    title: 'Live title',
    tokenUsageLabel: null,
    updatedAt: '2026-03-17T12:02:00.000Z',
  };

  assert.deepEqual(mergeBootstrapThread(hydrated, current), hydrated);
});

test('deriveLiveActivity keeps only running entries for the live stack', () => {
  assert.deepEqual(
    deriveLiveActivity({
      activity: [
        {
          detail: 'Inspecting',
          id: 'entry-complete',
          kind: 'commentary',
          status: 'completed',
          summary: 'Inspecting',
          title: 'Agent update',
          turnId: 'turn-1',
        },
        {
          detail: 'Running tests',
          id: 'entry-live',
          kind: 'commentary',
          status: 'in-progress',
          summary: 'Running tests',
          title: 'Draft reply',
          turnId: 'turn-2',
        },
      ],
      status: 'running',
    }),
    [
      {
        detail: 'Running tests',
        id: 'entry-live',
        kind: 'commentary',
        status: 'in-progress',
        summary: 'Running tests',
        title: 'Draft reply',
        turnId: 'turn-2',
      },
    ],
  );
});

test('upsertLiveActivity and appendLiveActivityDelta preserve the newest live detail', () => {
  const seeded = upsertLiveActivity([], {
    detail: 'Checking the command output',
    id: 'entry-live',
    kind: 'commentary',
    status: 'in-progress',
    summary: 'Checking the command output',
    title: 'Draft reply',
    turnId: 'turn-2',
  });

  assert.deepEqual(
    appendLiveActivityDelta(seeded, {
      delta: ' before I answer.',
      entryId: 'entry-live',
      turnId: 'turn-2',
    }),
    [
      {
        detail: 'Checking the command output before I answer.',
        id: 'entry-live',
        kind: 'commentary',
        status: 'in-progress',
        summary: 'Checking the command output before I answer.',
        title: 'Draft reply',
        turnId: 'turn-2',
      },
    ],
  );
});

test('mergeLiveActivity keeps local completed cards until the backend thread settles', () => {
  assert.deepEqual(
    mergeLiveActivity(
      [
        {
          detail: 'Command: bash -lc "npm test"',
          id: 'tool-1',
          kind: 'command',
          status: 'completed',
          summary: 'bash -lc "npm test"',
          title: 'bash -lc "npm test"',
          turnId: 'turn-2',
        },
      ],
      [
        {
          detail: 'Looking at the repo',
          id: 'entry-live',
          kind: 'commentary',
          status: 'in-progress',
          summary: 'Looking at the repo',
          title: 'Draft reply',
          turnId: 'turn-2',
        },
      ],
    ),
    [
      {
        detail: 'Command: bash -lc "npm test"',
        id: 'tool-1',
        kind: 'command',
        status: 'completed',
        summary: 'bash -lc "npm test"',
        title: 'bash -lc "npm test"',
        turnId: 'turn-2',
      },
      {
        detail: 'Looking at the repo',
        id: 'entry-live',
        kind: 'commentary',
        status: 'in-progress',
        summary: 'Looking at the repo',
        title: 'Draft reply',
        turnId: 'turn-2',
      },
    ],
  );
});
