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

/**
 * SoftOne SOSOURCE (ενότητα) ids → Greek label. SOSOURCE is a system constant
 * shared across installations. Ids not listed here are shown as «Ενότητα N»
 * until confirmed on the customer's tenant, so nothing is silently dropped.
 */
export const SOSOURCE_LABELS: Record<number, string> = {
  // Verified against the customer's SERIES table (2026-09-09). Pattern: 1<entity><kind>
  // entity 2=προμηθευτές 3=πελάτες 4=τράπεζες/ταμείο 5=χρεώστες 6=πιστωτές ·
  // kind 51=κύρια παραστατικά 53=λοιπές συναλλαγές 61=έσοδα/έξοδα 81=εισπράξεις/πληρωμές.
  1054: 'Αποσβέσεις παγίων',
  1089: 'Άρθρα Γενικής Λογιστικής',
  1090: 'Άρθρα Αναλυτικής Λογιστικής',
  1140: 'Λογιστικά σημειώματα',
  1151: 'Αποθήκη',
  1154: 'Παραστατικά παγίων',
  1171: 'Εντολές παραγωγής',
  1181: 'Κινήσεις αξιογράφων',
  1212: 'Συμψηφισμοί προμηθευτών',
  1251: 'Αγορές',
  1253: 'Λοιπές συναλλαγές προμηθευτών',
  1261: 'Παραστατικά εξόδων',
  1281: 'Πληρωμές προμηθευτών',
  1282: 'Κοστολόγηση εισαγωγών',
  1312: 'Συμψηφισμοί πελατών–προμηθευτών',
  1313: 'Συμψηφισμοί / επισφάλειες πελατών',
  1351: 'Πωλήσεις',
  1352: 'Φάκελοι πωλήσεων',
  1353: 'Λοιπές συναλλαγές πελατών',
  1361: 'Παραστατικά εσόδων',
  1381: 'Εισπράξεις πελατών',
  1382: 'Κοστολόγηση εξαγωγών',
  1412: 'Εμβάσματα προμηθευτών',
  1413: 'Εμβάσματα πελατών',
  1414: 'Μεταφορές τραπεζικών λογαριασμών',
  1415: 'Εμβάσματα χρεωστών',
  1416: 'Εμβάσματα πιστωτών',
  1453: 'Λοιπές συναλλαγές τραπεζών',
  1481: 'Ταμείο (καταθέσεις / αναλήψεις)',
  1553: 'Λοιπές συναλλαγές χρεωστών',
  1581: 'Εισπράξεις χρεωστών',
  1653: 'Παραστατικά πιστωτών',
  1681: 'Πληρωμές πιστωτών',
  1717: 'Συμψηφισμοί πιστωτών',
  2021: 'Ενέργειες CRM',
  2052: 'Ραντεβού',
  5151: 'Σύνθεση / αποσύνθεση set ειδών',
  7151: 'Παραγωγή',
  8100: 'Αξιόγραφα',
};

export function sosourceLabel(id: number): string {
  return SOSOURCE_LABELS[id] ?? `Ενότητα ${id}`;
}

export interface DocSeriesRow {
  /** SoftOne SOSOURCE (ενότητα). */
  sosource: number;
  /** Greek label for the ενότητα. */
  family: string;
  /** SERIES (αριθμός σειράς). */
  code: string;
  /** CODE (σύντμηση). */
  abbrev: string | null;
  /** NAME (Περιγραφή). */
  name: string;
  /** FPRMS (Τύπος). */
  section: string | null;
}

const SERIES_FIELDS = ['SOSOURCE', 'SERIES', 'CODE', 'NAME', 'FPRMS', 'ISACTIVE'];

/**
 * Reads every active document series from the SoftOne SERIES table, for all
 * ενότητες except purchases (1251), which already live in PurchaseDocType.
 * Uses GetTable (raw table access) because the SERIES browser does not expose
 * the SOSOURCE column, and we need it to group series per ενότητα.
 */
