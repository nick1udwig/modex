import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AppServerClient,
  buildCommandApprovalRequest,
  buildInitializeParams,
  collectThreadIdsToRefresh,
  findActiveTurnId,
  flattenUserInputs,
  isAppServerConnectionClosedError,
  isAppServerTurnWaitTimeoutError,
  latestTurnFailure,
  mapThread,
  mapThreadSummary,
  shouldResumeAfterTurnStartError,
} from '../src/services/appServerClient.ts';

const makeRawThread = (
  overrides: Partial<{
    id: string;
    preview: string;
    status: { type: 'notLoaded' | 'idle' | 'systemError' } | { activeFlags?: Array<'waitingOnApproval' | 'waitingOnUserInput'>; type: 'active' };
    turns: Array<{
      error?: { message: string } | null;
      id: string;
      items: Array<Record<string, unknown> & {
        id: string;
        type: string;
      }>;
      status: 'completed' | 'failed' | 'inProgress' | 'interrupted';
    }>;
  }> = {},
) => ({
  createdAt: 1_710_000_000,
  cwd: '/workspace/project',
  id: overrides.id ?? 'thr_test',
  modelProvider: 'openai',
  name: null,
  preview: overrides.preview ?? 'Preview',
  status: overrides.status ?? { type: 'idle' as const },
  turns: overrides.turns ?? [],
  updatedAt: 1_710_000_120,
});

test('buildInitializeParams opts into experimental API features', () => {
  assert.equal(buildInitializeParams().capabilities.experimentalApi, true);
});

test('collectThreadIdsToRefresh unions cached running sources without duplicates', () => {
  assert.deepEqual(
    collectThreadIdsToRefresh(
      ['chat-running-turn', 'chat-shared'],
      [
        {
          cwd: '/workspace/summary',
          id: 'chat-summary',
          preview: 'Running summary',
          status: 'running' as const,
          title: 'Summary',
          updatedAt: '2026-03-17T00:00:00.000Z',
        },
        {
          cwd: '/workspace/shared',
          id: 'chat-shared',
          preview: 'Shared summary',
          status: 'running' as const,
          title: 'Shared',
          updatedAt: '2026-03-17T00:00:01.000Z',
        },
        {
          cwd: '/workspace/idle',
          id: 'chat-idle',
          preview: 'Idle summary',
          status: 'idle' as const,
          title: 'Idle',
          updatedAt: '2026-03-17T00:00:02.000Z',
        },
      ],
      [
        {
          cwd: '/workspace/thread',
          id: 'chat-thread',
          messages: [],
          preview: 'Running thread',
          status: 'running' as const,
          title: 'Thread',
          updatedAt: '2026-03-17T00:00:03.000Z',
        },
        {
          cwd: '/workspace/summary',
          id: 'chat-summary',
          messages: [],
          preview: 'Running summary',
          status: 'running' as const,
          title: 'Summary',
          updatedAt: '2026-03-17T00:00:00.000Z',
        },
        {
          cwd: '/workspace/idle',
          id: 'chat-idle-thread',
          messages: [],
          preview: 'Idle thread',
          status: 'idle' as const,
          title: 'Idle thread',
          updatedAt: '2026-03-17T00:00:04.000Z',
        },
      ],
    ),
    ['chat-running-turn', 'chat-shared', 'chat-summary', 'chat-thread'],
  );
});

test('collectThreadIdsToRefresh rehydrates stale cached threads when summary metadata or local placeholders differ', () => {
  assert.deepEqual(
    collectThreadIdsToRefresh(
      [],
      [
        {
          cwd: '/workspace/chat-a',
          id: 'chat-a',
          preview: 'Final backend reply',
          status: 'idle' as const,
          title: 'Chat A',
          updatedAt: '2026-03-17T00:05:00.000Z',
        },
        {
          cwd: '/workspace/chat-b',
          id: 'chat-b',
          preview: 'Still idle',
          status: 'idle' as const,
          title: 'Chat B',
          updatedAt: '2026-03-17T00:05:00.000Z',
        },
      ],
      [
        {
          cwd: '/workspace/chat-a',
          id: 'chat-a',
          messages: [],
          preview: 'Partial streamed reply',
          status: 'idle' as const,
          title: 'Chat A',
          updatedAt: '2026-03-17T00:04:00.000Z',
        },
        {
          cwd: '/workspace/chat-b',
          id: 'chat-b',
          messages: [
            {
              content: 'Still sending locally',
              createdAt: '2026-03-17T00:05:00.000Z',
              id: 'optimistic-1',
              role: 'user' as const,
              turnId: null,
            },
          ],
          preview: 'Still idle',
          status: 'idle' as const,
          title: 'Chat B',
          updatedAt: '2026-03-17T00:05:00.000Z',
        },
      ],
    ),
    ['chat-a', 'chat-b'],
  );
});

