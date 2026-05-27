'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiTrash2 } from 'react-icons/fi';

export function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm('Διαγραφή εγγράφου και του αρχείου από το Bunny CDN;')) return;
        start(async () => {
          const res = await fetch(`/api/admin/ocr/${id}`, { method: 'DELETE' });
          if (!res.ok) { toast.error('Αποτυχία διαγραφής'); return; }
          toast.success('Διαγράφηκε');
          router.push('/admin/ocr');
          router.refresh();
        });
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
    >
      <FiTrash2 className="size-3.5" /> Διαγραφή
    </button>
  );
}
