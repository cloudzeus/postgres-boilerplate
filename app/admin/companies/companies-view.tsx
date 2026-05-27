'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ColumnDef } from '@tanstack/react-table';
import {
  FiPlus, FiEdit2, FiTrash2, FiMoreVertical, FiCheck, FiX,
  FiAlertTriangle, FiSettings, FiLayers, FiMapPin, FiStar,
  FiInfo, FiFileText, FiPhone, FiCreditCard, FiTag, FiEdit3,
  FiUpload, FiArchive, FiExternalLink, FiImage, FiRefreshCw,
  FiUserPlus, FiUser, FiMail, FiSmartphone,
} from 'react-icons/fi';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CompanyTypesDialog } from './company-types-dialog';
import { AadeLookupButton, type AadeResult } from '@/components/aade/aade-lookup-button';
import { GemiSyncButton } from '@/components/gemi/gemi-sync-button';
import { CountrySelect, DEFAULT_COUNTRY, countryName } from '@/components/forms/country-select';

export type TypeOption = {
  id: string; key: string; name: string; pluralName: string;
  color: string | null; isSystem: boolean; count: number;
};

export type CompanyRow = {
  id: string;
  code: string | null;
  name: string;
  shortName: string | null;
  afm: string | null;
  doy: string | null;
  profession: string | null;
  legalForm: string | null;
  gemhNumber: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  fax: string | null;
  website: string | null;
  contactPerson: string | null;
  contactTitle: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  country: string | null;
  district: string | null;
  iban: string | null;
  bankName: string | null;
  currency: string | null;
  paymentTerms: string | null;
  creditLimit: number | null;
  discount: number | null;
  vatCategory: string | null;
  vatCategoryId: number | null;
  vatCategoryLabel: string | null;
  legalTypeId: number | null;
  legalTypeLabel: string | null;
  gemiOfficeId: number | null;
  gemiOfficeLabel: string | null;
  companyStatusId: number | null;
  companyStatusLabel: string | null;
  prefectureId: string | null;
  prefectureLabel: string | null;
  municipalityId: string | null;
  municipalityLabel: string | null;
  employeeCount: number | null;
  category: string | null;
  isActive: boolean;
  branchCount: number;
  documentCount: number;
  contactCount: number;
  activityCount: number;
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodedAddress: string | null;
  arGemi: string | null;
  gemiStatus: string | null;
  gemiOffice: string | null;
  aadeStatus: string | null;
  aadeFirmKind: string | null;
  foundingDate: string | null;
  aadeSyncedAt: string | null;
  gemiSyncedAt: string | null;
  createdAt: string;
  typeIds: string[];
  typeKeys: string[];
  typeLabels: { id: string; name: string; color: string | null }[];
};

// ---- Column factories for togglable scalar fields ----
function text(
  id: keyof CompanyRow | string,
  header: string,
  size: number,
  pick: (r: CompanyRow) => string | null,
  mono = false,
): ColumnDef<CompanyRow> {
  return {
    id, accessorFn: (r) => pick(r) ?? '', header, size,
    cell: ({ row }) => {
      const v = pick(row.original);
      return <span className={`text-[12px] text-muted-foreground truncate ${mono ? 'font-mono tabular-nums' : ''}`}>{v || '—'}</span>;
    },
  };
}
function money(
  id: string, header: string, size: number,
  pick: (r: CompanyRow) => number | null,
  currency: (r: CompanyRow) => string | null,
): ColumnDef<CompanyRow> {
  return {
    id, accessorFn: (r) => pick(r) ?? 0, header, size,
    cell: ({ row }) => {
      const v = pick(row.original);
      if (v == null) return <span className="text-[12px] text-muted-foreground">—</span>;
      return <span className="text-[12px] text-muted-foreground tabular-nums">
        {v.toLocaleString('el-GR', { style: 'currency', currency: currency(row.original) || 'EUR' })}
      </span>;
    },
  };
}
function percent(
  id: string, header: string, size: number,
  pick: (r: CompanyRow) => number | null,
): ColumnDef<CompanyRow> {
  return {
    id, accessorFn: (r) => pick(r) ?? 0, header, size,
    cell: ({ row }) => {
      const v = pick(row.original);
      return <span className="text-[12px] text-muted-foreground tabular-nums">{v == null ? '—' : `${v}%`}</span>;
    },
  };
}
function date(
  id: string, header: string, size: number,
  pick: (r: CompanyRow) => string | null,
): ColumnDef<CompanyRow> {
  return {
    id, accessorFn: (r) => pick(r) ?? '', header, size,
    cell: ({ row }) => {
      const v = pick(row.original);
      return <span className="text-[12px] text-muted-foreground tabular-nums">{v ? new Date(v).toLocaleDateString('el-GR') : '—'}</span>;
    },
  };
}
function coordsCol(
  id: string, header: string, size: number,
  lat: (r: CompanyRow) => number | null,
  lng: (r: CompanyRow) => number | null,
): ColumnDef<CompanyRow> {
  return {
    id, header, size, enableSorting: false,
    accessorFn: (r) => (lat(r) != null && lng(r) != null ? `${lat(r)},${lng(r)}` : ''),
    cell: ({ row }) => {
      const la = lat(row.original); const ln = lng(row.original);
      if (la == null || ln == null) return <span className="text-[12px] text-muted-foreground">—</span>;
      return <span className="text-[11px] text-muted-foreground font-mono tabular-nums">{la.toFixed(4)}, {ln.toFixed(4)}</span>;
    },
  };
}

// Columns visible by default — everything else from the helpers above is hidden initially.
const DEFAULT_VISIBLE_COLUMNS = new Set<string>([
  '__expand', '__select', 'name', 'types', 'afm', 'email', 'phone', 'city', 'branchCount', 'isActive', 'actions',
]);

