import 'server-only';
import iconv from 'iconv-lite';
import { gunzipSync } from 'node:zlib';
import { getSetting, setSetting } from '@/lib/settings';

/**
 * SoftOne ERP Web Services client (Soft1).
 *
 * Two-step auth: `login` (temp clientID + available companies) → `authenticate`
 * (permanent clientID). The permanent clientID is the session "token" reused on
 * every subsequent call. Re-auth only when a response returns errorcode < 0.
 *
 * Credentials are read from DB-stored app settings (admin → Ρυθμίσεις → Διασυνδέσεις),
 * NOT from .env. Responses are gzip + windows-1253 (cp1253) — always decode via
 * ArrayBuffer + iconv-lite, never res.json()/res.text().
 */

export interface SoftoneConfig {
  endpoint: string; // https://<subdomain>.oncloud.gr/s1services
  appId: string;
  username: string;
  password: string;
  company?: string;
  branch?: string;
  module?: string;
  refid?: string;
}

export interface SoftoneLoginResult {
  success: boolean;
  clientID?: string;
  /** Available company/branch/module/refid combinations for this account. */
  objs?: Array<Record<string, unknown>>;
  ver?: string;
  sn?: string;
  error?: string;
  errorcode?: number;
}

export interface SoftoneAuthResult {
  success: boolean;
  clientID?: string;
  error?: string;
  errorcode?: number;
}

/** Loads SoftOne config from app settings. Throws if mandatory fields missing. */
export async function loadSoftoneConfig(): Promise<SoftoneConfig> {
  const [subdomain, appId, username, password, company, branch, module, refid] = await Promise.all([
    getSetting<string>('integrations.softoneSerial'),
    getSetting<string>('integrations.softoneAppId'),
    getSetting<string>('integrations.softoneUser'),
    getSetting<string>('integrations.softonePass'),
    getSetting<string>('integrations.softoneCompany'),
    getSetting<string>('integrations.softoneBranch'),
    getSetting<string>('integrations.softoneModule'),
    getSetting<string>('integrations.softoneRefid'),
  ]);

  const missing: string[] = [];
  if (!subdomain) missing.push('Subdomain');
  if (!appId) missing.push('App ID');
  if (!username) missing.push('Username');
  if (!password) missing.push('Password');
  if (missing.length) {
    throw new Error(`Λείπουν ρυθμίσεις SoftOne: ${missing.join(', ')}`);
  }

  // Accept either a bare subdomain ("kolleris") or a full host/URL — normalise to endpoint.
  const sub = subdomain!.trim();
  const endpoint = /^https?:\/\//i.test(sub)
    ? sub.replace(/\/+$/, '').replace(/\/s1services$/i, '') + '/s1services'
    : `https://${sub.replace(/\.oncloud\.gr.*$/i, '')}.oncloud.gr/s1services`;

  return {
    endpoint,
    appId: appId!,
    username: username!,
    password: password!,
    company: company || undefined,
    branch: branch || undefined,
    module: module || undefined,
    refid: refid || undefined,
  };
}

/** POST a payload and decode the gzip + cp1253 JSON response. */
export async function softoneFetch<T = Record<string, unknown>>(
  endpoint: string,
  payload: object,
): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  // Always ArrayBuffer — res.text()/res.json() assume UTF-8 and corrupt Greek.
  let buf = Buffer.from(await res.arrayBuffer());
  if (res.headers.get('content-encoding') === 'gzip') {
    // Some hosts/proxies auto-decompress; guard with the gzip magic bytes.
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = Buffer.from(gunzipSync(buf));
  }
  const text = iconv.decode(buf, 'win1253');
  return JSON.parse(text) as T;
}

/** Step 1: login → temporary clientID + available companies. */
export async function softoneLogin(cfg: SoftoneConfig): Promise<SoftoneLoginResult> {
  return softoneFetch<SoftoneLoginResult>(cfg.endpoint, {
    service: 'login',
    username: cfg.username,
    password: cfg.password,
    appId: cfg.appId,
  });
}

/** Step 2: authenticate → permanent clientID (the session token). */
export async function softoneAuthenticate(
  cfg: SoftoneConfig,
  tempClientId: string,
): Promise<SoftoneAuthResult> {
  return softoneFetch<SoftoneAuthResult>(cfg.endpoint, {
    service: 'authenticate',
    clientID: tempClientId,
    company: cfg.company,
    branch: cfg.branch,
    module: cfg.module,
    refid: cfg.refid,
  });
}

// The SoftOne session token expires after 30 minutes. Cache it that long and
// reuse it across ALL calls instead of authenticating every time. The cache is
// persisted to the DB (AppSetting) so it survives across Next.js requests /
// serverless instances — not just within one Node process.
const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_CACHE_KEY = 'integrations.softoneTokenCache';

type TokenCache = { clientID: string; at: number };
let cachedToken: TokenCache | null = null; // fast in-process path

function isFresh(c: TokenCache | null): c is TokenCache {
  return !!c && typeof c.clientID === 'string' && Date.now() - c.at < TOKEN_TTL_MS;
}

