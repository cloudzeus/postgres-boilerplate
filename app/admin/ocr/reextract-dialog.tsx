'use client';

// Ο ΕΝΑΣ διάλογος επανεκτέλεσης. Και η λίστα και η καρτέλα άνοιγαν μέχρι τώρα ένα `confirm()` που
// δεν χωρούσε επιλογή τύπου· εδώ ο χρήστης βλέπει τι θα κοστίσει και μπορεί να αλλάξει το είδος
// (προεπιλογή «Αυτόματα» — η επανεκτέλεση είναι ακριβώς η στιγμή να διορθωθεί λάθος ταξινόμηση).

import * as React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  UPLOAD_DOC_TYPES, UPLOAD_DOC_TYPE_LABELS, AUTO_DOC_TYPE_HINT, type ExtractDocType,
} from '@/lib/ocr/templates';

export function ReextractDialog({
  open, fileName, busy, onCancel, onConfirm,
}: {
  open: boolean;
  fileName?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (docType: ExtractDocType) => void;
}) {
  const [docType, setDocType] = React.useState<ExtractDocType>('auto');

  // Κάθε άνοιγμα ξεκινάει καθαρό: η επιλογή του προηγούμενου εγγράφου δεν κληρονομείται.
  React.useEffect(() => { if (open) setDocType('auto'); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Επανεκτέλεση ανάγνωσης</DialogTitle>
          <DialogDescription>
            Το έγγραφο{fileName ? ` «${fileName}»` : ''} θα ξαναδιαβαστεί με ισχυρότερο μοντέλο
            (gemini-2.5-pro): πιο αργό και πιο ακριβό, αλλά αποδίδει καλύτερα σε θολές σαρώσεις.
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1.5">
          <span className="text-[length:var(--fs-10)] font-bold uppercase tracking-wider text-muted-foreground">
            Τύπος εγγράφου
          </span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as ExtractDocType)}
            className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm transition focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
          >
            {UPLOAD_DOC_TYPES.map((key) => (
              <option key={key} value={key}>{UPLOAD_DOC_TYPE_LABELS[key]}</option>
            ))}
          </select>
          {docType === 'auto' ? (
            <span className="text-[length:var(--fs-11)] leading-snug text-muted-foreground">{AUTO_DOC_TYPE_HINT}</span>
          ) : null}
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Άκυρο</Button>
          <Button type="button" onClick={() => onConfirm(docType)} disabled={busy}>
            {busy ? 'Εκτελείται…' : 'Επανεκτέλεση'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