export function CompaniesView({
  rows, types, canManageTypes,
}: { rows: CompanyRow[]; types: TypeOption[]; canManageTypes: boolean }) {
  const router = useRouter();
  const [editCompany, setEditCompany] = React.useState<CompanyRow | null>(null);
  const [deleteCompany, setDeleteCompany] = React.useState<CompanyRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [managingTypes, setManagingTypes] = React.useState(false);
  const [contactFor, setContactFor] = React.useState<CompanyRow | null>(null);
  const [tab, setTab] = React.useState<string>('ALL');

  const columns = React.useMemo<ColumnDef<CompanyRow>[]>(() => ([
    {
      accessorKey: 'name', header: 'Επωνυμία', size: 260,
      cell: ({ row }) => {
        const initials = (row.original.name || '?').slice(0, 2).toUpperCase();
        return (
          <div className="flex items-center gap-2 min-w-0">
            {row.original.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={row.original.logoUrl} alt="" className="h-6 w-6 rounded-sm object-contain border border-border bg-background shrink-0" />
              : (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-primary-foreground text-[10px] font-semibold shrink-0">
                  {initials}
                </span>
              )}
            <div className="min-w-0">
              <div className="font-medium text-foreground truncate text-[12px]">{row.original.name}</div>
              {row.original.code && <div className="text-[10px] text-muted-foreground truncate">#{row.original.code}</div>}
            </div>
          </div>
        );
      },
    },
    {
      id: 'types', header: 'Τύποι', size: 220,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.typeLabels.map((t) => (
            <Badge
              key={t.id}
              variant="outline"
              style={t.color ? { borderColor: `${t.color}55`, color: t.color } : undefined}
              className="text-[10px]"
            >
              {t.name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      accessorKey: 'afm', header: 'ΑΦΜ', size: 110,
      cell: ({ row }) => <span className="tabular-nums text-[12px] text-muted-foreground">{row.original.afm || '—'}</span>,
    },
    {
      accessorKey: 'email', header: 'Email', size: 200,
      cell: ({ row }) => <span className="truncate text-[12px] text-muted-foreground">{row.original.email || '—'}</span>,
    },
    {
      accessorKey: 'phone', header: 'Τηλέφωνο', size: 120,
      cell: ({ row }) => <span className="tabular-nums text-[12px] text-muted-foreground">{row.original.phone || '—'}</span>,
    },
    {
      accessorKey: 'city', header: 'Πόλη', size: 120,
      cell: ({ row }) => <span className="text-[12px] text-muted-foreground">{row.original.city || '—'}</span>,
    },
    {
      accessorKey: 'branchCount', header: 'Υποκ/τα', size: 80,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground tabular-nums">
          <FiMapPin className="size-3" /> {row.original.branchCount}
        </span>
      ),
    },
    {
      accessorKey: 'isActive', header: 'Κατάσταση', size: 110,
      cell: ({ row }) => row.original.isActive
        ? <Badge variant="outline" className="border-emerald-300 text-emerald-700"><FiCheck /> Ενεργή</Badge>
        : <Badge variant="outline"><FiX /> Ανενεργή</Badge>,
    },

    // ---- Hidden by default — togglable via the Στήλες menu ----
    text('code', 'Κωδικός', 110, (r) => r.code),
    text('shortName', 'Διακριτικός τίτλος', 180, (r) => r.shortName),
    text('doy', 'ΔΟΥ', 130, (r) => r.doy),
    text('profession', 'Επάγγελμα', 200, (r) => r.profession),
    text('legalForm', 'Νομική μορφή', 130, (r) => r.legalForm),
    text('gemhNumber', 'Αρ. ΓΕΜΗ (input)', 140, (r) => r.gemhNumber, true),
    text('arGemi', 'Αρ. ΓΕΜΗ', 140, (r) => r.arGemi, true),
    text('address', 'Διεύθυνση', 220, (r) => r.address),
    text('zip', 'ΤΚ', 80, (r) => r.zip, true),
    text('country', 'Χώρα', 70, (r) => r.country),
    text('district', 'Νομός', 120, (r) => r.district),
    text('phone2', 'Τηλέφωνο 2', 130, (r) => r.phone2, true),
    text('fax', 'Fax', 120, (r) => r.fax, true),
    text('website', 'Website', 180, (r) => r.website),
    text('contactPerson', 'Υπεύθυνος', 160, (r) => r.contactPerson),
    text('contactTitle', 'Θέση', 130, (r) => r.contactTitle),
    text('iban', 'IBAN', 220, (r) => r.iban, true),
    text('bankName', 'Τράπεζα', 160, (r) => r.bankName),
    text('currency', 'Νόμισμα', 80, (r) => r.currency),
    text('paymentTerms', 'Όροι πληρωμής', 160, (r) => r.paymentTerms),
    money('creditLimit', 'Πιστωτικό όριο', 140, (r) => r.creditLimit, (r) => r.currency),
    percent('discount', 'Έκπτωση', 100, (r) => r.discount),
    text('vatCategory', 'Κατηγορία ΦΠΑ (text)', 150, (r) => r.vatCategory),
    text('vatCategoryRef', 'Κατηγορία ΦΠΑ', 150, (r) => r.vatCategoryLabel),
    text('legalTypeRef', 'Νομική μορφή (ΓΕΜΗ)', 160, (r) => r.legalTypeLabel),
    text('gemiOfficeRef', 'Υπηρεσία ΓΕΜΗ (ΓΕΜΗ)', 200, (r) => r.gemiOfficeLabel),
    text('prefectureRef', 'Νομός (ΓΕΜΗ)', 160, (r) => r.prefectureLabel),
    text('municipalityRef', 'Δήμος (ΓΕΜΗ)', 180, (r) => r.municipalityLabel),
    {
      id: 'employeeCount', header: 'Εργαζόμενοι', size: 100,
      accessorFn: (r) => r.employeeCount ?? 0,
      cell: ({ row }) => <span className="text-[12px] text-muted-foreground tabular-nums">{row.original.employeeCount ?? '—'}</span>,
    },
    text('category', 'Κατηγορία', 130, (r) => r.category),
    text('gemiOffice', 'Υπηρεσία ΓΕΜΗ', 200, (r) => r.gemiOffice),
    text('gemiStatus', 'Κατάσταση ΓΕΜΗ', 160, (r) => r.gemiStatus),
    text('aadeStatus', 'Κατάσταση ΑΕΔΕΕ', 160, (r) => r.aadeStatus),
    text('aadeFirmKind', 'Τύπος ΑΕΔΕΕ', 140, (r) => r.aadeFirmKind),
    date('foundingDate', 'Ίδρυση', 110, (r) => r.foundingDate),
    date('gemiSyncedAt', 'Sync ΓΕΜΗ', 140, (r) => r.gemiSyncedAt),
    date('aadeSyncedAt', 'Sync ΑΕΔΕΕ', 140, (r) => r.aadeSyncedAt),
    date('createdAt', 'Δημιουργία', 120, (r) => r.createdAt),
    coordsCol('coords', 'Συντεταγμένες', 160, (r) => r.latitude, (r) => r.longitude),

    {
      id: 'actions', header: '', size: 56, enableHiding: false, enableSorting: false, enableResizing: false,
      cell: ({ row }) => {
        const c = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Ενέργειες"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground hover:border-border data-[state=open]:bg-muted data-[state=open]:text-foreground data-[state=open]:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
            >
              <FiMoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px]">
              <DropdownMenuLabel>Ενέργειες</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setEditCompany(c)}>
                <FiEdit2 /> Επεξεργασία
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setContactFor(c)}>
                <FiUserPlus /> Προσθήκη επαφής
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteCompany(c)}>
                <FiTrash2 /> Διαγραφή
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ]), []);

  const filteredRows = React.useMemo(() => {
    if (tab === 'ALL') return rows;
    return rows.filter((r) => r.typeKeys.includes(tab) || r.typeIds.includes(tab));
  }, [rows, tab]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs value={tab} onValueChange={setTab} className="flex-1 min-w-0">
          <TabsList variant="line">
            <TabsTrigger value="ALL">
              Όλες <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">{rows.length}</span>
            </TabsTrigger>
            {types.map((t) => (
              <TabsTrigger key={t.id} value={t.key}>
                <span style={t.color ? { color: t.color } : undefined}>{t.pluralName}</span>
                <span className="ml-1.5 text-[10px] text-muted-foreground tabular-nums">{t.count}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {canManageTypes && (
            <Button variant="outline" size="sm" onClick={() => setManagingTypes(true)}>
              <FiLayers className="mr-1.5" /> Τύποι εταιριών
            </Button>
          )}
          <Button size="sm" onClick={() => setCreating(true)}>
            <FiPlus className="mr-1.5" /> Νέα εταιρία
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredRows}
        searchPlaceholder="Αναζήτηση εταιριών..."
        enableSelection
        persistKey="admin.companies.v1"
        initialColumnVisibility={Object.fromEntries(
          columns
            .map((c) => (c as any).id ?? (c as any).accessorKey)
            .filter(Boolean)
            .map((id) => [id, DEFAULT_VISIBLE_COLUMNS.has(id)]),
        )}
        expandable={(c) => <CompanyExpandedRow company={c} />}
      />

      <CompanyDialog
        open={creating || !!editCompany}
        company={editCompany}
        types={types}
        defaultTypeKey={tab !== 'ALL' ? tab : null}
        onClose={() => { setCreating(false); setEditCompany(null); }}
        onSaved={() => { setCreating(false); setEditCompany(null); router.refresh(); }}
      />

      <DeleteDialog
        company={deleteCompany}
        onClose={() => setDeleteCompany(null)}
        onDeleted={() => { setDeleteCompany(null); router.refresh(); }}
      />

      <ContactDialog
        open={!!contactFor}
        companyId={contactFor?.id ?? null}
        companyName={contactFor?.name ?? ''}
        contact={null}
        onClose={() => setContactFor(null)}
        onSaved={() => { setContactFor(null); router.refresh(); }}
      />

      <CompanyTypesDialog
        open={managingTypes}
        types={types}
        onClose={() => setManagingTypes(false)}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}

// ---------------- Create / Edit Dialog ----------------

function CompanyDialog({
  open, company, types, defaultTypeKey, onClose, onSaved,
}: {
  open: boolean;
  company: CompanyRow | null;
  types: TypeOption[];
  defaultTypeKey: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!company;
  const [form, setForm] = React.useState<any>({});
  const [typeIds, setTypeIds] = React.useState<string[]>([]);
  const [activities, setActivities] = React.useState<{ code: string; codeAade?: string | null; codeWithoutDots?: string | null; description: string; kind: 'PRIMARY' | 'SECONDARY'; order?: number }[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [activeSection, setActiveSection] = React.useState<string>('general');
  const [lookups, setLookups] = React.useState<{
    legalTypes: { id: number; descr: string }[];
    gemiOffices: { id: number; descr: string }[];
    companyStatuses: { id: number; descr: string; isActive: boolean }[];
    prefectures: { id: string; descr: string }[];
    municipalities: { id: string; descr: string; prefectureId: string | null }[];
    vatCategories: { id: number; code: string; descr: string; rate: number | null }[];
  } | null>(null);
  React.useEffect(() => {
    if (!open || lookups) return;
    fetch('/api/admin/lookups').then((r) => r.ok ? r.json() : null).then((d) => d && setLookups(d));
  }, [open, lookups]);

  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    setActiveSection('general');
    if (company) {
      fetch(`/api/admin/companies/${company.id}`)
        .then((r) => r.json())
        .then((d) => {
          const c = d.company;
          setForm({
            code: c.code ?? '', name: c.name ?? '', shortName: c.shortName ?? '',
            afm: c.afm ?? '', doy: c.doy ?? '', profession: c.profession ?? '',
            legalForm: c.legalForm ?? '', gemhNumber: c.gemhNumber ?? '',
            address: c.address ?? '', city: c.city ?? '', zip: c.zip ?? '',
            country: c.country ?? 'GR', phone: c.phone ?? '', phone2: c.phone2 ?? '',
            email: c.email ?? '', website: c.website ?? '',
            contactPerson: c.contactPerson ?? '', contactTitle: c.contactTitle ?? '',
            iban: c.iban ?? '', bankName: c.bankName ?? '',
            paymentTerms: c.paymentTerms ?? '',
            creditLimit: c.creditLimit ?? '', discount: c.discount ?? '',
            notes: c.notes ?? '', isActive: c.isActive ?? true,
            foundingDate: c.foundingDate ? c.foundingDate.slice(0, 10) : '',
            aadeStatus: c.aadeStatus ?? '', aadeFirmKind: c.aadeFirmKind ?? '',
            arGemi: c.arGemi ?? null,
            gemiStatus: c.gemiStatus ?? '', gemiOffice: c.gemiOffice ?? '',
            gemiObjective: c.gemiObjective ?? '',
            gemiSyncedAt: c.gemiSyncedAt ?? null,
            logoUrl: c.logoUrl ?? null,
            employeeCount: c.employeeCount ?? '',
            legalTypeId: c.legalTypeId ?? '',
            vatCategoryId: c.vatCategoryId ?? '',
            gemiOfficeId: c.gemiOfficeId ?? '',
            companyStatusId: c.companyStatusId ?? '',
            prefectureId: c.prefectureId ?? '',
            municipalityId: c.municipalityId ?? '',
          });
          setTypeIds(c.types.map((t: any) => t.typeId));
          setActivities((c.activities ?? []).map((a: any) => ({
            code: a.code, codeAade: a.codeAade, codeWithoutDots: a.codeWithoutDots,
            description: a.description, kind: a.kind, order: a.order,
          })));
        });
    } else {
      setForm({ name: '', country: 'GR', isActive: true });
      const def = defaultTypeKey ? types.find((t) => t.key === defaultTypeKey) : null;
      setTypeIds(def ? [def.id] : []);
      setActivities([]);
    }
  }, [open, company, defaultTypeKey, types, reloadKey]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const toggleType = (id: string) =>
    setTypeIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const applyAade = (data: AadeResult) => {
    const m = data.mapped;
    setForm((f: any) => ({
      ...f,
      afm: m.afm,
      name: m.name || f.name,
      shortName: m.shortName ?? f.shortName ?? '',
      doy: m.doy ?? f.doy ?? '',
      legalForm: m.legalForm ?? f.legalForm ?? '',
      profession: m.profession ?? f.profession ?? '',
      address: m.address ?? f.address ?? '',
      zip: m.zip ?? f.zip ?? '',
      city: m.city ?? f.city ?? '',
      country: m.country ?? f.country ?? 'GR',
      foundingDate: m.foundingDate ?? f.foundingDate ?? '',
      aadeStatus: m.aadeStatus ?? '',
      aadeFirmKind: m.aadeFirmKind ?? '',
      aadeSyncedAt: new Date().toISOString(),
      isActive: m.isActive,
    }));
    setActivities(data.activities);
  };

  const save = async () => {
    if (!form.name?.trim()) { toast.error('Επωνυμία υποχρεωτική'); return; }
    if (typeIds.length === 0) { toast.error('Επίλεξε τουλάχιστον έναν τύπο'); return; }
    setSaving(true);
    const payload = {
      ...form,
      creditLimit: form.creditLimit === '' ? null : form.creditLimit,
      discount: form.discount === '' ? null : form.discount,
      employeeCount: form.employeeCount === '' ? null : form.employeeCount,
      legalTypeId: form.legalTypeId === '' ? null : form.legalTypeId,
      vatCategoryId: form.vatCategoryId === '' ? null : form.vatCategoryId,
      gemiOfficeId: form.gemiOfficeId === '' ? null : form.gemiOfficeId,
      companyStatusId: form.companyStatusId === '' ? null : form.companyStatusId,
      prefectureId: form.prefectureId === '' ? null : form.prefectureId,
      municipalityId: form.municipalityId === '' ? null : form.municipalityId,
      foundingDate: form.foundingDate || null,
      typeIds,
      activities,
    };
    const url = isEdit ? `/api/admin/companies/${company!.id}` : '/api/admin/companies';
    const method = isEdit ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) { toast.success(isEdit ? 'Αποθηκεύτηκε' : 'Δημιουργήθηκε'); onSaved(); }
    else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || 'Αποτυχία αποθήκευσης');
    }
  };

  const initials = (form.name || '?').slice(0, 2).toUpperCase();
  const sections = [
    { id: 'general', label: 'Γενικά', icon: FiInfo, hint: 'Επωνυμία · τύποι · κωδικός' },
    { id: 'tax', label: 'Φορολογικά & ΚΑΔ', icon: FiFileText, hint: 'ΑΦΜ · ΔΟΥ · δραστηριότητες' },
    { id: 'contact', label: 'Επικοινωνία', icon: FiPhone, hint: 'Διεύθυνση · τηλέφωνο · email' },
    ...(isEdit && company ? [{ id: 'contacts', label: 'Επαφές', icon: FiUser, hint: 'Πρόσωπα · ρόλοι · κινητά · email' }] : []),
    ...(isEdit && company ? [{ id: 'branches', label: 'Υποκαταστήματα', icon: FiMapPin, hint: 'Έδρα + υποκαταστήματα' }] : []),
    ...(isEdit && company ? [{ id: 'documents', label: 'Έγγραφα ΓΕΜΗ', icon: FiArchive, hint: 'Δημόσια έγγραφα από ΓΕΜΗ' }] : []),
    { id: 'financial', label: 'Οικονομικά', icon: FiCreditCard, hint: 'IBAN · πιστωτικό όριο · έκπτωση' },
    { id: 'notes', label: 'Σημειώσεις', icon: FiEdit3, hint: 'Ελεύθερο κείμενο' },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl p-0 gap-0 max-h-[92vh] flex flex-col overflow-hidden">
        {/* Sticky header: identity + AADE action. pr-10 leaves room for the close X. */}
        <DialogHeader className="border-b border-border px-5 py-3 pr-12 space-y-0">
          <div className="flex items-center gap-3">
            <LogoBlock
              logoUrl={form.logoUrl ?? null}
              initials={initials}
              companyId={company?.id ?? null}
              onChange={(url) => { set('logoUrl', url); setReloadKey((k) => k + 1); }}
            />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-[14px] leading-tight truncate">
                {isEdit ? (form.name || 'Επεξεργασία εταιρίας') : 'Νέα εταιρία'}
              </DialogTitle>
              <DialogDescription className="text-[11px] truncate flex items-center gap-2 mt-0.5">
                {form.afm && <span className="tabular-nums">ΑΦΜ {form.afm}</span>}
                {form.arGemi && <span className="tabular-nums">· ΓΕΜΗ {form.arGemi}</span>}
                {typeIds.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    {typeIds.slice(0, 3).map((id) => {
                      const t = types.find((x) => x.id === id);
                      if (!t) return null;
                      return (
                        <Badge
                          key={id}
                          variant="outline"
                          style={t.color ? { borderColor: `${t.color}55`, color: t.color } : undefined}
                          className="text-[9px] py-0 h-4"
                        >
                          {t.name}
                        </Badge>
                      );
                    })}
                    {typeIds.length > 3 && <span className="text-muted-foreground">+{typeIds.length - 3}</span>}
                  </span>
                )}
                {!form.afm && typeIds.length === 0 && <span>Συμπλήρωσε ΑΦΜ ή χρησιμοποίησε άντληση ΑΕΔΕΕ →</span>}
              </DialogDescription>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer shrink-0 mr-1">
              <Checkbox checked={!!form.isActive} onCheckedChange={(v) => set('isActive', !!v)} />
              <span className="text-[11px] text-muted-foreground">Ενεργή</span>
            </label>
            <AadeLookupButton initialAfm={form.afm ?? ''} onApply={applyAade} />
            {isEdit && company && (
              <GemiSyncButton
                companyId={company.id}
                hasIdentifier={!!form.afm || !!form.arGemi}
                onSynced={() => setReloadKey((k) => k + 1)}
              />
            )}
          </div>
        </DialogHeader>

        {/* Two-pane body: custom vertical nav + scrollable panel.
            Scoped compact typography for all inputs/labels/textarea/select in the form. */}
        <div
          className="flex-1 min-h-0 flex flex-row
            [&_input]:!text-[12px] [&_input]:!h-8 [&_input]:!px-2
            [&_textarea]:!text-[12px]
            [&_select]:!text-[12px] [&_select]:!h-8
            [&_label]:!text-[11px] [&_label]:!font-medium"
        >
          <nav className="w-[210px] shrink-0 border-r border-border bg-muted/30 p-2 flex flex-col gap-0.5 overflow-y-auto">
            {sections.map((s) => {
              const active = activeSection === s.id;
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`flex items-start gap-2 px-2.5 py-2 rounded-sm text-left transition-colors ${
                    active
                      ? 'bg-background border border-border shadow-xs text-foreground'
                      : 'border border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                >
                  <s.icon className={`size-3.5 mt-0.5 shrink-0 ${active ? 'text-primary' : ''}`} />
                  <span className="flex flex-col min-w-0">
                    <span className="text-[12px] font-medium leading-tight truncate">{s.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight truncate font-normal">{s.hint}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 min-w-0 overflow-y-auto">
            {activeSection === 'general' && <div className="p-5 space-y-5">
              <SectionBlock title="Τύποι εταιρίας" hint="Επίλεξε όλους τους τύπους που εφαρμόζονται (π.χ. Πελάτης + Προμηθευτής).">
                <div className="flex flex-wrap gap-1.5">
                  {types.map((t) => {
                    const active = typeIds.includes(t.id);
                    return (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => toggleType(t.id)}
                        className={`text-[12px] rounded-sm border px-2.5 py-1 transition-colors ${
                          active ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                        style={active && t.color ? { borderColor: t.color, color: t.color, backgroundColor: `${t.color}10` } : undefined}
                      >
                        {active && <FiCheck className="inline mr-1 size-3" />}
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </SectionBlock>

              <SectionBlock title="Βασικά στοιχεία">
                <Grid>
                  <Field label="Επωνυμία *" id="c-name" wide>
                    <Input id="c-name" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
                  </Field>
                  <Field label="Διακριτικός τίτλος" id="c-short" wide>
                    <Input id="c-short" value={form.shortName ?? ''} onChange={(e) => set('shortName', e.target.value)} />
                  </Field>
                  <Field label="Κωδικός" id="c-code"><Input id="c-code" value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} /></Field>
                  <Field label="Νομική μορφή" id="c-legal">
                    <LookupSelect
                      id="c-legal"
                      value={form.legalTypeId}
                      options={lookups?.legalTypes ?? []}
                      freeText={form.legalForm}
                      onChange={(id, label) => {
                        set('legalTypeId', id);
                        if (label) set('legalForm', label);
                      }}
                      placeholder="Επίλεξε (π.χ. ΕΠΕ, ΙΚΕ, ΑΕ)"
                    />
                  </Field>
                  <Field label="Εργαζόμενοι" id="c-emp">
                    <Input id="c-emp" type="number" min={0} value={form.employeeCount ?? ''} onChange={(e) => set('employeeCount', e.target.value)} className="tabular-nums" />
                  </Field>
                  <Field label="Αρ. ΓΕΜΗ" id="c-gemh"><Input id="c-gemh" value={form.gemhNumber ?? ''} onChange={(e) => set('gemhNumber', e.target.value)} placeholder="π.χ. 123456789000" /></Field>
                  <Field label="Ημερομηνία ίδρυσης" id="c-found">
                    <Input id="c-found" type="date" value={form.foundingDate ?? ''} onChange={(e) => set('foundingDate', e.target.value)} />
                  </Field>
                  <Field label="Επάγγελμα" id="c-prof" wide>
                    <Input id="c-prof" value={form.profession ?? ''} onChange={(e) => set('profession', e.target.value)} />
                  </Field>
                </Grid>
              </SectionBlock>
            </div>}

            {activeSection === 'tax' && <div className="p-5 space-y-5">
              <SectionBlock title="Φορολογικά στοιχεία" hint="Άντλησε αυτόματα από ΑΕΔΕΕ με το εικονίδιο δίπλα στο ΑΦΜ.">
                <Grid>
                  <Field label="ΑΦΜ" id="c-afm">
                    <div className="flex items-center gap-1.5">
                      <Input
                        id="c-afm"
                        value={form.afm ?? ''}
                        onChange={(e) => set('afm', e.target.value.replace(/\D/g, '').slice(0, 9))}
                        maxLength={9}
                        inputMode="numeric"
                        className="font-mono tabular-nums"
                      />
                      <AadeLookupButton initialAfm={form.afm ?? ''} onApply={applyAade} />
                    </div>
                  </Field>
                  <Field label="ΔΟΥ" id="c-doy"><Input id="c-doy" value={form.doy ?? ''} onChange={(e) => set('doy', e.target.value)} /></Field>
                  <Field label="Κατηγορία ΦΠΑ" id="c-vat">
                    <LookupSelect
                      id="c-vat"
                      value={form.vatCategoryId}
                      options={(lookups?.vatCategories ?? []).map((v) => ({ id: v.id, descr: v.descr }))}
                      freeText={form.vatCategory}
                      onChange={(id, label) => {
                        set('vatCategoryId', id);
                        if (label) set('vatCategory', label);
                      }}
                      placeholder="Επίλεξε καθεστώς ΦΠΑ"
                    />
                  </Field>
                </Grid>
                {(form.aadeStatus || form.aadeFirmKind) && (
                  <div className="mt-3 flex flex-wrap gap-1.5 rounded-sm bg-muted/40 px-2.5 py-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">ΑΕΔΕΕ</span>
                    {form.aadeStatus && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">{form.aadeStatus}</Badge>}
                    {form.aadeFirmKind && <Badge variant="outline" className="text-[10px]">{form.aadeFirmKind}</Badge>}
                  </div>
                )}
                {(form.arGemi || form.gemiStatus || form.gemiOffice) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-sm bg-muted/40 px-2.5 py-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">ΓΕΜΗ</span>
                    {form.arGemi && <Badge variant="outline" className="text-[10px] tabular-nums">Αρ. {form.arGemi}</Badge>}
                    {form.gemiStatus && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">{form.gemiStatus}</Badge>}
                    {form.gemiOffice && <Badge variant="outline" className="text-[10px]">{form.gemiOffice}</Badge>}
                    {form.gemiSyncedAt && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        Sync: {new Date(form.gemiSyncedAt).toLocaleString('el-GR')}
                      </span>
                    )}
                  </div>
                )}
              </SectionBlock>

              <SectionBlock
                title="ΚΑΔ — Δραστηριότητες"
                hint="Αυτόματη συμπλήρωση από ΑΕΔΕΕ. Πρόσθεσε/διόρθωσε χειροκίνητα και όρισε την ΚΥΡΙΑ."
              >
                <ActivitiesEditor activities={activities} onChange={setActivities} />
              </SectionBlock>
            </div>}

            {activeSection === 'contact' && <div className="p-5 space-y-5">
              <SectionBlock title="Διεύθυνση">
                <Grid>
                  <Field label="Οδός & αριθμός" id="c-addr" wide><Input id="c-addr" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
                  <Field label="Πόλη" id="c-city"><Input id="c-city" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
                  <Field label="ΤΚ" id="c-zip"><Input id="c-zip" value={form.zip ?? ''} onChange={(e) => set('zip', e.target.value)} /></Field>
                  <Field label="Χώρα" id="c-country">
                    <CountrySelect id="c-country" value={form.country ?? DEFAULT_COUNTRY} onChange={(v) => set('country', v)} />
                  </Field>
                </Grid>
              </SectionBlock>

              <SectionBlock title="Στοιχεία επικοινωνίας">
                <Grid>
                  <Field label="Τηλέφωνο" id="c-phone"><Input id="c-phone" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
                  <Field label="Τηλέφωνο 2" id="c-phone2"><Input id="c-phone2" value={form.phone2 ?? ''} onChange={(e) => set('phone2', e.target.value)} /></Field>
                  <Field label="Email" id="c-email" wide><Input id="c-email" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
                  <Field label="Website" id="c-web" wide><Input id="c-web" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} /></Field>
                </Grid>
              </SectionBlock>

              <SectionBlock title="Υπεύθυνος επικοινωνίας">
                <Grid>
                  <Field label="Ονοματεπώνυμο" id="c-cp"><Input id="c-cp" value={form.contactPerson ?? ''} onChange={(e) => set('contactPerson', e.target.value)} /></Field>
                  <Field label="Θέση" id="c-ct"><Input id="c-ct" value={form.contactTitle ?? ''} onChange={(e) => set('contactTitle', e.target.value)} /></Field>
                </Grid>
              </SectionBlock>

              {isEdit && company && (
                <SectionBlock title="Πολλαπλά κανάλια επικοινωνίας" hint="Email/τηλέφωνα/fax με τίτλο για το καθένα (π.χ. Λογιστήριο, Hot line πωλήσεων).">
                  <ChannelsPanel companyId={company.id} />
                </SectionBlock>
              )}
            </div>}

            {activeSection === 'contacts' && isEdit && company && (
              <div className="p-5">
                <SectionBlock title="Επαφές" hint="Πρόσωπα που συνδέονται με την εταιρία (λογιστής, υπεύθυνος προμηθειών, υπεύθυνος πωλήσεων, κ.λπ.).">
                  <ContactsPanel companyId={company.id} />
                </SectionBlock>
              </div>
            )}

            {activeSection === 'branches' && isEdit && company && (
              <div className="p-5">
                <SectionBlock title="Υποκαταστήματα" hint="Μία εταιρία μπορεί να έχει πολλαπλά υποκαταστήματα. Σήμανε ένα ως Έδρα.">
                  <BranchesPanel companyId={company.id} />
                </SectionBlock>
              </div>
            )}

            {activeSection === 'documents' && isEdit && company && (
              <div className="p-5">
                <SectionBlock
                  title="Έγγραφα ΓΕΜΗ"
                  hint="Δημόσια έγγραφα από Open Data ΓΕΜΗ. Συγχρονισμός μέσω του εικονιδίου στην κεφαλίδα. Τα αρχεία αποθηκεύονται στο Bunny CDN."
                >
                  <DocumentsPanel
                    companyId={company.id}
                    gemiSyncedAt={form.gemiSyncedAt ?? null}
                    gemiOffice={form.gemiOffice ?? null}
                    gemiStatus={form.gemiStatus ?? null}
                  />
                </SectionBlock>
              </div>
            )}

            {activeSection === 'financial' && <div className="p-5 space-y-5">
              <SectionBlock title="Τραπεζικά">
                <Grid>
                  <Field label="IBAN" id="c-iban" wide><Input id="c-iban" value={form.iban ?? ''} onChange={(e) => set('iban', e.target.value)} className="font-mono" /></Field>
                  <Field label="Τράπεζα" id="c-bank" wide><Input id="c-bank" value={form.bankName ?? ''} onChange={(e) => set('bankName', e.target.value)} /></Field>
                </Grid>
              </SectionBlock>

              <SectionBlock title="Πίστωση & εμπορική πολιτική">
                <Grid>
                  <Field label="Όροι πληρωμής" id="c-pt" wide><Input id="c-pt" value={form.paymentTerms ?? ''} onChange={(e) => set('paymentTerms', e.target.value)} placeholder="π.χ. 30 ημέρες" /></Field>
                  <Field label="Πιστωτικό όριο (€)" id="c-cl">
                    <Input id="c-cl" type="number" step="0.01" value={form.creditLimit ?? ''} onChange={(e) => set('creditLimit', e.target.value)} className="tabular-nums" />
                  </Field>
                  <Field label="Έκπτωση (%)" id="c-disc">
                    <Input id="c-disc" type="number" step="0.01" value={form.discount ?? ''} onChange={(e) => set('discount', e.target.value)} className="tabular-nums" />
                  </Field>
                </Grid>
              </SectionBlock>
            </div>}

            {activeSection === 'notes' && <div className="p-5">
              <SectionBlock title="Σημειώσεις" hint="Εσωτερικές σημειώσεις, ορατές μόνο σε χρήστες με πρόσβαση στην εταιρία.">
                <textarea
                  className="w-full rounded-sm border border-input bg-background px-3 py-2 text-[13px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[180px]"
                  rows={8}
                  value={form.notes ?? ''}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Πληροφορίες, ιστορικό, κρίσιμες υπενθυμίσεις…"
                />
              </SectionBlock>
            </div>}
          </div>
        </div>

        {/* Sticky footer. mx-0/mb-0 override DialogFooter's default -mx-4 -mb-4 negative margins
            (which assume the parent has p-4 — our DialogContent uses p-0). */}
        <DialogFooter className="!mx-0 !mb-0 !rounded-none border-t border-border bg-background px-5 py-3 sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            {isEdit ? 'Επεξεργασία υφιστάμενης εγγραφής' : 'Νέα καταχώριση'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Άκυρο</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionBlock({
  title, hint, children,
}: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5">
        <h3 className="text-[12px] font-semibold text-foreground leading-tight">{title}</h3>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">{children}</div>;
}
function LookupSelect<T extends string | number>({
  id, value, options, onChange, placeholder, freeText,
}: {
  id: string;
  value: T | null | '' | undefined;
  options: { id: T; descr: string }[];
  onChange: (id: T | null, label: string | null) => void;
  placeholder?: string;
  freeText?: string | null;          // existing text value that isn't (yet) linked to an FK
}) {
  return (
    <div className="space-y-1">
      <select
        id={id}
        className="h-8 w-full rounded-sm border border-input bg-background px-2 text-[12px]"
        value={value == null || value === '' ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw) return onChange(null, null);
          const opt = options.find((o) => String(o.id) === raw);
          const id = (typeof options[0]?.id === 'number' ? Number(raw) : raw) as T;
          onChange(id, opt?.descr ?? null);
        }}
      >
        <option value="">{placeholder ?? '— Επίλεξε —'}</option>
        {options.map((o) => (
          <option key={String(o.id)} value={String(o.id)}>{o.descr}</option>
        ))}
      </select>
      {!value && freeText && (
        <p className="text-[10px] text-amber-700">Free-text τιμή: «{freeText}» — δεν συνδέεται με το μητρώο. Επίλεξε από τη λίστα για να την ομαλοποιήσεις.</p>
      )}
    </div>
  );
}