async function loadPersistedToken(): Promise<TokenCache | null> {
  const raw = await getSetting<unknown>(TOKEN_CACHE_KEY);
  if (!raw) return null;
  const obj = typeof raw === 'string' ? safeJson(raw) : raw;
  if (obj && typeof obj === 'object' && 'clientID' in obj && 'at' in obj) {
    return { clientID: String((obj as TokenCache).clientID), at: Number((obj as TokenCache).at) };
  }
  return null;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

export function getCachedToken(): string | null {
  return isFresh(cachedToken) ? cachedToken.clientID : null;
}

export function clearCachedToken(): void {
  cachedToken = null;
  // Best-effort persistent clear; ignore failures.
  void setSetting(TOKEN_CACHE_KEY, null).catch(() => {});
}

/**
 * Returns a valid SoftOne session token, authenticating only when there is no
 * unexpired cached token (≤30 min old). Pass `force` to bypass the cache.
 */
export async function softoneGetToken(force = false): Promise<string> {
  if (!force) {
    if (isFresh(cachedToken)) return cachedToken.clientID;
    const persisted = await loadPersistedToken();
    if (isFresh(persisted)) {
      cachedToken = persisted;
      return persisted.clientID;
    }
  }

  const cfg = await loadSoftoneConfig();
  const login = await softoneLogin(cfg);
  if (!login.success || !login.clientID) {
    throw new Error(`SoftOne login απέτυχε: ${login.error ?? 'άγνωστο σφάλμα'}`);
  }

  // Data services (getBrowserInfo etc.) REQUIRE an authenticated session — the
  // temp login clientID alone yields "Please authenticate first". Resolve the
  // auth params from settings, falling back to the first company the login
  // returned (covers single-company tenants where the 4 fields weren't filled).
  const first = (login.objs && login.objs[0]) ?? {};
  const pick = (k: string): string | undefined => {
    const v = first[k] ?? first[k.toUpperCase()] ?? first[k.toLowerCase()];
    return v == null || v === '' ? undefined : String(v);
  };
  const authCfg: SoftoneConfig = {
    ...cfg,
    company: cfg.company ?? pick('COMPANY'),
    branch: cfg.branch ?? pick('BRANCH'),
    module: cfg.module ?? pick('MODULE') ?? '0',
    refid: cfg.refid ?? pick('REFID'),
  };

  const auth = await softoneAuthenticate(authCfg, login.clientID);
  if (!auth.success || !auth.clientID) {
    throw new Error(`SoftOne authenticate απέτυχε: ${auth.error ?? 'άγνωστο σφάλμα'}`);
  }
  cachedToken = { clientID: auth.clientID, at: Date.now() };
  // Persist so other requests/instances reuse the same token for its 30-min life.
  void setSetting(TOKEN_CACHE_KEY, cachedToken).catch(() => {});
  return auth.clientID;
}

/**
 * Authenticated service call. Injects clientID + appId, decodes the response,
 * and transparently re-authenticates once if SoftOne reports an expired session
 * (errorcode < 0, e.g. -101/-100).
 */
export async function softoneCall<T extends { success?: boolean; errorcode?: number } = Record<string, unknown>>(
  service: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const cfg = await loadSoftoneConfig();
  const token = await softoneGetToken();

  const run = (clientID: string) =>
    softoneFetch<T>(cfg.endpoint, { service, clientID, appId: cfg.appId, ...params });

  let data = await run(token);
  if (data && data.success === false && typeof data.errorcode === 'number' && data.errorcode < 0) {
    clearCachedToken();
    const fresh = await softoneGetToken(true);
    data = await run(fresh);
  }
  return data;
}

export interface VatCategoryRow {
  /** SoftOne VAT code (Smallint). */
  code: string;
  /** Περιγραφή (NAME). */
  name: string;
  /** Ποσοστό % (PERCNT). */
  percent: number | null;
  /** ISACTIVE (1/0). */
  isActive: boolean;
  /** Κωδικός myDATA (MYDATACODE), αν υπάρχει. */
  mydataCode: string | null;
}

interface BrowserInfoResp {
  success?: boolean;
  errorcode?: number;
  error?: string;
  reqID?: string;
  totalcount?: number;
  fields?: Array<{ name: string; type?: string }>;
  columns?: Array<{ dataIndex?: string; header?: string }>;
}
interface BrowserDataResp {
  success?: boolean;
  errorcode?: number;
  error?: string;
  totalcount?: number;
  // SoftOne is inconsistent across versions: rows can be array-of-arrays
  // (positional) or array-of-objects (keyed by field name / dataIndex).
  rows?: Array<unknown[] | Record<string, unknown>>;
}

/** Normalises a browser field name to a bare UPPERCASE field key (strips "VAT." prefix). */
function bareField(name: string): string {
  const i = name.lastIndexOf('.');
  return (i >= 0 ? name.slice(i + 1) : name).toUpperCase();
}

/**
 * Generic browser reader. Runs getBrowserInfo + paginated getBrowserData on an
 * object and returns every row as a plain object keyed by bare UPPERCASE field
 * name (e.g. "VAT", "NAME"). Handles both row shapes SoftOne emits (array-of-
 * arrays positional, or array-of-objects keyed by field name / dataIndex).
 */
export async function softoneBrowseAll(
  object: string,
  filters = '',
  list = '',
): Promise<Array<Record<string, unknown>>> {
  const info = await softoneCall<BrowserInfoResp>('getBrowserInfo', { object, list, filters });
  if (info.success === false || !info.reqID) {
    throw new Error(`getBrowserInfo ${object} απέτυχε: ${info.error ?? `code ${info.errorcode ?? '?'}`}`);
  }

  const fields = info.fields ?? [];
  const columns = info.columns ?? [];
  const keyByPos: string[] = fields.map((f) => bareField(f.name));
  const aliasToKey: Record<string, string> = {};
  fields.forEach((f, i) => {
    const key = bareField(f.name);
    for (const alias of [f.name, key, columns[i]?.dataIndex].filter(Boolean) as string[]) {
      aliasToKey[alias] = key;
    }
  });

  const toObject = (row: unknown[] | Record<string, unknown>): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    if (Array.isArray(row)) {
      row.forEach((v, i) => { if (keyByPos[i]) obj[keyByPos[i]] = v; });
    } else {
      for (const [k, v] of Object.entries(row)) {
        const key = aliasToKey[k] ?? bareField(k);
        obj[key] = v;
      }
    }
    return obj;
  };

  const total = info.totalcount ?? 0;
  const out: Array<Record<string, unknown>> = [];
  const limit = 500;
  for (let start = 0; ; start += limit) {
    const page = await softoneCall<BrowserDataResp>('getBrowserData', { reqID: info.reqID, start, limit });
    const rows = page.rows ?? [];
    for (const r of rows) out.push(toObject(r));
    if (rows.length < limit || (total && out.length >= total) || rows.length === 0) break;
  }
  return out;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
// SoftOne browsers render ISACTIVE as the display caption "Ναι"/"Όχι" (not 1/0).
// Treat a row as inactive only when it is explicitly negative.
const isInactive = (v: unknown): boolean => {
  const s = str(v).toLowerCase();
  return s === '0' || s === 'όχι' || s === 'οχι' || s === 'no' || s === 'false';
};

/**
 * Reads all active VAT categories from SoftOne (default browser of object VAT,
 * server-side filter VAT.ISACTIVE=1).
 */
export async function softoneFetchVatCategories(): Promise<VatCategoryRow[]> {
  const rows = await softoneBrowseAll('VAT', 'VAT.ISACTIVE=1');
  const out: VatCategoryRow[] = [];
  for (const r of rows) {
    const code = str(r.VAT);
    if (!code) continue;
    if (isInactive(r.ISACTIVE)) continue; // safety net
    const pct = r.PERCNT;
    out.push({
      code,
      name: str(r.NAME),
      percent: pct == null || pct === '' ? null : Number(String(pct).replace(',', '.')),
      isActive: true,
      mydataCode: str(r.MYDATACODE) || null,
    });
  }
  return out;
}

export interface PurchaseDocTypeRow {
  /** SoftOne SERIES (αριθμός σειράς). */
  code: string;
  /** CODE (σύντμηση). */
  abbrev: string | null;
  /** NAME (Περιγραφή). */
  name: string;
  /** FPRMS (Τύπος παραστατικού). */
  section: string | null;
}

// SoftOne SOSOURCE (document source/module) ids — system constants consistent
// across installations: 1251 = Αγορές (purchases), 1361 = Πωλήσεις (sales).
// Verified on dgsoft: SERIES.SOSOURCE=1251 returns the full purchase series set
// (Τιμολόγιο Αγοράς, Παραγγελία σε Προμηθευτή, ΔΑ Προμηθευτή, ΤΠΥ, Πιστωτικά, …).
const SOSOURCE_PURCHASES = '1251';

/**
 * Reads the active purchase-document SERIES from SoftOne. SERIES is shared across
 * every document family, so it is filtered to the purchases module via
 * SERIES.SOSOURCE=1251 (plus SERIES.ISACTIVE=1).
 */
export async function softoneFetchPurchaseDocTypes(): Promise<PurchaseDocTypeRow[]> {
  const rows = await softoneBrowseAll('SERIES', `SERIES.ISACTIVE=1&SERIES.SOSOURCE=${SOSOURCE_PURCHASES}`);
  const out: PurchaseDocTypeRow[] = [];
  for (const r of rows) {
    const code = str(r.SERIES);
    if (!code) continue;
    if (isInactive(r.ISACTIVE)) continue;
    out.push({
      code,
      abbrev: str(r.CODE) || null,
      name: str(r.NAME),
      section: str(r.FPRMS) || null,
    });
  }
  return out;
}

export interface TrdrRow {
  trdr: number;
  code: string;
  name: string;
  kind: string | null;         // Πελάτης / Προμηθευτής / Πιστωτής (από SODTYPE)
  afm: string | null;
  doy: string | null;          // Δ.Ο.Υ. (IRSDATA)
  profession: string | null;   // Επάγγελμα (JOBTYPETRD)
  address: string | null;
  district: string | null;
  zip: string | null;
  city: string | null;
  phone: string | null;        // PHONE01
  phone2: string | null;       // PHONE02
  fax: string | null;
  email: string | null;
  webpage: string | null;
  isActive: boolean;
}

interface GetTableResp {
  success?: boolean;
  error?: string;
  errorcode?: number;
  count?: number;
  data?: unknown[][];
}

/**
 * Direct table query via the GetTable service. Returns each row as an object
 * keyed by the requested field names. Unlike browsers (getBrowserInfo), GetTable
 * is installation-independent — no per-tenant browser layouts, no row caps — so
 * it is the correct way to bulk-read standard tables like TRDR with full fields.
 *
 * @param table  DB table name, e.g. "TRDR"
 * @param fields ordered field list; the response rows align to this order
 * @param filter SQL WHERE clause without "WHERE", e.g. "SODTYPE=13 AND ISACTIVE=1"
 */
export async function softoneGetTable(
  table: string,
  fields: string[],
  filter = '',
): Promise<Array<Record<string, string>>> {
  const res = await softoneCall<GetTableResp>('GetTable', { TABLE: table, FIELDS: fields.join(','), FILTER: filter });
  if (res.success === false) {
    throw new Error(`GetTable ${table} απέτυχε: ${res.error ?? `code ${res.errorcode ?? '?'}`}`);
  }
  const rows = res.data ?? [];
  return rows.map((r) => {
    const o: Record<string, string> = {};
    fields.forEach((f, i) => { o[f] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  });
}

// Standard TRDR fields pulled for the customer/supplier registries.
const TRDR_FIELDS = [
  'TRDR', 'CODE', 'NAME', 'AFM', 'IRSDATA', 'JOBTYPETRD',
  'ADDRESS', 'ZIP', 'CITY', 'DISTRICT',
  'PHONE01', 'PHONE02', 'FAX', 'EMAIL', 'WEBPAGE', 'SODTYPE', 'ISACTIVE',
];

// TRDR.SODTYPE → human label (SoftOne standard subledgers).
const SODTYPE_LABEL: Record<string, string> = {
  '12': 'Προμηθευτής',
  '13': 'Πελάτης',
  '15': 'Πιστωτής',
  '16': 'Πιστωτής',
};

function mapTrdr(o: Record<string, string>): TrdrRow {
  return {
    trdr: Number(o.TRDR),
    code: o.CODE,
    name: o.NAME,
    kind: SODTYPE_LABEL[o.SODTYPE] ?? null,
    afm: o.AFM || null,
    doy: o.IRSDATA || null,
    profession: o.JOBTYPETRD || null,
    address: o.ADDRESS || null,
    district: o.DISTRICT || null,
    zip: o.ZIP || null,
    city: o.CITY || null,
    phone: o.PHONE01 || null,
    phone2: o.PHONE02 || null,
    fax: o.FAX || null,
    email: o.EMAIL || null,
    webpage: o.WEBPAGE || null,
    isActive: o.ISACTIVE !== '0',
  };
}

// TRDR.SODTYPE subledgers: 13 = πελάτης, 12 = προμηθευτής, 15/16 = πιστωτές.
const SODTYPE_CUSTOMER = '13';
// "Suppliers" registry = formal suppliers (12) + creditors (15, 16), per user choice.
const SODTYPE_SUPPLIERS = ['12', '15', '16'];

/** Reads all customers from SoftOne (TRDR SODTYPE=13) with full fields, via GetTable. */
export async function softoneFetchCustomers(): Promise<TrdrRow[]> {
  const rows = await softoneGetTable('TRDR', TRDR_FIELDS, `SODTYPE=${SODTYPE_CUSTOMER}`);
  return rows.map(mapTrdr).filter((r) => Number.isFinite(r.trdr));
}

/** Reads all suppliers + creditors from SoftOne (TRDR SODTYPE 12/15/16) with full fields, via GetTable. */
export async function softoneFetchSuppliers(): Promise<TrdrRow[]> {
  const rows = await softoneGetTable('TRDR', TRDR_FIELDS, `SODTYPE IN (${SODTYPE_SUPPLIERS.join(',')})`);
  return rows.map(mapTrdr).filter((r) => Number.isFinite(r.trdr));
}

export interface ItemRow {
  mtrl: number;
  code: string;
  code1: string | null;   // EAN / barcode
  code2: string | null;   // factory code
  name: string;
  name2: string | null;
  price: number | null;
  isService: boolean;
  isActive: boolean;
}

const MTRL_FIELDS = ['MTRL', 'CODE', 'CODE1', 'CODE2', 'NAME', 'NAME1', 'PRICER', 'SODTYPE', 'ISACTIVE'];

function mapItem(o: Record<string, string>): ItemRow {
  const price = o.PRICER === '' ? null : Number(String(o.PRICER).replace(',', '.'));
  return {
    mtrl: Number(o.MTRL),
    code: o.CODE,
    code1: o.CODE1 || null,
    code2: o.CODE2 || null,
    name: o.NAME,
    name2: o.NAME1 || null,
    price: Number.isFinite(price as number) ? (price as number) : null,
    isService: o.SODTYPE === '52',
    isActive: o.ISACTIVE !== '0',
  };
}

// MTRL.SODTYPE: 51 = προϊόν/είδος, 52 = υπηρεσία.
/** Reads all items + services from SoftOne (MTRL SODTYPE 51/52) via GetTable. */
export async function softoneFetchItems(): Promise<ItemRow[]> {
  const rows = await softoneGetTable('MTRL', MTRL_FIELDS, 'SODTYPE IN (51,52)');
  return rows.map(mapItem).filter((r) => Number.isFinite(r.mtrl));
}

/**
 * Finds a SoftOne item by an invoice-line code, trying CODE / CODE2 (factory) /
 * CODE1 (EAN) in that priority. Used by the OCR line ↔ item correlation.
 */
export async function softoneFindItemByCode(rawCode: string): Promise<ItemRow | null> {
  const code = String(rawCode ?? '').trim().replace(/'/g, '');
  if (!code) return null;
  // One query, any of the 3 code columns matches.
  const rows = await softoneGetTable(
    'MTRL', MTRL_FIELDS,
    `(CODE='${code}' OR CODE2='${code}' OR CODE1='${code}') AND SODTYPE IN (51,52)`,
  );
  const items = rows.map(mapItem).filter((r) => Number.isFinite(r.mtrl));
  if (items.length === 0) return null;
  // Prefer exact CODE, then CODE2 (factory), then CODE1 (EAN).
  return (
    items.find((i) => i.code === code) ??
    items.find((i) => i.code2 === code) ??
    items.find((i) => i.code1 === code) ??
    items[0]
  );
}

// Normalises a document number for loose comparison (digits+letters, uppercase).
function normNum(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[^0-9A-ZΑ-Ω]/gi, '');
}

/**
 * Checks whether a purchase invoice already exists in SoftOne for a supplier —
 * matched by TRDR + document number (FINCODE/TAXSERIESNUM) + date. Returns the
 * existing FINCODE if a likely duplicate is found (for review, never auto-block).
 */
export async function softoneCheckPurchaseDoc(
  trdr: number,
  number: string,
  dateISO?: string | null,
): Promise<{ exists: boolean; ref: string | null }> {
  const n = normNum(number);
  if (!Number.isFinite(trdr) || !n) return { exists: false, ref: null };

  const day = dateISO ? String(dateISO).slice(0, 10) : null; // yyyy-MM-dd
  const filter = day
    ? `TRDR=${trdr} AND TRNDATE=${day}`
    : `TRDR=${trdr}`;

  let rows: Array<Record<string, string>>;
  try {
    // Match anchored on TRDR (+ date); the supplier's number may live in any of
    // these fields depending on tenant config, so we check them all.
    rows = await softoneGetTable('FINDOC', ['FINDOC', 'FINCODE', 'TAXSERIESNUM', 'SERIESNUM', 'TRNDATE'], filter);
  } catch {
    return { exists: false, ref: null };
  }

  for (const r of rows) {
    const fincode = normNum(r.FINCODE);
    const taxnum = normNum(r.TAXSERIESNUM);
    const seriesnum = normNum(r.SERIESNUM);
    const hit =
      (fincode && (fincode === n || fincode.includes(n))) ||
      (taxnum && (taxnum === n || taxnum.includes(n))) ||
      (seriesnum && seriesnum === n);
    if (hit) return { exists: true, ref: r.FINCODE || r.TAXSERIESNUM || `FINDOC ${r.FINDOC}` };
  }
  return { exists: false, ref: null };
}

export interface CreateItemInput {
  code: string;
  name: string;
  isService: boolean;
  vat: string;          // VAT code (smallint as string)
  unit: string;         // MTRUNIT id (smallint as string)
  price?: number | null;
  // Optional classification (FK ids from the aux tables).
  group?: string | null;       // MTRGROUP
  category?: string | null;    // MTRCATEGORY
  manufacturer?: string | null;// MTRMANFCTR
  brand?: string | null;       // MTRMARK
}

/** Auxiliary lookup tables for the item-create form (combo boxes). */
export interface ItemAuxMeta {
  vats: { id: string; name: string }[];
  units: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  manufacturers: { id: string; name: string }[];
  brands: { id: string; name: string }[];
}

const cleanS1Label = (s: string): string => {
  // SoftOne sometimes returns "{en=Pieces|el=Τεμάχια}" — prefer the el value.
  const m = String(s ?? '').match(/el=([^|}]+)/);
  return (m ? m[1] : String(s ?? '')).trim();
};

// SoftOne aux tables → local lookups. label = the el value, prefixed with code when useful.
const LOOKUP_TABLES = ['MTRUNIT', 'MTRGROUP', 'MTRCATEGORY', 'MTRMANFCTR', 'MTRMARK'] as const;

/** Fetches all aux/classification tables flat ({kind, code, name}) for the lookups sync. */
export async function softoneFetchLookups(): Promise<{ kind: string; code: string; name: string }[]> {
  const out: { kind: string; code: string; name: string }[] = [];
  // Aux tables are company-scoped → GetTable returns the same code per company.
  // Dedupe on (kind, code) to satisfy the unique constraint.
  const seen = new Set<string>();
  const add = (kind: string, code: string, name: string) => {
    if (!code || !name) return;
    const key = `${kind} ${code}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, code, name });
  };

  // Scope to the configured company so we only get this company's rows.
  const cfg = await loadSoftoneConfig().catch(() => null);
  const companyFilter = cfg?.company ? ` AND COMPANY=${cfg.company}` : '';
  const onlyCompany = cfg?.company ? `COMPANY=${cfg.company}` : '';

  const vats = await softoneGetTable('VAT', ['VAT', 'NAME', 'PERCNT'], `ISACTIVE=1${companyFilter}`).catch(() => []);
  for (const r of vats) add('VAT', String(r.VAT), `${cleanS1Label(r.NAME)} (${r.PERCNT}%)`);

  for (const table of LOOKUP_TABLES) {
    const rows = await softoneGetTable(table, [table, 'CODE', 'NAME'], onlyCompany).catch(() => []);
    for (const r of rows) {
      // MTRUNIT keeps the label in CODE (NAME holds the company); the rest use NAME.
      const name = table === 'MTRUNIT'
        ? cleanS1Label(r.CODE)
        : (cleanS1Label(r.NAME) || cleanS1Label(r.CODE));
      add(table, String(r[table]), name);
    }
  }
  return out;
}

/** Loads the item classification lookup tables from SoftOne (small, cached upstream). */
export async function softoneLoadItemAux(): Promise<ItemAuxMeta> {
  const grab = async (table: string) => {
    const rows = await softoneGetTable(table, [table, 'CODE', 'NAME'], '').catch(() => []);
    return rows
      .map((r) => ({ id: String(r[table]), name: cleanS1Label(r.NAME || r.CODE) }))
      .filter((x) => x.id);
  };
  const [vats, units, groups, categories, manufacturers, brands] = await Promise.all([
    softoneGetTable('VAT', ['VAT', 'NAME', 'PERCNT'], 'ISACTIVE=1')
      .then((rows) => rows.map((r) => ({ id: String(r.VAT), name: `${cleanS1Label(r.NAME)} (${r.PERCNT}%)` })))
      .catch(() => []),
    softoneGetTable('MTRUNIT', ['MTRUNIT', 'CODE', 'NAME'], '')
      .then((rows) => rows.map((r) => ({ id: String(r.MTRUNIT), name: cleanS1Label(r.CODE) || cleanS1Label(r.NAME) })))
      .catch(() => []),
    grab('MTRGROUP'), grab('MTRCATEGORY'), grab('MTRMANFCTR'), grab('MTRMARK'),
  ]);
  return { vats, units, groups, categories, manufacturers, brands };
}

/** Builds the exact setData payload for an item create (also used for dry-run preview). */
export function buildItemPayload(input: CreateItemInput): { OBJECT: 'ITEM'; KEY: ''; DATA: { ITEM: Record<string, unknown>[] } } {
  const row: Record<string, unknown> = {
    CODE: input.code,
    NAME: input.name,
    SODTYPE: input.isService ? 52 : 51,
    MTRTYPE: 0,
    VAT: input.vat,
    MTRUNIT1: input.unit,
    MTRUNIT3: input.unit,
    MTRUNIT4: input.unit,
    ISACTIVE: 1,
  };
  if (input.price != null) row.PRICER = input.price;
  if (input.group) row.MTRGROUP = input.group;
  if (input.category) row.MTRCATEGORY = input.category;
  if (input.manufacturer) row.MTRMANFCTR = input.manufacturer;
  if (input.brand) row.MTRMARK = input.brand;
  return { OBJECT: 'ITEM', KEY: '', DATA: { ITEM: [row] } };
}

/**
 * Creates a new item/service in SoftOne (setData on object ITEM → MTRL).
 * Returns the new MTRL id. Required fields: CODE, NAME, VAT, MTRUNIT (1/3/4);
 * the rest fall back to SoftOne defaults.
 */
export async function softoneCreateItem(input: CreateItemInput): Promise<number> {
  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>(
    'setData', buildItemPayload(input),
  );
  if (res.success === false || res.id == null) {
    throw new Error(res.error ?? `setData ITEM απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  return Number(res.id);
}

export interface ItemClassification {
  vat: string | null;          // VAT
  unit: string | null;         // MTRUNIT1
  group: string | null;        // MTRGROUP
  category: string | null;     // MTRCATEGORY
  manufacturer: string | null; // MTRMANFCTR
  brand: string | null;        // MTRMARK
  isService: boolean;          // SODTYPE=52
}

const idOrNull = (v: unknown): string | null => {
  const s = str(v);
  // SoftOne returns '0' / '' for "unset" FK columns — treat those as null.
  return !s || s === '0' ? null : s;
};

/**
 * Reads a single item's full classification (VAT, unit, group, category,
 * manufacturer, brand) live from SoftOne. The local SoftoneItem mirror does NOT
 * store these, so a live MTRL read is required for the "copy from similar" flow.
 */
export async function softoneItemDetail(mtrl: number): Promise<ItemClassification | null> {
  if (!Number.isFinite(mtrl)) return null;
  const rows = await softoneGetTable(
    'MTRL',
    ['MTRL', 'VAT', 'MTRUNIT1', 'MTRGROUP', 'MTRCATEGORY', 'MTRMANFCTR', 'MTRMARK', 'SODTYPE'],
    `MTRL=${mtrl}`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    vat: idOrNull(r.VAT),
    unit: idOrNull(r.MTRUNIT1),
    group: idOrNull(r.MTRGROUP),
    category: idOrNull(r.MTRCATEGORY),
    manufacturer: idOrNull(r.MTRMANFCTR),
    brand: idOrNull(r.MTRMARK),
    isService: str(r.SODTYPE) === '52',
  };
}

// Normalises a Δ.Ο.Υ. description for loose matching: uppercase, strip accents,
// punctuation and the leading "Δ.Ο.Υ." token, collapse whitespace.
function normDoy(s: string): string {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip Greek/Latin accents
    .replace(/Δ\.?Ο\.?Υ\.?/g, ' ')
    .replace(/[^0-9A-ZΑ-Ω]+/gi, ' ')
    .trim();
}

/** Reads the SoftOne tax-office master (object/table IRSDATA → TRDR.IRSDATA FK). */
export async function softoneFetchTaxOffices(): Promise<{ code: string; name: string }[]> {
  const rows = await softoneGetTable('IRSDATA', ['IRSDATA', 'NAME'], '');
  return rows
    .map((r) => ({ code: str(r.IRSDATA), name: cleanS1Label(r.NAME) }))
    .filter((r) => r.code && r.name);
}

/**
 * Matches an AADE Δ.Ο.Υ. description (e.g. "Ε΄ ΘΕΣΣΑΛΟΝΙΚΗΣ") to a SoftOne
 * IRSDATA code. Tries exact-normalised, then bidirectional contains. Returns the
 * code or null when no confident match.
 */
export function matchTaxOffice(
  description: string | null | undefined,
  offices: { code: string; name: string }[],
): string | null {
  const target = normDoy(description ?? '');
  if (!target) return null;
  const norm = offices.map((o) => ({ ...o, n: normDoy(o.name) }));
  const exact = norm.find((o) => o.n === target);
  if (exact) return exact.code;
  const contains = norm.find((o) => o.n && (o.n.includes(target) || target.includes(o.n)));
  return contains ? contains.code : null;
}

export interface CreateSupplierInput {
  name: string;
  afm: string;
  code?: string | null;        // empty → SoftOne auto-numbering
  doyCode?: string | null;     // IRSDATA code
  profession?: string | null;  // JOBTYPETRD
  address?: string | null;
  zip?: string | null;
  city?: string | null;
}

/** Builds the exact setData payload for a supplier create (also used for dry-run preview). */
export function buildSupplierPayload(input: CreateSupplierInput): { OBJECT: 'SUPPLIER'; KEY: ''; DATA: { SUPPLIER: Record<string, unknown>[] } } {
  const row: Record<string, unknown> = {
    NAME: input.name,
    AFM: input.afm,
    ISACTIVE: 1,
  };
  if (input.code) row.CODE = input.code;
  if (input.doyCode) row.IRSDATA = input.doyCode;
  if (input.profession) row.JOBTYPETRD = input.profession;
  if (input.address) row.ADDRESS = input.address;
  if (input.zip) row.ZIP = input.zip;
  if (input.city) row.CITY = input.city;
  return { OBJECT: 'SUPPLIER', KEY: '', DATA: { SUPPLIER: [row] } };
}

/**
 * Creates a new supplier in SoftOne (setData on object SUPPLIER → TRDR; SODTYPE=12
 * is set by the object). Required fields beyond CODE/NAME carry schema defaults.
 * Returns the new TRDR id + the assigned CODE.
 */
export async function softoneCreateSupplier(input: CreateSupplierInput): Promise<{ trdr: number; code: string }> {
  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>(
    'setData', buildSupplierPayload(input),
  );
  if (res.success === false || res.id == null) {
    throw new Error(res.error ?? `setData SUPPLIER απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  const trdr = Number(res.id);
  // Read back the assigned CODE (auto-numbered when not supplied).
  let code = input.code ?? '';
  if (!code) {
    try {
      const back = await softoneGetTable('TRDR', ['TRDR', 'CODE'], `TRDR=${trdr}`);
      code = back[0]?.CODE ?? '';
    } catch { /* best-effort */ }
  }
  return { trdr, code };
}

export interface AfmLookupResult {
  afm: string;
  customers: TrdrRow[];
  suppliers: TrdrRow[];
}

/**
 * Looks up a VAT number (ΑΦΜ) in SoftOne TRDR and classifies matches as
 * customers / suppliers (by SODTYPE). Installation-independent via GetTable.
 */
export async function softoneFindByAfm(afm: string): Promise<AfmLookupResult> {
  const clean = String(afm).replace(/[^0-9A-Za-z]/g, '');
  if (!clean) return { afm: clean, customers: [], suppliers: [] };
  const rows = await softoneGetTable('TRDR', TRDR_FIELDS, `AFM='${clean}'`);
  // Lookup stays strict: only πελάτης (13) and προμηθευτής (12) — creditors (15/16)
  // would just create noise here.
  return {
    afm: clean,
    customers: rows.filter((o) => o.SODTYPE === SODTYPE_CUSTOMER).map(mapTrdr),
    suppliers: rows.filter((o) => o.SODTYPE === '12').map(mapTrdr),
  };
}

/**
 * Lean lookup of a single vendor by ΑΦΜ — used by the OCR pipeline to tag scanned
 * purchase invoices with their SoftOne supplier/creditor. Searches the same scope
 * as the suppliers registry (SODTYPE 12/15/16) and prefers a formal supplier (12),
 * then creditor (15), then misc creditor (16). Returns the match or null.
 */
export async function softoneFindSupplierByAfm(
  afm: string,
): Promise<{ trdr: number; code: string; name: string; kind: string | null } | null> {
  const clean = String(afm).replace(/[^0-9A-Za-z]/g, '');
  if (!clean) return null;
  const rows = await softoneGetTable(
    'TRDR', ['TRDR', 'CODE', 'NAME', 'SODTYPE'],
    `AFM='${clean}' AND SODTYPE IN (12,15,16)`,
  );
  const valid = rows.filter((o) => Number.isFinite(Number(o.TRDR)));
  if (valid.length === 0) return null;
  const pref = ['12', '15', '16'];
  valid.sort((a, b) => pref.indexOf(a.SODTYPE) - pref.indexOf(b.SODTYPE));
  const r = valid[0];
  return { trdr: Number(r.TRDR), code: r.CODE, name: r.NAME, kind: SODTYPE_LABEL[r.SODTYPE] ?? null };
}

export interface SoftoneTestResult {
  ok: boolean;
  endpoint: string;
  stage: 'login' | 'authenticate';
  /** The clientID / token to display. */
  clientID?: string;
  /** Temp clientID from the login step (for reference). */
  tempClientID?: string;
  authenticated: boolean;
  ver?: string;
  sn?: string;
  /** Available companies from login (shown when authenticate params are missing). */
  companies?: Array<Record<string, unknown>>;
  error?: string;
}

/**
 * Connection test used by the admin Test button.
 * Runs login, then authenticate if the 4 extra fields are set. Never throws —
 * returns a structured result so the UI can show either the token or the error.
 */
export async function softoneTestConnection(): Promise<SoftoneTestResult> {
  let cfg: SoftoneConfig;
  try {
    cfg = await loadSoftoneConfig();
  } catch (e) {
    return { ok: false, endpoint: '', stage: 'login', authenticated: false, error: (e as Error).message };
  }

  try {
    const login = await softoneLogin(cfg);
    if (!login.success || !login.clientID) {
      return {
        ok: false, endpoint: cfg.endpoint, stage: 'login', authenticated: false,
        error: login.error ?? `Login error (code ${login.errorcode ?? '?'})`,
      };
    }

    const hasAuthParams = !!(cfg.company && cfg.branch && cfg.module != null && cfg.refid);
    if (!hasAuthParams) {
      return {
        ok: true, endpoint: cfg.endpoint, stage: 'login', authenticated: false,
        clientID: login.clientID, tempClientID: login.clientID,
        ver: login.ver, sn: login.sn, companies: login.objs,
      };
    }

    const auth = await softoneAuthenticate(cfg, login.clientID);
    if (!auth.success || !auth.clientID) {
      return {
        ok: false, endpoint: cfg.endpoint, stage: 'authenticate', authenticated: false,
        tempClientID: login.clientID, companies: login.objs,
        error: auth.error ?? `Authenticate error (code ${auth.errorcode ?? '?'})`,
      };
    }

    cachedToken = { clientID: auth.clientID, at: Date.now() };
    void setSetting(TOKEN_CACHE_KEY, cachedToken).catch(() => {});
    return {
      ok: true, endpoint: cfg.endpoint, stage: 'authenticate', authenticated: true,
      clientID: auth.clientID, tempClientID: login.clientID,
      ver: login.ver, sn: login.sn, companies: login.objs,
    };
  } catch (e) {
    return { ok: false, endpoint: cfg.endpoint, stage: 'login', authenticated: false, error: (e as Error).message };
  }
}
