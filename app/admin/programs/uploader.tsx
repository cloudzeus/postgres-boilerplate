'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FiUploadCloud, FiLoader, FiZap, FiCheck, FiFile, FiCpu } from 'react-icons/fi';
import { cn } from '@/lib/utils';

type Stage = 'idle' | 'uploading' | 'parsing' | 'analyzing';

const STAGE_LABELS: Record<Exclude<Stage, 'idle'>, { title: string; sub: string; icon: React.ReactNode }> = {
  uploading: {
    title: 'Ανέβασμα στο Bunny CDN',
    sub:   'Το αρχείο αποθηκεύεται με ασφάλεια…',
    icon:  <FiUploadCloud className="size-4" />,
  },
  parsing: {
    title: 'Εξαγωγή κειμένου από το PDF',
    sub:   'Διαβάζουμε όλες τις σελίδες της προσκλήσεως…',
    icon:  <FiFile className="size-4" />,
  },
  analyzing: {
    title: 'Βαθιά ανάλυση με DeepSeek AI',
    sub:   'Εντοπίζουμε ΚΑΔ, δαπάνες, προθεσμίες, κριτήρια. Συνήθως 30-90 δευτερόλεπτα.',
    icon:  <FiCpu className="size-4" />,
  },
};

export function ProgramUploader() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Tick elapsed timer while busy.
  useEffect(() => {
    if (stage === 'idle') { setElapsedSec(0); return; }
    const startedAt = Date.now();
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [stage]);

  async function handleFile(file: File) {
    setFileName(file.name);
    setStage('uploading');
    // Approximate progress by advancing through stages on timers (real backend is one POST).
    const t1 = setTimeout(() => setStage('parsing'), 1500);
    const t2 = setTimeout(() => setStage('analyzing'), 4500);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/admin/programs', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('Η ανάλυση ολοκληρώθηκε');
      router.push(`/admin/programs/${json.id}`);
      router.refresh();
    } catch (err: any) {
      toast.error(`Σφάλμα: ${err?.message ?? err}`, { duration: 10_000 });
    } finally {
      clearTimeout(t1); clearTimeout(t2);
      setStage('idle');
      setFileName(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const busy = stage !== 'idle';
  const stageOrder: Array<Exclude<Stage, 'idle'>> = ['uploading', 'parsing', 'analyzing'];
  const currentIdx = stage === 'idle' ? -1 : stageOrder.indexOf(stage as Exclude<Stage, 'idle'>);
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-fluent-2">
      <header className="flex items-center justify-between border-b border-border bg-gradient-to-r from-sisyphus-50 via-card to-card px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-md bg-sisyphus-500 text-white shadow-fluent-2">
            <FiZap className="size-4" />
          </span>
          <div>
            <h3 className="text-[14px] font-semibold tracking-tight">Νέα ανάλυση προγράμματος</h3>
            <p className="text-[11px] text-muted-foreground">Gemini AI · Αναλύει PDF προσκλήσεων ΕΣΠΑ/EU και εξάγει όλα τα structured fields</p>
          </div>
        </div>
      </header>
      <div className="p-5">
        {busy ? (
          /* PROCESSING CARD — visible feedback while we work */
          <div className="rounded-lg border-2 border-sisyphus-500 bg-sisyphus-500/5 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-sisyphus-500/20">
                  <FiLoader className="size-5 animate-spin text-sisyphus-600" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{fileName ?? 'Επεξεργασία…'}</p>
                  <p className="text-[11px] text-muted-foreground">Παρακαλώ μην κλείσετε τη σελίδα.</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-[20px] font-bold tabular-nums text-sisyphus-600">{fmtTime(elapsedSec)}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">elapsed</p>
              </div>
            </div>

            {/* Indeterminate progress bar */}
            <div className="relative h-1.5 overflow-hidden rounded-full bg-neutral-8">
              <div className="absolute inset-y-0 w-1/3 animate-[ocrProgress_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-sisyphus-400 to-sisyphus-600" />
            </div>

            {/* Stage list */}
            <ol className="space-y-2">
              {stageOrder.map((st, idx) => {
                const def = STAGE_LABELS[st];
                const done = idx < currentIdx;
                const active = idx === currentIdx;
                return (
                  <li key={st} className={cn(
                    'flex items-start gap-3 rounded-md px-3 py-2 transition',
                    active && 'bg-card border border-sisyphus-500/30 shadow-fluent-2',
                    done && 'opacity-60',
                    !active && !done && 'opacity-40',
                  )}>
                    <span className={cn(
                      'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full',
                      done && 'bg-emerald-500 text-white',
                      active && 'bg-sisyphus-500 text-white',
                      !active && !done && 'bg-neutral-8 text-muted-foreground',
                    )}>
                      {done ? <FiCheck className="size-3" /> : active ? <FiLoader className="size-3 animate-spin" /> : def.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-[13px] font-medium', active ? 'text-foreground' : 'text-muted-foreground')}>
                        {def.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{def.sub}</p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {elapsedSec > 60 && (
              <p className="text-center text-[11px] text-muted-foreground">
                ⚡ Συνεχίζουμε — μεγάλα PDF μπορεί να χρειαστούν λίγο παραπάνω για ολοκληρωμένη ανάλυση.
              </p>
            )}
          </div>
        ) : (
          <label
            onDragEnter={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f);
            }}
            className={cn(
              'relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-12 px-4 text-center transition',
              dragOver
                ? 'border-sisyphus-500 bg-sisyphus-500/10'
                : 'border-input bg-neutral-6/40 hover:border-sisyphus-500/50 hover:bg-sisyphus-500/5',
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-sisyphus-500/10 text-sisyphus-600">
              <FiUploadCloud className="size-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">Σύρε PDF προσκλήσεως εδώ ή κάνε κλικ</p>
            <p className="text-[11px] text-muted-foreground">PDF · έως 50 MB · 30-90s ανάλυση</p>
          </label>
        )}
      </div>
    </section>
  );
}
