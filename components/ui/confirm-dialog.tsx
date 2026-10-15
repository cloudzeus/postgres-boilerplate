'use client';

// Επιβεβαίωση ενέργειας ΜΕΣΑ στην εφαρμογή — αντί για `window.confirm()`.
//
// Το `confirm()` του browser δεν εμφανίζεται σε ενσωματωμένα browsers (π.χ. το πάνελ της εφαρμογής
// Claude, webviews): επιστρέφει ΑΜΕΣΩΣ `false` και η «Διαγραφή» απλώς δεν έκανε τίποτα. Εδώ:
//   if (!(await confirmAction('Διαγραφή του εγγράφου «x»;'))) return;
// Ο `ConfirmHost` μπαίνει ΜΙΑ φορά στο root layout.
import * as React from 'react';
import { FiAlertTriangle, FiHelpCircle } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ConfirmOptions {
  /** Κύριο κείμενο (επιτρέπει αλλαγές γραμμής με \n). */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Κόκκινο κουμπί/εικονίδιο. Αν λείπει: αυτόματα για «Διαγραφή…», «Ακύρωση…», «Επαναφορά…». */
  destructive?: boolean;
}
type Request = ConfirmOptions & { resolve: (ok: boolean) => void };

let push: ((r: Request) => void) | null = null;

/** Ζητά επιβεβαίωση· `true` = ο χρήστης πάτησε το κουμπί ενέργειας. */
export function confirmAction(input: string | ConfirmOptions): Promise<boolean> {
  const opts: ConfirmOptions = typeof input === 'string' ? { message: input } : input;
  if (!push) return Promise.resolve(typeof window !== 'undefined' ? window.confirm(opts.message) : false);
  return new Promise((resolve) => push!({ ...opts, resolve }));
}

const DESTRUCTIVE = /^(διαγραφ|ακύρωσ|επαναφορ|αφαίρεσ|είσαι σίγουρος)/i;

/** Αρχικό ρήμα του μηνύματος ως ετικέτα κουμπιού («Διαγραφή …;» → «Διαγραφή»). */
function verbOf(message: string): string {
  const w = message.trim().split(/[\s;:,.«"]/)[0] ?? '';
  return w.length >= 4 && w.length <= 14 ? w : 'Επιβεβαίωση';
}

export function ConfirmHost() {
  const [req, setReq] = React.useState<Request | null>(null);
  React.useEffect(() => {
    push = (r) => setReq((prev) => { prev?.resolve(false); return r; });
    return () => { push = null; };
  }, []);
  const close = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  if (!req) return null;
  const destructive = req.destructive ?? DESTRUCTIVE.test(req.message.trim());
  const [first, ...rest] = req.message.split('\n');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-3 px-4 pb-2 pt-4 pr-12">
          <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-lg',
            destructive ? 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' : 'bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15')}>
            {destructive ? <FiAlertTriangle className="size-4" /> : <FiHelpCircle className="size-4" />}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <DialogTitle className="text-[length:var(--fs-14)] leading-snug">{req.title ?? first}</DialogTitle>
            {(req.title ? req.message : rest.join('\n')).trim() && (
              <DialogDescription className="whitespace-pre-line text-[length:var(--fs-12)]">
                {req.title ? req.message : rest.join('\n').trim()}
              </DialogDescription>
            )}
          </div>
        </DialogHeader>
        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
          <Button variant="outline" onClick={() => close(false)}>{req.cancelLabel ?? 'Άκυρο'}</Button>
          <Button
            autoFocus variant={destructive ? 'destructive' : 'default'} onClick={() => close(true)}
          >
            {req.confirmLabel ?? verbOf(first)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