export async function softoneFetchDocSeries(): Promise<DocSeriesRow[]> {
  // SERIES is per-company. Scope to the company the session authenticated against
  // (settings, else the tenant's first company) so a multi-company tenant never mixes.
  const cfg = await loadSoftoneConfig();
  const company = cfg.company?.trim();
  const filter = company ? `ISACTIVE=1 AND COMPANY=${Number(company)}` : 'ISACTIVE=1';
  const rows = await softoneGetTable('SERIES', SERIES_FIELDS, filter);
  const out: DocSeriesRow[] = [];
  for (const r of rows) {
    const sosource = Number(r.SOSOURCE);
    const code = str(r.SERIES);
    if (!Number.isFinite(sosource) || !code) continue;
    if (sosource === SOSOURCE_PURCHASES_NUM) continue;
    if (isInactive(r.ISACTIVE)) continue;
    out.push({
      sosource,
      family: sosourceLabel(sosource),
      code,
      abbrev: str(r.CODE) || null,
      name: str(r.NAME) || code,
      section: str(r.FPRMS) || null,
    });
  }
  return out;
}
const SOSOURCE_PURCHASES_NUM = 1251;

export interface TrdrRow {
  trdr: number;
  /** SoftOne SODTYPE (12 προμηθευτής, 13 πελάτης, 14 χρηματικός λογ., 15 χρεώστης, 16 πιστωτής). */
  sodtype: number;
  code: string;
  name: string;
  kind: string;         // Πελάτης / Προμηθευτής / Πιστωτής (από SODTYPE)
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

// TRDR.SODTYPE → human label. Verified against the tenant's SoftOne objects:
// LINSUPDOC=12, LINCUSDOC=13, LINBACDOC=14, LINDEBDOC=15, LINCREDOC=16.
export const SODTYPE_LABEL: Record<number, string> = {
  12: 'Προμηθευτής',
  13: 'Πελάτης',
  14: 'Χρηματικός λογαριασμός',
  15: 'Χρεώστης',
  16: 'Πιστωτής',
};
export const TRADER_SODTYPES = [12, 13, 14, 15, 16] as const;
/** SODTYPEs that can issue a purchase invoice to us (OCR supplier matching). */
export const SUPPLIER_SODTYPES = [12, 16] as const;

function mapTrdr(o: Record<string, string>): TrdrRow {
  const sodtype = Number(o.SODTYPE);
  return {
    trdr: Number(o.TRDR),
    sodtype,
    code: o.CODE,
    name: o.NAME,
    kind: SODTYPE_LABEL[sodtype] ?? `Τύπος ${o.SODTYPE}`,
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

// Entries SoftOne users park with these prefixes are dormant/closed and must not
// show up anywhere in the app: «(Α) …» and «… ΥΠΟ ΕΚΚΑΘΑΡΙΣΗ …».
const HIDDEN_TRADER = /^\s*\((Α|A)\)|ΥΠΟ\s+ΕΚΚΑΘΑΡΙΣΗ/i;
export const isHiddenTrader = (name: string) => HIDDEN_TRADER.test(name);

/**
 * Reads every συναλλασσόμενος (TRDR SODTYPE 12–16) of the session company from
 * SoftOne via GetTable. Hidden entries («(Α)», «ΥΠΟ ΕΚΚΑΘΑΡΙΣΗ») are dropped.
 */
export async function softoneFetchTraders(): Promise<TrdrRow[]> {
  const cfg = await loadSoftoneConfig();
  const company = cfg.company?.trim();
  const filter = `SODTYPE IN (${TRADER_SODTYPES.join(',')})` + (company ? ` AND COMPANY=${Number(company)}` : '');
  const rows = await softoneGetTable('TRDR', TRDR_FIELDS, filter);
  return rows
    .map(mapTrdr)
    .filter((r) => Number.isFinite(r.trdr) && !isHiddenTrader(r.name));
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
/** Συναλλασσόμενος που εκδίδει παραστατικό προς εμάς: προμηθευτής (12) ή πιστωτής (16). */
export type TraderKind = 'supplier' | 'creditor';
/** Ίδια πεδία για SUPPLIER και CREDITOR — το SODTYPE το θέτει το ίδιο το object. */
export type CreateTraderInput = CreateSupplierInput;

const TRADER_OBJECT: Record<TraderKind, 'SUPPLIER' | 'CREDITOR'> = { supplier: 'SUPPLIER', creditor: 'CREDITOR' };
/** SODTYPE που δίνει το κάθε object (για έλεγχο μετά την εγγραφή). */
export const TRADER_KIND_SODTYPE: Record<TraderKind, number> = { supplier: 12, creditor: 16 };

function traderRow(input: CreateTraderInput): Record<string, unknown> {
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
  return row;
}

/**
 * Builds the exact setData payload for a trader create (also used for dry-run preview).
 * Both objects write TRDR — SUPPLIER stamps SODTYPE=12, CREDITOR stamps 16.
 */
export function buildTraderPayload(kind: 'supplier', input: CreateTraderInput): { OBJECT: 'SUPPLIER'; KEY: ''; DATA: { SUPPLIER: Record<string, unknown>[] } };
export function buildTraderPayload(kind: 'creditor', input: CreateTraderInput): { OBJECT: 'CREDITOR'; KEY: ''; DATA: { CREDITOR: Record<string, unknown>[] } };
export function buildTraderPayload(kind: TraderKind, input: CreateTraderInput): { OBJECT: 'SUPPLIER' | 'CREDITOR'; KEY: ''; DATA: Record<string, Record<string, unknown>[]> };
export function buildTraderPayload(kind: TraderKind, input: CreateTraderInput) {
  const object = TRADER_OBJECT[kind];
  return { OBJECT: object, KEY: '' as const, DATA: { [object]: [traderRow(input)] } };
}

/** Builds the exact setData payload for a supplier create (also used for dry-run preview). */
export function buildSupplierPayload(input: CreateSupplierInput): { OBJECT: 'SUPPLIER'; KEY: ''; DATA: { SUPPLIER: Record<string, unknown>[] } } {
  return buildTraderPayload('supplier', input);
}

/**
 * Creates a new trader in SoftOne (setData on object SUPPLIER/CREDITOR → TRDR; the
 * SODTYPE is set by the object). Required fields beyond CODE/NAME carry schema
 * defaults. Returns the new TRDR id + the assigned CODE (read back from TRDR,
 * because `success: true` alone does not prove the row persisted).
 */
export async function softoneCreateTrader(
  kind: TraderKind,
  input: CreateTraderInput,
): Promise<{ trdr: number; code: string }> {
  const object = TRADER_OBJECT[kind];
  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>(
    'setData', buildTraderPayload(kind, input),
  );
  if (res.success === false || res.id == null) {
    throw new Error(res.error ?? `setData ${object} απέτυχε (code ${res.errorcode ?? '?'})`);
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

/** Creates a new supplier (SODTYPE=12). Thin wrapper over {@link softoneCreateTrader}. */
export async function softoneCreateSupplier(input: CreateSupplierInput): Promise<{ trdr: number; code: string }> {
  return softoneCreateTrader('supplier', input);
}

/** Creates a new creditor (SODTYPE=16) — object CREDITOR, ίδιο payload με SUPPLIER. */
export async function softoneCreateCreditor(input: CreateTraderInput): Promise<{ trdr: number; code: string }> {
  return softoneCreateTrader('creditor', input);
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
  // Lookup stays strict: only πελάτης (13) and προμηθευτής (12) — χρεώστες/πιστωτές
  // would just create noise here.
  return {
    afm: clean,
    customers: rows.filter((o) => Number(o.SODTYPE) === 13).map(mapTrdr),
    suppliers: rows.filter((o) => Number(o.SODTYPE) === 12).map(mapTrdr),
  };
}

/**
 * Lean lookup of a single vendor by ΑΦΜ, without the SODTYPE — kept for existing
 * callers; new code should use {@link softoneFindTraderByAfm}.
 */
export async function softoneFindSupplierByAfm(
  afm: string,
): Promise<{ trdr: number; code: string; name: string; kind: string } | null> {
  const m = await softoneFindTraderByAfm(afm);
  return m ? { trdr: m.trdr, code: m.code, name: m.name, kind: m.kind } : null;
}

export interface TraderLookupRow {
  trdr: number;
  code: string;
  name: string;
  /** Προμηθευτής / Πιστωτής (από το SODTYPE). */
  kind: string;
  sodtype: number;
}

/**
 * Looks up a single issuer by ΑΦΜ across προμηθευτές (12) and πιστωτές (16),
 * preferring a formal supplier when the ΑΦΜ exists as both. Used by the OCR
 * pipeline to tag scanned documents with their SoftOne trader.
 */
export async function softoneFindTraderByAfm(afm: string): Promise<TraderLookupRow | null> {
  const clean = String(afm).replace(/[^0-9A-Za-z]/g, '');
  if (!clean) return null;
  const rows = await softoneGetTable(
    'TRDR', ['TRDR', 'CODE', 'NAME', 'SODTYPE'],
    `AFM='${clean}' AND SODTYPE IN (${SUPPLIER_SODTYPES.join(',')})`,
  );
  const valid = rows.filter((o) => Number.isFinite(Number(o.TRDR)));
  if (valid.length === 0) return null;
  // SUPPLIER_SODTYPES is ordered 12 → 16, so its index is the preference order.
  const pref: readonly number[] = SUPPLIER_SODTYPES;
  valid.sort((a, b) => pref.indexOf(Number(a.SODTYPE)) - pref.indexOf(Number(b.SODTYPE)));
  const r = valid[0];
  const sodtype = Number(r.SODTYPE);
  return {
    trdr: Number(r.TRDR), code: r.CODE, name: r.NAME, sodtype,
    kind: SODTYPE_LABEL[sodtype] ?? `Τύπος ${sodtype}`,
  };
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

// ============================================================
// Έξοδα — object EXPENSES (EditMaster) → πίνακας EXPN
// ============================================================

export interface ExpenseRow {
  /** EXPN (Smallint) — το κλειδί του εξόδου. */
  expn: number;
  /** CODE — «Σύντμηση» (max 15 χαρακτήρες). */
  code: string;
  /** NAME — «Περιγραφή» (max 50 χαρακτήρες). */
  name: string;
  /** VAT — κωδικός κατηγορίας ΦΠΑ (προαιρετικό στο SoftOne). */
  vat: string | null;
  isActive: boolean;
}

// Πεδία του EXPN που καθρεφτίζουμε τοπικά (επαληθευμένα στο schema του object EXPENSES).
const EXPN_FIELDS = ['EXPN', 'CODE', 'NAME', 'VAT', 'ISACTIVE'];

function mapExpense(o: Record<string, string>): ExpenseRow {
  return {
    expn: Number(o.EXPN),
    code: o.CODE,
    name: o.NAME,
    vat: idOrNull(o.VAT),
    isActive: o.ISACTIVE !== '0',
  };
}

/** Reads the active expenses registry from SoftOne (EXPN, ISACTIVE=1) via GetTable. */
export async function softoneFetchExpenses(): Promise<ExpenseRow[]> {
  const rows = await softoneGetTable('EXPN', EXPN_FIELDS, 'ISACTIVE=1');
  return rows.map(mapExpense).filter((r) => Number.isFinite(r.expn));
}

/**
 * Required flag fields of EXPN. SoftOne rejects an insert without them, and the
 * correct values are installation-specific — so they are copied from an existing
 * expense (read-before-write) instead of being guessed.
 */
export const EXPENSE_FLAG_FIELDS = [
  'CLCMD', 'INCLMD', 'VATMODE', 'ISSTOCK', 'STOCKMD', 'SOVAL', 'INVOICEFLAG', 'KEPYOFLAG',
] as const;

/** Σχεδιαστικές προεπιλογές του object EXPENSES — μόνο ως δίχτυ όταν λείπει πεδίο από το πρότυπο. */
const EXPENSE_FLAG_DEFAULTS: Record<string, unknown> = {
  CLCMD: 0, INCLMD: 0, VATMODE: 0, ISSTOCK: 0, STOCKMD: 0, SOVAL: 0, INVOICEFLAG: 1, KEPYOFLAG: 1,
};

export interface ExpenseTemplate {
  /** Το EXPN της εγγραφής από την οποία αντιγράφηκαν τα flags (για audit/log). */
  expn: number | null;
  flags: Record<string, unknown>;
}

/**
 * Read-before-write: διαβάζει ένα υπάρχον ενεργό έξοδο (getData στο object EXPENSES)
 * και επιστρέφει τα required flags του, ώστε η δημιουργία νέου εξόδου να κληρονομεί
 * τις ρυθμίσεις της εγκατάστασης αντί για μαντεψιές.
 */
export async function softoneLoadExpenseTemplate(templateExpn?: number | null): Promise<ExpenseTemplate> {
  let key = Number(templateExpn);
  if (!Number.isFinite(key) || key <= 0) {
    const rows = await softoneGetTable('EXPN', ['EXPN'], 'ISACTIVE=1');
    const first = rows.map((r) => Number(r.EXPN)).filter((n) => Number.isFinite(n) && n > 0)[0];
    if (!first) return { expn: null, flags: { ...EXPENSE_FLAG_DEFAULTS } };
    key = first;
  }
  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; data?: Record<string, unknown> }>(
    'getData',
    { OBJECT: 'EXPENSES', KEY: String(key), LOCATEINFO: `EXPN:${EXPENSE_FLAG_FIELDS.join(',')}` },
  );
  if (res.success === false) {
    throw new Error(res.error ?? `getData EXPENSES ${key} απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  // Η απάντηση έρχεται ως { data: { EXPN: [ {…} ] } } — κρατάμε τον πρώτο πίνακα με γραμμές.
  const tables = (res.data ?? {}) as Record<string, unknown>;
  const rows = (tables.EXPN ?? tables.EXPENSES ?? Object.values(tables).find(Array.isArray)) as
    | Record<string, unknown>[]
    | undefined;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  const flags: Record<string, unknown> = { ...EXPENSE_FLAG_DEFAULTS };
  for (const f of EXPENSE_FLAG_FIELDS) {
    const v = row?.[f];
    if (v != null && String(v).trim() !== '') flags[f] = v;
  }
  return { expn: key, flags };
}

export interface CreateExpenseInput {
  code: string;
  name: string;
  vat?: string | null;
  /** Προαιρετικό «πρότυπο» έξοδο από το οποίο αντιγράφονται τα flags. */
  templateExpn?: number | null;
}

/** Builds the exact setData payload for an expense create (also used for dry-run preview). */
export function buildExpensePayload(
  input: CreateExpenseInput,
  flags: Record<string, unknown>,
): { OBJECT: 'EXPENSES'; KEY: ''; DATA: { EXPENSES: Record<string, unknown>[] } } {
  const row: Record<string, unknown> = {
    CODE: input.code,
    NAME: input.name,
    ISACTIVE: 1,
    ...flags,
  };
  if (input.vat) row.VAT = input.vat;
  return { OBJECT: 'EXPENSES', KEY: '', DATA: { EXPENSES: [row] } };
}

/**
 * Creates a new expense in SoftOne (setData on object EXPENSES → EXPN). The
 * required flag fields are copied from an existing expense first (read-before-write)
 * and the new row is read back, because `success: true` alone does not prove it
 * persisted. Returns the new EXPN + the template row that was copied.
 */
export async function softoneCreateExpense(
  input: CreateExpenseInput,
): Promise<{ expn: number; code: string; name: string; templateExpn: number | null }> {
  const template = await softoneLoadExpenseTemplate(input.templateExpn);
  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>(
    'setData', buildExpensePayload(input, template.flags),
  );
  if (res.success === false || res.id == null) {
    throw new Error(res.error ?? `setData EXPENSES απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  const expn = Number(res.id);
  // Read back — «success: true» δεν σημαίνει ότι γράφτηκε.
  const back = await softoneGetTable('EXPN', EXPN_FIELDS, `EXPN=${expn}`);
  const row = back[0];
  if (!row || !Number.isFinite(Number(row.EXPN))) {
    throw new Error(`Το έξοδο ${expn} δεν βρέθηκε μετά τη δημιουργία (setData EXPENSES)`);
  }
  return { expn, code: row.CODE, name: row.NAME, templateExpn: template.expn };
}