test('findActiveTurnId prefers the most recent in-progress turn', () => {
  assert.equal(
    findActiveTurnId(
      makeRawThread({
        turns: [
          { id: 'turn-complete', items: [], status: 'completed' },
          { id: 'turn-old-active', items: [], status: 'inProgress' },
          { id: 'turn-new-active', items: [], status: 'inProgress' },
        ],
      }),
    ),
    'turn-new-active',
  );
});

test('latestTurnFailure only reports the latest failed turn', () => {
  assert.deepEqual(
    latestTurnFailure(
      makeRawThread({
        turns: [
          { id: 'turn-old-failed', items: [], status: 'failed', error: { message: 'Old failure' } },
          { id: 'turn-latest-failed', items: [], status: 'failed', error: { message: 'Latest failure' } },
        ],
      }),
    ),
    { message: 'Latest failure', turnId: 'turn-latest-failed' },
  );

  assert.equal(
    latestTurnFailure(
      makeRawThread({
        turns: [
          { id: 'turn-failed', items: [], status: 'failed', error: { message: 'Old failure' } },
          { id: 'turn-complete', items: [], status: 'completed' },
        ],
      }),
    ),
    null,
  );
});

test('buildCommandApprovalRequest preserves available decisions and proposed amendments', () => {
  assert.deepEqual(
    buildCommandApprovalRequest(42, {
      additionalPermissions: {
        fileSystem: {
          write: ['/workspace'],
        },
      },
      availableDecisions: ['accept', 'acceptForSession', { acceptWithExecpolicyAmendment: {} }, 'decline', 'cancel'],
      command: 'npm test',
      cwd: '/workspace',
      itemId: 'item-1',
      proposedExecpolicyAmendment: ['npm', 'test'],
      reason: 'Run the project test suite.',
      threadId: 'chat-1',
      turnId: 'turn-1',
    }),
    {
      allowCancelDecision: true,
      allowDeclineDecision: true,
      allowSessionDecision: true,
      chatId: 'chat-1',
      detailLines: ['Command: npm test', 'Directory: /workspace', 'Writable roots: /workspace'],
      execPolicyAmendment: ['npm', 'test'],
      kind: 'approval',
      message: 'Run the project test suite.',
      requestId: 42,
      title: 'Command approval',
      turnId: 'turn-1',
    },
  );
});

test('flattenUserInputs preserves text and labels non-text inputs', () => {
  assert.equal(
    flattenUserInputs([
      { type: 'text', text: 'Inspect the repository' },
      { type: 'mention', name: 'filesystem', path: 'app://fs' },
      { type: 'localImage', path: '/tmp/screenshot.png' },
    ]),
    ['Inspect the repository', '@filesystem', '[Local image] /tmp/screenshot.png'].join('\n'),
  );
});

test('mapThreadSummary prefers explicit thread names and running status', () => {
  assert.deepEqual(
    mapThreadSummary({
      createdAt: 1_710_000_000,
      cwd: '/workspace/project',
      id: 'thr_123',
      modelProvider: 'openai',
      name: 'Release prep',
      preview: 'Prepare release notes',
      status: { type: 'active', activeFlags: [] },
      turns: [],
      updatedAt: 1_710_000_120,
    }),
    {
      cwd: '/workspace/project',
      id: 'thr_123',
      preview: 'Prepare release notes',
      status: 'running',
      title: 'Release prep',
      updatedAt: new Date(1_710_000_120 * 1000).toISOString(),
    },
  );
});

