'use client';

import * as React from 'react';
import { FiUploadCloud } from 'react-icons/fi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useDesigner } from './designer-context';
import { templatesApi, errorMessage } from './api';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

export function SampleStep() {
  const { dto, setDto, canManage, goToStep } = useDesigner();
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      await templatesApi.uploadSample(dto.id, file);
      setDto(await templatesApi.get(dto.id));
      toast.success('Το δείγμα ανέβηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); };

  return (
    <div className="space-y-4">
      <div><h2 className="text-[16px] font-semibold">Δείγμα εγγράφου</h2><p className="text-[12px] text-muted-foreground">Ένα καθαρό PDF ή εικόνα του προμηθευτή. Πάνω του θα σχεδιάσεις τις περιοχές.</p></div>
      {canManage && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
          onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          className={cn('flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center cx-transition',
            drag ? 'border-sisyphus-500 bg-sisyphus-50' : 'border-border hover:border-sisyphus-300 hover:bg-neutral-4')}>
          <FiUploadCloud className="size-6 text-sisyphus-600" />
          <p className="text-[13px] font-medium">{busy ? 'Ανέβασμα…' : 'Σύρε εδώ ένα PDF ή εικόνα, ή κάνε κλικ'}</p>
          <p className="text-[11px] text-muted-foreground">PDF, PNG, JPEG, WebP · έως 25 MB</p>
          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ''; }} />
        </div>
      )}
      {dto.sample ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={templatesApi.pageImageUrl(dto.id, 0, dto.version, 2)} alt="Δείγμα, σελίδα 1" className="w-full max-w-[280px] rounded-md border border-border shadow-fluent-2" />
          <div className="text-[12px] text-muted-foreground">
            <p><span className="font-medium text-foreground">{dto.sample.mimeType}</span> · {dto.sample.pageCount} σελίδ{dto.sample.pageCount === 1 ? 'α' : 'ες'}</p>
            <button type="button" onClick={() => goToStep(2)} className="mt-2 cursor-pointer text-sisyphus-700 hover:underline">Συνέχεια στις περιοχές →</button>
          </div>
        </div>
      ) : <p className="text-[12px] italic text-muted-foreground">Δεν υπάρχει δείγμα ακόμη.</p>}
    </div>
  );
}