function Field({ label, id, children, wide }: { label: string; id: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`grid gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <Label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

type Branch = {
  id: string; code: string | null; name: string;
  isHeadquarters: boolean; isActive: boolean;
  address: string | null; city: string | null; zip: string | null;
  phone: string | null; email: string | null; contactPerson: string | null;
};

function BranchesPanel({ companyId }: { companyId: string }) {
  const [branches, setBranches] = React.useState<Branch[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Branch | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/companies/${companyId}/branches`);
    const d = await res.json();
    setBranches(d.branches ?? []);
    setLoading(false);
  }, [companyId]);

  React.useEffect(() => { load(); }, [load]);

  const remove = async (b: Branch) => {
    if (!confirm(`Διαγραφή υποκαταστήματος "${b.name}";`)) return;
    const res = await fetch(`/api/admin/companies/${companyId}/branches/${b.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Διαγράφηκε'); load(); }
    else toast.error('Αποτυχία');
  };

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border rounded-sm border min-h-[44px]">
        {loading && <li className="px-3 py-2 text-[12px] text-muted-foreground">Φόρτωση…</li>}
        {!loading && branches.length === 0 && (
          <li className="px-3 py-2 text-[12px] text-muted-foreground">Δεν υπάρχουν υποκαταστήματα.</li>
        )}
        {branches.map((b) => (
          <li key={b.id} className="flex items-center gap-2 px-3 py-2">
            <FiMapPin className="size-3.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium text-foreground truncate">{b.name}</span>
                {b.isHeadquarters && (
                  <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700">
                    <FiStar className="mr-0.5" /> Έδρα
                  </Badge>
                )}
                {!b.isActive && <Badge variant="outline" className="text-[9px]">Ανενεργό</Badge>}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {[b.code && `#${b.code}`, b.address, b.city, b.phone].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(b)} aria-label="Επεξεργασία">
              <FiEdit2 />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => remove(b)} aria-label="Διαγραφή">
              <FiTrash2 className="text-destructive" />
            </Button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
        <FiPlus className="mr-1" /> Προσθήκη υποκαταστήματος
      </Button>

      <BranchDialog
        open={creating || !!editing}
        companyId={companyId}
        branch={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); load(); }}
      />
    </div>
  );
}

