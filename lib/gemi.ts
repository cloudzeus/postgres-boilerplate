// ΓΕΜΗ Open Data API client.
// Docs: https://opendata.businessportal.gr/techdocs/
// Spec: https://opendata-api.businessportal.gr/api-docs

import { ensurePrimaryActivity } from '@/lib/kad/resolve';

const BASE_URL = 'https://opendata-api.businessportal.gr/api/opendata/v1';

function apiKey(): string {
  const k = process.env.GEMI_API_KEY;
  if (!k) throw new Error('GEMI_API_KEY is not configured');
  return k;
}

async function gemiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { api_key: apiKey(), Accept: 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GemiError(res.status, text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export class GemiError extends Error {
  constructor(public status: number, message: string) { super(`GEMI ${status}: ${message}`); }
}

// ---------- Types (subset, see swagger spec for full schema) ----------

export type GemiCompanySummary = {
  arGemi: string;                  // API returns as string (≥ 12 digits)
  afm: string;
  coNameEl: string;
  coTitlesEl?: string[];
  status?: { id: number; descr: string; isActive: boolean };
};

// `arGemi` from API may be either string or number — normalize via mapper.
export type GemiCompany = Omit<GemiCompanySummary, 'arGemi'> & { arGemi: string | number } & {
  coNamesEn?: string[];
  coTitlesEn?: string[];
  city?: string;
  street?: string;
  streetNumber?: string;
  zipCode?: string;
  poBox?: string;
  url?: string;
  email?: string;
  isBranch?: boolean;
  objective?: string;
  legalType?: { id: number; descr: string };
  gemiOffice?: { id: number; descr: string };
  prefecture?: { id: string; descr: string };
  municipality?: { id: string; descr: string };
  incorporationDate?: string;
  lastStatusChange?: string;
  autoRegistered?: boolean;
  activities?: Array<{
    activity?: { id: string; descr: string };
    type?: string;
    dtFrom?: string;
    dtTo?: string;
  }>;
  persons?: Array<{
    personName?: string;
    businessName?: string;
    role?: string;
    dtFrom?: string;
    dtTo?: string;
    percentage?: string;
    category?: string;
  }>;
  capital?: any[];
};

export type GemiDocumentDecision = {
  dateAssemblyDecided?: string;
  assembly?: string;
  summary?: string;
  kak?: string;
  decisionSubject?: string;
  decisionSubjectID?: string;
  dateAnnounced?: string;
  assemblyDecisionUrl?: string;
  dateRegistrated?: string;
  applicationStatusId?: string;
  applicationStatusDescription?: string;
  referenceKak?: string;
};

export type GemiDocumentPublication = {
  url?: string;
  kad?: string;
};

export type GemiDocumentSet = {
  decision?: GemiDocumentDecision[];
  publication?: GemiDocumentPublication[];
};

// ---------- API methods ----------

// ---------- Metadata (lookup tables) ----------

export type MetadataItem = {
  id: string | number;
  descr: string;
  descrEn?: string;
  lastUpdated?: string;
};

export type GemiLegalType = MetadataItem & { id: number };
export type GemiCompanyStatus = MetadataItem & { id: number; isActive: boolean };
export type GemiOfficeMeta = MetadataItem & {
  id: number; address?: string; city?: string; zipCode?: string;
  phone?: string; fax?: string; url?: string;
};
export type GemiPrefecture = MetadataItem & { id: string };
export type GemiMunicipality = MetadataItem & { id: string; prefectureId?: string };

export const metadata = {
  legalTypes:       () => gemiFetch<GemiLegalType[]>('/metadata/legalTypes'),
  gemiOffices:      () => gemiFetch<GemiOfficeMeta[]>('/metadata/gemiOffices'),
  companyStatuses:  () => gemiFetch<GemiCompanyStatus[]>('/metadata/companyStatuses'),
  prefectures:      () => gemiFetch<GemiPrefecture[]>('/metadata/prefectures'),
  municipalities:   () => gemiFetch<GemiMunicipality[]>('/metadata/municipalities'),
};

export async function searchCompanies(params: {
  afm?: string;
  arGemi?: string | number;
  name?: string;
  resultsSize?: number;
}): Promise<{ results: GemiCompanySummary[]; totalResults: number }> {
  const qs = new URLSearchParams();
  if (params.afm) qs.set('afm', params.afm);
  if (params.arGemi !== undefined) qs.set('arGemi', String(params.arGemi));
  if (params.name) qs.set('name', params.name);
  qs.set('resultsSize', String(params.resultsSize ?? 25));
  const raw = await gemiFetch<any>(`/companies?${qs.toString()}`);
  return {
    results: raw.searchResults ?? raw.results ?? [],
    totalResults: raw.searchMetadata?.totalCount ?? raw.totalResults ?? 0,
  };
}

export async function getCompany(arGemi: string | number): Promise<GemiCompany> {
  return gemiFetch(`/companies/${arGemi}`);
}

export async function getCompanyDocuments(arGemi: string | number): Promise<GemiDocumentSet> {
  return gemiFetch(`/companies/${arGemi}/documents`);
}

/** Downloads a file from a GEMI URL (assemblyDecisionUrl or publication.url) as Buffer. */
export async function downloadGemiFile(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { api_key: apiKey() },
    cache: 'no-store',
  });
  if (!res.ok) throw new GemiError(res.status, `Download failed: ${url}`);
  const ab = await res.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/** Maps a GEMI Company into our internal Company shape (subset). */
export function mapGemiCompany(c: GemiCompany) {
  const addr = [c.street, c.streetNumber].filter(Boolean).join(' ');
  const arGemiStr = c.arGemi != null ? String(c.arGemi) : null;
  return {
    arGemi: arGemiStr,
    afm: c.afm,
    name: c.coNameEl,
    shortName: c.coTitlesEl?.[0] ?? null,
    gemhNumber: arGemiStr,
    // Lookup FKs — ΓΕΜΗ returns numeric ids as strings; coerce Int-typed ones.
    legalTypeId: c.legalType?.id != null ? Number(c.legalType.id) : null,
    gemiOfficeId: c.gemiOffice?.id != null ? Number(c.gemiOffice.id) : null,
    companyStatusId: c.status?.id != null ? Number(c.status.id) : null,
    prefectureId: c.prefecture?.id != null ? String(c.prefecture.id) : null,
    municipalityId: c.municipality?.id != null ? String(c.municipality.id) : null,
    legalForm: c.legalType?.descr ?? null,
    address: addr || null,
    city: c.city || c.municipality?.descr || null,
    zip: c.zipCode || null,
    country: 'GR',
    email: c.email || null,
    website: c.url || null,
    foundingDate: c.incorporationDate || null,
    gemiOffice: c.gemiOffice?.descr ?? null,
    gemiStatus: c.status?.descr ?? null,
    gemiObjective: c.objective ?? null,
    gemiIsBranch: c.isBranch ?? null,
    gemiAutoRegistered: c.autoRegistered ?? null,
    gemiLastStatusChange: c.lastStatusChange || null,
    isActive: c.status?.isActive ?? true,
    // Map activities to our CompanyActivity shape
    activities: ensurePrimaryActivity(
      (c.activities ?? [])
        .filter((a) => a.activity?.id)
        .map((a, i) => ({
          code: a.activity!.id,
          description: a.activity!.descr,
          // ΓΕΜΗ activity.type: "1" κύρια, otherwise δευτερεύουσα (per AADE convention)
          kind: a.type === '1' ? 'PRIMARY' as const : 'SECONDARY' as const,
          order: i,
        })),
    ),
  };
}
