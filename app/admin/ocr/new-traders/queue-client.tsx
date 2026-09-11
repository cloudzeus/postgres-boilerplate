'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FiCheckCircle, FiEyeOff, FiFile, FiUserPlus } from 'react-icons/fi';
import { toast } from 'sonner';
import { QueueLayout, QueueEmpty, type QueueFilter } from '@/components/admin/queue-layout';
import { Button } from '@/components/ui/button';
import { TraderPanel, KIND_COLORS, fmtDate, fmtEuro, type TaxOffice } from './trader-panel';
import type { IgnoredIssuerRow, TraderGroup } from '@/lib/ocr/queues';

type FilterKey = 'all' | 'supplier' | 'creditor' | 'ignored';

/** Μια γραμμή της ουράς: εκκρεμής εκδότης ή αγνοημένος (φίλτρο «Αγνοημένοι»). */
type Row =
  | { type: 'group'; id: string; group: TraderGroup }
  | { type: 'ignored'; id: string; row: IgnoredIssuerRow };

const KIND_LABEL = { supplier: 'Προμηθευτής', creditor: 'Πιστωτής' } as const;

const matches = (needle: string, ...haystack: (string | null | undefined)[]) => {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((h) => (h ?? '').toLowerCase().includes(q));
};

export interface NewTradersClientProps {
  /** Έτοιμος `PageHeader` από τον server (κρατά το `?` της wiki). */
  header: React.ReactNode;
  groups: TraderGroup[];
  ignored: IgnoredIssuerRow[];
  taxOffices: TaxOffice[];
  canManage: boolean;
}

/**
 * Ουρά «Νέοι συναλλασσόμενοι»: master–detail με πληκτρολόγιο (J/K/Enter/Esc),
 * αισιόδοξη αφαίρεση της γραμμής μόλις ο εκδότης λυθεί και πρόοδος συνεδρίας.
 */
