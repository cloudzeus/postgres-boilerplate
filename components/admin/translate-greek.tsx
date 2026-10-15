'use client';

// «Ελληνικά»: μετάφραση της περιγραφής ενός ξένου είδους, κατά παραγγελία (βλ. `lib/ocr/translate-ai.ts`).
// Η αρχική περιγραφή κρατιέται και επανέρχεται με ένα κλικ.
import * as React from 'react';
import { FiGlobe, FiLoader, FiRotateCcw } from 'react-icons/fi';
import { toast } from 'sonner';

/** Έχει το κείμενο περισσότερα λατινικά από ελληνικά γράμματα; (τότε αξίζει μετάφραση) */
export function looksForeign(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const greek = (text.match(/[Α-Ωα-ωάέήίόύώΆΈΉΊΌΎΏϊϋΐΰ]/g) ?? []).length;
  return latin >= 4 && latin > greek;
}

export function useGreekTranslation(value: string, setValue: (v: string) => void, lineId?: string | null, resetKey?: unknown) {
  const [busy, setBusy] = React.useState(false);
  const [original, setOriginal] = React.useState<string | null>(null);
  // Άλλη γραμμή/ομάδα ⇒ η «αρχική» της προηγούμενης δεν ισχύει πια.
  React.useEffect(() => { setOriginal(null); }, [resetKey]);
  const translate = async () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/ocr/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value, lineId: lineId ?? undefined }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.text) { toast.error(d?.message ?? 'Η μετάφραση απέτυχε.'); return; }
      setOriginal(value);
      setValue(d.text);
    } catch { toast.error('Σφάλμα δικτύου.'); } finally { setBusy(false); }
  };
  const restore = () => { if (original != null) { setValue(original); setOriginal(null); } };
  return { busy, original, translate, restore, offer: looksForeign(value) && original == null };
}

/** Κουμπί δίπλα στο πεδίο (ίδιο ύψος h-8). */
export function TranslateButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} disabled={busy}
      title="Μετάφραση της περιγραφής στα Ελληνικά — κωδικοί, διαστάσεις και μάρκες μένουν ως έχουν"
      className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-sisyphus-500/30 bg-sisyphus-50 px-2 text-[length:var(--fs-12)] font-medium text-sisyphus-700 hover:bg-sisyphus-100 disabled:cursor-wait disabled:opacity-70 dark:bg-sisyphus-500/10 dark:text-sisyphus-300"
    >
      {busy ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FiGlobe aria-hidden className="size-3.5" />}
      Ελληνικά
    </button>
  );
}

/** Γραμμή κάτω από το πεδίο: η αρχική περιγραφή + επαναφορά. */
export function TranslatedFrom({ original, onRestore }: { original: string; onRestore: () => void }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[length:var(--fs-11)] text-muted-foreground">
      <span className="truncate" title={original}>Αρχική: «{original}»</span>
      <button type="button" onClick={onRestore} className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 font-medium text-sisyphus-600 hover:underline">
        <FiRotateCcw aria-hidden className="size-3" /> Επαναφορά
      </button>
    </p>
  );
}
