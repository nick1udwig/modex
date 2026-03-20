import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessModeContextLabel,
  countLabel,
  dedupeRoots,
  parentDirectory,
  pathBasename,
  seedBrowseState,
} from '../src/components/runtimeSettingsSheetModel.ts';

test('dedupeRoots trims and removes duplicate paths', () => {
  assert.deepEqual(dedupeRoots([' /srv/app ', '/srv/app/', '/srv/shared', '', '/srv/shared']), ['/srv/app', '/srv/shared']);
});

test('parentDirectory handles root and nested paths', () => {
  assert.equal(parentDirectory('/'), null);
  assert.equal(parentDirectory('/srv'), '/');
  assert.equal(parentDirectory('/srv/modex/workspaces/app'), '/srv/modex/workspaces');
});

test('pathBasename returns the trailing segment', () => {
  assert.equal(pathBasename('/'), '/');
  assert.equal(pathBasename('/srv/modex/workspaces'), 'workspaces');
});

test('seedBrowseState uses the first selected root when present', () => {
  assert.deepEqual(seedBrowseState(['/srv/modex/workspaces/app/projects'], ['/srv/modex/workspaces/shared']), {
    anchorPath: '/srv/modex/workspaces/app',
    selectedPath: '/srv/modex/workspaces/app/projects',
  });
});

test('seedBrowseState falls back to recent roots', () => {
  assert.deepEqual(seedBrowseState([], ['/srv/modex/workspaces/shared']), {
    anchorPath: '/srv/modex/workspaces',
    selectedPath: '/srv/modex/workspaces/shared',
  });
});

test('count and access labels stay stable', () => {
  assert.equal(countLabel(1), '1 subdir');
  assert.equal(countLabel(3), '3 subdirs');
  assert.equal(accessModeContextLabel('read-only'), 'read-only allowed root');
  assert.equal(accessModeContextLabel('workspace-write'), 'read/write allowed root');
});
