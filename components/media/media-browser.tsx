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
import { Label } from '@/components/ui/label';
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

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex items-center gap-1 text-[12px] text-muted-foreground flex-1 min-w-0 truncate">
          <button
            type="button"
            onClick={() => setFolderId(null)}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <FiHome className="size-3.5" /> Αρχικός φάκελος
          </button>
          {breadcrumbs.map((b) => (
            <React.Fragment key={b.id}>
              <FiChevronRight className="size-3 text-muted-foreground" />
              <button
                type="button"
                onClick={() => setFolderId(b.id)}
                className="hover:text-foreground truncate font-medium text-foreground"
              >
                {b.name}
              </button>
            </React.Fragment>
          ))}
        </nav>

        <div className="relative w-48">
          <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input placeholder="Αναζήτηση..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 h-8" />
        </div>

        <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
          <DialogTrigger asChild>
            <Button variant="outline"><FiFolderPlus /> Νέος φάκελος</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Νέος φάκελος</DialogTitle>
              <DialogDescription>Δώσε όνομα στο νέο φάκελο.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="folder-name">Όνομα</Label>
              <Input id="folder-name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} autoFocus />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Άκυρο</Button>
              <Button onClick={createFolder}>Δημιουργία</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button onClick={() => fileInputRef.current?.click()}>
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
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative min-h-[400px] rounded-xl border-2 border-dashed transition-colors ${
          dragOver ? 'border-primary bg-accent' : 'border-border bg-card/50'
        }`}
      >
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold shadow-pop">
              Άφησε τα αρχεία για ανέβασμα…
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-[12px] text-muted-foreground">Φόρτωση…</div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="p-12 text-center">
            <FiUpload className="size-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-[13px] text-muted-foreground">
              Σύρε αρχεία εδώ ή πάτα <span className="font-semibold text-foreground">Μεταφόρτωση</span>.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">Max 500 MB ανά αρχείο.</p>
          </div>
        ) : (
          <div className="p-3 grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
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

      <UploadProgress
        items={uploader.items}
        open={uploader.open}
        onClose={uploader.close}
        onCancel={uploader.cancel}
      />
    </div>
  );
}

function FolderTile({ folder, onOpen, onDelete }: { folder: Folder; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3 hover:border-primary hover:bg-accent/40 transition-colors"
      >
        <FiFolder className="size-10 text-primary/80" />
        <span className="text-[11px] font-medium text-foreground truncate w-full text-center">{folder.name}</span>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-1 right-1 size-5 inline-flex items-center justify-center rounded-sm bg-card/90 border border-border text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
        aria-label="Διαγραφή"
      >
        <FiTrash2 className="size-2.5" />
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
        className="w-full flex flex-col items-stretch rounded-lg border border-border bg-card hover:border-primary transition-colors overflow-hidden"
      >
        <div className="aspect-square bg-muted relative flex items-center justify-center">
          {file.isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.publicUrl} alt={file.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          ) : (
            <FiFile className="size-10 text-muted-foreground" />
          )}
          {file.isSvg && (
            <span className="absolute top-1 left-1 rounded-sm bg-primary/90 text-primary-foreground px-1 py-0.5 text-[9px] font-bold tracking-wide">
              SVG
            </span>
          )}
        </div>
        <div className="p-1.5 text-left">
          <div className="text-[11px] font-medium text-foreground truncate">{file.name}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {fmt(file.size)}
            {file.width && file.height && ` · ${file.width}×${file.height}`}
          </div>
        </div>
      </button>
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); copyUrl(); }}
          className="size-5 inline-flex items-center justify-center rounded-sm bg-card/90 border border-border text-muted-foreground hover:text-foreground"
          title="Copy URL"
        >
          <FiCopy className="size-2.5" />
        </button>
        {file.originalUrl && (
          <a
            href={file.originalUrl}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="size-5 inline-flex items-center justify-center rounded-sm bg-card/90 border border-border text-muted-foreground hover:text-foreground"
            title="Original SVG"
          >
            <FiDownload className="size-2.5" />
          </a>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="size-5 inline-flex items-center justify-center rounded-sm bg-card/90 border border-border text-muted-foreground hover:text-destructive"
          title="Διαγραφή"
        >
          <FiTrash2 className="size-2.5" />
        </button>
      </div>
    </div>
  );
}
