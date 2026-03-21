import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const stylesPath = path.resolve(import.meta.dirname, '../src/styles.css');

test('terminal shell keeps a tight bottom inset', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(
    styles,
    /\.terminal-canvas-shell\s*\{[\s\S]*?padding:\s*10px 10px calc\(4px \+ env\(safe-area-inset-bottom\)\);/,
  );

  assert.match(
    styles,
    /\.terminal-canvas \.xterm\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?justify-content:\s*flex-end;/,
  );
});
