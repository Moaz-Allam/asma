'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { registerDocument } from '@/actions/provider';
import { track } from '@/lib/analytics/client';
import type { DocumentType } from '@/lib/storage/buckets';
import { uploadProviderFile } from '@/lib/storage/client';
import type { UploadCode } from '@/lib/storage/files';

/**
 * One upload, end to end (spec 0006 AC-7): the browser checks and uploads, then the Server Action
 * registers the path with the database, then the page refreshes from the server. A failed step leaves the
 * row as it was and shows a plain message with a retry. Only the reason reaches analytics (AC-24).
 *
 * When the upload worked and only the register failed, picking the same file again registers the object
 * already in Storage instead of uploading a second one, so retries leave no orphans that count toward the
 * 20 object cap (AC-22).
 */

const REASON: Readonly<Record<UploadCode, 'too_large' | 'wrong_type' | 'refused' | 'network'>> = {
  file_too_large: 'too_large',
  file_type_refused: 'wrong_type',
  image_unreadable: 'wrong_type',
  upload_refused: 'refused',
  network: 'network',
};

/** Name, size and date: enough to know the person picked the same file again. */
function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

export function useProviderUpload(userId: string, type: DocumentType) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const unregistered = useRef<{ key: string; path: string } | null>(null);

  function upload(file: File, onDone?: (result: { backToReview: boolean }) => void) {
    setError(null);
    startTransition(async () => {
      const key = fileKey(file);
      let path = unregistered.current?.key === key ? unregistered.current.path : null;
      if (path === null) {
        const uploaded = await uploadProviderFile(userId, type, file);
        if (!uploaded.ok) {
          track('document_upload_failed', { reason: REASON[uploaded.code] });
          setError(uploaded.code);
          return;
        }
        path = uploaded.path;
      }

      let registered: Awaited<ReturnType<typeof registerDocument>>;
      try {
        registered = await registerDocument({ type, path });
      } catch {
        // The action never answered: the object is in Storage, so a retry registers it.
        unregistered.current = { key, path };
        track('document_upload_failed', { reason: 'network' });
        setError('network');
        return;
      }
      if (!registered.success) {
        // file_missing means the object is gone: the next try uploads again.
        unregistered.current = registered.error === 'file_missing' ? null : { key, path };
        track('document_upload_failed', { reason: 'refused' });
        setError(registered.error);
        return;
      }
      unregistered.current = null;
      onDone?.({ backToReview: registered.data.backToReview });
      router.refresh();
    });
  }

  return { upload, error, isPending, clearError: () => setError(null) };
}
