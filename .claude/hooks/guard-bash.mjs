#!/usr/bin/env node
/**
 * PreToolUse guard for Bash and PowerShell commands.
 *
 * The write guard (guard.mjs) stops bad code landing in a file. This stops bad commands running:
 * printing secrets, wiping the machine or the repo, rewriting shared history, wiping a database,
 * and deploying around review. docs/engineering-approach.md §9.3.
 *
 * Contract: reads the PreToolUse payload on stdin. Exit 2 blocks the command and shows the reason
 * on stderr to the agent; exit 0 allows it.
 *
 * Design choices, on purpose:
 *   - It errs toward blocking. A false positive costs a rephrase; a false negative leaks a secret.
 *   - It scans every segment of the command (split on ; | & and newlines outside quotes),
 *     including quoted text, so a commit message that mentions a blocked phrase is blocked too.
 *     Write long messages to a file and use `git commit -F <file>`.
 *   - Unreadable input exits 0, so unrelated work is never blocked by a malformed payload.
 *
 * Test: tests/harness/guard-bash.test.ts (run by `npm test`). Never weaken a rule to let your own
 * command through; if a rule is wrong for a case, stop and say so.
 */

import { readFileSync } from 'node:fs';

let command = '';
try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  command = String(payload?.tool_input?.command ?? '');
} catch {
  process.exit(0);
}
if (!command.trim()) process.exit(0);

/** Split a command line into segments on ; | & and newlines that sit outside quotes. */
function segments(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '\r') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Shell-like word split with quotes removed. Good enough to find the command and its flags. */
function words(seg) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (const c of seg) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started || cur) out.push(cur);
      cur = '';
      started = false;
      continue;
    }
    cur += c;
  }
  if (started || cur) out.push(cur);
  return out;
}

/** Drop env assignments, sudo, and package runners so the real command comes first. */
function normalise(ws) {
  let i = 0;
  while (i < ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i])) i++;
  while (['sudo', 'command', 'exec', 'env', 'time'].includes(ws[i])) i++;
  if (ws[i] === 'pnpm' && ws[i + 1] === 'dlx') i += 2;
  else if (ws[i] === 'npx' || ws[i] === 'bunx') i += 1;
  else if (ws[i] === 'npm' && ws[i + 1] === 'exec') i += 2;
  while (i < ws.length && ws[i].startsWith('-') && ws[i - 1] && /^(npx|bunx|dlx|exec)$/.test(ws[i - 1])) i++;
  while (i < ws.length && /^(-y|--yes|--)$/.test(ws[i])) i++;
  const rest = ws.slice(i);
  if (rest[0]) {
    rest[0] = rest[0]
      .replace(/^.*[\\/]/, '') // path to the binary
      .replace(/\.exe$/i, '')
      .replace(/(.)@[^@]*$/, '$1') // version suffix: supabase@2.114.0
      .toLowerCase();
  }
  return rest;
}

/** git's subcommand, skipping global options such as -C <dir> and -c <key=value>. */
function gitSub(ws) {
  let i = 1;
  while (i < ws.length && ws[i].startsWith('-')) i += ws[i] === '-C' || ws[i] === '-c' ? 2 : 1;
  return [ws[i] ?? '', ws.slice(i + 1)];
}

