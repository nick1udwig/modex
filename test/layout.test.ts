import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveViewportSize, shouldUseWideShell } from '../src/app/layout.ts';

test('shouldUseWideShell keeps compact portrait phones in the narrow shell', () => {
  assert.equal(shouldUseWideShell({ height: 844, width: 390 }), false);
});

test('shouldUseWideShell widens the shell for compact landscape phones', () => {
  assert.equal(shouldUseWideShell({ height: 390, width: 844 }), true);
});

test('shouldUseWideShell widens the shell for tablets and desktop-sized viewports', () => {
  assert.equal(shouldUseWideShell({ height: 1024, width: 768 }), true);
});

test('resolveViewportSize uses the visual viewport height when the mobile keyboard shrinks the page', () => {
  assert.deepEqual(
    resolveViewportSize({
      innerHeight: 844,
      innerWidth: 390,
      visualViewport: {
        height: 522,
        offsetTop: 0,
        width: 390,
      },
    }),
    {
      height: 522,
      width: 390,
    },
  );
});
