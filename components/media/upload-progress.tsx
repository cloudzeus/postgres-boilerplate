'use client';

import * as React from 'react';
import { FiX, FiCheck, FiAlertCircle, FiUpload } from 'react-icons/fi';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
      <DialogContent className="!max-w-xl sm:!max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FiUpload className="text-primary" />
            Μεταφόρτωση αρχείων
            <span className="ml-auto text-[12px] font-normal text-muted-foreground">
              {done}/{items.length} ολοκληρώθηκαν
              {errored > 0 && <span className="text-destructive"> · {errored} σφάλματα</span>}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
          {items.map((item) => (
            <div key={item.id} className="rounded-md border border-border bg-card p-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-foreground truncate">{item.file.name}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {formatBytes(item.file.size)}
                    {item.status === 'uploading' && ` · ${item.progress}%`}
                  </div>
                </span>
                {item.status === 'done' && <FiCheck className="size-4 text-emerald-600 shrink-0" />}
                {item.status === 'error' && <FiAlertCircle className="size-4 text-destructive shrink-0" />}
                {(item.status === 'uploading' || item.status === 'queued') && onCancel && (
                  <button
                    type="button"
                    onClick={() => onCancel(item.id)}
                    className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Ακύρωση"
                  >
                    <FiX className="size-3" />
                  </button>
                )}
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full transition-[width] duration-150 ${
                    item.status === 'error'
                      ? 'bg-destructive'
                      : item.status === 'done'
                        ? 'bg-emerald-500'
                        : 'bg-primary'
                  }`}
                  style={{ width: `${item.status === 'done' ? 100 : item.progress}%` }}
                />
              </div>
              {item.status === 'error' && item.error && (
                <div className="mt-1 text-[10px] text-destructive">{item.error}</div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose} disabled={!allFinished}>
            {allFinished ? 'Κλείσιμο' : 'Σε εξέλιξη…'}
          </Button>
        </div>
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
