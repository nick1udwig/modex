import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  advanceTerminalTouchScroll,
  clampTerminalFontSize,
  isTerminalTapGesture,
  persistTerminalFontSize,
  readTerminalFontSize,
  resolveTerminalHelperTextAreaTop,
  resolveTerminalTouchScrollLines,
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

test('terminal touch scrolling activates after passing the tap threshold', () => {
  const initial = { lastY: 220, scrolling: false, startY: 220 };
  const beforeThreshold = advanceTerminalTouchScroll(initial, 214);
  assert.equal(beforeThreshold.scrollDelta, 0);
  assert.equal(beforeThreshold.nextState.scrolling, false);

  const afterThreshold = advanceTerminalTouchScroll(beforeThreshold.nextState, 200);
  assert.equal(afterThreshold.nextState.scrolling, true);
  assert.equal(afterThreshold.scrollDelta, 14);
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

test('terminal helper textarea stays pinned to the visible viewport bottom', () => {
  assert.equal(resolveTerminalHelperTextAreaTop(852, 0), 834);
  assert.equal(resolveTerminalHelperTextAreaTop(320, 240), 542);
});

test('terminal touch scrolling converts pixel drag into buffered line scroll', () => {
  assert.deepEqual(resolveTerminalTouchScrollLines(0, 8, 18), {
    lineDelta: 0,
    scrollRemainder: 8,
  });
  assert.deepEqual(resolveTerminalTouchScrollLines(8, 20, 18), {
    lineDelta: 1,
    scrollRemainder: 10,
  });
  assert.deepEqual(resolveTerminalTouchScrollLines(0, -41, 18), {
    lineDelta: -2,
    scrollRemainder: -5,
  });
});
