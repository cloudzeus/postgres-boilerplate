'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiFolder, FiUploadCloud, FiCheckCircle, FiXCircle, FiLoader } from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type FileState = { name: string; status: 'pending' | 'uploading' | 'done' | 'error' };
const CONCURRENCY = 4;
const ALLOWED = /\.(pdf|png|jpe?g|webp|tiff?)$/i;

export function OcrFolderUpload() {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [states, setStates] = React.useState<FileState[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [batchId, setBatchId] = React.useState<string | null>(null);

  const done = states.filter((s) => s.status === 'done').length;
  const errors = states.filter((s) => s.status === 'error').length;
  const pct = states.length ? Math.round(((done + errors) / states.length) * 100) : 0;

  async function processFolder(files: File[]) {
    const valid = files.filter((f) => ALLOWED.test(f.name) && f.size > 0);
    if (valid.length === 0) { toast.error('Δεν βρέθηκαν έγκυρα αρχεία (PDF/εικόνες)'); return; }

    // folder name = common top directory, or first file's folder.
    const rel = (valid[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const folderName = rel.split('/')[0] || `Φάκελος ${new Date().toLocaleDateString('el-GR')}`;

    setBusy(true);
    setStates(valid.map((f) => ({ name: f.name, status: 'pending' })));

    // 1) create the batch
    const bRes = await fetch('/api/admin/ocr/batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, docType: 'INVOICE', language: 'el' }),
    });
    if (!bRes.ok) { toast.error('Αποτυχία δημιουργίας φακέλου'); setBusy(false); return; }
    const { id } = await bRes.json();
    setBatchId(id);

    // 2) upload with a small concurrency pool
    let cursor = 0;
    const worker = async () => {
      while (cursor < valid.length) {
        const i = cursor++;
        const f = valid[i];
        setStates((s) => s.map((x, idx) => idx === i ? { ...x, status: 'uploading' } : x));
        try {
          const fd = new FormData();
          fd.set('file', f); fd.set('docType', 'invoice'); fd.set('language', 'el'); fd.set('pdfSource', 'auto');
          fd.set('batchId', id);
          const res = await fetch('/api/admin/ocr', { method: 'POST', body: fd });
          setStates((s) => s.map((x, idx) => idx === i ? { ...x, status: res.ok ? 'done' : 'error' } : x));
        } catch {
          setStates((s) => s.map((x, idx) => idx === i ? { ...x, status: 'error' } : x));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, valid.length) }, worker));

    setBusy(false);
    toast.success('Ο φάκελος ολοκληρώθηκε');
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">Ανέβασμα φακέλου παραστατικών</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Επίλεξε έναν φάκελο — όλα τα αρχεία σκανάρονται, ομαδοποιούνται και αντιστοιχίζονται αυτόματα.</p>
        </div>
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          <FiFolder className="mr-1.5 h-4 w-4" /> {busy ? 'Επεξεργασία…' : 'Επιλογή φακέλου'}
        </Button>
        <input
          ref={inputRef} type="file" multiple hidden
          // @ts-expect-error non-standard but widely supported
          webkitdirectory="" directory=""
          onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) void processFolder(f); e.target.value = ''; }}
        />
      </div>

      {states.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>{done}/{states.length} ολοκληρώθηκαν{errors > 0 && ` · ${errors} σφάλματα`}</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-[#0078D4] transition-all duration-200" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 max-h-44 overflow-auto rounded-lg border border-border">
            {states.map((s) => (
              <div key={s.name} className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[12px] last:border-0">
                <StatusIcon status={s.status} />
                <span className="truncate text-foreground">{s.name}</span>
              </div>
            ))}
          </div>
          {!busy && batchId && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => router.push(`/admin/ocr/batches/${batchId}`)}>
              Άνοιγμα φακέλου →
            </Button>
          )}
        </div>
      )}

      {states.length === 0 && (
        <button
          onClick={() => inputRef.current?.click()}
          className="mt-4 grid w-full place-items-center rounded-xl border-2 border-dashed border-border py-8 text-muted-foreground transition-colors hover:border-[#0078D4]/40 hover:bg-[#0078D4]/[0.04]"
        >
          <FiUploadCloud className="h-8 w-8 opacity-40" />
          <span className="mt-2 text-[12px]">Επίλεξε φάκελο με παραστατικά</span>
        </button>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: FileState['status'] }) {
  if (status === 'done') return <FiCheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  if (status === 'error') return <FiXCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (status === 'uploading') return <FiLoader className="h-3.5 w-3.5 shrink-0 animate-spin text-[#0078D4]" />;
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />;
}
