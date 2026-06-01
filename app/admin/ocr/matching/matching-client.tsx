'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FiBox, FiTool, FiTruck, FiSearch, FiCheckCircle, FiChevronDown, FiPlus, FiRepeat } from 'react-icons/fi';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { SoftoneSearchPanel, type SoftoneSearchResult } from '@/components/admin/softone-match-picker';
import { CreateSoftoneItemModal } from '@/components/admin/create-softone-item-modal';
import { CreateSupplierFromAadeDialog } from '@/components/admin/create-supplier-from-aade-dialog';

type Line = { id: string; code: string | null; name: string; docId: string; fileName: string; supplier: string | null };
type Sup = { docId: string; fileName: string; afm: string; issuer: string };

export function MatchingClient({
  products, services, suppliers,
}: { products: Line[]; services: Line[]; suppliers: Sup[] }) {
  const router = useRouter();
  const [q, setQ] = React.useState('');
  const [resolved, setResolved] = React.useState<Set<string>>(new Set());

  const flt = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const filterLines = (rows: Line[]) => rows.filter((r) => !resolved.has(`l:${r.id}`) && (flt(r.name) || flt(r.code ?? '') || flt(r.fileName)));
  const filterSups = (rows: Sup[]) => rows.filter((r) => !resolved.has(`s:${r.docId}`) && (flt(r.issuer) || flt(r.afm) || flt(r.fileName)));

  const resolveLine = (id: string) => setResolved((s) => new Set(s).add(`l:${id}`));
  const resolveSup = (docId: string) => setResolved((s) => new Set(s).add(`s:${docId}`));

  const matchLine = async (line: Line, mtrl: number, name: string) => {
    const res = await fetch('/api/admin/ocr/match-line', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineId: line.id, mtrl }),
    });
    if (res.ok) { resolveLine(line.id); toast.success(`Αντιστοιχίστηκε: ${name}`); }
    else toast.error('Αποτυχία αντιστοίχισης');
  };
  const convertLine = async (line: Line, isService: boolean) => {
    const res = await fetch('/api/admin/ocr/line-type', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineId: line.id, isService }),
    });
    if (res.ok) { toast.success(isService ? 'Έγινε υπηρεσία' : 'Έγινε προϊόν'); router.refresh(); }
    else toast.error('Αποτυχία μετατροπής');
  };
  const matchSupplier = async (sup: Sup, trdr: number, name: string) => {
    const res = await fetch(`/api/admin/ocr/${sup.docId}/match-supplier`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trdr }),
    });
    if (res.ok) { resolveSup(sup.docId); toast.success(`Αντιστοιχίστηκε: ${name}`); }
    else toast.error('Αποτυχία αντιστοίχισης');
  };

  const pCount = products.filter((r) => !resolved.has(`l:${r.id}`)).length;
  const sCount = services.filter((r) => !resolved.has(`l:${r.id}`)).length;
  const supCount = suppliers.filter((r) => !resolved.has(`s:${r.docId}`)).length;

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Φιλτράρισμα λίστας…" className="h-9 pl-8 text-[13px]" />
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products"><FiBox className="mr-1.5 h-3.5 w-3.5" /> Προϊόντα <Count n={pCount} /></TabsTrigger>
          <TabsTrigger value="services"><FiTool className="mr-1.5 h-3.5 w-3.5" /> Υπηρεσίες <Count n={sCount} /></TabsTrigger>
          <TabsTrigger value="suppliers"><FiTruck className="mr-1.5 h-3.5 w-3.5" /> Προμηθευτές <Count n={supCount} /></TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <LineTable rows={filterLines(products)} isService={false} emptyLabel="Όλα τα προϊόντα έχουν αντιστοιχιστεί"
            onMatch={(line, r) => matchLine(line, r.id, r.name)} onResolved={resolveLine} onConvert={convertLine} />
        </TabsContent>
        <TabsContent value="services">
          <LineTable rows={filterLines(services)} isService emptyLabel="Όλες οι υπηρεσίες έχουν αντιστοιχιστεί"
            onMatch={(line, r) => matchLine(line, r.id, r.name)} onResolved={resolveLine} onConvert={convertLine} />
        </TabsContent>
        <TabsContent value="suppliers">
          <SupplierTable rows={filterSups(suppliers)} onMatch={(s, r) => matchSupplier(s, r.id, r.name)} onResolved={resolveSup} />
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <button onClick={() => router.refresh()} className="text-[11px] text-muted-foreground hover:text-foreground">Ανανέωση λίστας</button>
      </div>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{n}</span>;
}

function Empty({ label }: { label: string }) {
  return (
    <div className="py-12 text-center text-[13px] text-muted-foreground">
      <FiCheckCircle className="mx-auto mb-2 h-7 w-7 text-emerald-500/50" /> {label}
    </div>
  );
}

