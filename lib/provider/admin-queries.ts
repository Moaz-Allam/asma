import 'server-only';

import { z } from 'zod';

import { createSupabaseServer } from '@/lib/db/server';

import {
  PROVIDER_STATUSES,
  QUEUE_PAGE_SIZE,
  QUEUE_SORTS,
  QUEUE_TABS,
  REVIEW_REASONS,
  type QueueSort,
  type QueueTab,
  type Standing,
} from './options';
import { getProviderFile, getStanding, type ProviderFile } from './queries';

/**
 * The admin side reads of position 02 (spec 0006 AC-13 to AC-15), through RLS: `providers_read_admin`
 * and `profiles_read_admin`. A draft provider appears nowhere.
 */

export type QueueQuery = { tab: QueueTab; sort: QueueSort; page: number };

/** An invalid tab, sort or page falls back silently to pending, oldest, page 1 (AC-14). */
export function parseQueueQuery(params: Record<string, string | string[] | undefined>): QueueQuery {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const tab = one(params.tab);
  const sort = one(params.sort);
  const page = Number.parseInt(one(params.page) ?? '', 10);
  return {
    tab: (QUEUE_TABS as readonly string[]).includes(tab ?? '') ? (tab as QueueTab) : 'pending',
    sort: (QUEUE_SORTS as readonly string[]).includes(sort ?? '') ? (sort as QueueSort) : 'oldest',
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** The query string that keeps the queue as it is, for row links and tabs. */
export function queueSearch({ tab, sort, page }: QueueQuery): string {
  return new URLSearchParams({ tab, sort, page: String(page) }).toString();
}

/** Files under review, for the rail's badge. */
export async function pendingCount(): Promise<number> {
  const supabase = await createSupabaseServer();
  const { count, error } = await supabase
    .from('providers')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}

const QueueRow = z.object({
  id: z.string(),
  status: z.enum(PROVIDER_STATUSES),
  review_reason: z.enum(REVIEW_REASONS).nullable(),
  submitted_at: z.string().nullable(),
  decided_at: z.string().nullable(),
  profiles: z.object({ full_name: z.string() }).nullable(),
});

export type QueueEntry = {
  id: string;
  name: string;
  status: (typeof PROVIDER_STATUSES)[number];
  reviewReason: z.infer<typeof QueueRow>['review_reason'];
  date: string | null;
};

export type QueuePage = { entries: QueueEntry[]; page: number; pages: number; total: number };

/**
 * One page of a tab. Pending sorts on `submitted_at`, the others on `decided_at`, ties on `id`. The page
 * is clamped to the last one, so `?page=99` shows the last page, never an error.
 */
export async function queuePage(query: QueueQuery): Promise<QueuePage> {
  const supabase = await createSupabaseServer();
  const column = query.tab === 'pending' ? 'submitted_at' : 'decided_at';
  const ascending = query.sort === 'oldest';

  const { count, error: countError } = await supabase
    .from('providers')
    .select('id', { count: 'exact', head: true })
    .eq('status', query.tab);
  if (countError) throw countError;
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const from = (page - 1) * QUEUE_PAGE_SIZE;

  const { data, error } = await supabase
    .from('providers')
    .select('id, status, review_reason, submitted_at, decided_at, profiles(full_name)')
    .eq('status', query.tab)
    .order(column, { ascending, nullsFirst: false })
    .order('id', { ascending })
    .range(from, from + QUEUE_PAGE_SIZE - 1);
  if (error) throw error;

  const entries = z
    .array(QueueRow)
    .parse(data ?? [])
    .map((row) => ({
      id: row.id,
      name: row.profiles?.full_name ?? '',
      status: row.status,
      reviewReason: row.review_reason,
      date: query.tab === 'pending' ? row.submitted_at : row.decided_at,
    }));
  return { entries, page, pages, total };
}

const PersonRow = z.object({ full_name: z.string(), phone: z.string(), created_at: z.string() });

export type AdminProviderFile = ProviderFile & {
  /** provider_standing(): document_expired for an approved file with an expired document. */
  standing: Standing | null;
  fullName: string;
  /** The last four digits only, masked on the server before any Client Component (AC-15). */
  phoneLastFour: string;
  joinedAt: string;
};

/** A provider's file for admin, or null for a draft or unknown id (the page answers 404). */
export async function adminProviderFile(providerId: string): Promise<AdminProviderFile | null> {
  const [file, standing] = await Promise.all([getProviderFile(providerId), getStanding(providerId)]);
  if (!file || file.status === 'draft') return null;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, phone, created_at')
    .eq('id', providerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const person = PersonRow.parse(data);
  return {
    ...file,
    standing,
    fullName: person.full_name,
    phoneLastFour: person.phone.slice(-4),
    joinedAt: person.created_at,
  };
}
