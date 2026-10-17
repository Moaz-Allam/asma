#!/usr/bin/env node
/**
 * PostToolUse hook for Edit|Write: runs the project's own Prettier on the file just written, when it
 * is code. Best effort: it never blocks and always exits 0. Markdown is excluded so prose diffs stay
 * clean; `.prettierignore` keeps vendored skills and generated files untouched.
 * docs/engineering-approach.md §9.4.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, relative, resolve } from 'node:path';

const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css']);

let file = '';
try {
  file = String(JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path ?? '');
} catch {
  process.exit(0);
}
if (!file || !CODE.has(extname(file).toLowerCase())) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const prettier = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
const target = resolve(root, file);
if (!existsSync(prettier) || !existsSync(target) || relative(root, target).startsWith('..')) process.exit(0);

try {
  spawnSync(process.execPath, [prettier, '--write', '--ignore-unknown', '--log-level', 'silent', target], {
    cwd: root,
    stdio: 'ignore',
    timeout: 20000,
  });
} catch {
  // Formatting is a convenience, never a gate. CI's format check is the gate.
}
process.exit(0);
