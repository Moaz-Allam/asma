#!/usr/bin/env node
/**
 * PreToolUse guard for Write|Edit|MultiEdit.
 *
 * Enforces the rules that never bend (project-overview.md §5, summarised in AGENTS.md) that fail
 * SILENTLY in production — a missing
 * RLS policy, a float in a ledger, a PSP call in a request path, a leaked secret.
 * Prose in a 4,500-line context directory gets forgotten. A hook does not.
 *
 * Contract: reads the PreToolUse payload on stdin, prints a permissionDecision.
 * Deny is advisory-with-teeth: it names the rule, the reason, and the doc section.
 *
 * Deliberately conservative. A guard that cries wolf gets disabled, and then it
 * protects nothing. Regression suite: node .claude/evals/guard.test.mjs
 *
 * Two rule shapes:
 *   find    — a pattern that must NOT appear.
 *   check   — a function returning a detail string when the rule is violated,
 *             for absence checks (something that must be present but isn't).
 *             `whole: true` limits it to Write, where the full file is visible.
 */

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SERVER_ONLY_DIRS = /(?:^|[\\/])lib[\\/](?:money|pricing|psp)[\\/]/;

const RULES = [
  // ---------------------------------------------------------------- money path
  {
    id: 'psp-in-request-path',
    when: (p) =>
      SOURCE.test(p) &&
      !/lib[\\/]psp[\\/]/.test(p) &&
      !/(outbox|relay)/i.test(p) &&
      !/\.test\.|\.spec\./.test(p),
    find: /(?:from|require\()\s*['"](?:@\/lib\/psp[^'"]*|[^'"]*(?:iyzico|iyzipay|paytabs)[^'"]*)['"]/i,
    why:
      'Rule 3: no external call in a request path. Money flow is DB transaction -> outbox_events -> relay worker -> PSP. ' +
      'The relay is the only mutating caller of lib/psp. Write an outbox event instead. See architecture.md §27, code-standards.md §26.',
  },
  {
    id: 'float-money',
    when: (p) => /(lib[\\/](money|pricing)|actions)[\\/]/.test(p) && SOURCE.test(p),
    find: /\.toFixed\(|parseFloat\(|Number\.parseFloat\(/,
    why:
      'Rule 4: money is integer minor units. Float arithmetic on money is forbidden in lib/money, lib/pricing, and actions/. ' +
      'Format for display from server-provided minor units instead. See code-standards.md §5.',
  },
  {
    id: 'ledger-mutation',
    when: (p) => SOURCE.test(p) || /\.sql$/.test(p),
    find: /(?:from\(['"]|UPDATE\s+|DELETE\s+FROM\s+)(?:ledger_entries|ratings)['"]?\s*\)?[\s\S]{0,120}?\.(?:update|delete)\(|(?:UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:ledger_entries|ratings)\b/i,
    why:
      'Rule 5: ledger_entries and ratings are append-only, with UPDATE/DELETE REVOKEd at the database level. ' +
      'Corrections are new compensating postings; a rating can be hidden but never edited. See architecture.md §28.',
  },
  {
    id: 'commission-netted',
    when: (p) => SOURCE.test(p),
    find: /(?:price|amount|total)\s*[-−]\s*commission|commission\s*[-−]\s*(?:price|amount)/i,
    why:
      'Rule 6: commission is its own ledger leg. Computing escrow as `price - commission` and posting one line is the classic ' +
      'marketplace ledger bug — the fee gets netted but never posted. Post three legs. See architecture.md §30.',
  },

  // ------------------------------------------------------------------ security
  {
    id: 'rls-missing-on-new-table',
    when: (p) => /\.sql$/.test(p),
    check: (text) => {
      const created = [
        ...text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)/gi),
      ].map((m) => m[1].toLowerCase());
      if (!created.length) return null;
      const guarded = new Set(
        [
          ...text.matchAll(
            /ALTER\s+TABLE\s+(?:public\.)?["']?(\w+)["']?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
          ),
        ].map((m) => m[1].toLowerCase()),
      );
      const naked = created.filter((t) => !guarded.has(t));
      return naked.length ? `table(s) without RLS: ${[...new Set(naked)].join(', ')}` : null;
    },
    why:
      'Rule 7: every table gets RLS enabled in the SAME migration that creates it. A table created without RLS raises no error — ' +
      'it just returns every row to every authenticated user, and it is the most common Supabase security incident. ' +
      'Add ALTER TABLE <t> ENABLE ROW LEVEL SECURITY, the policies, and the negative test. See code-standards.md §4, §11.',
  },
  {
    id: 'server-only-missing',
    when: (p) => SERVER_ONLY_DIRS.test(p) && SOURCE.test(p) && !/\.(test|spec|d)\.ts$/.test(p),
    whole: true,
    check: (text) => (/(['"])server-only\1/.test(text) ? null : "missing import 'server-only'"),
    why:
      "Modules under lib/money, lib/pricing and lib/psp must start with import 'server-only', so a stray import from a Client " +
      'Component fails at build time instead of shipping money logic or secrets to the browser. See code-standards.md §3.',
  },
  {
    id: 'code-execution',
    when: (p) => SOURCE.test(p),
    find: /\beval\s*\(|new\s+Function\s*\(/,
    why:
      'Rule 8: never execute an admin-authored string. Pricing formulas are structured rows (pricing_modifiers) run by our own ' +
      'interpreter. An admin account is not a code-execution boundary. See code-standards.md §25.',
  },
  {
    id: 'public-secret',
    when: () => true,
    find: /NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE_ROLE|SECRET|WEBHOOK|API_KEY|PRIVATE|TOKEN|PASSWORD)/,
    why:
      'NEXT_PUBLIC_ ships the value to every browser. No secret may carry that prefix — not the service role key, not a PSP key, ' +
      'not a messaging key. See code-standards.md §22.',
  },
  {
    id: 'service-role-in-client',
    when: (p) => SOURCE.test(p) && /components[\\/]|app[\\/].*page\.tsx$/.test(p),
    find: /SUPABASE_SERVICE_ROLE_KEY|createSupabaseAdmin|service_role/,
    why:
      'The service_role client bypasses RLS and must never exist in a component or page. It is for webhooks and cron only. ' +
      'Use createSupabaseServer() so RLS applies. See architecture.md §16.',
  },
  {
    id: 'select-star',
    when: (p) => SOURCE.test(p),
    find: /\.select\(\s*['"`]\s*\*\s*['"`]\s*\)/,
    why:
      "select('*') risks returning a column RLS was meant to gate — RLS filters rows, not columns. List columns explicitly. " +
      'See code-standards.md §4, library-docs.md (Supabase RLS gotcha).',
  },
  {
    id: 'client-storage-for-trust',
    when: (p) => SOURCE.test(p),
    find: /(?:localStorage|sessionStorage)\.setItem\(\s*['"`][^'"`]*(?:token|auth|session|balance|amount|price|role)/i,
    why: 'localStorage/sessionStorage is not a trust boundary. Auth and money state live in the server session. See ui-rules.md §10.',
  },

  // ------------------------------------------------------- framework contracts
  {
    id: 'middleware-filename',
    when: (p) => /(?:^|[\\/])middleware\.(ts|js)$/.test(p),
    find: /[\s\S]/,
    why:
      'Rule 11: Next.js 16 renamed this convention to proxy.ts (exporting `proxy`). A leftover middleware.ts is SILENTLY IGNORED — ' +
      'no error, and route protection becomes dead code. Create proxy.ts at the project root instead. See code-standards.md §27.',
  },
  {
    id: 'colours-in-tailwind-config',
    when: (p) => /tailwind\.config\.(ts|js|mjs|cjs)$/.test(p),
    find: /colors?\s*:/,
    why: 'Tailwind v4 defines tokens with @theme in app/globals.css. Colours never go in tailwind.config. See ui-tokens.md §11.',
  },

  // -------------------------------------------------------------- i18n (rule 10)
  {
    id: 'turkish-case-fold',
    when: (p) => SOURCE.test(p),
    find: /toLocale(?:Lower|Upper)Case\s*\(\s*['"`]tr/i,
    why:
      'Rule 10: Turkish case mapping is not the same as everyone else\'s — "I".toLocaleLowerCase("tr") is "ı" (dotless), ' +
      'not "i". Case-folding an identifier under a Turkish locale silently breaks email matching, enum comparison, and ' +
      'account lookup; it has broken OpenSSL and the Kotlin compiler the same way. Use plain toLowerCase()/toUpperCase() ' +
      '(locale-independent in JS) for identifiers, and reserve locale-aware casing for display text. See i18n.md §6.',
  },
  {
    id: 'hardcoded-locale-string',
    when: (p) => /\.(tsx|jsx)$/.test(p) && !/[\\/]messages[\\/]/.test(p),
    find: /['"`][^'"`]*[؀-ۿ][^'"`]*['"`]/,
    why:
      'Rule 10: no hardcoded user-facing strings. Arabic text in a component means copy that cannot be translated into ' +
      'tr or en. UI strings come from messages/{ar,tr,en}.json; admin-authored labels come from localised JSONB columns. ' +
      'See i18n.md §5.',
  },

  // ------------------------------------------------------------------ UI tokens
  {
    id: 'hardcoded-hex',
    when: (p) => /\.(tsx|jsx)$/.test(p),
    find: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/,
    why:
      'Rule 10: no raw hex in components. Every visual value comes from a semantic token in ui-tokens.md. ' +
      'Colours are defined once, with @theme in globals.css.',
  },
  {
    id: 'brand-value-in-globals',
    when: (p) => /(?:^|[\\/])globals\.css$/.test(p),
    raw: true,
    check: (text) => {
      // Concrete colour values belong ONLY in the palette block: a line declaring a
      // --ramp-* variable (ui-tokens.md §2, §13). Every other token references the ramps.
      // Lines marked `placeholder` stay allowed only until the tokens land, because the
      // pre-B4 file still holds them; delete this escape with the placeholders.
      const offenders = text
        .split(/\r?\n/)
        .filter((l) => /(#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\()/.test(l))
        .filter((l) => !/^\s*--ramp-[\w-]+\s*:/.test(l) && !/placeholder/i.test(l));
      return offenders.length
        ? `${offenders.length} colour value(s) outside the --ramp-* palette block, e.g. "${offenders[0].trim().slice(0, 60)}"`
        : null;
    },
    why:
      'Rule 10 + D48/D60: the palette is decided (ui-tokens.md §2). Concrete colours live only in the --ramp-* ' +
      'variables of the palette block in globals.css; every other token references them (var(--ramp-*)). This fires ' +
      'most often right after `npx shadcn init`, which writes its own generated palette into globals.css: map its ' +
      'names to ours (ui-tokens.md §3) and delete its values. Never mark a real value `placeholder` to get past it; ' +
      'that escape only covers the pre-B4 file until the tokens land.',
  },
  {
    id: 'raw-tailwind-palette',
    when: (p) => /\.(tsx|jsx|css)$/.test(p),
    find: /\b(?:bg|text|border|ring|from|to|via|divide|outline|fill|stroke|shadow|accent|caret)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:\d{2,3})\b/,
    why:
      'Rule 10: raw Tailwind palette classes are forbidden — semantic tokens only (bg-surface, text-text-primary, bg-error). ' +
      'When the theme lands, semantics survive and literals break. See ui-tokens.md §17.',
  },
  {
    id: 'arbitrary-value',
    when: (p) => /\.(tsx|jsx)$/.test(p),
    find: /\b[a-z]+(?:-[a-z]+)*-\[(?:#|\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)|rgb|hsl)/,
    why:
      'Rule 10: no arbitrary values (p-[13px], w-[437px], text-[#101828]). Use the token scale; add a token before using a value. ' +
      'See ui-tokens.md §1. (Arbitrary *variants* like [&>svg]:size-4 are fine — this only blocks arbitrary numeric/colour values.)',
  },
  {
    id: 'physical-direction',
    when: (p) => /\.(tsx|jsx)$/.test(p),
    find: /\b(?:ml|mr|pl|pr)-(?:\d|px|auto)|\b(?:left|right)-(?:\d|px|auto|full)\b|\btext-(?:left|right)\b|\bborder-[lr]\b|\brounded-[lr]\b/,
    why:
      'Rule 10: direction is derived from the locale at runtime (ar = RTL, tr/en = LTR), so a physical utility is ' +
      'wrong in one direction by construction. Use logical properties — ms/me, ps/pe, start/end, text-start/text-end, ' +
      'border-s/border-e. Code written logically flips for free; code written physically must be rebuilt. See ui-rules.md §3.',
  },
];

function body(input) {
  const parts = [input?.content, input?.new_string];
  if (Array.isArray(input?.edits)) parts.push(...input.edits.map((e) => e?.new_string));
  return parts.filter((s) => typeof s === 'string').join('\n');
}

function stripComments(src, path) {
  // Rules describe code, not prose about code. A doc comment quoting a forbidden
  // pattern (as AGENTS.md and the context files do constantly) must not trip.
  const out = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // SQL line comments, in SQL only: in CSS a leading `--` is a custom property, and stripping
  // it hid every multi-line token declaration from the globals.css rule.
  return /\.sql$/i.test(path) ? out.replace(/^\s*--.*$/gm, '') : out;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    process.exit(0); // Never block on a malformed payload.
  }

  const input = payload.tool_input ?? {};
  const path = String(input.file_path ?? '');
  if (!path) process.exit(0);

  // The agent's own config, the context docs, and the prose under docs/ (specs, reviews, the brief,
  // the playbook) quote these patterns by design. Only Markdown under docs/ is exempt: a page.tsx in
  // a `docs` route is still code and still guarded.
  if (/[\\/]\.claude[\\/]|[\\/]context[\\/]|(^|[\\/])docs[\\/].*\.md$|CLAUDE\.md$|AGENTS\.md$/.test(path))
    process.exit(0);

  const isWholeFile = payload.tool_name === 'Write';
  const rawText = body(input);
  const text = stripComments(rawText, path);
  if (!text.trim()) process.exit(0);

  const hits = [];
  for (const r of RULES) {
    if (!r.when(path)) continue;
    if (r.whole && !isWholeFile) continue;
    // A `raw` rule reads comments too (its exemption marker lives in one).
    const subject = r.raw ? rawText : text;
    if (r.find) {
      if (r.find.test(subject)) hits.push({ ...r, detail: null });
    } else if (r.check) {
      const detail = r.check(subject, path);
      if (detail) hits.push({ ...r, detail });
    }
  }
  if (hits.length === 0) process.exit(0);

  const reason =
    `Blocked ${hits.length} rule violation(s) in ${path}:\n\n` +
    hits.map((h, i) => `${i + 1}. [${h.id}]${h.detail ? ` ${h.detail}.` : ''} ${h.why}`).join('\n\n') +
    '\n\nFix the code. Do not edit this hook to pass — that is the same failure class as weakening an RLS policy ' +
    'to make a test green. If the rule is genuinely wrong for this case, stop and say so.';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
});