/** Per-row dropdown: match an existing item, create a new item/service, or flip its type. */
function LineRowActions({
  line, isService, onMatch, onResolved, onConvert,
}: {
  line: Line; isService: boolean;
  onMatch: (line: Line, r: SoftoneSearchResult) => void;
  onResolved: (id: string) => void;
  onConvert: (line: Line, isService: boolean) => void;
}) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const typeLabel = isService ? 'υπηρεσίας' : 'είδους';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-[11px]">
            Αντιστοίχιση <FiChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => setSearchOpen(true)} className="text-[12px]">
            <FiSearch className="mr-2 h-3.5 w-3.5" /> Αντιστοίχιση σε υπάρχον
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreateOpen(true)} className="text-[12px]">
            <FiPlus className="mr-2 h-3.5 w-3.5" /> Δημιουργία νέου {typeLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onConvert(line, !isService)} className="text-[12px]">
            <FiRepeat className="mr-2 h-3.5 w-3.5" /> {isService ? 'Μετατροπή σε προϊόν' : 'Μετατροπή σε υπηρεσία'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle className="text-[14px]">Αντιστοίχιση σε υπάρχον {typeLabel}</DialogTitle></DialogHeader>
          <SoftoneSearchPanel
            type="items"
            service={isService ? '1' : '0'}
            onPick={(r) => { onMatch(line, r); setSearchOpen(false); }}
          />
        </DialogContent>
      </Dialog>

      <CreateSoftoneItemModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        lineId={line.id}
        initialCode={line.code ?? ''}
        initialName={line.name}
        defaultService={isService}
        onCreated={() => onResolved(line.id)}
      />
    </>
  );
}

function LineTable({
  rows, isService, emptyLabel, onMatch, onResolved, onConvert,
}: {
  rows: Line[]; isService: boolean; emptyLabel: string;
  onMatch: (line: Line, r: SoftoneSearchResult) => void;
  onResolved: (id: string) => void;
  onConvert: (line: Line, isService: boolean) => void;
}) {
  if (rows.length === 0) return <Empty label={emptyLabel} />;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <table className="w-full text-[13px]">
        <thead className="bg-muted/80 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-semibold w-[120px]">Κωδ. γραμμής</th>
            <th className="px-3 py-2 text-left font-semibold">Περιγραφή</th>
            <th className="px-3 py-2 text-left font-semibold w-[200px]">Παραστατικό</th>
            <th className="px-3 py-2 text-right font-semibold w-[160px]">Αντιστοίχιση</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/60 even:bg-muted/20">
              <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{r.code || '—'}</td>
              <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
              <td className="px-3 py-2 text-[11px] text-muted-foreground truncate">{r.fileName}{r.supplier ? ` · ${r.supplier}` : ''}</td>
              <td className="px-3 py-2 text-right">
                <LineRowActions line={r} isService={isService} onMatch={onMatch} onResolved={onResolved} onConvert={onConvert} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Per-row dropdown: match an existing supplier, or create one from AADE. */
function SupplierRowActions({
  sup, onMatch, onResolved,
}: {
  sup: Sup;
  onMatch: (s: Sup, r: SoftoneSearchResult) => void;
  onResolved: (docId: string) => void;
}) {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-[11px]">
            Αντιστοίχιση <FiChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => setSearchOpen(true)} className="text-[12px]">
            <FiSearch className="mr-2 h-3.5 w-3.5" /> Αντιστοίχιση σε υπάρχον
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreateOpen(true)} className="text-[12px]">
            <FiPlus className="mr-2 h-3.5 w-3.5" /> Δημιουργία προμηθευτή {/^\d{9}$/.test((sup.afm || '').replace(/\D/g, '')) ? 'από ΑΑΔΕ' : '(χειροκίνητα)'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle className="text-[14px]">Αντιστοίχιση σε υπάρχοντα προμηθευτή</DialogTitle></DialogHeader>
          <SoftoneSearchPanel
            type="suppliers"
            onPick={(r) => { onMatch(sup, r); setSearchOpen(false); }}
          />
        </DialogContent>
      </Dialog>

      <CreateSupplierFromAadeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        afm={sup.afm}
        docId={sup.docId}
        fallbackName={sup.issuer}
        onCreated={() => onResolved(sup.docId)}
      />
    </>
  );
}

function SupplierTable({
  rows, onMatch, onResolved,
}: {
  rows: Sup[];
  onMatch: (s: Sup, r: SoftoneSearchResult) => void;
  onResolved: (docId: string) => void;
}) {
  if (rows.length === 0) return <Empty label="Όλοι οι προμηθευτές έχουν αντιστοιχιστεί" />;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <table className="w-full text-[13px]">
        <thead className="bg-muted/80 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-semibold w-[120px]">ΑΦΜ</th>
            <th className="px-3 py-2 text-left font-semibold">Εκδότης (OCR)</th>
            <th className="px-3 py-2 text-left font-semibold w-[200px]">Παραστατικό</th>
            <th className="px-3 py-2 text-right font-semibold w-[160px]">Αντιστοίχιση</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.docId} className="border-t border-border/60 even:bg-muted/20">
              <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{r.afm || '—'}</td>
              <td className="px-3 py-2 font-medium text-foreground">{r.issuer || '—'}</td>
              <td className="px-3 py-2 text-[11px] text-muted-foreground truncate">{r.fileName}</td>
              <td className="px-3 py-2 text-right">
                <SupplierRowActions sup={r} onMatch={onMatch} onResolved={onResolved} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
