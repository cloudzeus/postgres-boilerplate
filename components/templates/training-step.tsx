'use client';

// Το βήμα «Εκπαίδευση» του σχεδιαστή (spec §11).
//
// Ένα πρότυπο σχεδιάζεται πάνω σε ΕΝΑ αρχείο και μετά καλείται να διαβάσει εκατοντάδες. Εδώ μετριέται
// πόσο καλά το κάνει: ανεβαίνουν πολλά δείγματα του ίδιου εντύπου, το πρότυπο τα διαβάζει, ο χρήστης
// επιβεβαιώνει τι ΕΠΡΕΠΕ να διαβάσει, και η συμφωνία των δύο είναι ο βαθμός εκπαίδευσης — το κατώφλι
// που πρέπει να περάσει ένα πρότυπο πριν ενεργοποιηθεί.

import * as React from 'react';
import { FiCheckCircle, FiInfo, FiPlay, FiUploadCloud } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RegionMarker } from '@/components/ui/region-marker';
import { cn } from '@/lib/utils';
import { isValidBbox } from '@/lib/templates/schema';
import { trainingGate } from '@/lib/templates/training';
import { activationMessage } from '@/lib/templates/readiness';
import { expectedSeed, pctText } from '@/lib/templates/training-view';
import { useDesigner } from './designer-context';
import { SampleTable } from './sample-table';
import { templatesApi, errorMessage, type TrainingSummary } from './api';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
/** Όσα δέχεται ΕΝΑ αίτημα (`SAMPLES_PER_REQUEST` στον server) — τα περισσότερα σπάνε σε παρτίδες. */
const UPLOAD_BATCH = 20;
/** Όσο τρέχει η «Ανάγνωση όλων», η λίστα ξαναφορτώνεται για να φαίνεται η πρόοδος. */
const PROGRESS_MS = 4000;