function BranchDialog({
  open, companyId, branch, onClose, onSaved,
}: {
  open: boolean; companyId: string; branch: Branch | null;
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!branch;
  const [form, setForm] = React.useState<any>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (branch) setForm({ ...branch });
    else setForm({ name: '', country: 'GR', isActive: true, isHeadquarters: false });
  }, [open, branch]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name?.trim()) { toast.error('Όνομα υποχρεωτικό'); return; }
    setSaving(true);
    const url = isEdit
      ? `/api/admin/companies/${companyId}/branches/${branch!.id}`
      : `/api/admin/companies/${companyId}/branches`;
    const res = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) { toast.success('Αποθηκεύτηκε'); onSaved(); }
    else toast.error('Αποτυχία');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Επεξεργασία υποκαταστήματος' : 'Νέο υποκατάστημα'}</DialogTitle>
          <DialogDescription>Στοιχεία διεύθυνσης και επικοινωνίας υποκαταστήματος.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3 py-2">
          <Field label="Όνομα *" id="b-name"><Input id="b-name" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Κωδικός" id="b-code"><Input id="b-code" value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} /></Field>
          <Field label="Διεύθυνση" id="b-addr"><Input id="b-addr" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Πόλη" id="b-city"><Input id="b-city" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="ΤΚ" id="b-zip"><Input id="b-zip" value={form.zip ?? ''} onChange={(e) => set('zip', e.target.value)} /></Field>
          <Field label="Χώρα" id="b-country">
            <CountrySelect id="b-country" value={form.country ?? DEFAULT_COUNTRY} onChange={(v) => set('country', v)} />
          </Field>
          <Field label="Τηλέφωνο" id="b-phone"><Input id="b-phone" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Email" id="b-email"><Input id="b-email" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Υπεύθυνος" id="b-cp"><Input id="b-cp" value={form.contactPerson ?? ''} onChange={(e) => set('contactPerson', e.target.value)} /></Field>
        </div>
        <div className="flex items-center gap-4 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={!!form.isHeadquarters} onCheckedChange={(v) => set('isHeadquarters', !!v)} />
            <span className="text-[13px]">Έδρα</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={!!form.isActive} onCheckedChange={(v) => set('isActive', !!v)} />
            <span className="text-[13px]">Ενεργό</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Άκυρο</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AvatarUploader({
  url, initials, canUpload, onPick, onRemove,
}: {
  url: string | null;
  initials: string;
  canUpload: boolean;
  onPick: (f: File) => void;
  onRemove: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="relative shrink-0 group">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }}
      />
      <button
        type="button"
        onClick={() => canUpload ? fileRef.current?.click() : toast.info('Αποθήκευσε πρώτα την επαφή')}
        className={`relative inline-flex h-12 w-12 items-center justify-center rounded-full overflow-hidden border bg-muted text-foreground ${
          canUpload ? 'border-border cursor-pointer hover:ring-2 hover:ring-primary' : 'border-dashed border-muted-foreground/40 cursor-help'
        }`}
        aria-label={url ? 'Αλλαγή avatar' : 'Ανέβασμα avatar'}
      >
        {url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt="avatar" className="h-full w-full object-cover" />
          : <span className="text-[11px] font-semibold">{initials}</span>}
        <span className={`absolute -bottom-0.5 -right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-background text-[8px] ${
          canUpload ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/60 text-background'
        }`}>
          <FiImage className="size-2.5" />
        </span>
      </button>
      {url && canUpload && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Διαγραφή avatar"
        >×</button>
      )}
    </div>
  );
}

// ---------- Contacts ----------

type Contact = {
  id: string;
  firstName: string | null; lastName: string | null; fullName: string;
  role: string | null; department: string | null;
  mobile: string | null; phone: string | null; email: string | null; fax: string | null;
  address: string | null; city: string | null; zip: string | null; country: string | null;
  isPrimary: boolean; isActive: boolean;
  notes: string | null;
  avatarUrl?: string | null;
};

