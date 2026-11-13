import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0006 AC-8: `removeOld` compares what it asked to delete with what Storage says it deleted. A hidden
 * or kept object is simply missing from Storage's answer, never an error, so only the comparison catches it.
 */

const m = vi.hoisted(() => ({ remove: vi.fn(), from: vi.fn() }));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ storage: { from: m.from } })),
}));

import { removeOld } from '@/lib/storage/server';

beforeEach(() => {
  vi.clearAllMocks();
  m.from.mockReturnValue({ remove: m.remove });
});

describe('removeOld', () => {
  it('reports nothing failed when every path was deleted', async () => {
    m.remove.mockResolvedValue({ data: [{ name: 'a.jpg' }, { name: 'b.jpg' }], error: null });
    await expect(removeOld('provider-documents', ['a.jpg', 'b.jpg'])).resolves.toEqual({ failed: [] });
    expect(m.from).toHaveBeenCalledWith('provider-documents');
  });

  it('reports the paths missing from a partial answer', async () => {
    m.remove.mockResolvedValue({ data: [{ name: 'a.jpg' }], error: null });
    await expect(removeOld('provider-documents', ['a.jpg', 'b.jpg'])).resolves.toEqual({ failed: ['b.jpg'] });
  });

  it('reports every path when Storage deleted none (the policy hid them): an empty list, no error', async () => {
    m.remove.mockResolvedValue({ data: [], error: null });
    await expect(removeOld('provider-photos', ['a.jpg'])).resolves.toEqual({ failed: ['a.jpg'] });
  });

  it('reports every path on an error or a throw', async () => {
    m.remove.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(removeOld('provider-documents', ['a.jpg'])).resolves.toEqual({ failed: ['a.jpg'] });
    m.remove.mockRejectedValueOnce(new Error('network'));
    await expect(removeOld('provider-documents', ['a.jpg'])).resolves.toEqual({ failed: ['a.jpg'] });
  });

  it('asks once per path and makes no call for an empty list', async () => {
    m.remove.mockResolvedValue({ data: [{ name: 'a.jpg' }], error: null });
    await removeOld('provider-documents', ['a.jpg', 'a.jpg', '']);
    expect(m.remove).toHaveBeenCalledWith(['a.jpg']);
    m.remove.mockClear();
    await expect(removeOld('provider-documents', [])).resolves.toEqual({ failed: [] });
    expect(m.remove).not.toHaveBeenCalled();
  });
});