export function TrainingStep() {
  const { dto, setDto, canManage, samples, setSamples, scores } = useDesigner();
  const [drafts, setDrafts] = React.useState<Record<string, Record<string, string>>>({});
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [reading, setReading] = React.useState(false);
  const [remaining, setRemaining] = React.useState(0);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const rows = samples ?? [];
  const fields = dto.fields;
  const gate = trainingGate({ minTrainingScore: dto.minTrainingScore, minTrainingSamples: dto.minTrainingSamples, trainingScore: dto.trainingScore, verifiedSamples: dto.verifiedSamples });

  const refresh = React.useCallback(async () => {
    try { setSamples((await templatesApi.samples.list(dto.id)).samples); } catch { /* η λίστα είναι διακόσμηση εδώ */ }
  }, [dto.id, setSamples]);

  /** Ο βαθμός που γύρισε ο server μπαίνει στο DTO, ώστε η πύλη και το badge να λένε το ίδιο. */
  const applyTraining = React.useCallback((t: TrainingSummary) => {
    setDto({ ...dto, trainingScore: t.trainingScore, verifiedSamples: t.verifiedSamples });
  }, [dto, setDto]);

  // Όσο διαβάζονται τα δείγματα, η λίστα ανανεώνεται μόνη της: ο χρήστης βλέπει τα «Δεν διαβάστηκε»
  // να γίνονται «Διαβάστηκε» ένα-ένα αντί να κοιτά ένα spinner για λεπτά.
  React.useEffect(() => {
    if (!reading) return;
    const id = setInterval(() => { void refresh(); }, PROGRESS_MS);
    return () => clearInterval(id);
  }, [reading, refresh]);

  React.useEffect(() => { setPage(0); }, [openId]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      let added = 0;
      const failed: { fileName: string; error: string }[] = [];
      for (let i = 0; i < files.length; i += UPLOAD_BATCH) {
        const out = await templatesApi.samples.add(dto.id, files.slice(i, i + UPLOAD_BATCH));
        added += out.samples.length;
        failed.push(...out.failed);
        applyTraining(out.training);
      }
      await refresh();
      if (added) toast.success(`${added} δείγμα${added === 1 ? '' : 'τα'} προστέθηκ${added === 1 ? 'ε' : 'αν'}`);
      if (failed.length) toast.error(`${failed.length} αρχεία δεν μπήκαν: ${failed.map((f) => f.fileName).join(', ')}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setUploading(false); }
  };

  const adoptPrimary = async () => {
    setUploading(true);
    try {
      const out = await templatesApi.samples.adoptPrimary(dto.id);
      applyTraining(out.training);
      await refresh();
      toast.success('Το κύριο δείγμα μπήκε στην εκπαίδευση');
    } catch (e) { toast.error(errorMessage(e)); } finally { setUploading(false); }
  };

  const readAll = async () => {
    setReading(true);
    try {
      const out = await templatesApi.samples.readAll(dto.id);
      setRemaining(out.remaining);
      applyTraining(out.training);
      await refresh();
      toast[out.failed ? 'warning' : 'success'](
        `Διαβάστηκαν ${out.read} δείγματα${out.failed ? ` · ${out.failed} απέτυχαν` : ''}${out.remaining ? ` · απομένουν ${out.remaining}` : ''}`,
      );
    } catch (e) { toast.error(errorMessage(e)); } finally { setReading(false); }
  };

  const readOne = async (sampleId: string) => {
    setBusyId(sampleId);
    try {
      const out = await templatesApi.samples.read(dto.id, sampleId);
      setSamples(rows.map((r) => (r.id === sampleId ? out.sample : r)));
      if (out.errors.length) toast.warning(`Διαβάστηκε με ${out.errors.length} σφάλματα πεδίων`);
      else toast.success('Διαβάστηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusyId(null); }
  };

  const verify = async (sampleId: string) => {
    const s = rows.find((r) => r.id === sampleId);
    if (!s) return;
    const expected = expectedSeed(fields, s, drafts[sampleId] ?? {});
    if (Object.keys(expected).length === 0) { toast.error('Διάβασε πρώτα το δείγμα — δεν υπάρχει τίποτα να επιβεβαιωθεί'); return; }
    setBusyId(sampleId);
    try {
      const out = await templatesApi.samples.verify(dto.id, sampleId, expected);
      setSamples(rows.map((r) => (r.id === sampleId ? out.sample : r)));
      setDrafts((d) => { const next = { ...d }; delete next[sampleId]; return next; });
      applyTraining(out.training);
      toast.success(`Επιβεβαιώθηκε — ${pctText(out.sample.score)}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusyId(null); }
  };

  const remove = async (sampleId: string) => {
    if (!confirm('Διαγραφή του δείγματος;')) return;
    setBusyId(sampleId);
    try {
      const out = await templatesApi.samples.remove(dto.id, sampleId);
      setSamples(rows.filter((r) => r.id !== sampleId));
      applyTraining(out.training);
      if (openId === sampleId) setOpenId(null);
      toast.success('Διαγράφηκε');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusyId(null); }
  };

  const open = rows.find((r) => r.id === openId) ?? null;
  // Τα κουτιά της ανοιχτής σελίδας, στα χρώματα των πεδίων — το ίδιο που δείχνει η καρτέλα εργασίας.
  const regions = React.useMemo(() => {
    if (!open?.lastResult) return [];
    return fields
      .map((f) => ({ f, v: open.lastResult?.[f.key] }))
      .filter((x) => x.v && x.v.page === page && isValidBbox(x.v.bbox))
      .map((x) => ({ bbox: x.v!.bbox as [number, number, number, number], color: x.f.color, label: x.f.label }));
  }, [open, fields, page]);

  const verified = dto.verifiedSamples;
  const overall = dto.trainingScore;

  return (
    <div
      className="space-y-4"
      onKeyDown={(e) => {
        // Enter πάνω στη γραμμή που κοιτά ο χρήστης = «Επιβεβαίωση». Μέσα σε input το Enter ανήκει
        // στη διόρθωση του κελιού, όχι εδώ.
        if (e.key !== 'Enter' || !openId) return;
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        void verify(openId);
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">Εκπαίδευση</h2>
          <p className="text-[12px] text-muted-foreground">
            Ανέβασε δείγματα του ίδιου εντύπου, βάλε το πρότυπο να τα διαβάσει και επιβεβαίωσε τις σωστές τιμές.
            Η συμφωνία των δύο είναι ο βαθμός εκπαίδευσης.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-md border border-border bg-neutral-4 px-3 py-2">
          <div className="text-center">
            <div className="text-[18px] font-semibold leading-none">{pctText(overall)}</div>
            <div className="text-[10px] text-muted-foreground">βαθμός</div>
          </div>
          <div className="text-center">
            <div className="text-[18px] font-semibold leading-none">{verified}</div>
            <div className="text-[10px] text-muted-foreground">επιβεβαιωμένα</div>
          </div>
        </div>
      </div>

      {/* Η πύλη ενεργοποίησης, με τη γλώσσα που θα δει ο χρήστης αν πατήσει «Ενεργοποίηση». */}
      <div className={cn('flex items-start gap-2 rounded-md border p-3 text-[12px]',
        gate.ok ? 'border-[#A7E3C8] bg-[#E8F7F0] text-[#065F46]' : 'border-[#F3D9A6] bg-[#FDF3E3] text-[#8A5B0B]')}>
        {gate.ok ? <FiCheckCircle className="mt-0.5 size-4 shrink-0" /> : <FiInfo className="mt-0.5 size-4 shrink-0" />}
        <div>
          {gate.ok
            ? <span>Έτοιμο για ενεργοποίηση — {dto.minTrainingSamples === 0 ? 'η πύλη εκπαίδευσης είναι κλειστή για αυτό το πρότυπο' : `${verified} επιβεβαιωμένα δείγματα, βαθμός ${pctText(overall)}`}.</span>
            : <span>{activationMessage({ ok: false, error: 'training_gate', reason: gate.reason }, { minTrainingScore: dto.minTrainingScore, minTrainingSamples: dto.minTrainingSamples, trainingScore: dto.trainingScore, verifiedSamples: verified })}.</span>}
          <span className="text-muted-foreground"> Τα κατώφλια αλλάζουν στο βήμα «Στοιχεία».</span>
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={readAll} disabled={reading || rows.length === 0}>
            <FiPlay className={cn('mr-1.5 size-3.5', reading && 'animate-pulse')} />
            {reading ? 'Διαβάζονται…' : remaining > 0 ? `Συνέχεια ανάγνωσης (${remaining})` : 'Ανάγνωση όλων'}
          </Button>
          {reading && <span className="text-[11px] text-muted-foreground">Κάθε δείγμα διαβάζεται χωριστά — η λίστα ανανεώνεται μόνη της.</span>}
          {!reading && remaining > 0 && (
            <span className="text-[11px] text-[#B45309]">Απομένουν {remaining} δείγματα — πάτα ξανά για να συνεχίσει.</span>
          )}
          {!reading && rows.length > 0 && !rows.some((r) => r.isPrimary) && dto.sample && (
            <Button size="sm" variant="ghost" onClick={adoptPrimary} disabled={uploading}>Χρήση του κύριου δείγματος</Button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void upload([...(e.dataTransfer.files ?? [])]); }}
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            className={cn('flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center cx-transition',
              drag ? 'border-sisyphus-500 bg-sisyphus-50' : 'border-border hover:border-sisyphus-300 hover:bg-neutral-4')}
          >
            <FiUploadCloud className="size-6 text-sisyphus-600" />
            <p className="text-[13px] font-medium">{uploading ? 'Ανέβασμα…' : 'Σύρε δείγματα εδώ'}</p>
            <p className="text-[11px] text-muted-foreground">PDF, PNG, JPEG, WebP · έως 25 MB το καθένα</p>
          </div>
          {dto.sample && canManage && (
            <p className="text-[12px] text-muted-foreground">
              Το αρχείο πάνω στο οποίο σχεδίασες τις περιοχές είναι ήδη ένα τέλειο πρώτο δείγμα.{' '}
              <button type="button" onClick={adoptPrimary} disabled={uploading} className="cursor-pointer font-medium text-sisyphus-700 hover:underline">
                Χρήση του κύριου δείγματος
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className={open ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]' : ''}>
          <div className="min-w-0 space-y-2">
            <SampleTable
              fields={fields} samples={rows} perField={scores} drafts={drafts}
              onDraft={(sampleId, key, value) => setDrafts((d) => ({ ...d, [sampleId]: { ...(d[sampleId] ?? {}), [key]: value } }))}
              onVerify={verify} onRead={readOne} onDelete={remove}
              onOpen={(id) => setOpenId((o) => (o === id ? null : id))} openId={openId}
              busyId={busyId} canManage={canManage}
            />
            {canManage && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  <FiUploadCloud className="mr-1.5 size-3.5" /> {uploading ? 'Ανέβασμα…' : 'Προσθήκη δειγμάτων'}
                </Button>
                <span>Κλικ σε τιμή για διόρθωση · Enter επιβεβαιώνει το ανοιχτό δείγμα · Esc ακυρώνει τη διόρθωση.</span>
              </div>
            )}
          </div>

          {open && (
            <aside className="rounded-xl border border-border bg-card p-3 shadow-card">
              <p className="mb-2 truncate text-[13px] font-medium">{open.fileName}</p>
              <RegionMarker
                pageImageUrl={(p) => templatesApi.samples.pageImageUrl(dto.id, open.id, p)}
                pageCount={open.pageCount ?? 1}
                page={page}
                onPageChange={setPage}
                savedRegions={regions}
                isMarking={false}
                onRegionComplete={() => { /* read-only */ }}
                pageLabel={`${open.fileName}, σελίδα ${page + 1}`}
              />
            </aside>
          )}
        </div>
      )}

      <input
        ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden"
        onChange={(e) => { void upload([...(e.target.files ?? [])]); e.currentTarget.value = ''; }}
      />
    </div>
  );
}
