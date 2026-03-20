import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseWideShell } from '../src/app/layout.ts';

test('shouldUseWideShell keeps compact portrait phones in the narrow shell', () => {
  assert.equal(shouldUseWideShell({ height: 844, width: 390 }), false);
});

test('shouldUseWideShell widens the shell for compact landscape phones', () => {
  assert.equal(shouldUseWideShell({ height: 390, width: 844 }), true);
});

test('shouldUseWideShell widens the shell for tablets and desktop-sized viewports', () => {
  assert.equal(shouldUseWideShell({ height: 1024, width: 768 }), true);
});
