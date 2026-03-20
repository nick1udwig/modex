import assert from 'node:assert/strict';
import test from 'node:test';
import { positionMessageMenu } from '../src/app/messageMenuPosition.ts';

test('positionMessageMenu keeps the menu below the message when there is room', () => {
  assert.deepEqual(
    positionMessageMenu(
      {
        bottom: 240,
        left: 120,
        right: 320,
        top: 180,
      },
      {
        height: 110,
        width: 164,
      },
      {
        height: 844,
        width: 390,
      },
    ),
    {
      left: 120,
      top: 250,
    },
  );
});

test('positionMessageMenu moves the menu above bottom messages instead of clipping off-screen', () => {
  assert.deepEqual(
    positionMessageMenu(
      {
        bottom: 760,
        left: 172,
        right: 374,
        top: 676,
      },
      {
        height: 110,
        width: 164,
      },
      {
        height: 844,
        width: 390,
      },
    ),
    {
      left: 172,
      top: 556,
    },
  );
});

test('positionMessageMenu clamps horizontally inside the viewport', () => {
  assert.deepEqual(
    positionMessageMenu(
      {
        bottom: 400,
        left: 320,
        right: 376,
        top: 332,
      },
      {
        height: 110,
        width: 164,
      },
      {
        height: 844,
        width: 390,
      },
    ),
    {
      left: 210,
      top: 410,
    },
  );
});
