import assert from 'node:assert/strict';
import test from 'node:test';
import { focusTextInputWithoutPageJump } from '../src/components/textInputFocus.ts';

const createInput = (value: string) => {
  const calls: Array<FocusOptions | undefined> = [];
  const selections: Array<[number, number]> = [];

  return {
    calls,
    input: {
      value,
      focus: (options?: FocusOptions) => {
        calls.push(options);
      },
      setSelectionRange: (start: number, end: number) => {
        selections.push([start, end]);
      },
    },
    selections,
  };
};

test('focusTextInputWithoutPageJump focuses with preventScroll and moves the caret to the end', () => {
  const prevented = { value: false };
  const { calls, input, selections } = createInput('Ask anything');

  assert.equal(
    focusTextInputWithoutPageJump(input, null, {
      preventDefault: () => {
        prevented.value = true;
      },
    }),
    true,
  );
  assert.deepEqual(calls, [{ preventScroll: true }]);
  assert.deepEqual(selections, [[12, 12]]);
  assert.equal(prevented.value, true);
});

test('focusTextInputWithoutPageJump is a no-op when the input is already active', () => {
  const prevented = { value: false };
  const { calls, input, selections } = createInput('Open tabs');

  assert.equal(
    focusTextInputWithoutPageJump(input, input, {
      preventDefault: () => {
        prevented.value = true;
      },
    }),
    false,
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(selections, []);
  assert.equal(prevented.value, false);
});