export function NewTradersClient({ header, groups, ignored, taxOffices, canManage }: NewTradersClientProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState<TraderGroup[]>(groups);
  const [hidden, setHidden] = React.useState<IgnoredIssuerRow[]>(ignored);
  const [done, setDone] = React.useState(0);
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const primaryRef = React.useRef<(() => void) | null>(null);

  // Ο server είναι η πηγή αλήθειας: κάθε `router.refresh()` ξαναγεμίζει τις λίστες.
  React.useEffect(() => { setPending(groups); }, [groups]);
  React.useEffect(() => { setHidden(ignored); }, [ignored]);

  const rows: Row[] = React.useMemo(() => {
    if (filter === 'ignored') {
      return hidden
        .filter((r) => matches(search, r.name, r.afm, r.reason))
        .map((r) => ({ type: 'ignored' as const, id: `i:${r.afm}`, row: r }));
    }
    return pending
      .filter((g) => (filter === 'all' ? true : g.suggestedKind === filter))
      .filter((g) => matches(search, g.name, g.afm, g.profession, g.address))
      .map((g) => ({ type: 'group' as const, id: `g:${g.afm}`, group: g }));
  }, [filter, hidden, pending, search]);

  // Πάντα υπάρχει επιλεγμένη γραμμή όσο η λίστα δεν είναι άδεια.
  React.useEffect(() => {
    if (rows.length === 0) { setSelectedId(null); return; }
    setSelectedId((cur) => (cur && rows.some((r) => r.id === cur) ? cur : rows[0].id));
  }, [rows]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  /** Η επόμενη γραμμή μετά από αυτήν που φεύγει (αλλιώς η προηγούμενη). */
  const neighbourOf = (id: string): string | null => {
    const at = rows.findIndex((r) => r.id === id);
    if (at < 0) return null;
    return rows[at + 1]?.id ?? rows[at - 1]?.id ?? null;
  };

  const dropGroup = (afm: string) => {
    const next = neighbourOf(`g:${afm}`);
    setPending((list) => list.filter((g) => g.afm !== afm));
    setDone((n) => n + 1);
    setSelectedId(next);
  };

  const handleResolved = (afm: string, message: string) => {
    dropGroup(afm);
    toast.success(message);
    router.refresh();
  };

  const handleIgnored = (afm: string, reason: string | null) => {
    const group = pending.find((g) => g.afm === afm) ?? null;
    dropGroup(afm);
    setHidden((list) => [{ afm, name: group?.name ?? null, reason }, ...list.filter((r) => r.afm !== afm)]);
    toast.success(`Αγνοήθηκε ο εκδότης ${group?.name ?? afm}`, {
      action: {
        label: 'Αναίρεση',
        onClick: () => { void restore(afm, group); },
      },
    });
    router.refresh();
  };

  const restore = async (afm: string, group: TraderGroup | null) => {
    try {
      const res = await fetch(`/api/admin/ocr/new-traders/${afm}/ignore`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Η αναίρεση απέτυχε.'); return; }
      setHidden((list) => list.filter((r) => r.afm !== afm));
      if (group) {
        setPending((list) => (list.some((g) => g.afm === afm) ? list : [group, ...list]));
        setDone((n) => Math.max(0, n - 1));
        setSelectedId(`g:${afm}`);
      }
      toast.success('Ο εκδότης επέστρεψε στην ουρά');
      router.refresh();
    } catch {
      toast.error('Σφάλμα δικτύου — η αναίρεση απέτυχε.');
    }
  };

  const filters: QueueFilter[] = [
    { key: 'all', label: 'Όλοι', count: pending.length },
    { key: 'supplier', label: 'Προμηθευτές', count: pending.filter((g) => g.suggestedKind === 'supplier').length },
    { key: 'creditor', label: 'Πιστωτές', count: pending.filter((g) => g.suggestedKind === 'creditor').length },
    { key: 'ignored', label: 'Αγνοημένοι', count: hidden.length },
  ];

  const emptyState = filter === 'ignored'
    ? <QueueEmpty icon={<FiEyeOff />} title="Κανένας αγνοημένος εκδότης" hint="Όσοι εκδότες αγνοηθούν εμφανίζονται εδώ και μπορούν να επιστρέψουν στην ουρά." />
    : search.trim() || filter !== 'all'
      ? <QueueEmpty title="Κανένα αποτέλεσμα" hint="Δοκίμασε άλλο φίλτρο ή καθάρισε την αναζήτηση." />
      : (
        <QueueEmpty
          icon={<FiCheckCircle />}
          title="Όλοι οι εκδότες υπάρχουν στο SoftOne"
          hint="Δεν εκκρεμεί καμία δημιουργία συναλλασσομένου."
          action={
            <Link
              href="/admin/ocr"
              className="inline-flex h-8 cursor-pointer items-center rounded-lg px-2.5 text-[13px] font-medium text-sisyphus-700 outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500"
            >
              Λίστα εγγράφων OCR
            </Link>
          }
        />
      );

  return (
    <QueueLayout<Row>
      header={header}
      items={rows}
      getId={(r) => r.id}
      selectedId={selectedId}
      onSelect={setSelectedId}
      filters={filters}
      filter={filter}
      onFilter={(k) => setFilter(k as FilterKey)}
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Επωνυμία ή ΑΦΜ…"
      progress={{ done, total: done + pending.length }}
      listLabel="Ουρά εκδοτών"
      empty={emptyState}
      onPrimary={() => primaryRef.current?.()}
      renderItem={(r) => (r.type === 'group' ? <GroupRow group={r.group} /> : <IgnoredRow row={r.row} />)}
    >
      {selected?.type === 'group' ? (
        <TraderPanel
          key={selected.group.afm}
          group={selected.group}
          taxOffices={taxOffices}
          canManage={canManage}
          onResolved={handleResolved}
          onIgnored={handleIgnored}
          primaryRef={primaryRef}
        />
      ) : selected?.type === 'ignored' ? (
        <IgnoredPanel row={selected.row} canManage={canManage} onRestore={() => void restore(selected.row.afm, null)} />
      ) : (
        <QueueEmpty
          icon={<FiUserPlus />}
          title="Διάλεξε εκδότη"
          hint="Επίλεξε γραμμή από την ουρά ή χρησιμοποίησε J / K."
        />
      )}
    </QueueLayout>
  );
}

/** Γραμμή ουράς: μικρογραφία, επωνυμία, ΑΦΜ και chips πλήθους/συνόλου/τύπου. */
function GroupRow({ group }: { group: TraderGroup }) {
  const color = KIND_COLORS[group.suggestedKind];
  return (
    <>
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-neutral-6 text-muted-foreground">
        {group.thumbUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={group.thumbUrl} alt="" className="size-full object-cover" />
          : <FiFile aria-hidden className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">
          {group.name ?? 'Χωρίς επωνυμία'}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">{group.afm}</span>
          <span aria-hidden>·</span>
          <span>{group.docCount} παραστατικά</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{fmtEuro(group.total)}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium"
            style={{ backgroundColor: color.bg, color: color.fg }}
          >
            {KIND_LABEL[group.suggestedKind]}
          </span>
          <span className="text-[10px] text-muted-foreground">{fmtDate(group.lastDate)}</span>
        </span>
      </span>
    </>
  );
}

function IgnoredRow({ row }: { row: IgnoredIssuerRow }) {
  return (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-neutral-6 text-muted-foreground">
        <FiEyeOff aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">
          {row.name ?? 'Χωρίς επωνυμία'}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">{row.afm}</span>
          {row.reason && (<><span aria-hidden>·</span><span className="truncate">{row.reason}</span></>)}
        </span>
      </span>
    </>
  );
}

/** Panel αγνοημένου εκδότη: μόνο επαναφορά στην ουρά. */
function IgnoredPanel({
  row, canManage, onRestore,
}: { row: IgnoredIssuerRow; canManage: boolean; onRestore: () => void }) {
  return (
    <div className="space-y-3 px-4 py-3">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{row.name ?? 'Χωρίς επωνυμία'}</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <FiEyeOff aria-hidden className="size-3.5" /> Αγνοημένος εκδότης
          <span aria-hidden>·</span>
          <span className="font-mono tabular-nums text-foreground">ΑΦΜ {row.afm}</span>
        </p>
      </div>
      <p className="rounded-lg border border-border bg-neutral-4 px-3 py-2 text-[12px] text-muted-foreground">
        {row.reason ? <>Λόγος: {row.reason}</> : 'Χωρίς καταγεγραμμένο λόγο.'}
      </p>
      <Button type="button" variant="outline" className="cursor-pointer" disabled={!canManage} onClick={onRestore}>
        <FiCheckCircle aria-hidden className="size-4" /> Επαναφορά στην ουρά
      </Button>
    </div>
  );
}
