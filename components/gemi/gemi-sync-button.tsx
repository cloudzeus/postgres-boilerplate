'use client';

import * as React from 'react';
import { FiRefreshCw, FiCheck, FiAlertCircle } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type Props = {
  companyId: string;
  hasIdentifier: boolean;
  onSynced: () => void;
};

export function GemiSyncButton({ companyId, hasIdentifier, onSynced }: Props) {
  const [busy, setBusy] = React.useState(false);

  const sync = async () => {
    if (!hasIdentifier) {
      toast.error('Συμπλήρωσε ΑΦΜ ή Αρ. ΓΕΜΗ πριν τον συγχρονισμό.');
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/admin/companies/${companyId}/gemi-sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncDocuments: true }),
    });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      toast.success(`Συγχρονίστηκε από ΓΕΜΗ · ${d.documentsImported ?? 0} έγγραφα`);
      onSynced();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(
        e.error === 'gemi_not_found' ? 'Δεν βρέθηκε στο ΓΕΜΗ' :
        e.error === 'missing_identifier' ? 'Λείπει ΑΦΜ/Αρ. ΓΕΜΗ' :
        e.error === 'gemi_error' ? `Σφάλμα ΓΕΜΗ: ${e.message ?? e.status}` :
        'Αποτυχία συγχρονισμού',
      );
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={sync}
            disabled={busy}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            aria-label="Συγχρονισμός από ΓΕΜΗ"
          >
            <FiRefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Συγχρονισμός από ΓΕΜΗ (στοιχεία + έγγραφα)</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