function ContactsPanel({ companyId }: { companyId: string }) {
  const [list, setList] = React.useState<Contact[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Contact | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/contacts`);
      if (!res.ok) {
        toast.error(`Αποτυχία φόρτωσης επαφών (HTTP ${res.status})`);
        setList([]);
      } else {
        const text = await res.text();
        const d = text ? JSON.parse(text) : { contacts: [] };
        setList(d.contacts ?? []);
      }
    } catch (e) {
      console.error('[contacts] load failed', e);
      toast.error('Αποτυχία φόρτωσης επαφών');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  React.useEffect(() => { load(); }, [load]);

  const remove = async (c: Contact) => {
    if (!confirm(`Διαγραφή επαφής "${c.fullName}";`)) return;
    const res = await fetch(`/api/admin/companies/${companyId}/contacts/${c.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Διαγράφηκε'); load(); }
    else toast.error('Αποτυχία');
  };

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border rounded-sm border min-h-[44px]">
        {loading && <li className="px-3 py-2 text-[12px] text-muted-foreground">Φόρτωση…</li>}
        {!loading && list.length === 0 && (
          <li className="px-3 py-2 text-[12px] text-muted-foreground italic">Δεν υπάρχουν επαφές.</li>
        )}
        {list.map((c) => (
          <li key={c.id} className="flex items-start gap-2 px-3 py-2">
            {c.avatarUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={c.avatarUrl} alt="" className="mt-0.5 h-7 w-7 rounded-sm object-cover border border-border shrink-0" />
              : (
                <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-sm bg-muted text-foreground text-[10px] font-semibold shrink-0">
                  {(c.fullName || '?').slice(0, 2).toUpperCase()}
                </span>
              )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] font-medium text-foreground truncate">{c.fullName}</span>
                {c.role && <Badge variant="outline" className="text-[9px]">{c.role}</Badge>}
                {c.isPrimary && <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700"><FiStar className="mr-0.5" /> Κύρια</Badge>}
                {!c.isActive && <Badge variant="outline" className="text-[9px]">Ανενεργή</Badge>}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                {c.mobile && <span className="inline-flex items-center gap-1"><FiSmartphone className="size-3" /> {c.mobile}</span>}
                {c.phone && <span className="inline-flex items-center gap-1"><FiPhone className="size-3" /> {c.phone}</span>}
                {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-primary"><FiMail className="size-3" /> {c.email}</a>}
                {c.department && <span>{c.department}</span>}
                {(c.address || c.city) && <span className="inline-flex items-center gap-1"><FiMapPin className="size-3" /> {[c.address, c.city].filter(Boolean).join(', ')}</span>}
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label="Επεξεργασία"><FiEdit2 /></Button>
              <Button variant="ghost" size="sm" onClick={() => remove(c)} aria-label="Διαγραφή"><FiTrash2 className="text-destructive" /></Button>
            </div>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
        <FiUserPlus className="mr-1" /> Προσθήκη επαφής
      </Button>

      <ContactDialog
        open={creating || !!editing}
        companyId={companyId}
        contact={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); load(); }}
      />
    </div>
  );
}

function ContactDialog({
  open, companyId, companyName, contact, onClose, onSaved,
}: {
  open: boolean;
  companyId: string | null;
  companyName?: string;
  contact: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!contact;
  const [form, setForm] = React.useState<any>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (contact) setForm({ ...contact });
    else setForm({ country: 'GR', isActive: true, isPrimary: false });
  }, [open, contact]);

  const refreshAvatar = (url: string | null) => setForm((f: any) => ({ ...f, avatarUrl: url }));
  const uploadAvatar = async (file: File) => {
    if (!companyId || !contact?.id) { toast.info('Αποθήκευσε πρώτα την επαφή για να ανεβάσεις avatar'); return; }
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`/api/admin/companies/${companyId}/contacts/${contact.id}/avatar`, { method: 'POST', body: fd });
    if (res.ok) { const d = await res.json(); refreshAvatar(d.contact.avatarUrl); toast.success('Avatar ενημερώθηκε'); }
    else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'unsupported_type' ? 'Μη υποστηριζόμενος τύπος' : e.error === 'too_large' ? 'Πολύ μεγάλο αρχείο' : 'Αποτυχία');
    }
  };
  const removeAvatar = async () => {
    if (!companyId || !contact?.id || !form.avatarUrl) return;
    if (!confirm('Διαγραφή avatar;')) return;
    const res = await fetch(`/api/admin/companies/${companyId}/contacts/${contact.id}/avatar`, { method: 'DELETE' });
    if (res.ok) { refreshAvatar(null); toast.success('Διαγράφηκε'); }
    else toast.error('Αποτυχία');
  };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!companyId) { toast.error('Επιλέξτε εταιρία'); return; }
    const fn = [form.firstName, form.lastName].filter(Boolean).join(' ').trim() || form.fullName?.trim();
    if (!fn) { toast.error('Όνομα/Επώνυμο υποχρεωτικά'); return; }
    setSaving(true);
    const url = isEdit
      ? `/api/admin/companies/${companyId}/contacts/${contact!.id}`
      : `/api/admin/companies/${companyId}/contacts`;
    const res = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, fullName: fn }),
    });
    setSaving(false);
    if (res.ok) { toast.success(isEdit ? 'Αποθηκεύτηκε' : 'Δημιουργήθηκε'); onSaved(); }
    else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'missing_name' ? 'Όνομα υποχρεωτικό' : 'Αποτυχία');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FiUser className="text-primary" /> {isEdit ? 'Επεξεργασία επαφής' : 'Νέα επαφή'}
          </DialogTitle>
          <DialogDescription>
            {companyName ? <>Εταιρία: <strong className="text-foreground">{companyName}</strong></> : 'Στοιχεία επαφής'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1
          [&_input]:!text-[12px] [&_input]:!h-8 [&_input]:!px-2
          [&_textarea]:!text-[12px]
          [&_label]:!text-[11px] [&_label]:!font-medium">

          {/* Avatar uploader — visible always; informs user that save is needed if new contact */}
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
            <AvatarUploader
              url={form.avatarUrl ?? null}
              initials={(form.firstName?.[0] ?? '') + (form.lastName?.[0] ?? '') || (form.fullName || '?').slice(0, 2).toUpperCase()}
              canUpload={isEdit}
              onPick={uploadAvatar}
              onRemove={removeAvatar}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground">Avatar επαφής</p>
              <p className="text-[10px] text-muted-foreground">
                {isEdit
                  ? 'PNG/JPG/WEBP/SVG · μέχρι 3MB. Κλικ στο εικονίδιο για ανέβασμα.'
                  : 'Αποθήκευσε πρώτα την επαφή και μετά πρόσθεσε avatar.'}
              </p>
            </div>
          </div>

          <Section title="Στοιχεία ταυτότητας">
            <Grid>
              <Field label="Όνομα *" id="ct-fn"><Input id="ct-fn" value={form.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} /></Field>
              <Field label="Επώνυμο" id="ct-ln"><Input id="ct-ln" value={form.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} /></Field>
              <Field label="Ρόλος / Θέση" id="ct-role"><Input id="ct-role" value={form.role ?? ''} onChange={(e) => set('role', e.target.value)} placeholder="π.χ. Λογιστής, Διευθυντής Πωλήσεων" /></Field>
              <Field label="Τμήμα" id="ct-dept"><Input id="ct-dept" value={form.department ?? ''} onChange={(e) => set('department', e.target.value)} /></Field>
            </Grid>
          </Section>

          <Section title="Επικοινωνία">
            <Grid>
              <Field label="Κινητό" id="ct-mob"><Input id="ct-mob" value={form.mobile ?? ''} onChange={(e) => set('mobile', e.target.value)} /></Field>
              <Field label="Σταθερό" id="ct-tel"><Input id="ct-tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
              <Field label="Email" id="ct-em"><Input id="ct-em" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label="Fax" id="ct-fax"><Input id="ct-fax" value={form.fax ?? ''} onChange={(e) => set('fax', e.target.value)} /></Field>
            </Grid>
          </Section>

          <Section title="Διεύθυνση (αν διαφέρει από εταιρία)">
            <Grid>
              <Field label="Διεύθυνση" id="ct-addr"><Input id="ct-addr" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
              <Field label="Πόλη" id="ct-city"><Input id="ct-city" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
              <Field label="ΤΚ" id="ct-zip"><Input id="ct-zip" value={form.zip ?? ''} onChange={(e) => set('zip', e.target.value)} /></Field>
              <Field label="Χώρα" id="ct-country">
                <CountrySelect id="ct-country" value={form.country ?? DEFAULT_COUNTRY} onChange={(v) => set('country', v)} />
              </Field>
            </Grid>
          </Section>

          <Section title="Σημειώσεις">
            <textarea
              className="w-full rounded-sm border border-input bg-background px-2 py-1.5"
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Section>

          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={!!form.isPrimary} onCheckedChange={(v) => set('isPrimary', !!v)} />
              <span className="text-[13px]">Κύρια επαφή</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={!!form.isActive} onCheckedChange={(v) => set('isActive', !!v)} />
              <span className="text-[13px]">Ενεργή</span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Άκυρο</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Multiple emails / phones / etc. ----------

type ChannelKind = 'EMAIL' | 'PHONE' | 'MOBILE' | 'FAX' | 'OTHER';
type Channel = {
  id: string; kind: ChannelKind;
  label: string | null; value: string;
  isPrimary: boolean; isActive: boolean;
  notes: string | null;
};

const CHANNEL_META: Record<ChannelKind, { label: string; icon: any; placeholder: string }> = {
  EMAIL:  { label: 'Email',    icon: FiMail,        placeholder: 'name@domain.gr' },
  PHONE:  { label: 'Σταθερό',  icon: FiPhone,       placeholder: '210 1234567' },
  MOBILE: { label: 'Κινητό',   icon: FiSmartphone,  placeholder: '69x xxx xxxx' },
  FAX:    { label: 'Fax',      icon: FiPhone,       placeholder: '210 1234567' },
  OTHER:  { label: 'Άλλο',     icon: FiPhone,       placeholder: '—' },
};

function ChannelsPanel({ companyId, compact = false }: { companyId: string; compact?: boolean }) {
  const [items, setItems] = React.useState<Channel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState<{ kind: ChannelKind; label: string; value: string; isPrimary: boolean }>({
    kind: 'EMAIL', label: '', value: '', isPrimary: false,
  });
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/channels`);
      if (!res.ok) { setItems([]); return; }
      const text = await res.text();
      const d = text ? JSON.parse(text) : { channels: [] };
      setItems(d.channels ?? []);
    } finally { setLoading(false); }
  }, [companyId]);

  React.useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.value.trim()) { toast.error('Συμπλήρωσε την τιμή'); return; }
    setBusy(true);
    const res = await fetch(`/api/admin/companies/${companyId}/channels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft, label: draft.label.trim() || null }),
    });
    setBusy(false);
    if (res.ok) {
      setDraft({ kind: draft.kind, label: '', value: '', isPrimary: false });
      load();
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.issues?.[0]?.message || 'Αποτυχία');
    }
  };

  const update = async (id: string, patch: Partial<Channel>) => {
    setItems((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c));
    const res = await fetch(`/api/admin/companies/${companyId}/channels/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { toast.error('Αποτυχία'); load(); }
    else load();
  };

  const remove = async (id: string) => {
    if (!confirm('Διαγραφή καναλιού;')) return;
    const res = await fetch(`/api/admin/companies/${companyId}/channels/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Διαγράφηκε'); load(); }
    else toast.error('Αποτυχία');
  };

  // Group by kind for nicer rendering
  const grouped = (['EMAIL','PHONE','MOBILE','FAX','OTHER'] as ChannelKind[])
    .map((k) => ({ kind: k, list: items.filter((i) => i.kind === k) }))
    .filter((g) => g.list.length > 0);

  return (
    <div className="space-y-3">
      {loading && <div className="text-[12px] text-muted-foreground">Φόρτωση…</div>}
      {!loading && items.length === 0 && (
        <div className="text-[12px] text-muted-foreground italic rounded-[4px] border border-dashed px-3 py-2">
          Δεν έχουν καταχωρηθεί κανάλια επικοινωνίας.
        </div>
      )}

      {grouped.map((g) => {
        const Meta = CHANNEL_META[g.kind];
        return (
          <div key={g.kind} className="rounded-[4px] border border-border bg-background">
            <div className="px-3 py-1.5 border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
              <Meta.icon className="size-3" /> {Meta.label} <span className="text-muted-foreground/60">({g.list.length})</span>
            </div>
            <ul className="divide-y divide-border">
              {g.list.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {c.kind === 'EMAIL'
                        ? <a href={`mailto:${c.value}`} className="text-[12px] text-foreground hover:text-primary truncate">{c.value}</a>
                        : c.kind === 'PHONE' || c.kind === 'MOBILE'
                          ? <a href={`tel:${c.value}`} className="text-[12px] text-foreground hover:text-primary font-mono">{c.value}</a>
                          : <span className="text-[12px] text-foreground font-mono">{c.value}</span>}
                      {c.label && <Badge variant="outline">{c.label}</Badge>}
                      {c.isPrimary && <Badge variant="outline" className="border-amber-300 text-amber-700"><FiStar className="mr-0.5" /> Κύριο</Badge>}
                      {!c.isActive && <Badge variant="outline">Ανενεργό</Badge>}
                    </div>
                  </div>
                  {!compact && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => update(c.id, { isPrimary: !c.isPrimary })} title="Κύριο / όχι">
                        <FiStar className={c.isPrimary ? 'text-amber-500' : ''} />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(c.id)} aria-label="Διαγραφή">
                        <FiTrash2 className="text-destructive" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {!compact && (
        <div className="rounded-[4px] border border-dashed border-border p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Προσθήκη καναλιού</div>
          <div className="grid grid-cols-[110px_140px_1fr_auto] gap-2 items-end">
            <Field label="Τύπος" id="ch-kind">
              <select
                id="ch-kind"
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-[12px]"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as ChannelKind })}
              >
                {(['EMAIL','PHONE','MOBILE','FAX','OTHER'] as ChannelKind[]).map((k) =>
                  <option key={k} value={k}>{CHANNEL_META[k].label}</option>
                )}
              </select>
            </Field>
            <Field label="Τίτλος (προαιρ.)" id="ch-label">
              <Input id="ch-label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="π.χ. Λογιστήριο" />
            </Field>
            <Field label="Τιμή" id="ch-value">
              <Input
                id="ch-value"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                placeholder={CHANNEL_META[draft.kind].placeholder}
                type={draft.kind === 'EMAIL' ? 'email' : 'text'}
              />
            </Field>
            <Button size="sm" variant="outline" onClick={add} disabled={busy}><FiPlus /></Button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer mt-1">
            <Checkbox checked={draft.isPrimary} onCheckedChange={(v) => setDraft({ ...draft, isPrimary: !!v })} />
            <span className="text-[11px]">Όρισε ως κύριο για τον τύπο</span>
          </label>
        </div>
      )}
    </div>
  );
}

type Activity = { code: string; codeAade?: string | null; codeWithoutDots?: string | null; description: string; kind: 'PRIMARY' | 'SECONDARY'; order?: number };

function ActivitiesEditor({
  activities, onChange,
}: { activities: Activity[]; onChange: (a: Activity[]) => void }) {
  const [draft, setDraft] = React.useState<Activity>({ code: '', description: '', kind: 'SECONDARY' });

  const add = () => {
    if (!draft.code.trim() || !draft.description.trim()) { toast.error('Συμπλήρωσε ΚΑΔ και περιγραφή'); return; }
    if (activities.some((a) => a.code === draft.code)) { toast.error('Ο ΚΑΔ υπάρχει ήδη'); return; }
    let next = [...activities, { ...draft }];
    if (draft.kind === 'PRIMARY') {
      next = next.map((a) => a.code === draft.code ? a : (a.kind === 'PRIMARY' ? { ...a, kind: 'SECONDARY' as const } : a));
    }
    onChange(next);
    setDraft({ code: '', description: '', kind: 'SECONDARY' });
  };

  const setPrimary = (code: string) => {
    onChange(activities.map((a) => ({ ...a, kind: (a.code === code ? 'PRIMARY' : 'SECONDARY') as 'PRIMARY' | 'SECONDARY' })));
  };

  const remove = (code: string) => onChange(activities.filter((a) => a.code !== code));

  return (
    <div className="space-y-2">
      {activities.length === 0
        ? <div className="text-[12px] text-muted-foreground rounded-sm border border-dashed px-3 py-2">Δεν έχουν καταχωρηθεί ΚΑΔ.</div>
        : (
          <ul className="divide-y divide-border rounded-sm border max-h-60 overflow-y-auto">
            {activities.map((a) => (
              <li key={a.code} className="flex items-center gap-2 px-2 py-1.5">
                <span className="font-mono text-[11px] tabular-nums w-24 shrink-0" title="ΑΑΔΕ form">
                  {a.codeAade ?? a.code.replace(/\./g, '')}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-20 shrink-0" title="Με τελείες (canonical)">
                  {a.code}
                </span>
                <span className="flex-1 text-[11px] truncate" title={a.description}>{a.description}</span>
                <Badge
                  variant="outline"
                  className={a.kind === 'PRIMARY' ? 'text-[9px] border-emerald-300 text-emerald-700' : 'text-[9px]'}
                >
                  {a.kind === 'PRIMARY' ? 'ΚΥΡΙΑ' : 'ΔΕΥΤ.'}
                </Badge>
                {a.kind !== 'PRIMARY' && (
                  <Button variant="ghost" size="sm" onClick={() => setPrimary(a.code)} title="Ορισμός ως κύρια">
                    <FiStar />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => remove(a.code)} aria-label="Διαγραφή">
                  <FiTrash2 className="text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      <div className="grid grid-cols-[100px_1fr_120px_auto] gap-2 items-end">
        <Field label="ΚΑΔ" id="a-code">
          <Input id="a-code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Περιγραφή" id="a-descr">
          <Input id="a-descr" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
        <Field label="Τύπος" id="a-kind">
          <select
            id="a-kind"
            className="h-8 w-full rounded-sm border border-input bg-background px-2 text-[12px]"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'PRIMARY' | 'SECONDARY' })}
          >
            <option value="SECONDARY">Δευτερεύουσα</option>
            <option value="PRIMARY">Κύρια</option>
          </select>
        </Field>
        <Button size="sm" variant="outline" onClick={add}><FiPlus /></Button>
      </div>
    </div>
  );
}

type ExpandTab = 'info' | 'contact' | 'contacts' | 'tax' | 'branches' | 'documents' | 'financial' | 'map';

function CompanyExpandedRow({ company }: { company: CompanyRow }) {
  const [tab, setTab] = React.useState<ExpandTab>('info');
  const [coords, setCoords] = React.useState<{ lat: number | null; lng: number | null }>({
    lat: company.latitude, lng: company.longitude,
  });
  const [geocoding, setGeocoding] = React.useState(false);

  // Lazy-loaded data caches. null = not requested yet, [] / {} = loaded.
  const [detail, setDetail] = React.useState<any | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [branches, setBranches] = React.useState<any[] | null>(null);
  const [branchesLoading, setBranchesLoading] = React.useState(false);
  const [docs, setDocs] = React.useState<DocRow[] | null>(null);
  const [docsLoading, setDocsLoading] = React.useState(false);

  const ensureDetail = React.useCallback(async () => {
    if (detail || detailLoading) return;
    setDetailLoading(true);
    const r = await fetch(`/api/admin/companies/${company.id}`);
    if (r.ok) setDetail((await r.json()).company);
    setDetailLoading(false);
  }, [company.id, detail, detailLoading]);

  const ensureBranches = React.useCallback(async () => {
    if (branches || branchesLoading) return;
    setBranchesLoading(true);
    const r = await fetch(`/api/admin/companies/${company.id}/branches`);
    if (r.ok) setBranches((await r.json()).branches ?? []);
    setBranchesLoading(false);
  }, [company.id, branches, branchesLoading]);

  const ensureDocs = React.useCallback(async () => {
    if (docs || docsLoading) return;
    setDocsLoading(true);
    const r = await fetch(`/api/admin/companies/${company.id}/documents`);
    if (r.ok) setDocs((await r.json()).documents ?? []);
    setDocsLoading(false);
  }, [company.id, docs, docsLoading]);

  const switchTo = (next: ExpandTab) => {
    setTab(next);
    if (['info', 'contact', 'tax', 'financial'].includes(next)) ensureDetail();
    if (next === 'branches') ensureBranches();
    if (next === 'documents') ensureDocs();
  };

  // Info tab also benefits from full detail (notes, gemiObjective, etc.) — kick off on mount.
  React.useEffect(() => { ensureDetail(); }, [ensureDetail]);

  const reGeocode = async () => {
    setGeocoding(true);
    const res = await fetch(`/api/admin/companies/${company.id}/geocode`, { method: 'POST' });
    setGeocoding(false);
    if (res.ok) {
      const d = await res.json();
      setCoords({ lat: d.latitude, lng: d.longitude });
      toast.success('Γεωκωδικοποιήθηκε');
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(e.error === 'geocode_failed' ? 'Δεν βρέθηκε η διεύθυνση' : 'Αποτυχία γεωκωδικοποίησης');
    }
  };

  const addressLine = [company.address, company.zip, company.city, countryName(company.country)].filter(Boolean).join(', ');

  const tabs: { id: ExpandTab; label: string; icon: typeof FiInfo; badge?: React.ReactNode }[] = [
    { id: 'info', label: 'Πληροφορίες', icon: FiInfo },
    { id: 'contact', label: 'Επικοινωνία', icon: FiPhone },
    { id: 'contacts', label: 'Επαφές', icon: FiUser },
    { id: 'tax', label: 'Φορολογικά & ΚΑΔ', icon: FiFileText },
    { id: 'branches', label: 'Υποκαταστήματα', icon: FiMapPin, badge: company.branchCount > 0 ? company.branchCount : undefined },
    { id: 'documents', label: 'Έγγραφα ΓΕΜΗ', icon: FiArchive },
    { id: 'financial', label: 'Οικονομικά', icon: FiCreditCard },
    { id: 'map', label: 'Χάρτης', icon: FiMapPin },
  ];

  return (
    <div className="w-full">
      <div className="flex items-center gap-0 border-b border-border mb-3 overflow-x-auto">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTo(t.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border-b-2 transition-colors whitespace-nowrap ${
                active ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <t.icon className="size-3.5" /> {t.label}
              {t.badge !== undefined && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-muted text-[10px] tabular-nums">{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'info' && (() => {
        const c = (detail ?? company) as any;
        const fmtDate = (v: any) => v ? new Date(v).toLocaleDateString('el-GR') : null;
        const fmtDateTime = (v: any) => v ? new Date(v).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' }) : null;
        // Collapse whitespace from imported text (e.g. GEMI's gemiObjective uses \r\n).
        const clean = (v: any) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v;
        const activitiesCount = Array.isArray(c.activities) ? c.activities.length : company.activityCount;
        const primaryActivity = Array.isArray(c.activities) ? c.activities.find((a: any) => a.kind === 'PRIMARY') : null;

        return (
          <div className="space-y-4">
            {/* Hero: name + key identifiers + status pills */}
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {c.legalForm && <Badge variant="outline" className="text-[10px]">{c.legalForm}</Badge>}
                    {c.isActive
                      ? <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700"><FiCheck className="mr-0.5" /> Ενεργή</Badge>
                      : <Badge variant="outline" className="text-[10px]"><FiX className="mr-0.5" /> Ανενεργή</Badge>}
                    {c.aadeStatus && <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700">ΑΕΔΕΕ: {c.aadeStatus}</Badge>}
                    {c.gemiStatus && <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700">ΓΕΜΗ: {c.gemiStatus}</Badge>}
                  </div>
                  <h3 className="text-[14px] font-semibold text-foreground leading-tight">{c.name}</h3>
                  {c.shortName && <p className="text-[12px] text-muted-foreground truncate">{c.shortName}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-border">
                <KeyValue label="ΑΦΜ" value={c.afm} mono />
                <KeyValue label="Αρ. ΓΕΜΗ" value={c.arGemi} mono />
                <KeyValue label="Κωδικός" value={c.code} />
                <KeyValue label="Ίδρυση" value={fmtDate(c.foundingDate)} />
              </div>
            </div>

            {/* Stat tiles: counts give a sense of completeness + quick navigation */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile
                icon={FiTag} label="ΚΑΔ"
                value={activitiesCount ?? '…'}
                hint={primaryActivity ? `Κύρια: ${clean(primaryActivity.description)}` : 'Δραστηριότητες'}
                onClick={() => switchTo('tax')}
              />
              <Tile
                icon={FiMapPin} label="Υποκαταστήματα"
                value={company.branchCount}
                hint="Έδρα + υποκαταστήματα"
                onClick={() => switchTo('branches')}
              />
              <Tile
                icon={FiArchive} label="Έγγραφα ΓΕΜΗ"
                value={docs ? docs.length : company.documentCount}
                hint={(() => {
                  const items = docs ?? [];
                  const uploaded = items.filter((d) => !!d.publicUrl).length;
                  if (items.length > 0) return `${uploaded}/${items.length} στο Bunny CDN${c.gemiSyncedAt ? ` · Sync: ${fmtDateTime(c.gemiSyncedAt)}` : ''}`;
                  if (company.documentCount > 0) return `${company.documentCount} έγγραφα · κάνε click για λεπτομέρειες`;
                  return c.gemiSyncedAt ? `Sync: ${fmtDateTime(c.gemiSyncedAt)}` : 'Χωρίς συγχρονισμό';
                })()}
                onClick={() => switchTo('documents')}
              />
              <Tile
                icon={FiMapPin} label="Γεωκωδικοποίηση"
                value={(c.latitude != null && c.longitude != null) ? '✓' : '—'}
                hint={c.geocodedAddress ? clean(c.geocodedAddress) : 'Χωρίς συντεταγμένες'}
                onClick={() => switchTo('map')}
              />
            </div>

            {/* Two-column identity meta */}
            <div className="grid sm:grid-cols-2 gap-x-5 gap-y-2 rounded-md border border-border p-4">
              <KeyValue label="ΔΟΥ" value={c.doy} />
              <KeyValue label="Κατηγορία ΦΠΑ" value={c.vatCategory} />
              <KeyValue label="Επάγγελμα" value={clean(c.profession)} wide />
              <KeyValue label="Κατηγορία" value={c.category} />
              <KeyValue label="Sync ΑΕΔΕΕ" value={fmtDateTime(c.aadeSyncedAt)} hint={c.aadeFirmKind ?? undefined} />
              <KeyValue label="Sync ΓΕΜΗ" value={fmtDateTime(c.gemiSyncedAt)} hint={c.gemiOffice ?? undefined} />
              <KeyValue label="Δημιουργία" value={fmtDateTime(c.createdAt)} />
              <KeyValue label="Ενημέρωση" value={fmtDateTime(c.updatedAt)} />
            </div>

            {/* Free-text blocks — collapse whitespace so the layout doesn't explode vertically */}
            {clean(c.gemiObjective) && (
              <div className="rounded-md border border-border p-4">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">Σκοπός εταιρίας (ΓΕΜΗ)</div>
                <p className="text-[12px] text-foreground leading-relaxed">{clean(c.gemiObjective)}</p>
              </div>
            )}
            {clean(c.notes) && (
              <div className="rounded-md border border-border p-4">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">Σημειώσεις</div>
                <p className="text-[12px] text-foreground leading-relaxed">{clean(c.notes)}</p>
              </div>
            )}
          </div>
        );
      })()}

      {tab === 'contact' && (
        <LazySection loading={detailLoading} data={detail}>
          {(c) => (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4 px-1 py-1 text-[12px]">
                <Stat label="Website">
                  {c.website
                    ? <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{c.website}</a>
                    : '—'}
                </Stat>
                <Stat label="Διεύθυνση" wide>{[c.address, c.zip, c.city, countryName(c.country)].filter(Boolean).join(', ') || '—'}</Stat>
                <Stat label="Υπεύθυνος">{c.contactPerson || '—'}</Stat>
                <Stat label="Θέση">{c.contactTitle || '—'}</Stat>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">Κανάλια επικοινωνίας</div>
                <ChannelsPanel companyId={company.id} compact />
              </div>
            </div>
          )}
        </LazySection>
      )}

      {tab === 'tax' && (
        <LazySection loading={detailLoading} data={detail}>
          {(c) => (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-4 gap-4 text-[12px]">
                <Stat label="ΑΦΜ">{c.afm || '—'}</Stat>
                <Stat label="ΔΟΥ">{c.doy || '—'}</Stat>
                <Stat label="Αρ. ΓΕΜΗ"><span className="tabular-nums">{c.arGemi || '—'}</span></Stat>
                <Stat label="Νομική μορφή">{c.legalForm || '—'}</Stat>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  ΚΑΔ ({c.activities?.length ?? 0})
                </div>
                {(!c.activities || c.activities.length === 0)
                  ? <div className="text-[12px] text-muted-foreground italic">Δεν έχουν καταχωρηθεί ΚΑΔ.</div>
                  : (
                    <ul className="divide-y divide-border rounded-sm border max-h-60 overflow-y-auto">
                      {c.activities.map((a: any) => (
                        <li key={a.code} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                          <span className="font-mono tabular-nums w-20 shrink-0">{a.code}</span>
                          <span className="flex-1 truncate" title={a.description}>{a.description}</span>
                          <Badge
                            variant="outline"
                            className={a.kind === 'PRIMARY' ? 'text-[9px] border-emerald-300 text-emerald-700' : 'text-[9px]'}
                          >
                            {a.kind === 'PRIMARY' ? 'ΚΥΡΙΑ' : 'ΔΕΥΤ.'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            </div>
          )}
        </LazySection>
      )}

      {tab === 'contacts' && (
        <ContactsPanel companyId={company.id} />
      )}

      {tab === 'branches' && (
        <LazySection loading={branchesLoading} data={branches}>
          {(items) => items.length === 0
            ? <div className="text-[12px] text-muted-foreground italic">Δεν υπάρχουν υποκαταστήματα.</div>
            : (
              <ul className="divide-y divide-border rounded-sm border">
                {items.map((b: any) => (
                  <li key={b.id} className="flex items-start gap-2 px-3 py-2">
                    <FiMapPin className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-foreground truncate">{b.name}</span>
                        {b.isHeadquarters && <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700"><FiStar className="mr-0.5" /> Έδρα</Badge>}
                        {!b.isActive && <Badge variant="outline" className="text-[9px]">Ανενεργό</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {[b.code && `#${b.code}`, b.address, b.city, b.phone].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </LazySection>
      )}

      {tab === 'documents' && (
        <LazySection loading={docsLoading} data={docs}>
          {(items) => items.length === 0
            ? <div className="text-[12px] text-muted-foreground italic">Δεν υπάρχουν έγγραφα ΓΕΜΗ. Άνοιξε την εγγραφή και πάτησε συγχρονισμό ΓΕΜΗ.</div>
            : (
              <ul className="divide-y divide-border rounded-sm border max-h-[360px] overflow-y-auto">
                {items.map((d) => (
                  <li key={d.id} className="flex items-start gap-2 px-3 py-2">
                    <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-sm shrink-0 ${
                      d.kind === 'DECISION' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      <FiFileText className="size-3" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12px] font-medium text-foreground truncate">{d.title}</span>
                        <Badge variant="outline" className="text-[9px]">{d.kind === 'DECISION' ? 'Απόφαση' : d.kind === 'PUBLICATION' ? 'ΥΜΣ' : 'Άλλο'}</Badge>
                        {d.kak && <span className="text-[10px] text-muted-foreground tabular-nums">ΚΑΚ {d.kak}</span>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                        {d.assembly && <span>{d.assembly}</span>}
                        {d.dateRegistrated && <span>Κατ.: {new Date(d.dateRegistrated).toLocaleDateString('el-GR')}</span>}
                        {d.sizeBytes && <span>{(d.sizeBytes / 1024).toFixed(0)} KB</span>}
                      </div>
                    </div>
                    {(d.publicUrl || d.sourceUrl) && (
                      <a
                        href={d.publicUrl ?? d.sourceUrl ?? '#'}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
                        title={d.publicUrl ? 'Άνοιγμα από Bunny CDN' : 'Άνοιγμα από ΓΕΜΗ'}
                      >
                        <FiExternalLink className="size-3.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </LazySection>
      )}

      {tab === 'financial' && (
        <LazySection loading={detailLoading} data={detail}>
          {(c) => (
            <div className="grid sm:grid-cols-3 gap-4 px-1 py-1 text-[12px]">
              <Stat label="IBAN"><span className="font-mono">{c.iban || '—'}</span></Stat>
              <Stat label="Τράπεζα">{c.bankName || '—'}</Stat>
              <Stat label="Νόμισμα">{c.currency || '—'}</Stat>
              <Stat label="Όροι πληρωμής">{c.paymentTerms || '—'}</Stat>
              <Stat label="Πιστωτικό όριο">
                {c.creditLimit != null ? <span className="tabular-nums">{Number(c.creditLimit).toLocaleString('el-GR', { style: 'currency', currency: c.currency || 'EUR' })}</span> : '—'}
              </Stat>
              <Stat label="Έκπτωση">{c.discount != null ? `${c.discount}%` : '—'}</Stat>
            </div>
          )}
        </LazySection>
      )}

      {tab === 'map' && (
        <CompanyMap
          lat={coords.lat} lng={coords.lng}
          address={company.geocodedAddress ?? addressLine}
          onGeocode={reGeocode}
          geocoding={geocoding}
        />
      )}
    </div>
  );
}

function LazySection<T>({
  loading, data, children,
}: { loading: boolean; data: T | null; children: (d: T) => React.ReactNode }) {
  if (loading && data == null) {
    return <div className="flex items-center gap-2 px-1 py-3 text-[12px] text-muted-foreground"><FiRefreshCw className="size-3 animate-spin" /> Φόρτωση…</div>;
  }
  if (data == null) {
    return <div className="text-[12px] text-muted-foreground italic">Δεν φορτώθηκαν δεδομένα.</div>;
  }
  return <>{children(data)}</>;
}

function Stat({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-3' : ''}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">{label}</div>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function KeyValue({
  label, value, hint, mono, wide,
}: {
  label: string;
  value: React.ReactNode | null | undefined;
  hint?: string;
  mono?: boolean;
  wide?: boolean;
}) {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    <div className={`flex items-baseline gap-2 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-[11px] text-muted-foreground shrink-0 min-w-[120px]">{label}</span>
      <span className={`text-[12px] flex-1 min-w-0 truncate ${isEmpty ? 'text-muted-foreground/60' : 'text-foreground'} ${mono ? 'font-mono tabular-nums' : ''}`}>
        {isEmpty ? '—' : value}
        {hint && !isEmpty && <span className="ml-1.5 text-[10px] text-muted-foreground">· {hint}</span>}
      </span>
    </div>
  );
}

function Tile({
  icon: Icon, label, value, hint, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  onClick?: () => void;
}) {
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-md border border-border bg-background p-3 text-left transition-colors ${onClick ? 'hover:border-primary hover:bg-muted/40 cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3 text-muted-foreground" />
      </div>
      <div className="text-[18px] font-semibold text-foreground leading-tight tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </Wrapper>
  );
}

function CompanyMap({
  lat, lng, address, onGeocode, geocoding,
}: { lat: number | null; lng: number | null; address: string | null; onGeocode: () => void; geocoding: boolean }) {
  if (lat == null || lng == null) {
    return (
      <div className="rounded-sm border border-dashed p-6 text-center space-y-2">
        <p className="text-[12px] text-muted-foreground">Δεν υπάρχουν συντεταγμένες για αυτή την εταιρία.</p>
        <Button size="sm" variant="outline" onClick={onGeocode} disabled={geocoding}>
          <FiMapPin className="mr-1" /> {geocoding ? 'Γεωκωδικοποίηση…' : 'Γεωκωδικοποίηση τώρα'}
        </Button>
      </div>
    );
  }
  // OpenStreetMap embed — keyless, free, with marker. Bbox spans ~700m around the point.
  const d = 0.004;
  const bbox = `${(lng - d).toFixed(6)},${(lat - d).toFixed(6)},${(lng + d).toFixed(6)},${(lat + d).toFixed(6)}`;
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lng.toFixed(6)}`;
  const externalUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  return (
    <div className="space-y-2">
      <div className="rounded-sm overflow-hidden border border-border">
        <iframe
          title="Χάρτης"
          src={embedUrl}
          className="w-full h-[280px] block"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">{address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-mono tabular-nums">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
          <a
            href={externalUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
            title="Άνοιγμα σε Google Maps"
          >
            <FiExternalLink className="size-3" /> Google
          </a>
          <Button size="sm" variant="ghost" onClick={onGeocode} disabled={geocoding} title="Ανανέωση συντεταγμένων">
            <FiRefreshCw className={geocoding ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function LogoBlock({
  logoUrl, initials, companyId, onChange,
}: {
  logoUrl: string | null;
  initials: string;
  companyId: string | null;
  onChange: (newUrl: string | null) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const upload = async (file: File) => {
    if (!companyId) {
      toast.error('Αποθήκευσε πρώτα την εταιρία, μετά ανέβασε λογότυπο');
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/admin/companies/${companyId}/logo`, { method: 'POST', body: fd });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      onChange(d.company.logoUrl);
      toast.success('Λογότυπο ενημερώθηκε');
    } else {
      const e = await res.json().catch(() => ({}));
      toast.error(
        e.error === 'unsupported_type' ? 'Μη υποστηριζόμενος τύπος (PNG/JPG/WEBP/SVG)' :
        e.error === 'too_large' ? 'Πολύ μεγάλο αρχείο (max 4MB)' : 'Αποτυχία ανεβάσματος',
      );
    }
  };

  const remove = async () => {
    if (!companyId || !logoUrl) return;
    if (!confirm('Διαγραφή λογότυπου;')) return;
    const res = await fetch(`/api/admin/companies/${companyId}/logo`, { method: 'DELETE' });
    if (res.ok) { onChange(null); toast.success('Διαγράφηκε'); }
    else toast.error('Αποτυχία διαγραφής');
  };

  const canUpload = !!companyId;
  return (
    <div className="relative shrink-0 group">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
      />
      <button
        type="button"
        onClick={() => {
          if (!canUpload) { toast.info('Αποθήκευσε πρώτα την εταιρία για να ανεβάσεις λογότυπο'); return; }
          fileRef.current?.click();
        }}
        disabled={busy}
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-sm overflow-hidden border bg-muted text-foreground transition-shadow disabled:opacity-50 ${
          canUpload ? 'border-border cursor-pointer hover:ring-2 hover:ring-primary' : 'border-dashed border-muted-foreground/40 cursor-help'
        }`}
        aria-label={logoUrl ? 'Αλλαγή λογότυπου' : 'Ανέβασμα λογότυπου'}
        title={canUpload ? (logoUrl ? 'Αλλαγή λογότυπου' : 'Ανέβασμα λογότυπου') : 'Αποθήκευσε εταιρία πρώτα'}
      >
        {logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={logoUrl} alt="logo" className="h-full w-full object-contain" />
          : <span className="text-[12px] font-semibold">{initials}</span>}
        {/* Camera badge always visible — affordance for upload */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-background text-[8px] ${
            canUpload ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/60 text-background'
          }`}
        >
          <FiImage className="size-2.5" />
        </span>
      </button>
      {logoUrl && canUpload && (
        <button
          type="button"
          onClick={remove}
          className="absolute -top-1.5 -right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Διαγραφή λογότυπου"
          title="Διαγραφή"
        >
          ×
        </button>
      )}
    </div>
  );
}

type DocRow = {
  id: string; kind: 'DECISION' | 'PUBLICATION' | 'OTHER';
  title: string; kak: string | null; assembly: string | null;
  summary: string | null; decisionSubject: string | null;
  dateRegistrated: string | null; dateAnnounced: string | null;
  publicUrl: string | null; sourceUrl: string | null;
  mimeType: string | null; sizeBytes: number | null;
};

function DocumentsPanel({
  companyId, gemiSyncedAt, gemiOffice, gemiStatus,
}: { companyId: string; gemiSyncedAt: string | null; gemiOffice: string | null; gemiStatus: string | null }) {
  const [docs, setDocs] = React.useState<DocRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<'ALL' | 'DECISION' | 'PUBLICATION'>('ALL');

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/companies/${companyId}/documents`);
    const d = await res.json();
    setDocs(d.documents ?? []);
    setLoading(false);
  }, [companyId]);

  React.useEffect(() => { load(); }, [load]);

  const remove = async (doc: DocRow) => {
    if (!confirm(`Διαγραφή εγγράφου "${doc.title}";`)) return;
    const res = await fetch(`/api/admin/companies/${companyId}/documents/${doc.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Διαγράφηκε'); load(); }
    else toast.error('Αποτυχία');
  };

  const filtered = filter === 'ALL' ? docs : docs.filter((d) => d.kind === filter);
  const counts = {
    DECISION: docs.filter((d) => d.kind === 'DECISION').length,
    PUBLICATION: docs.filter((d) => d.kind === 'PUBLICATION').length,
  };
  const uploaded = docs.filter((d) => !!d.publicUrl).length;
  const totalBytes = docs.reduce((s, d) => s + (d.sizeBytes ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-[4px] border border-border bg-background p-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Σύνολο</div>
          <div className="text-[14px] font-semibold tabular-nums">{docs.length}</div>
        </div>
        <div className="rounded-[4px] border border-border bg-background p-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Στο Bunny CDN</div>
          <div className="text-[14px] font-semibold tabular-nums">
            {uploaded}<span className="text-muted-foreground text-[11px]"> / {docs.length}</span>
          </div>
        </div>
        <div className="rounded-[4px] border border-border bg-background p-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Μέγεθος</div>
          <div className="text-[14px] font-semibold tabular-nums">
            {totalBytes > 0 ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB` : '—'}
          </div>
        </div>
        <div className="rounded-[4px] border border-border bg-background p-2">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Τύποι</div>
          <div className="text-[14px] font-semibold tabular-nums">
            {counts.DECISION}<span className="text-muted-foreground text-[11px]">Α</span>
            {' · '}
            {counts.PUBLICATION}<span className="text-muted-foreground text-[11px]">Δ</span>
          </div>
        </div>
      </div>
      {(gemiSyncedAt || gemiOffice || gemiStatus) && (
        <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border bg-muted/40 px-3 py-1.5 text-[11px]">
          {gemiStatus && <Badge variant="outline" className="border-emerald-300 text-emerald-700">{gemiStatus}</Badge>}
          {gemiOffice && <span className="text-muted-foreground">ΓΕΜΗ: {gemiOffice}</span>}
          {gemiSyncedAt && <span className="text-muted-foreground ml-auto">Τελευταίος συγχρονισμός: {new Date(gemiSyncedAt).toLocaleString('el-GR')}</span>}
        </div>
      )}

      <div className="flex items-center gap-1">
        {(['ALL', 'DECISION', 'PUBLICATION'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`text-[11px] rounded-sm px-2 py-1 border transition-colors ${
              filter === f ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {f === 'ALL' ? `Όλα (${docs.length})`
              : f === 'DECISION' ? `Αποφάσεις (${counts.DECISION})`
              : `Δημοσιεύσεις ΥΜΣ (${counts.PUBLICATION})`}
          </button>
        ))}
      </div>

      {loading && <div className="text-[12px] text-muted-foreground">Φόρτωση…</div>}
      {!loading && filtered.length === 0 && (
        <div className="rounded-sm border border-dashed px-3 py-6 text-center text-[12px] text-muted-foreground">
          Δεν υπάρχουν έγγραφα. Πάτησε το εικονίδιο ΓΕΜΗ στην κεφαλίδα για συγχρονισμό.
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <ul className="divide-y divide-border rounded-sm border max-h-[420px] overflow-y-auto">
          {filtered.map((d) => (
            <li key={d.id} className="flex items-start gap-2 px-3 py-2">
              <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-sm shrink-0 ${
                d.kind === 'DECISION' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
              }`}>
                <FiFileText className="size-3" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[12px] font-medium text-foreground truncate">{d.title}</span>
                  <Badge variant="outline" className="text-[9px]">{d.kind === 'DECISION' ? 'Απόφαση' : d.kind === 'PUBLICATION' ? 'ΥΜΣ' : 'Άλλο'}</Badge>
                  {d.kak && <span className="text-[10px] text-muted-foreground tabular-nums">ΚΑΚ {d.kak}</span>}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                  {d.assembly && <span>{d.assembly}</span>}
                  {d.dateRegistrated && <span>Κατ.: {new Date(d.dateRegistrated).toLocaleDateString('el-GR')}</span>}
                  {d.dateAnnounced && <span>Αν.: {new Date(d.dateAnnounced).toLocaleDateString('el-GR')}</span>}
                  {d.sizeBytes && <span>{(d.sizeBytes / 1024).toFixed(0)} KB</span>}
                </div>
                {d.summary && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{d.summary}</p>}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {d.publicUrl && (
                  <a
                    href={d.publicUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Άνοιγμα από Bunny CDN"
                  >
                    <FiExternalLink className="size-3.5" />
                  </a>
                )}
                {!d.publicUrl && d.sourceUrl && (
                  <a
                    href={d.sourceUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Άνοιγμα από ΓΕΜΗ"
                  >
                    <FiExternalLink className="size-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => remove(d)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-destructive hover:bg-destructive/10"
                  aria-label="Διαγραφή"
                >
                  <FiTrash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeleteDialog({
  company, onClose, onDeleted,
}: { company: CompanyRow | null; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = React.useState(false);
  const confirm = async () => {
    if (!company) return;
    setDeleting(true);
    const res = await fetch(`/api/admin/companies/${company.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.ok) { toast.success('Διαγράφηκε'); onDeleted(); }
    else toast.error('Αποτυχία διαγραφής');
  };
  return (
    <Dialog open={!!company} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <FiAlertTriangle /> Διαγραφή εταιρίας
          </DialogTitle>
          <DialogDescription>
            Διαγραφή της εταιρίας <strong className="text-foreground">{company?.name}</strong>;
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>Άκυρο</Button>
          <Button variant="destructive" onClick={confirm} disabled={deleting}>
            <FiTrash2 /> {deleting ? 'Διαγραφή…' : 'Διαγραφή'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
