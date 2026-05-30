'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/lib/design-system';

export function DeleteTemplateButton({ id }: { id: string }) {
  const router = useRouter();

  async function handleDelete() {
    if (!window.confirm('Διαγραφή προτύπου;')) return;
    await fetch(`/api/admin/ocr/templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <Button variant="danger" size="sm" onClick={handleDelete}>
      Διαγραφή
    </Button>
  );
}
