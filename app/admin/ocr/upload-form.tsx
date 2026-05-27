'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiUploadCloud, FiLoader, FiZap, FiImage, FiFileText } from 'react-icons/fi';
import { cn } from '@/lib/utils';
import { SUPPORTED_LANGUAGES, DOC_TYPE_LABELS, type DocType, type SupportedLang } from '@/lib/ocr/templates';
import { OcrResultModal } from './result-modal';

const DOC_TYPE_ICONS: Record<DocType, React.ReactNode> = {
  invoice: <FiFileText className="size-4" />,
  receipt: <FiFileText className="size-4" />,
  general_text: <FiImage className="size-4" />,
};

export function OcrUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<DocType>('invoice');
  const [language, setLanguage] = useState<SupportedLang>('el');
  const [pdfSource, setPdfSource] = useState<'auto' | 'digital' | 'scanned'>('auto');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function handleFile(file: File) {
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

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
        {/* Header band */}
        <header className="flex items-center justify-between border-b border-border bg-gradient-to-r from-sisyphus-50 via-card to-card px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-sisyphus-500 text-white shadow-fluent-2">
              <FiZap className="size-4" />
            </span>
            <div>
              <h3 className="text-[14px] font-semibold tracking-tight text-foreground">Νέα ανάλυση εγγράφου</h3>
              <p className="text-[11px] text-muted-foreground">
                DeepSeek για ψηφιακά PDF · Gemini Vision για εικόνες και σαρωμένα
              </p>
            </div>
          </div>
          <span className="hidden text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:inline">
            Πειραγωγή · v1
          </span>
        </header>

        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-[1fr_1fr_auto]">
          {/* Doc type */}
          <Field label="Τύπος εγγράφου">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocType)}
              className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm transition focus:border-sisyphus-500 focus:outline-none focus:ring-2 focus:ring-sisyphus-500/20"
            >
              {(Object.entries(DOC_TYPE_LABELS) as [DocType, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
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

        {/* Drop zone */}
        <div className="px-5 pb-5">
          <label
            onDragEnter={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDrop={onDrop}
            className={cn(
              'relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-12 px-4 text-center transition-all duration-fluent-150 ease-standard',
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
                <p className="text-sm font-semibold text-sisyphus-600">Ανάλυση μέσω AI…</p>
                <p className="text-[11px] text-muted-foreground">
                  Εξαγωγή πεδίων, line items, και σχηματισμός JSON. Διαρκεί 5-25 δευτερόλεπτα.
                </p>
              </>
            ) : (
              <>
                <span className="inline-flex size-12 items-center justify-center rounded-full bg-sisyphus-500/10 text-sisyphus-600">
                  <FiUploadCloud className="size-5" />
                </span>
                <p className="text-sm font-semibold text-foreground">
                  Σύρε αρχείο εδώ ή κάνε κλικ για επιλογή
                </p>
                <p className="text-[11px] text-muted-foreground">
                  PDF, PNG, JPG, WebP, GIF, TIFF, BMP · έως 25 MB
                </p>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
