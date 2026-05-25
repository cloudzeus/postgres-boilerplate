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
      {label && <span className="text-[12px] font-semibold text-foreground">{label}</span>}

      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
          <div className="size-12 shrink-0 rounded bg-muted overflow-hidden relative flex items-center justify-center">
            {value.isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.publicUrl} alt={value.name} className="size-full object-cover" />
            ) : (
              <FiImage className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-foreground truncate">{value.name}</div>
            <div className="text-[10px] text-muted-foreground truncate">
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
            <Button type="button" variant="outline" className="w-full justify-start gap-2 h-10">
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
    <DialogContent className="!max-w-5xl w-[95vw] sm:!max-w-5xl">
      <DialogHeader>
        <DialogTitle>Επιλογή από Media Gallery</DialogTitle>
        <DialogDescription>
          Διάλεξε υπάρχον αρχείο ή ανέβασε νέα. Click σε αρχείο για επιλογή.
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-[70vh] overflow-y-auto">
        <MediaBrowser pickerMode onPick={onPick} acceptImagesOnly={acceptImagesOnly} />
      </div>
    </DialogContent>
  );
}
