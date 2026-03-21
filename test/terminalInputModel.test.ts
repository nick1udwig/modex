import assert from 'node:assert/strict';
import test from 'node:test';
import { getTerminalShortcutSequence, getTerminalTextSequence } from '../src/components/terminalInputModel.ts';

test('terminal shortcut keys emit their raw sequences by default', () => {
  assert.equal(getTerminalShortcutSequence('esc', { alt: false, ctrl: false }), '\u001b');
  assert.equal(getTerminalShortcutSequence('tab', { alt: false, ctrl: false }), '\t');
  assert.equal(getTerminalShortcutSequence('pipe', { alt: false, ctrl: false }), '|');
});

test('ctrl-modified terminal text emits control bytes for letters', () => {
  assert.equal(getTerminalTextSequence('c', { alt: false, ctrl: true }), '\u0003');
});

test('alt-modified terminal text prefixes escape for one-shot meta bindings', () => {
  assert.equal(getTerminalTextSequence('f', { alt: true, ctrl: false }), '\u001bf');
});
