'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { fail, guardedAction } from '@/lib/auth/action';
import { applyToRequest as applyInDb, loadMyQuality, saveSetup } from '@/lib/provider-feed';
import { ApplyInput, SaveSetupInput } from '@/lib/provider-feed/input';

/**
 * The provider's writes in position 05 (spec 0009). Each calls one definer function, which holds every rule,
 * so a direct API call meets the same refusals. A stable code is mapped and reaches no Sentry report; the
 * door raises the one alert (`apply_settings_invalid`). The apply message is named `applicationMessage`, so
 * the scrubber removes it from anything that would carry it (AC-20).
 */

/** `p4` (AC-3). A refusal names its field: `setup_invalid_services` and so on. */
export const saveProviderSetup = guardedAction(
  { name: 'saveProviderSetup', access: ['provider'], schema: SaveSetupInput },
  async (input, user) => {
    const outcome = await saveSetup(input, { region: user.region });
    if (!outcome.ok) return fail(outcome.field ? `${outcome.code}_${outcome.field}` : outcome.code);
    revalidatePath('/', 'layout');
    return { status: 'ok' as const };
  },
);

/** AC-10, AC-11. A replay returns the stored application; the page tells the two apart. */
export const applyToRequest = guardedAction(
  { name: 'applyToRequest', access: ['provider'], schema: ApplyInput },
  async (input, user) => {
    const outcome = await applyInDb(input, { region: user.region });
    if (!outcome.ok) return fail(outcome.code);
    if (!outcome.replayed) revalidatePath('/', 'layout');
    return { replayed: outcome.replayed, application: outcome.application };
  },
);

/**
 * Spec 0011-19a AC-6, X-22: after a `probation_limit` refusal the form asks again for the two figures its line
 * names (the live limit and the jobs needed). They can differ from the instant of the refusal by a job that closed
 * in between, accepted.
 */
export const loadMyProbation = guardedAction(
  { name: 'loadMyProbation', access: ['provider'], schema: z.object({}).strict() },
  async (_input, user) => {
    const outcome = await loadMyQuality({ region: user.region });
    if (!outcome.ok) return fail(outcome.code);
    return { probation: outcome.quality.probation };
  },
);
