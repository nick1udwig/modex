import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addSelectedDirectory,
  moveSelectedDirectoryToFront,
  removeSelectedDirectory,
} from '../src/components/remoteDirectorySelectionModel.ts';

test('single-select directory mode keeps only the most recent browse selection', () => {
  assert.deepEqual(addSelectedDirectory(['/workspace/a'], '/workspace/b', 'single'), ['/workspace/b']);
});

test('multi-select directory mode appends and dedupes roots', () => {
  assert.deepEqual(addSelectedDirectory(['/workspace/a'], '/workspace/a/', 'multiple'), ['/workspace/a']);
  assert.deepEqual(addSelectedDirectory(['/workspace/a'], '/workspace/b', 'multiple'), ['/workspace/a', '/workspace/b']);
});

test('selected directories can be promoted and removed', () => {
  assert.deepEqual(moveSelectedDirectoryToFront(['/workspace/a', '/workspace/b'], '/workspace/b'), ['/workspace/b', '/workspace/a']);
  assert.deepEqual(removeSelectedDirectory(['/workspace/a', '/workspace/b'], '/workspace/a'), ['/workspace/b']);
});
