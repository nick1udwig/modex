import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  clampTerminalFontSize,
  isTerminalTapGesture,
  persistTerminalFontSize,
  readTerminalFontSize,
  stepTerminalFontSize,
} from '../src/components/terminalViewModel.ts';

const createStorage = (seed: Record<string, string> = {}) => {
  const entries = new Map(Object.entries(seed));

  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
};

test('terminal tap gesture ignores drag-sized movement', () => {
  assert.equal(isTerminalTapGesture({ x: 18, y: 22 }, { x: 23, y: 26 }), true);
  assert.equal(isTerminalTapGesture({ x: 18, y: 22 }, { x: 42, y: 54 }), false);
});

test('terminal font size defaults and clamps stored values', () => {
  assert.equal(readTerminalFontSize(createStorage()), DEFAULT_TERMINAL_FONT_SIZE);
  assert.equal(readTerminalFontSize(createStorage({ 'modex.terminal.fontSize': '999' })), MAX_TERMINAL_FONT_SIZE);
  assert.equal(readTerminalFontSize(createStorage({ 'modex.terminal.fontSize': '1' })), MIN_TERMINAL_FONT_SIZE);
  assert.equal(readTerminalFontSize(createStorage({ 'modex.terminal.fontSize': 'bad' })), DEFAULT_TERMINAL_FONT_SIZE);
});

test('terminal font size stepping stays within supported bounds', () => {
  assert.equal(stepTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE, -1), DEFAULT_TERMINAL_FONT_SIZE - 1);
  assert.equal(stepTerminalFontSize(MIN_TERMINAL_FONT_SIZE, -1), MIN_TERMINAL_FONT_SIZE);
  assert.equal(stepTerminalFontSize(MAX_TERMINAL_FONT_SIZE, 1), MAX_TERMINAL_FONT_SIZE);
  assert.equal(clampTerminalFontSize(12.6), 13);
});

test('terminal font size persistence stores the clamped value', () => {
  const storage = createStorage();
  assert.equal(persistTerminalFontSize(99, storage), MAX_TERMINAL_FONT_SIZE);
  assert.equal(readTerminalFontSize(storage), MAX_TERMINAL_FONT_SIZE);
});
