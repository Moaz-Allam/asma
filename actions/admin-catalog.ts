'use server';

import { revalidatePath } from 'next/cache';

import { fail, guardedAction } from '@/lib/auth/action';
import { adminRegion } from '@/lib/catalog/queries';
import {
  MoveApplicationQuestionSchema,
  MoveRowSchema,
  SaveAddonSchema,
  SaveApplicationQuestionSchema,
  SaveCategorySchema,
  SaveQuestionSchema,
  SaveServiceSchema,
  SaveZoneSchema,
  SetActiveSchema,
} from '@/lib/catalog/schemas';
import { catalogCode, insertRow, moveRow, parentRegion, updateRow, ZeroRows } from '@/lib/catalog/writes';
import { SELECT_TYPES } from '@/lib/catalog/options';
import { parseFactor, parseMinor } from '@/lib/money/parse';

/**
 * Admin's writes on the catalog (spec 0007 AC-17 to AC-19). Each runs inside `guardedAction` for `admin`,
 * and the database decides again through RLS, the column grants and the checks. The region of a new
 * category or zone is the active one, read here; a child's region is its parent's, read here, and the
 * composite key refuses a mismatch. Nothing is ever deleted: turning a row off retires it.
 */

async function mapped<T>(run: () => Promise<T>) {
  try {
    const result = await run();
    revalidatePath('/', 'layout');
    return result;
  } catch (error) {
    if (error instanceof ZeroRows) return fail('forbidden');
    const code = catalogCode(error);
    if (code) return fail(code);
    throw error;
  }
}

async function activeRegion() {
  const region = await adminRegion();
  return region?.region ?? null;
}

export const saveCategory = guardedAction(
  { name: 'saveCategory', access: ['admin'], schema: SaveCategorySchema },
  async ({ id, name }) =>
    mapped(async () => {
      if (id) {
        await updateRow('service_categories', id, { name });
        return { id };
      }
      const region = await activeRegion();
      if (!region) return fail('validation_failed');
      return { id: await insertRow('service_categories', { region, name }, region) };
    }),
);

export const saveService = guardedAction(
  { name: 'saveService', access: ['admin'], schema: SaveServiceSchema },
  async ({ id, categoryId, name, note, hoursMin, hoursMax }) =>
    mapped(async () => {
      const fields = { name, note, hours_min: hoursMin, hours_max: hoursMax };
      if (id) {
        await updateRow('services', id, fields);
        return { id };
      }
      const region = await parentRegion('service_categories', categoryId);
      if (!region) return fail('forbidden');
      return { id: await insertRow('services', { ...fields, category_id: categoryId, region }, categoryId) };
    }),
);

export const saveAddon = guardedAction(
  { name: 'saveAddon', access: ['admin'], schema: SaveAddonSchema },
  async ({ id, serviceId, name, price }) =>
    mapped(async () => {
      const minor = parseMinor(price);
      if (minor === null || minor < 1) return fail('validation_failed');
      if (id) {
        await updateRow('addons', id, { name, price: minor });
        return { id };
      }
      const region = await parentRegion('services', serviceId);
      if (!region) return fail('forbidden');
      return {
        id: await insertRow('addons', { service_id: serviceId, region, name, price: minor }, serviceId),
      };
    }),
);

export const saveZone = guardedAction(
  { name: 'saveZone', access: ['admin'], schema: SaveZoneSchema },
  async ({ id, name, multiplier }) =>
    mapped(async () => {
      const value = parseFactor(multiplier, 2);
      if (value === null) return fail('validation_failed');
      if (id) {
        await updateRow('zones', id, { name, multiplier: value });
        return { id };
      }
      const region = await activeRegion();
      if (!region) return fail('validation_failed');
      return { id: await insertRow('zones', { region, name, multiplier: value }, region) };
    }),
);

/**
 * Create or edit a question (AC-3, AC-18). Key, type and scope are set on create only: an edit sends none
 * of them, and no grant would let it. A question an active formula reads keeps its key, its required flag,
 * its price flag and every matched option (`question_in_use`, AC-4).
 */
export const saveQuestion = guardedAction(
  { name: 'saveQuestion', access: ['admin'], schema: SaveQuestionSchema },
  async (input) =>
    mapped(async () => {
      const select = SELECT_TYPES.includes(input.type);
      const fields = {
        label: input.label,
        help_text: input.helpText,
        required: input.required,
        affects_pricing: input.affectsPricing,
        options: select ? input.options : null,
        validation:
          select || input.type === 'boolean' || input.type === 'date' || input.type === 'time'
            ? null
            : input.validation,
      };
      if (input.id) {
        await updateRow('questions', input.id, fields);
        return { id: input.id };
      }
      const region = await parentRegion('service_categories', input.categoryId);
      if (!region) return fail('forbidden');
      const row = {
        ...fields,
        category_id: input.categoryId,
        service_id: input.serviceId,
        region,
        key: input.key,
        type: input.type,
      };
      return { id: await insertRow('questions', row, input.categoryId) };
    }),
);

/**
 * Spec 0011-19b AC-2: create or edit an application question. Key and type are set on create only; there is no
 * scope and no price flag, so an application question never reaches the pricing engine. A sixth active question
 * is refused in Postgres (`too_many_questions`), and nothing is deleted (`application_question_retire`).
 */
export const saveApplicationQuestion = guardedAction(
  { name: 'saveApplicationQuestion', access: ['admin'], schema: SaveApplicationQuestionSchema },
  async (input) =>
    mapped(async () => {
      const fields = {
        label: input.label,
        help_text: input.helpText,
        required: input.required,
        options: input.type === 'single_select' ? input.options : null,
        validation: input.type === 'textarea' ? input.validation : null,
      };
      if (input.id) {
        await updateRow('application_questions', input.id, fields);
        return { id: input.id };
      }
      const region = await parentRegion('service_categories', input.categoryId);
      if (!region) return fail('forbidden');
      const row = { ...fields, category_id: input.categoryId, region, key: input.key, type: input.type };
      return { id: await insertRow('application_questions', row, input.categoryId) };
    }),
);

/** Spec 0011-19b AC-2: move an application question up or down in its category's list. */
export const moveApplicationQuestion = guardedAction(
  { name: 'moveApplicationQuestion', access: ['admin'], schema: MoveApplicationQuestionSchema },
  async ({ id, direction }) =>
    mapped(async () => {
      await moveRow('application_questions', id, direction);
      return { done: true };
    }),
);

/** Turn a row on or off, in both directions (AC-17). A question in use cannot go off (AC-4). */
export const setCatalogActive = guardedAction(
  { name: 'setCatalogActive', access: ['admin'], schema: SetActiveSchema },
  async ({ table, id, active }) =>
    mapped(async () => {
      await updateRow(table, id, { active });
      return { done: true };
    }),
);

/** Move a row up or down in its list (AC-17). */
export const moveCatalogRow = guardedAction(
  { name: 'moveCatalogRow', access: ['admin'], schema: MoveRowSchema },
  async ({ table, id, direction }) =>
    mapped(async () => {
      await moveRow(table, id, direction);
      return { done: true };
    }),
);
