'use client';

// Ο ΕΝΑΣ διάλογος επανεκτέλεσης. Και η λίστα και η καρτέλα άνοιγαν μέχρι τώρα ένα `confirm()` που
// δεν χωρούσε επιλογή τύπου· εδώ ο χρήστης βλέπει τι θα κοστίσει και μπορεί να αλλάξει το είδος
// (προεπιλογή «Αυτόματα» — η επανεκτέλεση είναι ακριβώς η στιγμή να διορθωθεί λάθος ταξινόμηση).

import * as React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FiFileText, FiRefreshCw, FiZap } from 'react-icons/fi';
import { Field, FormSection, FormSelect, RowHint } from '@/components/admin/form-kit';
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
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15">
            <FiRefreshCw className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--fs-15)]">Επανεκτέλεση ανάγνωσης</DialogTitle>
            <DialogDescription className="truncate text-[length:var(--fs-11)]" title={fileName ?? undefined}>
              {fileName ? `«${fileName}»` : 'Το έγγραφο θα ξαναδιαβαστεί'}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="space-y-3 bg-muted/20 px-4 py-3">
          <FormSection tone="amber" icon={<FiZap />} title="Μοντέλο" aside={<span className="font-mono">gemini-2.5-pro</span>}>
            <p className="text-[length:var(--fs-12)] leading-snug text-foreground">
              Το έγγραφο{fileName ? ` «${fileName}»` : ''} θα ξαναδιαβαστεί με ισχυρότερο μοντέλο
              (gemini-2.5-pro): πιο αργό και πιο ακριβό, αλλά αποδίδει καλύτερα σε θολές σαρώσεις.
            </p>
          </FormSection>

          <FormSection tone="blue" icon={<FiFileText />} title="Είδος εγγράφου">
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <Field label="Τύπος εγγράφου" htmlFor="reextract-doctype" className="col-span-12">
                <FormSelect
                  id="reextract-doctype"
                  value={docType}
                  onChange={(v) => setDocType(v as ExtractDocType)}
                  opts={UPLOAD_DOC_TYPES.map((key) => ({ id: key, name: UPLOAD_DOC_TYPE_LABELS[key] }))}
                />
              </Field>
            </div>
            {docType === 'auto' ? <RowHint>{AUTO_DOC_TYPE_HINT}</RowHint> : null}
          </FormSection>
        </div>

        {/* `mx-0 mb-0`: το DialogFooter έχει `-mx-4 -mb-4` για modal με padding· εδώ είναι `p-0`. */}
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Άκυρο</Button>
          <Button type="button" onClick={() => onConfirm(docType)} disabled={busy}>
            <FiRefreshCw aria-hidden className={busy ? 'size-3.5 animate-spin motion-reduce:animate-none' : 'size-3.5'} />
            {busy ? 'Εκτελείται…' : 'Επανεκτέλεση'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