test('mapThreadSummary uses the latest visible message for preview', () => {
  assert.equal(
    mapThreadSummary({
      createdAt: 1_710_000_000,
      cwd: '/workspace/project',
      id: 'thr_preview',
      modelProvider: 'openai',
      name: null,
      preview: 'Raw server preview blob',
      status: { type: 'idle' },
      turns: [
        {
          id: 'turn-1',
          items: [
            {
              content: [{ type: 'text', text: 'Ship the patch' }],
              id: 'item-user',
              type: 'userMessage',
            },
            {
              id: 'item-commentary',
              phase: 'commentary',
              text: 'Running tests before I answer.',
              type: 'agentMessage',
            },
            {
              id: 'item-final',
              phase: 'final_answer',
              text: 'Tests passed and the patch is ready.',
              type: 'agentMessage',
            },
          ],
          status: 'completed',
        },
      ],
      updatedAt: 1_710_000_120,
    }).preview,
    'Tests passed and the patch is ready.',
  );
});

test('mapThread flattens turn history into chat messages', () => {
  const thread = mapThread({
    createdAt: 1_710_000_000,
    cwd: '/workspace/project',
    id: 'thr_456',
    modelProvider: 'openai',
    name: null,
    preview: '',
    status: { type: 'idle' },
    turns: [
      {
        id: 'turn-1',
        items: [
          {
            content: [{ type: 'text', text: 'Explain the deployment error' }],
            id: 'item-user',
            type: 'userMessage',
          },
          {
            id: 'item-commentary',
            phase: 'commentary',
            text: 'Inspecting the repository before I answer.',
            type: 'agentMessage',
          },
          {
            id: 'item-assistant',
            phase: 'final_answer',
            text: 'The service is missing its runtime env vars.',
            type: 'agentMessage',
          },
        ],
        status: 'completed',
      },
    ],
    updatedAt: 1_710_000_120,
  });

  assert.equal(thread.title, 'Explain the deployment error');
  assert.equal(thread.cwd, '/workspace/project');
  assert.equal(thread.preview, 'The service is missing its runtime env vars.');
  assert.deepEqual(
    thread.messages.map((message) => ({
      content: message.content,
      role: message.role,
      turnId: message.turnId,
    })),
    [
      { content: 'Explain the deployment error', role: 'user', turnId: 'turn-1' },
      { content: 'The service is missing its runtime env vars.', role: 'assistant', turnId: 'turn-1' },
    ],
  );
});

test('mapThread exposes in-progress activity items as transient assistant updates', () => {
  const thread = mapThread({
    createdAt: 1_710_000_000,
    cwd: '/workspace/project',
    id: 'thr_progress',
    modelProvider: 'openai',
    name: null,
    preview: '',
    status: { type: 'active', activeFlags: [] },
    turns: [
      {
        id: 'turn-progress',
        items: [
          {
            content: [{ type: 'text', text: 'Check the follow-up behavior' }],
            id: 'item-user',
            type: 'userMessage',
          },
          {
            id: 'commentary-1',
            phase: 'commentary',
            text: 'Reading the live thread data now.',
            type: 'agentMessage',
          },
          {
            command: 'npm test',
            cwd: '/workspace/project',
            id: 'command-1',
            status: 'inProgress',
            type: 'commandExecution',
          },
        ],
        status: 'inProgress',
      },
    ],
    updatedAt: 1_710_000_120,
  });

  assert.deepEqual(
    thread.messages.map((message) => message.content),
    [
      'Check the follow-up behavior',
      'Reading the live thread data now.',
      'Running command: npm test\nCommand: npm test\nDirectory: /workspace/project',
    ],
  );
  assert.deepEqual(
    thread.activity.map((entry) => entry.status),
    ['in-progress', 'in-progress'],
  );
});

