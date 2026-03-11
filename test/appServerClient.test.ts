import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flattenUserInputs,
  mapThread,
  mapThreadSummary,
  shouldResumeAfterTurnStartError,
} from '../src/services/appServerClient.ts';

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
  assert.equal(thread.preview, 'The service is missing its runtime env vars.');
  assert.deepEqual(
    thread.messages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
    [
      { content: 'Explain the deployment error', role: 'user' },
      { content: 'The service is missing its runtime env vars.', role: 'assistant' },
    ],
  );
});

test('shouldResumeAfterTurnStartError only retries unloaded threads', () => {
  assert.equal(shouldResumeAfterTurnStartError(new Error('thread not found: thr_123')), true);
  assert.equal(shouldResumeAfterTurnStartError(new Error('no rollout found for thread id thr_123')), false);
  assert.equal(shouldResumeAfterTurnStartError(new Error('Timed out waiting for the app-server to finish the turn')), false);
});