const SECRET_ENV_FILE = /(^|[\s'"`/\\=:(,])\.env(?:\.(?!example\b)[\w.-]+)?(?![\w.-])/i;
const EXCLUDE_ENV = /--exclude(?:-dir)?=['"]?\.env\*?['"]?/gi;
const ROOTISH =
  /^(?:\/|\/\*|~|~\/|~\/\*|\.|\.\/|\.\/\*|\.\.|\.\.\/|\*|[A-Za-z]:[\\/]?\*?|\/[A-Za-z]\/?|\$HOME\/?|\$\{HOME\}\/?|\$PWD\/?|\$\{PWD\}\/?|\$env:(?:USERPROFILE|HOME)[\\/]?|%USERPROFILE%[\\/]?)$/i;
const ENV_FILE_OK = new Set(['ls', 'dir', 'test', '[', '[[', 'test-path', 'get-childitem', 'gci']);

const RULES = [
  {
    id: 'secret-env-file',
    test: (seg, ws) => {
      if (!SECRET_ENV_FILE.test(seg.replace(EXCLUDE_ENV, ''))) return false;
      const h = ws[0] ?? '';
      if (ENV_FILE_OK.has(h)) return false;
      if (h === 'git' && ['check-ignore', 'status'].includes(gitSub(ws)[0])) return false;
      if (h === 'vercel' && ws[1] === 'env' && ws[2] === 'pull') return false;
      return true;
    },
    why: 'Secret env files are off limits: never print, copy, move, or edit them. `.env.example` is fine.',
    instead:
      '`vercel env pull`, `test -f`, `ls`, `git check-ignore`, `git status`; the owner edits the file.',
  },
  {
    id: 'search-prints-secrets',
    test: (seg, ws) => {
      const h = ws[0] ?? '';
      if (h === 'rg') return ws.some((w) => /^--no-ignore/.test(w) || /^-[a-zA-Z]*uu/.test(w));
      if (!['grep', 'egrep', 'fgrep'].includes(h)) return false;
      const opts = ws.slice(1).filter((w) => w.startsWith('-'));
      const recursive = opts.some(
        (o) => o === '--recursive' || o === '--dereference-recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(o),
      );
      if (!recursive || /--exclude(?:-dir)?=['"]?\.env/.test(seg)) return false;
      const operands = ws.slice(1).filter((w) => !w.startsWith('-'));
      const usesE = opts.some((o) => o === '-e' || o === '-f' || /^--(regexp|file)=/.test(o));
      const paths = usesE ? operands : operands.slice(1);
      return paths.length === 0 || paths.some((p) => ROOTISH.test(p));
    },
    why: 'A recursive search over the repo root prints secret env files.',
    instead: 'Search a subfolder, add `--exclude=.env*`, or use plain `rg` (it respects .gitignore).',
  },
  {
    id: 'broad-delete',
    test: (seg, ws) => {
      const h = ws[0] ?? '';
      const ps = ['remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase'].includes(h);
      if (h !== 'rm' && !ps) return false;
      const args = ws.slice(1);
      const recursive = args.some(
        (a) =>
          a === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(a) || /^-rec/i.test(a) || /^\/s$/i.test(a),
      );
      if (!recursive) return false;
      // cmd.exe style switches (/s /q /f /a) are flags for rmdir/rd/del, never paths. For `rm`, a
      // single letter like /c is a Git Bash drive root and must stay a target.
      const targets = args.filter((a) => !a.startsWith('-') && !(ps && /^\/[sqfa]$/i.test(a)));
      return targets.some((t) => ROOTISH.test(t.replace(/([\\/])[\\/]+$/, '$1')));
    },
    why: 'A recursive delete of /, ~, ., .., *, a drive root, or $HOME wipes the machine or the repo.',
    instead: 'Delete a targeted path, for example `rm -rf .next`.',
  },
  {
    id: 'force-push',
    test: (seg, ws) => {
      if (ws[0] !== 'git') return false;
      const [sub, args] = gitSub(ws);
      if (sub !== 'push') return false;
      return args.some(
        (a) =>
          a === '--force' || a === '--mirror' || (/^-[a-zA-Z]+$/.test(a) && a.includes('f')) || /^\+/.test(a),
      );
    },
    why: 'Force pushing rewrites shared history.',
    instead: 'A normal push, or `--force-with-lease` on your own feature branch after asking the owner.',
  },
  {
    id: 'discard-work',
    test: (seg, ws) => {
      if (ws[0] !== 'git') return false;
      const [sub, args] = gitSub(ws);
      if (sub === 'reset') return args.includes('--hard');
      if (sub === 'clean') return args.some((a) => a === '--force' || /^-[a-zA-Z]*f/.test(a));
      return false;
    },
    why: 'This discards uncommitted or untracked work.',
    instead: 'Ask the owner. Preview with `git clean -n`, or use `git stash`.',
  },
  {
    id: 'data-wipe',
    test: (seg) => /\bdrop\s+(?:database|schema|table)\b|\btruncate\s+table\b/i.test(seg),
    why: 'Dropping or truncating loses data outside any migration.',
    instead: 'Write a migration file, test it with a local reset, and let the owner push it.',
  },
  {
    id: 'linked-db-reset',
    test: (seg, ws) => {
      if (ws[0] !== 'supabase') return false;
      if (ws.includes('projects') && ws.includes('delete')) return true;
      return (
        ws.includes('db') && ws.includes('reset') && ws.some((w) => w === '--linked' || /^--db-url/.test(w))
      );
    },
    why: 'This wipes or deletes the cloud database.',
    instead:
      "A local reset (`npx supabase db reset` without `--linked`). Cloud changes go through migrations, on the owner's request.",
  },
  {
    id: 'supabase-config-push',
    test: (seg, ws) => ws[0] === 'supabase' && ws.includes('config') && ws.includes('push'),
    why: 'config.toml holds fixed test codes and local Auth limits, which must never reach the cloud project (spec 0005 AC-25).',
    instead: 'Cloud Auth settings change in the dashboard: owner step S22.',
  },
  {
    id: 'prod-deploy',
    test: (seg, ws) => {
      if (ws[0] !== 'vercel') return false;
      if (['promote', 'rollback'].includes(ws[1] ?? '')) return true;
      return (
        ws.some((w) => w === '--prod' || w === '--production' || /^--target=production$/.test(w)) ||
        ws.some((w, i) => w === '--target' && ws[i + 1] === 'production')
      );
    },
    why: 'Production must come from merges to master, never a direct deploy around review.',
    instead: 'Open a PR; preview deployments come from branches.',
  },
  {
    id: 'third-party-installer',
    test: (seg, ws) => ws[0] === 'skills' && ['add', 'update', 'install'].includes(ws[1] ?? ''),
    why: 'Third party installers are never run by the agent (playbook §8, §20.4).',
    instead: 'Review the skill line by line and vendor it at a pinned commit, after the owner says yes.',
  },
];

/** Whole command checks: things that only make sense across a pipe. */
const WHOLE = [
  {
    id: 'piped-installer',
    test: (cmd) =>
      /\b(?:curl|wget)\b[^\n;]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i.test(cmd) ||
      /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n;]*\|\s*(?:iex|invoke-expression)\b/i.test(cmd),
    why: 'Piping a downloaded script into a shell runs third party code unreviewed.',
    instead: 'Download it, read it, and ask the owner to run it.',
  },
];

function block(rule) {
  process.stderr.write(
    `Blocked by .claude/hooks/guard-bash.mjs [${rule.id}]: ${rule.why}\nInstead: ${rule.instead}\n` +
      'Do not rephrase to slip past this rule. If it is wrong for this case, stop and tell the owner.\n',
  );
  process.exit(2);
}

for (const rule of WHOLE) if (rule.test(command)) block(rule);

for (const seg of segments(command)) {
  const ws = normalise(words(seg));
  for (const rule of RULES) if (rule.test(seg, ws)) block(rule);
}

process.exit(0);
