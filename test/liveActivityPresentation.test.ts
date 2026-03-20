import assert from 'node:assert/strict';
import test from 'node:test';
import { isToolActivity, liveActivityHeadline, liveActivityPreview } from '../src/app/liveActivityPresentation.ts';
import type { ActivityEntry } from '../src/app/types.ts';

const makeEntry = (overrides: Partial<ActivityEntry>): ActivityEntry => ({
  detail: '',
  id: 'entry-1',
  kind: 'commentary',
  status: 'in-progress',
  summary: '',
  title: 'Agent update',
  turnId: 'turn-1',
  ...overrides,
});

test('liveActivityHeadline formats tool calls with the command name', () => {
  assert.equal(
    liveActivityHeadline(
      makeEntry({
        detail: 'Command: bash -lc "npm test"',
        kind: 'command',
        summary: 'bash -lc "npm test"',
        title: 'bash -lc \"npm test\"',
      }),
    ),
    'Tool call: bash',
  );
});

test('liveActivityPreview truncates tool call arguments for collapsed cards', () => {
  assert.equal(
    liveActivityPreview(
      makeEntry({
        detail: '',
        kind: 'command',
        summary: 'bash -lc "npm test -- --watch=false"',
        title: 'bash -lc \"npm test -- --watch=false\"',
      }),
      20,
    ),
    '-lc "npm test --...',
  );
});

test('isToolActivity distinguishes prose updates from tool entries', () => {
  assert.equal(isToolActivity(makeEntry({ kind: 'commentary' })), false);
  assert.equal(isToolActivity(makeEntry({ kind: 'command' })), true);
  assert.equal(isToolActivity(makeEntry({ kind: 'file-change' })), true);
});