test('mapThread preserves non-message activity for later inspection', () => {
  const thread = mapThread({
    createdAt: 1_710_000_000,
    cwd: '/workspace/project',
    id: 'thr_activity',
    modelProvider: 'openai',
    name: null,
    preview: '',
    status: { type: 'idle' },
    turns: [
      {
        id: 'turn-activity',
        items: [
          {
            id: 'commentary-1',
            phase: 'commentary',
            text: 'I am checking the failing snapshot before I patch it.',
            type: 'agentMessage',
          },
          {
            id: 'plan-1',
            text: '1. Inspect the logs\\n2. Patch the config',
            type: 'plan',
          },
          {
            content: ['Root cause is a missing API key.'],
            id: 'reasoning-1',
            summary: ['Diagnosing the production failure'],
            type: 'reasoning',
          },
          {
            aggregatedOutput: 'ok',
            command: 'npm test',
            cwd: '/workspace/project',
            exitCode: 0,
            id: 'command-1',
            status: 'completed',
            type: 'commandExecution',
          },
          {
            changes: [
              {
                diff: '@@ -1 +1 @@',
                kind: 'modified',
                path: 'src/config.ts',
              },
            ],
            id: 'patch-1',
            status: 'completed',
            type: 'fileChange',
          },
        ],
        status: 'completed',
      },
    ],
    updatedAt: 1_710_000_120,
  });

  assert.deepEqual(
    thread.activity.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      status: entry.status,
      title: entry.title,
      turnId: entry.turnId,
    })),
    [
      { id: 'commentary-1', kind: 'commentary', status: 'completed', title: 'Agent update', turnId: 'turn-activity' },
      { id: 'plan-1', kind: 'plan', status: 'completed', title: 'Plan', turnId: 'turn-activity' },
      { id: 'reasoning-1', kind: 'reasoning', status: 'completed', title: 'Reasoning', turnId: 'turn-activity' },
      { id: 'command-1', kind: 'command', status: 'completed', title: 'npm test', turnId: 'turn-activity' },
      { id: 'patch-1', kind: 'file-change', status: 'completed', title: 'src/config.ts', turnId: 'turn-activity' },
    ],
  );
});

test('shouldResumeAfterTurnStartError only retries unloaded threads', () => {
  assert.equal(shouldResumeAfterTurnStartError(new Error('thread not found: thr_123')), true);
  assert.equal(shouldResumeAfterTurnStartError(new Error('no rollout found for thread id thr_123')), false);
  assert.equal(shouldResumeAfterTurnStartError(new Error('Timed out waiting for the app-server to finish the turn')), false);
});

test('isAppServerConnectionClosedError only matches established websocket disconnects', () => {
  assert.equal(isAppServerConnectionClosedError(new Error('App-server connection closed: ws://localhost:4222')), true);
  assert.equal(isAppServerConnectionClosedError(new Error('Unable to connect to app-server at ws://localhost:4222')), false);
  assert.equal(isAppServerConnectionClosedError(new Error('The app-server turn failed')), false);
});

test('isAppServerTurnWaitTimeoutError only matches turn wait timeouts', () => {
  assert.equal(isAppServerTurnWaitTimeoutError(new Error('Timed out waiting for the app-server to finish the turn')), true);
  assert.equal(isAppServerTurnWaitTimeoutError(new Error('App-server connection closed: ws://localhost:4222')), false);
  assert.equal(isAppServerTurnWaitTimeoutError(new Error('The app-server turn failed')), false);
});

test('interruptTurn reads the thread to recover a missing active turn id', async () => {
  const client = new AppServerClient({ url: 'ws://localhost:4222' });
  const requests: Array<{ method: string; params: unknown }> = [];

  (client as any).ensureConnection = async () => ({
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    },
  });

  (client as any).readRawThread = async () =>
    makeRawThread({
      id: 'chat-1',
      status: { type: 'active', activeFlags: [] },
      turns: [
        { id: 'turn-complete', items: [], status: 'completed' },
        { id: 'turn-active', items: [], status: 'inProgress' },
      ],
    });

  await client.interruptTurn('chat-1');

  assert.deepEqual(requests, [
    {
      method: 'turn/interrupt',
      params: {
        threadId: 'chat-1',
        turnId: 'turn-active',
      },
    },
  ]);
});

