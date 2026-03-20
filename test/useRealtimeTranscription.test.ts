import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldHoldTranscriptionWakeLock } from '../src/app/useRealtimeTranscription.ts';

test('keeps the wake lock while transcription is draining final results', () => {
  assert.equal(shouldHoldTranscriptionWakeLock('connecting'), true);
  assert.equal(shouldHoldTranscriptionWakeLock('recording'), true);
  assert.equal(shouldHoldTranscriptionWakeLock('processing'), true);
  assert.equal(shouldHoldTranscriptionWakeLock(undefined), false);
});
