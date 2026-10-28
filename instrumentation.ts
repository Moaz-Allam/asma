/**
 * Runs once when the server starts, before any request is handled.
 *
 * This is what makes environment validation genuinely FAIL-FAST
 * (code-standards.md §12): a missing or malformed variable stops the process at
 * boot with a message naming it, instead of surfacing as a confusing 500 on the
 * first request that happens to touch it — possibly in production, possibly in a
 * money path.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('@/lib/env');
    getEnv();

    // Spec 0004 AC-9: a deployment refuses to boot without its keys, the same check the build ran.
    const { assertDeploymentKeys } = await import('@/lib/deployment');
    assertDeploymentKeys(process.env, 'runtime');
  }
}
