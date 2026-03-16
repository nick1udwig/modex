import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInitializeParams,
  flattenUserInputs,
  isAppServerConnectionClosedError,
  mapThread,
  mapThreadSummary,
  shouldResumeAfterTurnStartError,
} from '../src/services/appServerClient.ts';

test('buildInitializeParams opts into experimental API features', () => {
  assert.equal(buildInitializeParams().capabilities.experimentalApi, true);
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
