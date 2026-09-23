'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiUploadCloud, FiLoader, FiZap, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import {
  SUPPORTED_LANGUAGES, UPLOAD_DOC_TYPES, UPLOAD_DOC_TYPE_LABELS, AUTO_DOC_TYPE_HINT,
  type ExtractDocType, type SupportedLang,
} from '@/lib/ocr/templates';
import { MAX_OCR_MB, MAX_SPLIT_MB } from '@/lib/ocr/limits';
import { OcrResultModal } from './result-modal';
import { OcrSplitPreview, type SplitPreviewData } from './split-preview';

/** Η προτίμηση «ανοιχτή/κλειστή» ζει ανά περιηγητή: είναι συνήθεια του χρήστη, όχι ρύθμιση. */
const PANEL_KEY = 'ocr.upload.panelOpen';

export function OcrUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  // «Αυτόματα» είναι η προεπιλογή: ο χρήστης δεν χρειάζεται να ξέρει τι κρατάει στο χέρι.
  const [docType, setDocType] = useState<ExtractDocType>('auto');
  const [language, setLanguage] = useState<SupportedLang>('el');
  const [pdfSource, setPdfSource] = useState<'auto' | 'digital' | 'scanned'>('auto');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // Πολυ-παραστατικό PDF: ο σαρωτής βγάζει ΕΝΑ αρχείο με όλη τη στοίβα της ημέρας.
  const [multiDoc, setMultiDoc] = useState(false);
  const [split, setSplit] = useState<SplitPreviewData | null>(null);
  /**
   * Συμπτυγμένη ΑΠΟ ΠΡΟΕΠΙΛΟΓΗ: η φόρμα ανεβάσματος είναι η ενέργεια της ημέρας, όχι της ώρας —
   * ο πίνακας των παραστατικών είναι. Ανοιχτή έτρωγε ~450px πριν φανεί η πρώτη γραμμή.
   *
   * Το αρχικό render είναι ΠΑΝΤΑ συμπτυγμένο και η προτίμηση διαβάζεται σε `useEffect`: το
   * `localStorage` δεν υπάρχει στον server, και μια αρχική τιμή από εκεί θα έσπαγε το hydration.
   */
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(PANEL_KEY) === '1') setOpen(true); } catch { /* ιδιωτική περιήγηση */ }
  }, []);
  function toggle(next: boolean) {
    setOpen(next);
    try { localStorage.setItem(PANEL_KEY, next ? '1' : '0'); } catch { /* ιδιωτική περιήγηση */ }
  }

  async function handleSplitFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('language', language);
      const res = await fetch('/api/admin/ocr/split-preview', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSplit({ ...json, fileName: file.name, docType });
    } catch (err: any) {
      toast.error(`Αποτυχία προεπισκόπησης: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleFile(file: File) {
    // Το «πολλά παραστατικά» αφορά μόνο PDF· μια φωτογραφία είναι ένα παραστατικό.
    if (multiDoc) {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        await handleSplitFile(file);
        return;
      }
      toast.info('Ο διαχωρισμός αφορά μόνο PDF — το αρχείο ανεβαίνει ως ένα παραστατικό.');
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('docType', docType);
      fd.set('language', language);
      fd.set('pdfSource', pdfSource);
      const res = await fetch('/api/admin/ocr', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('Η εξαγωγή ολοκληρώθηκε');
      setResultId(json.id);
      setModalOpen(true);
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα OCR: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  }

  // Η περίληψη που αντικαθιστά τις ρυθμίσεις όταν η φόρμα είναι κλειστή. Το «πολλά παραστατικά»
  // μπαίνει ΜΟΝΟ όταν είναι αναμμένο: αλλάζει τι συμβαίνει στο drop, και κρυμμένο θα ξάφνιαζε.
  const settingsSummary = [
    UPLOAD_DOC_TYPE_LABELS[docType],
    SUPPORTED_LANGUAGES[language].label,
    pdfSource === 'auto' ? 'PDF αυτόματα' : pdfSource === 'digital' ? 'PDF ψηφιακό' : 'PDF σάρωση',
    multiDoc ? 'πολλά παραστατικά' : null,
  ].filter(Boolean).join(' · ');

  // Όσο ο χρήστης ορίζει κοψίματα, η φόρμα παραχωρεί τη θέση της: δύο «πρωτεύουσες» ενέργειες
  // στην ίδια οθόνη (ανέβασμα και διαχωρισμός) θα ήταν μόνο σύγχυση.
  if (split) {
    return <OcrSplitPreview data={split} onCancel={() => setSplit(null)} />;
  }

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
        {/* Header band — και ο διακόπτης σύμπτυξης */}
        <header className="border-b border-border bg-gradient-to-r from-sisyphus-50 via-card to-card">
          <button
            type="button"
            onClick={() => toggle(!open)}
            aria-expanded={open}
            aria-controls="ocr-upload-options"
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-sisyphus-500/5"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sisyphus-500 text-white shadow-fluent-2">
                <FiZap className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold tracking-tight text-foreground">Νέα ανάλυση εγγράφου</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {/* Κλειστή: ο χρήστης πρέπει να βλέπει ΜΕ ΤΙ θα τρέξει, χωρίς να την ανοίξει. */}
                  {open
                    ? 'DeepSeek για ψηφιακά PDF · Gemini Vision για εικόνες και σαρωμένα'
                    : settingsSummary}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2.5">
              <span className="hidden text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:inline">
                {open ? 'Σύμπτυξη' : 'Ρυθμίσεις'}
              </span>
              {open ? <FiChevronUp className="size-4 text-muted-foreground" /> : <FiChevronDown className="size-4 text-muted-foreground" />}
            </span>
          </button>
        </header>

        {open && (
        <>
        <div id="ocr-upload-options" className="grid grid-cols-1 gap-4 p-5 md:grid-cols-[1fr_1fr_auto]">
          {/* Doc type */}
          <Field label="Τύπος εγγράφου" hint={docType === 'auto' ? AUTO_DOC_TYPE_HINT : undefined}>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as ExtractDocType)}
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm transition focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
            >
              {UPLOAD_DOC_TYPES.map((key) => (
                <option key={key} value={key}>{UPLOAD_DOC_TYPE_LABELS[key]}</option>
              ))}
            </select>
          </Field>

          {/* Language */}
          <Field label="Γλώσσα εξόδου">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as SupportedLang)}
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm transition focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
            >
              {(Object.entries(SUPPORTED_LANGUAGES) as [SupportedLang, { label: string }][]).map(([key, l]) => (
                <option key={key} value={key}>{l.label}</option>
              ))}
            </select>
          </Field>

          {/* Mode segmented control */}
          <Field label="PDF Mode">
            <div className="flex h-9 rounded-md border border-input bg-background p-0.5 text-[12px] font-medium">
              {(['auto', 'digital', 'scanned'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPdfSource(m)}
                  className={cn(
                    'flex items-center justify-center rounded-sm px-3 transition',
                    pdfSource === m
                      ? 'bg-sisyphus-500 text-white shadow-fluent-2'
                      : 'text-foreground hover:bg-neutral-8',
                  )}
                >
                  {m === 'auto' ? 'Αυτό' : m === 'digital' ? 'Ψηφ.' : 'Scan'}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* Πολυ-παραστατικό PDF */}
        <div className="px-5 pb-3">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-input bg-neutral-6/40 px-3 py-2.5 transition hover:border-sisyphus-500/50">
            <input
              type="checkbox"
              checked={multiDoc}
              onChange={(e) => setMultiDoc(e.target.checked)}
              disabled={busy}
              className="mt-0.5 size-4 accent-[var(--sisyphus-500,#2563eb)]"
            />
            <span>
              <span className="block text-[13px] font-medium text-foreground">
                Το αρχείο περιέχει πολλά παραστατικά
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Μόνο για PDF, έως {MAX_SPLIT_MB} MB. Θα δεις πρώτα τις σελίδες και θα ορίσεις πού
                κόβεται κάθε παραστατικό.
              </span>
            </span>
          </label>
        </div>
        </>
        )}

        {/* Drop zone — ΠΑΝΤΑ ορατή, και κλειστή: το drop είναι ο λόγος ύπαρξης της κάρτας. */}
        <div className={cn('px-5', open ? 'pb-5' : 'pb-4 pt-4')}>
          <label
            onDragEnter={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDrop={onDrop}
            className={cn(
              'relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 text-center transition-all duration-fluent-150 ease-standard',
              open ? 'py-12' : 'py-5',
              busy && 'cursor-not-allowed border-sisyphus-500 bg-sisyphus-500/5',
              !busy && dragOver && 'border-sisyphus-500 bg-sisyphus-500/10 scale-[1.005]',
              !busy && !dragOver && 'border-input bg-neutral-6/40 hover:border-sisyphus-500/50 hover:bg-sisyphus-500/5',
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/tiff,image/bmp"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
            {busy ? (
              <>
                <span className="inline-flex size-12 items-center justify-center rounded-full bg-sisyphus-500/15">
                  <FiLoader className="size-5 animate-spin text-sisyphus-600" />
                </span>
                <p className="text-sm font-semibold text-sisyphus-600">
                  {multiDoc ? 'Προετοιμασία σελίδων…' : 'Ανάλυση μέσω AI…'}
                </p>
                {open && (
                  <p className="text-[11px] text-muted-foreground">
                    Εξαγωγή πεδίων, line items, και σχηματισμός JSON. Διαρκεί 5-25 δευτερόλεπτα.
                  </p>
                )}
              </>
            ) : (
              <>
                <span className={cn(
                  'inline-flex items-center justify-center rounded-full bg-sisyphus-500/10 text-sisyphus-600',
                  open ? 'size-12' : 'size-8',
                )}>
                  <FiUploadCloud className={open ? 'size-5' : 'size-4'} />
                </span>
                <p className="text-sm font-semibold text-foreground">
                  {multiDoc ? 'Σύρε το PDF εδώ — συνέχεια στον διαχωρισμό' : 'Σύρε αρχείο εδώ ή κάνε κλικ για επιλογή'}
                </p>
                {open && (
                  <p className="text-[11px] text-muted-foreground">
                    {multiDoc
                      ? `PDF · έως ${MAX_SPLIT_MB} MB`
                      : `PDF, PNG, JPG, WebP, GIF, TIFF, BMP · έως ${MAX_OCR_MB} MB`}
                  </p>
                )}
              </>
            )}
          </label>
        </div>
      </section>

      <OcrResultModal
        open={modalOpen}
        documentId={resultId}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
