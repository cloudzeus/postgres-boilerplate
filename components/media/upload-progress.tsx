'use client';

import * as React from 'react';
import { FiX, FiCheck, FiAlertCircle, FiUpload } from 'react-icons/fi';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';

export type UploadItem = {
  id: string;
  file: File;
  progress: number; // 0..100
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
  uploadedId?: string;
  publicUrl?: string;
};

export interface UploadProgressProps {
  items: UploadItem[];
  open: boolean;
  onClose: () => void;
  onCancel?: (id: string) => void;
}

export function UploadProgress({ items, open, onClose, onCancel }: UploadProgressProps) {
  const done = items.filter((i) => i.status === 'done').length;
  const errored = items.filter((i) => i.status === 'error').length;
  const active = items.filter((i) => i.status === 'uploading' || i.status === 'queued').length;
  const allFinished = active === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && allFinished) onClose(); }}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15" aria-hidden>
            <FiUpload className="size-4" />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="text-[length:var(--fs-15)]">Μεταφόρτωση αρχείων</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)] tabular-nums" aria-live="polite">
              {done}/{items.length} ολοκληρώθηκαν
              {errored > 0 && <span className="text-destructive"> · {errored} σφάλματα</span>}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto bg-muted/20 px-4 py-3">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {items.map((item) => (
              <li key={item.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center" aria-hidden>
                    {item.status === 'done' && <FiCheck className="size-4 text-emerald-600 dark:text-emerald-400" />}
                    {item.status === 'error' && <FiAlertCircle className="size-4 text-destructive" />}
                    {(item.status === 'uploading' || item.status === 'queued') && <FiUpload className="size-3.5 text-sisyphus-600 dark:text-sisyphus-300" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[length:var(--fs-12)] font-medium text-foreground" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <span className="shrink-0 text-[length:var(--fs-11)] tabular-nums text-muted-foreground">
                    {formatBytes(item.file.size)}
                  </span>
                  <span className={`w-10 shrink-0 text-right text-[length:var(--fs-11)] font-semibold tabular-nums ${
                    item.status === 'error'
                      ? 'text-destructive'
                      : item.status === 'done'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-sisyphus-700 dark:text-sisyphus-300'
                  }`}>
                    {item.status === 'error' ? '—' : `${item.status === 'done' ? 100 : item.progress}%`}
                  </span>
                  {(item.status === 'uploading' || item.status === 'queued') && onCancel ? (
                    <button
                      type="button"
                      onClick={() => onCancel(item.id)}
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500"
                      aria-label="Ακύρωση"
                    >
                      <FiX className="size-3.5" />
                    </button>
                  ) : (
                    <span className="size-6 shrink-0" aria-hidden />
                  )}
                </div>
                <div
                  className="ml-7 mr-8 mt-1 h-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={item.file.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.status === 'done' ? 100 : item.progress}
                >
                  <div
                    className={`h-full transition-[width] duration-150 ${
                      item.status === 'error'
                        ? 'bg-destructive'
                        : item.status === 'done'
                          ? 'bg-emerald-500'
                          : 'bg-sisyphus-500'
                    }`}
                    style={{ width: `${item.status === 'done' ? 100 : item.progress}%` }}
                  />
                </div>
                {item.status === 'error' && item.error && (
                  <div className="ml-7 mt-1 text-[length:var(--fs-11)] text-destructive" role="alert">{item.error}</div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button variant="outline" onClick={onClose} disabled={!allFinished}>
            {allFinished ? 'Κλείσιμο' : 'Σε εξέλιξη…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Hook for managing concurrent uploads with XHR progress
export function useUploader(folderId: string | null, onComplete?: () => void) {
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const [open, setOpen] = React.useState(false);
  const xhrs = React.useRef(new Map<string, XMLHttpRequest>());

  const upload = (files: File[]) => {
    const newItems: UploadItem[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      progress: 0,
      status: 'queued' as const,
    }));
    setItems((prev) => [...prev, ...newItems]);
    setOpen(true);
    newItems.forEach(startUpload);
  };

  const startUpload = (item: UploadItem) => {
    const fd = new FormData();
    fd.append('file', item.file);
    if (folderId) fd.append('folderId', folderId);

    const xhr = new XMLHttpRequest();
    xhrs.current.set(item.id, xhr);
    xhr.open('POST', '/api/admin/media/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'uploading' as const, progress: pct } : i));
      }
    };
    xhr.onload = () => {
      xhrs.current.delete(item.id);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          setItems((prev) => prev.map((i) => i.id === item.id ? {
            ...i, status: 'done' as const, progress: 100,
            uploadedId: data.file?.id, publicUrl: data.file?.publicUrl,
          } : i));
        } catch {
          setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'error' as const, error: 'Bad response' } : i));
        }
        onComplete?.();
      } else {
        let msg = `HTTP ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'error' as const, error: msg } : i));
      }
    };
    xhr.onerror = () => {
      xhrs.current.delete(item.id);
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'error' as const, error: 'Network error' } : i));
    };
    xhr.onabort = () => {
      xhrs.current.delete(item.id);
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: 'error' as const, error: 'Ακυρώθηκε' } : i));
    };
    xhr.send(fd);
  };

  const cancel = (id: string) => {
    xhrs.current.get(id)?.abort();
  };

  const close = () => {
    setOpen(false);
    setItems([]);
  };

  return { items, open, upload, cancel, close, setOpen };
}
