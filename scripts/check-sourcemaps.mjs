#!/usr/bin/env node
/**
 * Runs after `next build` in `npm run build` (spec 0004 AC-1).
 *
 * On a deployment build, Sentry uploads the browser source maps and deletes them, so none may be left
 * under `.next/static`: anything there is served to every visitor, and a source map hands out the
 * original code. Off a deployment nothing is uploaded, and the check stands aside.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Node strips the types natively; lib/deployment.ts has no dependencies for exactly this reason.
import { isDeployment } from '../lib/deployment.ts';

if (!isDeployment(process.env)) {
  console.log('sourcemaps: not a deployment build, check skipped.');
  process.exit(0);
}

const staticDir = join(process.cwd(), '.next', 'static');
const maps = existsSync(staticDir)
  ? readdirSync(staticDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.map'))
  : [];

if (maps.length > 0) {
  console.error(
    `sourcemaps: ${maps.length} source map file(s) left under .next/static (for example ${maps[0]}). ` +
      'They would be served to every visitor. Check the Sentry upload in the build log (spec 0004 AC-1).',
  );
  process.exit(1);
}
console.log('sourcemaps: none left under .next/static.');
