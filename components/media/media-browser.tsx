'use client';

import * as React from 'react';
import {
  FiFolder, FiFolderPlus, FiUpload, FiImage, FiFile, FiTrash2,
  FiChevronRight, FiHome, FiSearch, FiX, FiDownload, FiCopy,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog';
import { Field, fieldCls } from '@/components/admin/form-kit';
import { UploadProgress, useUploader } from './upload-progress';

type Folder = { id: string; name: string; parentId: string | null };
type MediaFile = {
  id: string; name: string; mimeType: string; size: number;
  width: number | null; height: number | null;
  isImage: boolean; isSvg: boolean;
  publicUrl: string; originalUrl: string | null;
  uploadedAt: string;
};

interface Props {
  pickerMode?: boolean;
  onPick?: (file: MediaFile) => void;
  acceptImagesOnly?: boolean;
}

function fmt(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function MediaBrowser({ pickerMode, onPick, acceptImagesOnly }: Props) {
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [folders, setFolders] = React.useState<Folder[]>([]);
  const [files, setFiles] = React.useState<MediaFile[]>([]);
  const [breadcrumbs, setBreadcrumbs] = React.useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState('');

  const fetchList = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    if (q) params.set('q', q);
    if (acceptImagesOnly) params.set('images', '1');
    const res = await fetch(`/api/admin/media?${params}`);
    setLoading(false);
    if (!res.ok) { toast.error('Αποτυχία φόρτωσης'); return; }
    const data = await res.json();
    setFolders(data.folders ?? []);
    setFiles(data.files ?? []);
    setBreadcrumbs(data.breadcrumbs ?? []);
  }, [folderId, q, acceptImagesOnly]);

  React.useEffect(() => { fetchList(); }, [fetchList]);

  const uploader = useUploader(folderId, fetchList);

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    const res = await fetch('/api/admin/media/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newFolderName.trim(), parentId: folderId }),
    });
    if (res.ok) {
      toast.success('Ο φάκελος δημιουργήθηκε');
      setNewFolderName(''); setNewFolderOpen(false); fetchList();
    } else toast.error('Αποτυχία δημιουργίας');
  };

  const deleteFile = async (id: string) => {
    if (!confirm('Διαγραφή αρχείου;')) return;
    const res = await fetch(`/api/admin/media/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Διαγράφηκε'); fetchList(); }
    else toast.error('Αποτυχία');
  };

  const deleteFolder = async (id: string) => {
    if (!confirm('Διαγραφή φακέλου και όλων των περιεχομένων;')) return;
    const res = await fetch(`/api/admin/media/folders/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Διαγράφηκε'); fetchList(); }
    else toast.error('Αποτυχία');
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const onFilesSelected = (selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    uploader.upload(Array.from(selected));
  };

  // Drag-drop
  const [dragOver, setDragOver] = React.useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      uploader.upload(Array.from(e.dataTransfer.files));
    }
  };

  // Μέσα στο παράθυρο επιλογής (pickerMode) το browser γεμίζει όλο το πλάτος του modal:
  // εργαλειοθήκη ως πυκνή γραμμή κάτω από την κεφαλίδα, σώμα με κύλιση, γραμμή κατάστασης στο κάτω μέρος.
  const embedded = !!pickerMode;

  return (
    <div className={embedded ? 'flex min-h-0 flex-col' : 'overflow-hidden rounded-xl border border-border bg-card'}>
      {/* Toolbar: διαδρομή φακέλων · αναζήτηση · νέος φάκελος · μεταφόρτωση */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
        <nav aria-label="Διαδρομή φακέλων" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[length:var(--fs-12)] text-muted-foreground">
          <button
            type="button"
            onClick={() => setFolderId(null)}
            className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500 ${
              breadcrumbs.length === 0 ? 'font-semibold text-foreground' : ''
            }`}
          >
            <FiHome className="size-3.5" aria-hidden /> Αρχικός φάκελος
          </button>
          {breadcrumbs.map((b) => (
            <React.Fragment key={b.id}>
              <FiChevronRight className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
              <button
                type="button"
                onClick={() => setFolderId(b.id)}
                className="h-7 min-w-0 truncate rounded-md px-1.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500"
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </nav>

        <div className="relative w-full sm:w-52">
          <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Αναζήτηση..."
            aria-label="Αναζήτηση αρχείων"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`pl-8 ${fieldCls}`}
          />
        </div>

        <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="text-[length:var(--fs-12)]"><FiFolderPlus /> Νέος φάκελος</Button>
          </DialogTrigger>
          <DialogContent className="w-[95vw] gap-0 overflow-hidden p-0 sm:max-w-sm">
            <DialogHeader className="flex-row items-center gap-3 border-b border-border px-4 py-2.5 pr-12">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15" aria-hidden>
                <FiFolderPlus className="size-4" />
              </span>
              <div className="min-w-0 text-left">
                <DialogTitle className="text-[length:var(--fs-15)]">Νέος φάκελος</DialogTitle>
                <DialogDescription className="truncate text-[length:var(--fs-11)]">Δώσε όνομα στο νέο φάκελο.</DialogDescription>
              </div>
            </DialogHeader>
            <div className="bg-muted/20 px-4 py-3">
              <Field label="Όνομα" htmlFor="folder-name" required>
                <Input id="folder-name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} autoFocus className={fieldCls} />
              </Field>
            </div>
            <DialogFooter className="mx-0 mb-0 gap-2 border-t border-border bg-card px-4 py-2.5">
              <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Άκυρο</Button>
              <Button onClick={createFolder}>Δημιουργία</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button onClick={() => fileInputRef.current?.click()} className="text-[length:var(--fs-12)]">
          <FiUpload /> Μεταφόρτωση
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => onFilesSelected(e.target.files)}
        />
      </div>

      {/* Drop zone + grid */}
      <div className={embedded ? 'max-h-[66vh] overflow-auto bg-muted/20 px-4 py-3' : 'bg-muted/20 px-4 py-3'}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative rounded-lg border-2 border-dashed transition-colors ${
            embedded ? 'min-h-[18rem]' : 'min-h-[25rem]'
          } ${
            dragOver
              ? 'border-sisyphus-500 bg-sisyphus-50/60 dark:bg-sisyphus-500/10'
              : 'border-border/70 bg-card/40'
          }`}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="inline-flex items-center gap-2 rounded-lg bg-sisyphus-600 px-3 py-1.5 text-[length:var(--fs-13)] font-semibold text-white shadow-pop">
                <FiUpload className="size-4" aria-hidden /> Άφησε τα αρχεία για ανέβασμα…
              </div>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-[length:var(--fs-12)] text-muted-foreground" role="status">Φόρτωση…</div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <span className="mb-2 grid size-10 place-items-center rounded-xl bg-sisyphus-50 text-sisyphus-600 dark:bg-sisyphus-500/15" aria-hidden>
                <FiUpload className="size-5" />
              </span>
              <p className="text-[length:var(--fs-13)] text-muted-foreground">
                Σύρε αρχεία εδώ ή πάτα <span className="font-semibold text-foreground">Μεταφόρτωση</span>.
              </p>
              <p className="mt-1 text-[length:var(--fs-11)] text-muted-foreground">Max 500 MB ανά αρχείο.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {folders.map((f) => (
                <FolderTile key={f.id} folder={f} onOpen={() => setFolderId(f.id)} onDelete={() => deleteFolder(f.id)} />
              ))}
              {files.map((file) => (
                <FileTile
                  key={file.id}
                  file={file}
                  onDelete={() => deleteFile(file.id)}
                  onPick={pickerMode ? () => onPick?.(file) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Γραμμή κατάστασης */}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-2.5 text-[length:var(--fs-11)] text-muted-foreground">
        <span className="tabular-nums">
          {folders.length} φάκελοι · {files.length} αρχεία
        </span>
        <span className="truncate">
          {pickerMode ? 'Click σε αρχείο για επιλογή · ' : 'Click σε αρχείο: αντιγραφή URL · '}Max 500 MB ανά αρχείο
        </span>
      </div>

      <UploadProgress
        items={uploader.items}
        open={uploader.open}
        onClose={uploader.close}
        onCancel={uploader.cancel}
      />
    </div>
  );
}

const tileActionCls =
  'inline-flex size-6 items-center justify-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500';

function FolderTile({ folder, onOpen, onDelete }: { folder: Folder; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col items-center gap-1 rounded-lg border border-sisyphus-500/20 bg-sisyphus-50/50 px-2 pb-2 pt-3 transition-colors hover:border-sisyphus-500 hover:bg-sisyphus-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500 dark:bg-sisyphus-500/10 dark:hover:bg-sisyphus-500/15"
      >
        <FiFolder className="size-9 text-sisyphus-600 dark:text-sisyphus-300" aria-hidden />
        <span className="w-full truncate text-center text-[length:var(--fs-11)] font-medium text-foreground" title={folder.name}>{folder.name}</span>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className={`absolute right-1 top-1 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 ${tileActionCls}`}
        aria-label="Διαγραφή"
        title="Διαγραφή"
      >
        <FiTrash2 className="size-3" />
      </button>
    </div>
  );
}

function FileTile({ file, onDelete, onPick }: { file: MediaFile; onDelete: () => void; onPick?: () => void }) {
  const copyUrl = () => {
    navigator.clipboard.writeText(file.publicUrl);
    toast.success('Το URL αντιγράφηκε');
  };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onPick ?? copyUrl}
        title={onPick ? 'Επιλογή' : 'Click: copy URL'}
        className={`flex w-full flex-col items-stretch overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
          onPick ? 'hover:border-sisyphus-500 hover:ring-2 hover:ring-sisyphus-500' : 'hover:border-sisyphus-500'
        }`}
      >
        <div className="relative flex aspect-square items-center justify-center bg-muted">
          {file.isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.publicUrl} alt={file.name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          ) : (
            <FiFile className="size-9 text-muted-foreground" aria-hidden />
          )}
          {file.isSvg && (
            <span className="absolute left-1 top-1 rounded-sm bg-violet-600/90 px-1 py-0.5 text-[length:var(--fs-9)] font-bold tracking-wide text-white">
              SVG
            </span>
          )}
        </div>
        <div className="border-t border-border px-1.5 py-1 text-left">
          <div className="truncate text-[length:var(--fs-11)] font-medium text-foreground" title={file.name}>{file.name}</div>
          <div className="truncate text-[length:var(--fs-10)] tabular-nums text-muted-foreground">
            {fmt(file.size)}
            {file.width && file.height && ` · ${file.width}×${file.height}`}
          </div>
        </div>
      </button>
      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); copyUrl(); }}
          className={`hover:text-foreground ${tileActionCls}`}
          title="Copy URL"
          aria-label="Αντιγραφή URL"
        >
          <FiCopy className="size-3" />
        </button>
        {file.originalUrl && (
          <a
            href={file.originalUrl}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className={`hover:text-foreground ${tileActionCls}`}
            title="Original SVG"
            aria-label="Πρωτότυπο SVG"
          >
            <FiDownload className="size-3" />
          </a>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`hover:text-destructive ${tileActionCls}`}
          title="Διαγραφή"
          aria-label="Διαγραφή"
        >
          <FiTrash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}
