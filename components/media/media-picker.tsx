'use client';

import * as React from 'react';
import { FiImage, FiX, FiFolder } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { MediaBrowser } from './media-browser';

export type PickedMediaFile = {
  id: string;
  name: string;
  publicUrl: string;
  originalUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  isImage: boolean;
  isSvg: boolean;
  size: number;
};

interface Props {
  value?: PickedMediaFile | null;
  onChange: (file: PickedMediaFile | null) => void;
  acceptImagesOnly?: boolean;
  label?: string;
  triggerLabel?: string;
  className?: string;
}

/**
 * Reusable media-picker. Click → opens dialog with Media Gallery
 * (also allows uploading new from inside the picker).
 */
export function MediaPicker({
  value, onChange, acceptImagesOnly = false,
  label, triggerLabel = 'Επιλογή από Media',
  className,
}: Props) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      {label && <span className="text-[length:var(--fs-11)] font-medium text-muted-foreground">{label}</span>}

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-1.5">
          <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted ring-1 ring-border">
            {value.isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.publicUrl} alt={value.name} className="size-full object-cover" />
            ) : (
              <FiImage className="size-5 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-[length:var(--fs-13)] font-medium text-foreground" title={value.name}>{value.name}</div>
            <div className="truncate text-[length:var(--fs-11)] tabular-nums text-muted-foreground">
              {value.mimeType}
              {value.width && value.height && ` · ${value.width}×${value.height}`}
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">Αλλαγή</Button>
            </DialogTrigger>
            <PickerDialogBody acceptImagesOnly={acceptImagesOnly} onPick={(f) => { onChange(f); setOpen(false); }} />
          </Dialog>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange(null)}
            aria-label="Αφαίρεση"
          >
            <FiX />
          </Button>
        </div>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" className="h-8 w-full justify-start gap-2 text-[length:var(--fs-13)]">
              <FiFolder className="text-muted-foreground" /> {triggerLabel}
            </Button>
          </DialogTrigger>
          <PickerDialogBody acceptImagesOnly={acceptImagesOnly} onPick={(f) => { onChange(f); setOpen(false); }} />
        </Dialog>
      )}
    </div>
  );
}

function PickerDialogBody({
  acceptImagesOnly, onPick,
}: { acceptImagesOnly: boolean; onPick: (file: PickedMediaFile) => void }) {
  return (
    <DialogContent className="flex max-h-[92vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15" aria-hidden>
          <FiImage className="size-4" />
        </span>
        <div className="min-w-0 text-left">
          <DialogTitle className="text-[length:var(--fs-15)]">Επιλογή από Media Gallery</DialogTitle>
          <DialogDescription className="truncate text-[length:var(--fs-11)]">
            Διάλεξε υπάρχον αρχείο ή ανέβασε νέα. Click σε αρχείο για επιλογή.
          </DialogDescription>
        </div>
      </DialogHeader>
      {/* Εργαλειοθήκη, πλέγμα (με δική του κύλιση) και γραμμή κατάστασης έρχονται από το MediaBrowser. */}
      <MediaBrowser pickerMode onPick={onPick} acceptImagesOnly={acceptImagesOnly} />
    </DialogContent>
  );
}