test('interruptTurn reconciles an already-idle thread and surfaces the recovered failure', async () => {
  const client = new AppServerClient({ url: 'ws://localhost:4222' });
  const requests: Array<{ method: string; params: unknown }> = [];
  const events: Array<Record<string, unknown>> = [];

  (client as any).emit = (event: Record<string, unknown>) => {
    events.push(event);
  };

  (client as any).ensureConnection = async () => ({
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    },
  });

  (client as any).readRawThread = async () =>
    makeRawThread({
      id: 'chat-2',
      status: { type: 'idle' },
      turns: [
        { id: 'turn-failed', items: [], status: 'failed', error: { message: 'The backend command timed out.' } },
      ],
    });

  await client.interruptTurn('chat-2');

  assert.deepEqual(requests, []);
  assert.equal((client as any).runningTurnIds.has('chat-2'), false);
  assert.ok(events.some((event) => event.type === 'thread'));
  assert.ok(
    events.some((event) => event.type === 'error' && event.message === 'The backend command timed out.'),
  );
});

test('foreground resume forces a reconnect when a running thread may be stale', () => {
  const client = new AppServerClient({ url: 'ws://localhost:4222' });
  let restarted = 0;
  let nudged = 0;

  (client as any).connection = {
    close: () => undefined,
  };
  (client as any).summaryCache.set('chat-1', {
    cwd: '/workspace/project',
    id: 'chat-1',
    preview: 'Running',
    status: 'running',
    title: 'Chat 1',
    updatedAt: '2026-03-17T00:00:00.000Z',
  });
  (client as any).restartConnection = () => {
    restarted += 1;
  };
  (client as any).nudgeReconnect = () => {
    nudged += 1;
  };

  (client as any).handleForegroundResume();

  assert.equal(restarted, 1);
  assert.equal(nudged, 0);
});

test('foreground resume restarts an existing connection after the app was backgrounded', () => {
  const client = new AppServerClient({ url: 'ws://localhost:4222' });
  let restarted = 0;
  let nudged = 0;

  (client as any).connection = {
    close: () => undefined,
  };
  (client as any).restartConnection = () => {
    restarted += 1;
  };
  (client as any).nudgeReconnect = () => {
    nudged += 1;
  };

  (client as any).handleForegroundResume(true);

  assert.equal(restarted, 1);
  assert.equal(nudged, 0);
});

test('sendMessage waits for completed turn output to materialize before returning the thread', async () => {
  const client = new AppServerClient({ url: 'ws://localhost:4222' });
  let readCount = 0;

  (client as any).ensureConnection = async () => ({
    request: async (method: string) => {
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-followup',
            items: [],
            status: 'inProgress',
          },
        };
      }

      throw new Error(`Unexpected request: ${method}`);
    },
    waitForTurnCompletion: async () => undefined,
  });

  (client as any).readRawThread = async () => {
    readCount += 1;

    if (readCount === 1) {
      return makeRawThread({
        id: 'chat-followup',
        status: { type: 'idle' },
        turns: [
          {
            id: 'turn-followup',
            items: [
              {
                content: [{ type: 'text', text: 'Follow up' }],
                id: 'user-followup',
                type: 'userMessage',
              },
            ],
            status: 'completed',
          },
        ],
      });
    }

    return makeRawThread({
      id: 'chat-followup',
      preview: 'Here is the follow-up reply.',
      status: { type: 'idle' },
      turns: [
        {
          id: 'turn-followup',
          items: [
            {
              content: [{ type: 'text', text: 'Follow up' }],
              id: 'user-followup',
              type: 'userMessage',
            },
            {
              id: 'assistant-followup',
              phase: 'final_answer',
              text: 'Here is the follow-up reply.',
              type: 'agentMessage',
            },
          ],
          status: 'completed',
        },
      ],
    });
  };

  const thread = await client.sendMessage({
    attachments: [],
    chatId: 'chat-followup',
    content: 'Follow up',
    settings: {
      accessMode: 'workspace-write',
      model: null,
      reasoningEffort: null,
      roots: ['/workspace/project'],
    },
  });

  assert.equal(readCount, 2);
  assert.equal(thread.messages[thread.messages.length - 1]?.content, 'Here is the follow-up reply.');
});
