import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = ['src', 'test'];
const extensions = new Set(['.ts', '.tsx', '.mjs', '.css']);
const violations = [];

const walk = async (directory) => {
  let entries = [];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        return;
      }

      if (!extensions.has(path.extname(entry.name))) {
        return;
      }

      const content = await readFile(absolutePath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNumber = index + 1;

        if (/\s+$/.test(line)) {
          violations.push(`${absolutePath}:${lineNumber} trailing whitespace`);
        }

        if (/\bdebugger\b/.test(line)) {
          violations.push(`${absolutePath}:${lineNumber} debugger statement`);
        }

        if (/\bconsole\.(log|debug)\b/.test(line)) {
          violations.push(`${absolutePath}:${lineNumber} console debug output`);
        }
      });
    }),
  );
};

await Promise.all(roots.map((root) => walk(path.resolve(root))));

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
}
