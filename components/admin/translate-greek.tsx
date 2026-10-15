'use client';

// «Ελληνικά»: μετάφραση της περιγραφής ενός ξένου είδους, κατά παραγγελία (βλ. `lib/ocr/translate-ai.ts`).
// Η αρχική περιγραφή κρατιέται και επανέρχεται με ένα κλικ.
import * as React from 'react';
import { FiGlobe, FiLoader, FiRotateCcw } from 'react-icons/fi';
import { toast } from 'sonner';
import { looksForeign, parseNameCase, type NameCase } from '@/lib/item-naming';

export { looksForeign };

export interface ItemNamingCfg { nameCase: NameCase; autoTranslate: boolean }
let namingCache: Promise<ItemNamingCfg> | null = null;

/** Ρυθμίσεις → «Αρχικοποίηση εφαρμογής» (μία φορά ανά σελίδα). */
export function useItemNaming(): ItemNamingCfg | null {
  const [cfg, setCfg] = React.useState<ItemNamingCfg | null>(null);
  React.useEffect(() => {
    namingCache ??= fetch('/api/admin/ocr/item-naming', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => ({ nameCase: parseNameCase(d?.nameCase), autoTranslate: d?.autoTranslate === true }))
      .catch(() => { namingCache = null; return { nameCase: 'asis' as NameCase, autoTranslate: false }; });
    let alive = true;
    void namingCache.then((c) => { if (alive) setCfg(c); });
    return () => { alive = false; };
  }, []);
  return cfg;
}

/**
 * `auto`: με τη ρύθμιση «Αυτόματη μετάφραση» η ξένη περιγραφή μεταφράζεται ΜΟΛΙΣ ανοίξει η φόρμα
 * (μία φορά ανά γραμμή/ομάδα) — ο χρήστης τη βλέπει πριν τη δημιουργία και μπορεί να την επαναφέρει.
 * Η αρχική (`original`) πάει στην «Περιγραφή 2» (NAME1) της SoftOne.
 */
export function useGreekTranslation(value: string, setValue: (v: string) => void, lineId?: string | null, resetKey?: unknown, auto = false) {
  const [busy, setBusy] = React.useState(false);
  const [original, setOriginal] = React.useState<string | null>(null);
  const autoDone = React.useRef(false);
  // Άλλη γραμμή/ομάδα ⇒ η «αρχική» της προηγούμενης δεν ισχύει πια.
  React.useEffect(() => { setOriginal(null); autoDone.current = false; }, [resetKey]);
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
  React.useEffect(() => {
    if (!auto || autoDone.current || busy || original != null || !looksForeign(value)) return;
    autoDone.current = true;
    void translate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, value, resetKey]);
  return { busy, original, translate, restore, offer: looksForeign(value) && original == null };
}

/**
 * Τι ΑΚΡΙΒΩΣ θα γραφτεί (NAME / NAME1) με τη ρύθμιση πεζών/κεφαλαίων — ρωτά τον server, που κάνει
 * και τον τονισμό των πεζών. `null` όσο δεν χρειάζεται («όπως γράφονται», χωρίς αρχική).
 */
export function useNamePreview(name: string, original: string | null, cfg: ItemNamingCfg | null, lineId?: string | null) {
  const [out, setOut] = React.useState<{ name: string; name1: string | null } | null>(null);
  const needed = !!cfg && !!name.trim() && (cfg.nameCase !== 'asis' || original != null);
  React.useEffect(() => {
    if (!needed) { setOut(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      fetch('/api/admin/ocr/item-naming', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim().slice(0, 200), original, lineId: lineId ?? undefined }),
      }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive) setOut(d?.name ? { name: d.name, name1: d.name1 ?? null } : null); })
        .catch(() => { if (alive) setOut(null); });
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [needed, name, original, lineId]);
  return out;
}

/** «Στη SoftOne: …» κάτω από το πεδίο — μόνο όταν διαφέρει από ό,τι γράφει το πεδίο ή υπάρχει NAME1. */
export function NamePreview({ typed, preview }: { typed: string; preview: { name: string; name1: string | null } | null }) {
  if (!preview || (preview.name === typed.trim() && !preview.name1)) return null;
  return (
    <p className="min-w-0 text-[length:var(--fs-11)] text-muted-foreground">
      <span className="font-medium text-foreground/80">Στη SoftOne:</span>{' '}
      <span className="break-words text-foreground">«{preview.name}»</span>
      {preview.name1 && <> · <span className="font-medium text-foreground/80">Περιγραφή 2:</span> <span className="break-words">«{preview.name1}»</span></>}
    </p>
  );
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
