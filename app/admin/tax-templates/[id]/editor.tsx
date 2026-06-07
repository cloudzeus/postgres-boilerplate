'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { FiSave, FiUpload } from 'react-icons/fi';
import { Input } from '@/components/ui/input';
import { TaxTemplateRegionEditor, type ValueType } from '@/components/admin/tax-template-region-editor';

export interface TemplateField {
  id: string;
  fieldKey: string;
  label: string;
  section: string | null | undefined;
  valueType: ValueType;
  kind: 'SINGLE' | 'SERIES';
  regionHint: { page: number; bbox: [number, number, number, number] } | null | undefined;
  aiHint: string | null | undefined;
  required: boolean;
  order: number;
}

interface TemplateData {
  id: string;
  code: string;
  name: string;
  year: number | null | undefined;
  description: string | null | undefined;
  status: 'DRAFT' | 'READY';
  sampleStorageKey: string | null | undefined;
  samplePageCount: number | null | undefined;
  sampleThumbUrl: string | null | undefined;
  createdAt: string;
  updatedAt: string;
  fields: TemplateField[];
}

export function TaxTemplateEditor({ template }: { template: TemplateData }) {
  const [name, setName] = React.useState(template.name);
  const [year, setYear] = React.useState(template.year ? String(template.year) : '');
  const [status, setStatus] = React.useState<'DRAFT' | 'READY'>(template.status);
  const [samplePageCount, setSamplePageCount] = React.useState<number | null>(template.samplePageCount ?? null);
  const [savingMeta, setSavingMeta] = React.useState(false);
  const [uploadingFile, setUploadingFile] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function saveMeta() {
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/admin/tax-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), year: year ? Number(year) : null, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('Αποθηκεύτηκε.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setSavingMeta(false); }
  }

  async function uploadSample(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/tax-templates/${template.id}/sample`, {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setSamplePageCount(json.samplePageCount ?? null);
      toast.success('Το δείγμα ανέβηκε.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingFile(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      {/* Meta form */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-fluent-2">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Στοιχεία προτύπου</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Όνομα</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Έτος</span>
            <Input value={year} onChange={(e) => setYear(e.target.value)} type="number" placeholder="2024" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-muted-foreground">Κατάσταση</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'READY')}
              className="h-9 rounded-md border border-input bg-background px-2 text-[12px]"
            >
              <option value="DRAFT">DRAFT</option>
              <option value="READY">READY</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={saveMeta}
            disabled={savingMeta}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-sisyphus-500 px-3 text-[12px] font-semibold text-white hover:bg-sisyphus-600 disabled:opacity-50"
          >
            <FiSave className="size-3.5" /> {savingMeta ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
        </div>
      </div>

      {/* Sample upload */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-fluent-2">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Δείγμα εντύπου (PDF)</p>
        {samplePageCount != null && (
          <p className="mb-2 text-[12px] text-muted-foreground">
            Ανεβασμένο δείγμα — <strong>{samplePageCount}</strong> σελίδ{samplePageCount === 1 ? 'α' : 'ες'}.
            Μπορείτε να αντικαταστήσετε με νέο.
          </p>
        )}
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[12px] font-semibold hover:bg-muted">
          <FiUpload className="size-3.5" />
          {uploadingFile ? 'Ανέβασμα…' : samplePageCount != null ? 'Αντικατάσταση PDF' : 'Ανέβασμα δείγματος PDF'}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={uploadSample}
            disabled={uploadingFile}
          />
        </label>
      </div>

      {/* Region editor */}
      <TaxTemplateRegionEditor
        templateId={template.id}
        initialFields={template.fields}
        samplePageCount={samplePageCount}
      />
    </div>
  );
}
