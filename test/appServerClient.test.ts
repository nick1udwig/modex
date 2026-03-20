import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AppServerClient,
  buildCommandApprovalRequest,
  buildInitializeParams,
  collectThreadIdsToRefresh,
  findActiveTurnId,
  flattenUserInputs,
  isAppServerThreadNotFoundError,
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
      { type: 'image', url: 'data:image/jpeg;base64,AAAA' },
      { type: 'mention', name: 'filesystem', path: 'app://fs' },
      { type: 'localImage', path: '/tmp/screenshot.png' },
    ]),
    ['Inspect the repository', '[Image] Uploaded photo', '@filesystem', '[Local image] /tmp/screenshot.png'].join('\n'),
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

test('mapThread keeps in-progress activity in the activity stack instead of the message history', () => {
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
    ['Check the follow-up behavior'],
  );
  assert.deepEqual(
    thread.activity.map((entry) => ({
      status: entry.status,
      summary: entry.summary,
      title: entry.title,
    })),
    [
      { status: 'in-progress', summary: 'Reading the live thread data now.', title: 'Agent update' },
      { status: 'in-progress', summary: 'npm test', title: 'npm test' },
    ],
  );
});

test('mapThread exposes in-progress assistant replies in activity so the live stack can render them', () => {
  const thread = mapThread({
    createdAt: 1_710_000_000,
    cwd: '/workspace/project',
    id: 'thr_live_reply',
    modelProvider: 'openai',
    name: null,
    preview: '',
    status: { type: 'active', activeFlags: [] },
    turns: [
      {
        id: 'turn-progress',
        items: [
          {
            content: [{ type: 'text', text: 'Summarize the repo' }],
            id: 'item-user',
            type: 'userMessage',
          },
          {
            id: 'reply-1',
            phase: 'final_answer',
            text: 'I am reading the repository structure now.',
            type: 'agentMessage',
          },
        ],
        status: 'inProgress',
      },
    ],
    updatedAt: 1_710_000_120,
  });

  assert.deepEqual(thread.messages.map((message) => message.content), ['Summarize the repo']);
  assert.deepEqual(
    thread.activity.map((entry) => ({
      detail: entry.detail,
      status: entry.status,
      title: entry.title,
    })),
    [
      {
        detail: 'I am reading the repository structure now.',
        status: 'in-progress',
        title: 'Draft reply',
      },
    ],
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

test('mapThread normalizes structured file-change payloads from app-server', () => {
  const thread = mapThread({
    createdAt: 1_710_000_000,
    cwd: '/workspace/project',
    id: 'thr_file_change_structured',
    modelProvider: 'openai',
    name: null,
    preview: '',
    status: { type: 'idle' },
    turns: [
      {
        id: 'turn-file-change',
        items: [
          {
            changes: [
              {
                diff: '@@ -1 +1 @@',
                kind: {
                  move_path: null,
                  type: 'update',
                },
                path: '/workspace/project/src/config.ts',
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

  assert.deepEqual(thread.messages, []);
  assert.deepEqual(
    thread.activity.map((entry) => ({
      detail: entry.detail,
      kind: entry.kind,
      summary: entry.summary,
      title: entry.title,
    })),
    [
      {
        detail: 'updated: /workspace/project/src/config.ts\n@@ -1 +1 @@',
        kind: 'file-change',
        summary: '/workspace/project/src/config.ts',
        title: '/workspace/project/src/config.ts',
      },
    ],
  );
});

test('mapThread normalizes structured text payloads from app-server items', () => {
  const thread = mapThread({
    createdAt: 1_710_000_000,
    cwd: '/workspace/project',
    id: 'thr_structured_text',
    modelProvider: 'openai',
    name: null,
    preview: '',
    status: { type: 'idle' },
    turns: [
      {
        id: 'turn-structured',
        items: [
          {
            content: [{ type: 'text', text: { text: 'Explain the `deploy` failure' } }],
            id: 'item-user',
            type: 'userMessage',
          },
          {
            content: [{ text: 'Found the missing env var.' }],
            id: 'reasoning-1',
            summary: [{ type: 'summary_text', text: '**Checking logs**' }],
            type: 'reasoning',
          },
          {
            id: 'item-assistant',
            phase: 'final_answer',
            text: { type: 'output_text', text: 'The `API_KEY` env var is missing.' },
            type: 'agentMessage',
          },
        ],
        status: 'completed',
      },
    ],
    updatedAt: 1_710_000_120,
  });

  assert.deepEqual(
    thread.messages.map((message) => message.content),
    ['Explain the `deploy` failure', 'The `API_KEY` env var is missing.'],
  );
  assert.deepEqual(
    thread.activity.map((entry) => ({
      detail: entry.detail,
      summary: entry.summary,
    })),
    [
      {
        detail: '**Checking logs**\n\nFound the missing env var.',
        summary: '**Checking logs**',
      },
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

test('isAppServerThreadNotFoundError only matches missing-thread responses', () => {
  assert.equal(isAppServerThreadNotFoundError(new Error('thread not found: thr_123')), true);
  assert.equal(isAppServerThreadNotFoundError(new Error('invalid thread id: expected uuid')), true);
  assert.equal(isAppServerThreadNotFoundError(new Error('thread not loaded: 8e67cd9d-ed8c-424e-ade9-a9a68c388069')), true);
  assert.equal(isAppServerThreadNotFoundError(new Error('Unable to connect to app-server at ws://localhost:4222')), false);
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

test('getChat downgrades cached running threads when the backend no longer has them', async () => {
  const client = new AppServerClient({ url: 'ws://localhost:4222' });
  const events: Array<Record<string, unknown>> = [];

  (client as any).emit = (event: Record<string, unknown>) => {
    events.push(event);
  };
  (client as any).threadCache.set('chat-missing', {
    activity: [],
    cwd: '/workspace/project',
    id: 'chat-missing',
    messages: [],
    preview: 'Still running locally',
    status: 'running',
    title: 'Missing thread',
    tokenUsageLabel: null,
    updatedAt: '2026-03-20T00:00:00.000Z',
  });
  (client as any).summaryCache.set('chat-missing', {
    cwd: '/workspace/project',
    id: 'chat-missing',
    preview: 'Still running locally',
    status: 'running',
    title: 'Missing thread',
    updatedAt: '2026-03-20T00:00:00.000Z',
  });
  (client as any).readRawThread = async () => {
    throw new Error('thread not found: chat-missing');
  };

  const thread = await client.getChat('chat-missing');

  assert.equal(thread.status, 'idle');
  assert.equal((client as any).runningTurnIds.has('chat-missing'), false);
  assert.ok(
    events.some(
      (event) => event.type === 'thread' && ((event.thread as { status?: string } | undefined)?.status ?? null) === 'idle',
    ),
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

test('pageshow ignores the initial page load but reconnects after a bfcache restore', () => {
  const client = new AppServerClient({ url: 'ws://localhost:4222' });
  let restarted = 0;

  (client as any).handleForegroundResume = (forceRestart: boolean) => {
    if (forceRestart) {
      restarted += 1;
    }
  };

  (client as any).handlePageShow({ persisted: false });
  (client as any).handlePageShow({ persisted: true });

  assert.equal(restarted, 1);
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
      approvalPolicy: null,
      model: null,
      reasoningEffort: null,
      roots: ['/workspace/project'],
    },
  });

  assert.equal(readCount, 2);
  assert.equal(thread.messages[thread.messages.length - 1]?.content, 'Here is the follow-up reply.');
});

test('handleNotification emits live activity events for tool items and agent deltas', () => {
  const client = new AppServerClient({ url: 'ws://localhost:4222' });
  const events: Array<Record<string, unknown>> = [];

  (client as any).emit = (event: Record<string, unknown>) => {
    events.push(event);
  };
  (client as any).queueThreadRefresh = () => undefined;

  (client as any).handleNotification({
    method: 'item/started',
    params: {
      item: {
        command: 'bash -lc "npm test"',
        cwd: '/workspace/project',
        id: 'command-1',
        status: 'inProgress',
        type: 'commandExecution',
      },
      threadId: 'chat-1',
      turnId: 'turn-1',
    },
  });

  (client as any).handleNotification({
    method: 'item/agentMessage/delta',
    params: {
      delta: 'Reading the README now.',
      itemId: 'reply-1',
      threadId: 'chat-1',
      turnId: 'turn-1',
    },
  });

  assert.deepEqual(events, [
    {
      chatId: 'chat-1',
      entry: {
        detail: 'Command: bash -lc "npm test"\nDirectory: /workspace/project',
        id: 'command-1',
        kind: 'command',
        status: 'in-progress',
        summary: 'bash -lc "npm test"',
        title: 'bash -lc "npm test"',
        turnId: 'turn-1',
      },
      type: 'activity-upsert',
    },
    {
      chatId: 'chat-1',
      delta: 'Reading the README now.',
      entryId: 'reply-1',
      turnId: 'turn-1',
      type: 'activity-delta',
    },
  ]);
});
