import 'server-only';
import iconv from 'iconv-lite';
import { gunzipSync } from 'node:zlib';
import { getSetting, setSetting } from '@/lib/settings';
import { validCoords } from '@/lib/coords';
import { normalizeDocRef } from '@/lib/doc-reference';
import {
  parseTaxOfficesResponse, TAX_OFFICE_FIELDS, irsDataKeyError,
  type TaxOffice, type GetTableTaxOfficesResponse,
} from '@/lib/tax-office';
import { nextTraderCode, type NextCodeResult } from '@/lib/trader-code';
import { proposeItemCode, type ItemCodeKind, type ItemCodeProposal } from '@/lib/item-code';

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

/**
 * Αποτυχία που ΑΝΗΚΕΙ στο SoftOne: δίκτυο, μη-JSON απάντηση, ή `success:false` από υπηρεσία.
 *
 * Υπάρχει για να μη χρεώνεται ο ERP σφάλματα που δεν είναι δικά του: ένα `502 softone_error`
 * πάνω από μια αποτυχία της ΤΟΠΙΚΗΣ βάσης στέλνει τον διαχειριστή να ψάξει λάθος σύστημα.
 * Ό,τι φεύγει από αυτό το αρχείο ως σφάλμα επικοινωνίας με τον ERP είναι `SoftoneError`·
 * οτιδήποτε άλλο σκάσει μέσα σε έναν συγχρονισμό (Prisma, transaction timeout) μένει σκέτο
 * `Error` και αναγνωρίζεται ως τοπικό.
 */
export class SoftoneError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SoftoneError';
  }
}

/** Λείπουν ρυθμίσεις σύνδεσης — ούτε ο ERP φταίει, ούτε η βάση: η διαμόρφωση. */
export class SoftoneConfigError extends SoftoneError {
  constructor(message: string) {
    super(message);
    this.name = 'SoftoneConfigError';
  }
}

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
    throw new SoftoneConfigError(`Λείπουν ρυθμίσεις SoftOne: ${missing.join(', ')}`);
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
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch (e) {
    // Δίκτυο/DNS/TLS: το SoftOne δεν απάντησε καν. Τυποποιείται, για να μην μπερδευτεί
    // αργότερα με αποτυχία της τοπικής βάσης.
    throw new SoftoneError(`Το SoftOne δεν απάντησε (${(e as Error).message})`, { cause: e });
  }

  // Always ArrayBuffer — res.text()/res.json() assume UTF-8 and corrupt Greek.
  let buf = Buffer.from(await res.arrayBuffer());
  if (res.headers.get('content-encoding') === 'gzip') {
    // Some hosts/proxies auto-decompress; guard with the gzip magic bytes.
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = Buffer.from(gunzipSync(buf));
  }
  const text = iconv.decode(buf, 'win1253');
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // Απάντηση που δεν είναι JSON (HTML σφάλματος από proxy, άδειο σώμα κ.λπ.).
    throw new SoftoneError(
      `Μη αναγνώσιμη απάντηση SoftOne (HTTP ${res.status}): ${text.slice(0, 200)}`,
      { cause: e },
    );
  }
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

/**
 * Πετάει το token ΚΑΙ από τη μνήμη ΚΑΙ από το `AppSetting` — και περιμένει να γραφτεί.
 *
 * Δεν επιτρέπεται να είναι «fire-and-forget»: το `softoneGetToken` πέφτει πίσω στο persisted
 * αντίγραφο, οπότε ένα αίτημα που θα έπεφτε μέσα στο παράθυρο (ή οποιοδήποτε άλλο instance)
 * θα ξανα-υιοθετούσε το ΙΔΙΟ `clientID`, δεμένο στην προηγούμενη εταιρία. Ο caller περιμένει
 * το `await` πριν συνεχίσει· αν η γραφή αποτύχει, το σφάλμα ΔΕΝ καταπίνεται — ο καθαρισμός
 * είναι το νόημα της κλήσης, και μια σιωπηλή αποτυχία είναι ακριβώς το bug που διορθώνουμε.
 */
export async function clearCachedToken(): Promise<void> {
  cachedToken = null;
  await setSetting(TOKEN_CACHE_KEY, null);
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
    throw new SoftoneError(`SoftOne login απέτυχε: ${login.error ?? 'άγνωστο σφάλμα'}`);
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
    throw new SoftoneError(`SoftOne authenticate απέτυχε: ${auth.error ?? 'άγνωστο σφάλμα'}`);
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
    await clearCachedToken();
    const fresh = await softoneGetToken(true);
    data = await run(fresh);
  }
  return data;
}

/**
 * Επίσημη υπηρεσία `getData`: διαβάζει ΕΝΑ record ενός business object (OBJECT + KEY) και επιστρέφει
 * τους πίνακές του (`{ PURDOC: [...], ITELINES: [...] }`). Υπάρχει για το read-back μετά από `setData`:
 * το SoftOne απαντά `success:true` και όταν δεν έχει γράψει, οπότε η μόνη απόδειξη είναι μια ανάγνωση.
 * `locateInfo` περιορίζει τα πεδία (μορφή `ΠΙΝΑΚΑΣ:ΠΕΔΙΟ,ΠΕΔΙΟ`), όπως το ζητά η υπηρεσία.
 */
export async function softoneGetData(
  object: string,
  key: string | number,
  locateInfo?: string,
): Promise<Record<string, Record<string, unknown>[]>> {
  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; data?: Record<string, unknown> }>(
    'getData',
    { OBJECT: object, KEY: String(key), ...(locateInfo ? { LOCATEINFO: locateInfo } : {}) },
  );
  if (res.success === false) {
    throw new SoftoneError(res.error ?? `getData ${object} ${key} απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  const tables = (res.data ?? {}) as Record<string, unknown>;
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(tables)) {
    if (Array.isArray(rows)) out[name] = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  }
  return out;
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
    throw new SoftoneError(`getBrowserInfo ${object} απέτυχε: ${info.error ?? `code ${info.errorcode ?? '?'}`}`);
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
    throw new SoftoneError(`GetTable ${table} απέτυχε: ${res.error ?? `code ${res.errorcode ?? '?'}`}`);
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
/**
 * SODTYPEs ενός συναλλασσομένου που μπορεί να ΕΚΔΩΣΕΙ παραστατικό προς εμάς: προμηθευτής (12),
 * πιστωτής (16), χρεώστης (15). Η ΣΕΙΡΑ ΕΙΝΑΙ ΣΗΜΑΣΙΟΛΟΓΙΚΗ — είναι η σειρά προτίμησης όταν το
 * ίδιο ΑΦΜ υπάρχει ως περισσότεροι από έναν τύποι ({@link softoneFindTraderByAfm}). Ο χρεώστης
 * μπήκε ΤΕΛΕΥΤΑΙΟΣ σκόπιμα: κανένα έγγραφο που σήμερα λύνεται σε προμηθευτή ή πιστωτή δεν αλλάζει
 * αντιστοίχιση — προστίθεται μόνο η περίπτωση «υπάρχει ΜΟΝΟ ως χρεώστης», που πριν έβγαινε κενή.
 */
export const ISSUER_SODTYPES = [12, 16, 15] as const;

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
  /** MYDATACODE — ο χαρακτηρισμός myDATA που κουβαλά ΤΟ ΜΗΤΡΩΟ (όχι η γραμμή παραστατικού). */
  myDataCode: string | null;
}

const MTRL_FIELDS = ['MTRL', 'CODE', 'CODE1', 'CODE2', 'NAME', 'NAME1', 'PRICER', 'SODTYPE', 'ISACTIVE', 'MYDATACODE'];

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
    myDataCode: idOrNull(o.MYDATACODE),
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

/** Η αναφορά του εκδότη, όπως θα γραφόταν στην κεφαλίδα — το ίδιο τρίπτυχο με την καταχώριση. */
export type PurchaseDocRef = {
  /** Ο τυπωμένος αριθμός, χωρίς πρόθεμα (`TAXSERIESNUM`). */
  number: string | null;
  /** Η πλήρης τυπωμένη ταυτότητα (`FINCODE`, π.χ. «ΤΠΥ 17»). */
  fincode?: string | null;
};

/**
 * Υπάρχει ΗΔΗ παραστατικό αυτού του προμηθευτή στο SoftOne; Το ψάχνουμε με TRDR (+ ημερομηνία)
 * και συγκρίνουμε ΜΟΝΟ τα ΦΟΡΟΛΟΓΙΚΑ πεδία — `TAXSERIESNUM` («Φορ/κός αριθμός») και `FINCODE`
 * («Παραστατικό»), δηλαδή ΑΚΡΙΒΩΣ εκεί που γράφει η καταχώριση τον αριθμό του εκδότη.
 *
 * Το `SERIESNUM` ΔΕΝ συγκρίνεται πια: είναι ο ΔΙΚΟΣ ΜΑΣ αύξων μέσα στη σειρά, οπότε ένα τιμολόγιο
 * προμηθευτή με αριθμό «1» «ταίριαζε» με κάθε πρώτο παραστατικό της σειράς και έβγαζε ψεύτικη
 * προειδοποίηση διπλοεγγραφής. Για τον ίδιο λόγο η χαλαρή σύγκριση (περιέχει) ισχύει μόνο από
 * 3 χαρακτήρες και πάνω· κάτω από αυτό θέλουμε ακριβή ταύτιση.
 *
 * Προειδοποιητικό, ποτέ αποτρεπτικό: επιστρέφει την αναφορά του υπάρχοντος παραστατικού.
 */
export async function softoneCheckPurchaseDoc(
  trdr: number,
  ref: PurchaseDocRef,
  dateISO?: string | null,
): Promise<{ exists: boolean; ref: string | null }> {
  const n = normalizeDocRef(ref.number ?? '');
  if (!Number.isFinite(trdr) || !n) return { exists: false, ref: null };
  // Και οι δύο γραφές που μπορεί να έχει το υπάρχον παραστατικό: σκέτος αριθμός ή πλήρης ταυτότητα.
  const wanted = new Set([n, normalizeDocRef(ref.fincode ?? '')].filter(Boolean));

  // Η ημερομηνία θέλει ΕΙΣΑΓΩΓΙΚΑ. Χωρίς αυτά το `TRNDATE=2026-05-01` δεν ταιριάζει ΚΑΜΙΑ γραμμή
  // (επαληθεύτηκε live: ίδιο φίλτρο με εισαγωγικά επιστρέφει το παραστατικό, χωρίς επιστρέφει 0) —
  // δηλαδή ο έλεγχος απαντούσε σιωπηλά «δεν υπάρχει διπλοεγγραφή» για ΚΑΘΕ έγγραφο με ημερομηνία.
  // Δεχόμαστε μόνο αυστηρό `YYYY-MM-DD`: η ημερομηνία έρχεται από OCR και μπαίνει σε φίλτρο.
  const raw = dateISO ? String(dateISO).slice(0, 10) : '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  // ΜΟΝΟ οι ενότητες στις οποίες καταχωρίζουμε: αγορές, ειδικές προμηθευτών/χρεωστών/πιστωτών.
  // Αφιλτράριστο, το ερώτημα φτάνει και σε παραστατικά ΠΩΛΗΣΕΩΝ, όπου ο «Φορ/κός αριθμός» είναι
  // πάντα ένας μικρός ακέραιος ίσος με τον αύξοντα — έτοιμο ψευδώς θετικό.
  const scope = 'SOSOURCE IN (1251,1253,1553,1653)';
  const filter = day
    ? `TRDR=${trdr} AND ${scope} AND TRNDATE='${day}'`
    : `TRDR=${trdr} AND ${scope}`;

  let rows: Array<Record<string, string>>;
  try {
    rows = await softoneGetTable('FINDOC', ['FINDOC', 'FINCODE', 'TAXSERIES', 'TAXSERIESNUM', 'TRNDATE'], filter);
  } catch {
    return { exists: false, ref: null };
  }

  const loose = n.length >= 3;
  for (const r of rows) {
    const fincode = normalizeDocRef(r.FINCODE);
    const taxnum = normalizeDocRef(r.TAXSERIESNUM);
    const hit =
      (fincode !== '' && (wanted.has(fincode) || (loose && fincode.includes(n)))) ||
      (taxnum !== '' && (wanted.has(taxnum) || (loose && taxnum.includes(n))));
    if (hit) {
      return {
        exists: true,
        ref: r.FINCODE || [r.TAXSERIES, r.TAXSERIESNUM].filter(Boolean).join(' ') || `FINDOC ${r.FINDOC}`,
      };
    }
  }
  return { exists: false, ref: null };
}

export interface CreateItemInput {
  code: string;
  name: string;
  isService: boolean;
  vat: string;          // VAT code (smallint as string)
  unit: string;         // MTRUNIT id (smallint as string)
  /**
   * Τιμή **ΧΟΝΔΡΙΚΗΣ** (καθαρή, χωρίς ΦΠΑ) → `ITEM.PRICEW`. Αυτή είναι η τιμή που κουβαλά μια
   * γραμμή τιμολογίου ΑΓΟΡΑΣ: κόστος. Είναι και η ΜΟΝΗ τιμή που ξέρουμε.
   */
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

export type LookupRow = { kind: string; code: string; name: string };

export type LookupFetchResult = {
  rows: LookupRow[];
  /**
   * Βοηθητικοί πίνακες που ΔΕΝ απάντησαν (η `GetTable` πέταξε). ΔΕΝ είναι το ίδιο με «άδειος»:
   * μια εγκατάσταση μπορεί κάλλιστα να μην έχει μάρκες. Ο καλών το χρειάζεται για να μην
   * καθαρίσει είδος που απλώς δεν μίλησε — μέχρι τώρα η αποτυχία καταπινόταν με `.catch(() => [])`
   * και ο συγχρονισμός έσβηνε ΟΛΟ το μητρώο του συγκεκριμένου πίνακα νομίζοντας ότι άδειασε.
   */
  failed: string[];
};

/** Fetches all aux/classification tables flat ({kind, code, name}) for the lookups sync. */
export async function softoneFetchLookups(): Promise<LookupFetchResult> {
  const out: LookupRow[] = [];
  const failed: string[] = [];
  // Aux tables are company-scoped → GetTable returns the same code per company.
  // Dedupe on (kind, code) to satisfy the unique constraint.
  const seen = new Set<string>();
  const add = (kind: string, code: string, name: string) => {
    if (!code || !name) return;
    const key = `${kind}\u0000${code}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, code, name });
  };

  // Scope to the configured company so we only get this company's rows.
  const cfg = await loadSoftoneConfig().catch(() => null);
  const companyFilter = cfg?.company ? ` AND COMPANY=${cfg.company}` : '';
  const onlyCompany = cfg?.company ? `COMPANY=${cfg.company}` : '';

  // Η αποτυχία ενός πίνακα δεν σταματάει τους υπόλοιπους — αλλά ΚΑΤΑΓΡΑΦΕΤΑΙ.
  const vats = await softoneGetTable('VAT', ['VAT', 'NAME', 'PERCNT'], `ISACTIVE=1${companyFilter}`)
    .catch(() => { failed.push('VAT'); return []; });
  for (const r of vats) add('VAT', String(r.VAT), `${cleanS1Label(r.NAME)} (${r.PERCNT}%)`);

  for (const table of LOOKUP_TABLES) {
    const rows = await softoneGetTable(table, [table, 'CODE', 'NAME'], onlyCompany)
      .catch(() => { failed.push(table); return []; });
    for (const r of rows) {
      // MTRUNIT keeps the label in CODE (NAME holds the company); the rest use NAME.
      const name = table === 'MTRUNIT'
        ? cleanS1Label(r.CODE)
        : (cleanS1Label(r.NAME) || cleanS1Label(r.CODE));
      add(table, String(r[table]), name);
    }
  }
  return { rows: out, failed };
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
  // ΜΟΝΟ χονδρική, όπως δόθηκε (δεν «βελτιώνουμε» αριθμό που έγραψε άνθρωπος).
  //
  // ΓΙΑΤΙ ΔΕΝ ΣΤΕΛΝΕΤΑΙ `PRICER`: η εφαρμογή καταχωρεί παραστατικά **αγορών, εξόδων και
  // παγίων** — δεν πουλά τίποτα. Τιμή λιανικής είναι **εμπορική απόφαση με περιθώριο**, όχι
  // αριθμητικό παράγωγο του κόστους· ένα `κόστος × (1 + ΦΠΑ)` θα έγραφε τιμή πώλησης με
  // **μηδενικό περιθώριο** και μάλιστα σαν να την είχε ορίσει άνθρωπος. Το `PRICER` είναι
  // `calculated: false` στο schema του `ITEM`, δηλαδή ό,τι στείλουμε **μένει** — λόγος
  // παραπάνω να μη στείλουμε τίποτα. Την τιμολόγηση την κάνει ο χρήστης μέσα στο SoftOne.
  if (input.price != null) row.PRICEW = input.price;
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
    throw new SoftoneError(res.error ?? `setData ITEM απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  // Ο κωδικός ΕΠΙΑΣΕ θέση τη στιγμή που πέτυχε το setData: η cached λίστα (60s) θα τον έδινε
  // ξανά ως ελεύθερο στην επόμενη πρόταση. Ίδια φροντίδα με τον συναλλασσόμενο.
  clearItemCodeCache(input.isService ? 'service' : 'product');
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

/**
 * Διαβάζει το μητρώο Δ.Ο.Υ. του SoftOne (πίνακας IRSDATA): κλειδί, **κωδικός ΑΑΔΕ** (`CODE`),
 * ονομασία, ενεργή. Μόνο ΑΝΑΓΝΩΣΗ. Η ανάλυση γίνεται **κατά όνομα στήλης** από το `model`
 * ({@link parseTaxOfficesResponse}) — ποτέ κατά θέση. Η αντιστοίχιση ΑΑΔΕ → IRSDATA γίνεται στο
 * `lib/tax-office.ts` ({@link resolveTaxOffice}), με κωδικό.
 */
export async function softoneFetchTaxOffices(): Promise<TaxOffice[]> {
  const res = await softoneCall<GetTableTaxOfficesResponse>(
    'GetTable', { TABLE: 'IRSDATA', FIELDS: TAX_OFFICE_FIELDS.join(','), FILTER: '' },
  );
  try {
    return parseTaxOfficesResponse(res);
  } catch (e) {
    throw new SoftoneError((e as Error).message);
  }
}

/**
 * Το κλειδί IRSDATA που θα γραφτεί στο `TRDR.IRSDATA` — υπάρχει και είναι ενεργό; `null` = εντάξει
 * (ή δεν ζητήθηκε Δ.Ο.Υ.), αλλιώς το μήνυμα για 422 `invalid_doy`. Αν το μητρώο δεν διαβαστεί, ΔΕΝ
 * μπλοκάρει: η τιμή προήλθε από λίστα που διάβασε το ίδιο το SoftOne.
 */
export async function softoneIrsDataError(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const offices = await softoneFetchTaxOffices().catch(() => null);
  return offices ? irsDataKeyError(key, offices) : null;
}

/** Γραμμή του μητρώου χωρών του SoftOne (object/table COUNTRY). */
export interface SoftoneCountry {
  /** `COUNTRY.COUNTRY` — το αριθμητικό id που γράφεται στο `TRDR.COUNTRY`. */
  id: string;
  /** `SHORTCUT` — σύντμηση (συνήθως ο ISO-2 κωδικός). */
  shortcut: string;
  name: string;
  /** `INTCODE` — κωδικός Intrastat (ISO-2 στις χώρες ΕΕ). */
  intcode: string;
  /** `INTERCODE` — «Διεθνής κωδικός». */
  intercode: string;
}

/** Πεδία που ζητάμε από τον πίνακα COUNTRY (cached schema: EditMaster «Χώρες»). */
const COUNTRY_FIELDS = ['COUNTRY', 'SHORTCUT', 'NAME', 'INTCODE', 'INTERCODE'];

/** Το μητρώο χωρών αλλάζει ~ποτέ: το κρατάμε in-process για μια ημέρα. */
const COUNTRY_TTL_MS = 24 * 60 * 60 * 1000;
let countryCache: { at: number; rows: SoftoneCountry[] } | null = null;

/** Καθαρίζει το cache χωρών (χρήσιμο σε δοκιμές / μετά από αλλαγή εγκατάστασης). */
export function clearCountryCache(): void {
  countryCache = null;
}

/**
 * Διαβάζει το μητρώο χωρών του SoftOne (COUNTRY). Cached 24h στη διεργασία —
 * μια δημιουργία συναλλασσομένου δεν πρέπει να κοστίζει έξτρα GetTable.
 */
export async function softoneFetchCountries(): Promise<SoftoneCountry[]> {
  if (countryCache && Date.now() - countryCache.at < COUNTRY_TTL_MS) return countryCache.rows;
  const rows = await softoneGetTable('COUNTRY', COUNTRY_FIELDS, '');
  const mapped = rows
    .map((r) => ({
      id: str(r.COUNTRY),
      shortcut: str(r.SHORTCUT).toUpperCase(),
      name: cleanS1Label(r.NAME),
      intcode: str(r.INTCODE).toUpperCase(),
      intercode: str(r.INTERCODE).toUpperCase(),
    }))
    .filter((r) => r.id);
  countryCache = { at: Date.now(), rows: mapped };
  return mapped;
}

/**
 * ISO-2 → `COUNTRY.COUNTRY` id. Δοκιμάζει με τη σειρά SHORTCUT, INTCODE και
 * INTERCODE, γιατί η εγκατάσταση μπορεί να κρατά τον ISO κωδικό σε οποιοδήποτε
 * από τα τρία. `null` όταν δεν βρεθεί (ο καλών παραλείπει το πεδίο).
 */
export function matchCountryId(
  iso2: string | null | undefined,
  countries: SoftoneCountry[],
): string | null {
  const target = String(iso2 ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(target)) return null;
  for (const key of ['shortcut', 'intcode', 'intercode'] as const) {
    const hit = countries.find((c) => c[key] === target);
    if (hit) return hit.id;
  }
  return null;
}

export interface CreateSupplierInput {
  name: string;
  afm: string;
  code?: string | null;        // empty → SoftOne auto-numbering
  /**
   * Δ.Ο.Υ. → `TRDR.IRSDATA`: το **κλειδί** `IRSDATA.IRSDATA` της γραμμής του μητρώου (το πεδίο της
   * καρτέλας είναι selector με editor `IRSDATA`), ΟΧΙ ο κωδικός ΑΑΔΕ (`IRSDATA.CODE`). Στον τρέχοντα
   * πελάτη συμπίπτουν· σε άλλη εγκατάσταση μπορεί όχι. Βγαίνει από το `resolveTaxOffice`.
   */
  irsData?: string | null;
  profession?: string | null;  // JOBTYPETRD
  address?: string | null;
  zip?: string | null;
  city?: string | null;
  phone?: string | null;      // PHONE01
  email?: string | null;      // EMAIL
  /**
   * ISO-3166-1 alpha-2 της χώρας έδρας (π.χ. «CY»). Μεταφράζεται σε
   * `TRDR.COUNTRY` (αριθμητικό FK στον πίνακα COUNTRY) με το μητρώο που περνά ο
   * καλών — δες {@link softoneFetchCountries}. Άγνωστος κωδικός ⇒ το πεδίο
   * παραλείπεται και ο καλών ειδοποιείται (`country_not_found`).
   */
  country?: string | null;
  /**
   * Γεωγραφικό πλάτος / μήκος της έδρας → `TRDR.LATITUDE` / `TRDR.LONGITUDE`
   * («Γεωγραφικό πλάτος» / «Γεωγραφικό μήκος», Float — υπάρχουν και στα τρία
   * objects SUPPLIER/CREDITOR/DEBTOR, ίδιος πίνακας TRDR).
   *
   * ΑΓΝΩΣΤΟ ΣΗΜΑΙΝΕΙ ΠΑΡΑΛΕΙΨΗ, ΟΧΙ ΜΗΔΕΝ: το (0,0) είναι υπαρκτό σημείο στον
   * Ατλαντικό και δεν επιτρέπεται να γραφεί ως «δεν ξέρουμε».
   */
  latitude?: number | null;
  longitude?: number | null;
}
/**
 * Το SoftOne αρνήθηκε τη δημιουργία επειδή ΛΕΙΠΕΙ ο κωδικός;
 *
 * Επιβεβαιωμένο ζωντανά (dev tenant, 2026-09-16): `setData` σε object `CREDITOR`
 * χωρίς `CODE` γυρίζει «Δεν έχετε συμπληρώσει το πεδίο 'Κωδικός'» και ΔΕΝ δημιουργεί
 * τίποτα. Αναγνωρίζουμε ακριβώς αυτό το μήνυμα (ελληνικά ή αγγλικά) ώστε το UI να
 * δείξει το σφάλμα ΠΑΝΩ στο πεδίο «Κωδικός» αντί για γενικό banner.
 *
 * Σκόπιμα ΣΤΕΝΟ: ένα άλλο υποχρεωτικό πεδίο δεν πρέπει να περάσει για «κωδικός».
 */
export function isMissingCodeError(message: unknown): boolean {
  const m = String(message ?? '');
  if (!m) return false;
  const mentionsCode = /Κωδικ[όο]ς?/i.test(m) || /\bcode\b/i.test(m);
  if (!mentionsCode) return false;
  return /δεν\s+[έε]χετε\s+συμπληρ[ωώ]σει/i.test(m)
    || /συμπληρ[ωώ]στε/i.test(m)
    || /(is\s+)?(required|mandatory|not\s+(filled|specified))/i.test(m);
}

/**
 * Το SoftOne αρνήθηκε επειδή ο κωδικός **υπάρχει ήδη**;
 *
 * ΠΡΟΣΟΧΗ: σε αντίθεση με το {@link isMissingCodeError}, το ακριβές μήνυμα ΔΕΝ έχει
 * παρατηρηθεί ζωντανά σε αυτή την εγκατάσταση — καλύπτουμε τις συνήθεις διατυπώσεις.
 * Αν δεν αναγνωριστεί, η αποτυχία απλώς παραμένει γενικό σφάλμα SoftOne: δεν
 * δημιουργείται τίποτα σε καμία περίπτωση.
 */
export function isDuplicateCodeError(message: unknown): boolean {
  const m = String(message ?? '');
  if (!m) return false;
  const mentionsCode = /Κωδικ[όο]ς?/i.test(m) || /\bcode\b/i.test(m);
  if (!mentionsCode) return false;
  return /υπ[άα]ρχει\s+[ήη]δη/i.test(m)
    || /[ήη]δη\s+υπ[άα]ρχει/i.test(m)
    || /διπλ[όο]/i.test(m)
    || /duplicate|already\s+exists/i.test(m);
}

/** Πόσο κρατά η λίστα κωδικών ανά μητρώο — αρκετά για μια συνεδρία, όχι για μια μέρα. */
const CODES_TTL_MS = 60_000;
/**
 * Ένα cache για ΟΛΑ τα μητρώα κωδικών, με κλειδί «οικογένεια:τύπος» (`trader:creditor`,
 * `item:service`). Χωριστά Map ανά οικογένεια θα ήταν ο ίδιος κώδικας δύο φορές — και δύο
 * ευκαιρίες να ξεχαστεί το καθάρισμα μετά από δημιουργία.
 */
const codeCache = new Map<string, { at: number; codes: string[] }>();

/** Οι κωδικοί ενός μητρώου, με 60s cache. `loader` τρέχει μόνο σε αστοχία. */
async function cachedCodes(key: string, loader: () => Promise<string[]>): Promise<string[]> {
  const hit = codeCache.get(key);
  if (hit && Date.now() - hit.at < CODES_TTL_MS) return hit.codes;
  const codes = await loader();
  codeCache.set(key, { at: Date.now(), codes });
  return codes;
}

const traderCacheKey = (kind: TraderKind) => `trader:${kind}`;
const itemCacheKey = (kind: ItemCodeKind) => `item:${kind}`;

/** Καθαρίζει το cache κωδικών συναλλασσομένων (δοκιμές / μετά από δημιουργία). */
export function clearTraderCodeCache(kind?: TraderKind): void {
  if (kind) codeCache.delete(traderCacheKey(kind));
  else for (const k of codeCache.keys()) if (k.startsWith('trader:')) codeCache.delete(k);
}

/** Καθαρίζει το cache κωδικών ειδών/εξόδων/χρεοπιστώσεων (δοκιμές / μετά από δημιουργία). */
export function clearItemCodeCache(kind?: ItemCodeKind): void {
  if (kind) codeCache.delete(itemCacheKey(kind));
  else for (const k of codeCache.keys()) if (k.startsWith('item:')) codeCache.delete(k);
}

/**
 * ΟΛΟΙ οι κωδικοί συναλλασσομένων ενός τύπου, από το ίδιο το SoftOne (read-only
 * `GetTable` στον `TRDR`, φιλτραρισμένο στο SODTYPE του τύπου).
 *
 * Ο τοπικός καθρέφτης μπορεί να είναι παλιός — και ένας κωδικός που δόθηκε στο
 * μεσοδιάστημα από άλλον χρήστη θα οδηγούσε σε πρόταση που θα απορριφθεί. Το
 * αποτέλεσμα κρατιέται 60 δευτερόλεπτα: φρέσκο όσο χρειάζεται, χωρίς ένα GetTable
 * ανά πάτημα πλήκτρου.
 */
export async function softoneFetchTraderCodes(kind: TraderKind): Promise<string[]> {
  return cachedCodes(traderCacheKey(kind), async () => {
    const rows = await softoneGetTable('TRDR', ['CODE'], `SODTYPE=${TRADER_KIND_SODTYPE[kind]}`);
    return rows.map((r) => str(r.CODE)).filter(Boolean);
  });
}

/**
 * Ο πίνακας και το φίλτρο κάθε μητρώου ειδών. Τα τρία `MTRL` ξεχωρίζουν ΜΟΝΟ με το SODTYPE
 * (51 είδη · 52 υπηρεσίες · 53 χρεοπιστώσεις)· τα έξοδα ζουν σε δικό τους πίνακα (`EXPN`).
 *
 * ΧΩΡΙΣ `ISACTIVE=1`: ένας κωδικός ανενεργής εγγραφής είναι ΠΙΑΣΜΕΝΟΣ — το SoftOne δεν τον
 * ξαναδίνει επειδή κάποιος την απενεργοποίησε. Εδώ ρωτάμε «τι είναι ελεύθερο», όχι «τι ισχύει».
 */
// Συνάρτηση και όχι σταθερό object: το `LINEITEM_SODTYPE` ορίζεται πιο κάτω στο αρχείο και ένα
// module-level literal εδώ θα το διάβαζε πριν αρχικοποιηθεί (TDZ).
const itemCodeSource = (kind: ItemCodeKind): { table: string; filter: string } => ({
  product: { table: 'MTRL', filter: 'SODTYPE=51' },
  service: { table: 'MTRL', filter: 'SODTYPE=52' },
  lineitem: { table: 'MTRL', filter: `SODTYPE=${LINEITEM_SODTYPE}` },
  expense: { table: 'EXPN', filter: '' },
}[kind]);

/**
 * ΟΛΟΙ οι κωδικοί ενός μητρώου ειδών, από το ίδιο το SoftOne (read-only `GetTable`).
 *
 * Ίδια φροντίδα με τους συναλλασσομένους: ο τοπικός καθρέφτης μπορεί να είναι παλιός και ένας
 * κωδικός που δόθηκε στο μεσοδιάστημα θα οδηγούσε σε πρόταση που θα απορριφθεί. 60s cache.
 */
export async function softoneFetchItemCodes(kind: ItemCodeKind): Promise<string[]> {
  return cachedCodes(itemCacheKey(kind), async () => {
    const src = itemCodeSource(kind);
    const rows = await softoneGetTable(src.table, ['CODE'], src.filter);
    return rows.map((r) => str(r.CODE)).filter(Boolean);
  });
}

/**
 * Η πρόταση κωδικού για νέα εγγραφή μητρώου ειδών, με **φρέσκα** δεδομένα από τον ERP.
 *
 * `fallbackCodes` (ο τοπικός καθρέφτης) χρησιμοποιείται ΜΟΝΟ όταν το SoftOne δεν απαντά — τότε
 * το αποτέλεσμα σημειώνεται `stale: true` και το UI το λέει: μπαγιάτικα δεδομένα ⇒ ο κωδικός
 * (ακόμη και ο κωδικός του προμηθευτή) μπορεί στην πραγματικότητα να έχει πιαστεί.
 */
export async function softoneNextItemCode(
  kind: ItemCodeKind,
  opts: { mask?: string | null; supplierCode?: string | null; fallbackCodes?: readonly string[] } = {},
): Promise<ItemCodeProposal & { stale: boolean }> {
  const rules = { supplierCode: opts.supplierCode ?? null, mask: opts.mask ?? null };
  try {
    const codes = await softoneFetchItemCodes(kind);
    return { ...proposeItemCode({ existing: codes, ...rules }), stale: false };
  } catch {
    return { ...proposeItemCode({ existing: opts.fallbackCodes ?? [], ...rules }), stale: true };
  }
}

/**
 * Ο επόμενος ελεύθερος κωδικός για έναν τύπο, με **φρέσκα** δεδομένα από τον ERP.
 *
 * `fallbackCodes` (ο τοπικός καθρέφτης) χρησιμοποιείται ΜΟΝΟ όταν το SoftOne δεν
 * απαντά — τότε το αποτέλεσμα σημειώνεται `stale: true` και το UI το λέει.
 */
export async function softoneNextTraderCode(
  kind: TraderKind,
  opts: { mask?: string | null; fallbackCodes?: readonly string[] } = {},
): Promise<NextCodeResult & { stale: boolean }> {
  try {
    const codes = await softoneFetchTraderCodes(kind);
    return { ...nextTraderCode(codes, { mask: opts.mask }), stale: false };
  } catch {
    return { ...nextTraderCode(opts.fallbackCodes ?? [], { mask: opts.mask }), stale: true };
  }
}

/**
 * Συναλλασσόμενος που εκδίδει παραστατικό προς εμάς: προμηθευτής (12), πιστωτής (16) ή
 * χρεώστης (15). Ένα object μητρώου ανά τύπο, όλα πάνω στον ΙΔΙΟ πίνακα TRDR.
 */
export type TraderKind = 'supplier' | 'creditor' | 'debtor';
/** Ίδια πεδία για SUPPLIER, CREDITOR και DEBTOR — το SODTYPE το θέτει το ίδιο το object. */
export type CreateTraderInput = CreateSupplierInput;

export type TraderObject = 'SUPPLIER' | 'CREDITOR' | 'DEBTOR';
const TRADER_OBJECT: Record<TraderKind, TraderObject> = {
  supplier: 'SUPPLIER', creditor: 'CREDITOR', debtor: 'DEBTOR',
};
/** SODTYPE που δίνει το κάθε object (για έλεγχο μετά την εγγραφή). */
export const TRADER_KIND_SODTYPE: Record<TraderKind, number> = { supplier: 12, creditor: 16, debtor: 15 };

function traderRow(input: CreateTraderInput, countries: SoftoneCountry[] = []): Record<string, unknown> {
  const row: Record<string, unknown> = {
    NAME: input.name,
    AFM: input.afm,
    ISACTIVE: 1,
  };
  // `TRDR.COUNTRY` είναι αριθμητικό FK: γράφεται ΜΟΝΟ όταν ο ISO-2 βρεθεί στο
  // μητρώο. Χωρίς μητρώο (κενή λίστα) το πεδίο μένει στην προεπιλογή του SoftOne.
  const countryId = matchCountryId(input.country, countries);
  if (countryId) row.COUNTRY = Number(countryId);
  if (input.code) row.CODE = input.code;
  if (input.irsData) row.IRSDATA = input.irsData;
  if (input.profession) row.JOBTYPETRD = input.profession;
  if (input.address) row.ADDRESS = input.address;
  if (input.zip) row.ZIP = input.zip;
  if (input.city) row.CITY = input.city;
  if (input.phone) row.PHONE01 = input.phone;
  if (input.email) row.EMAIL = input.email;
  // Συντεταγμένες: ή και τα δύο πεδία με έγκυρο ζεύγος, ή κανένα. Ποτέ «0 = άγνωστο».
  const coords = validCoords(input.latitude, input.longitude);
  if (coords) {
    row.LATITUDE = coords.lat;
    row.LONGITUDE = coords.lng;
  }
  return row;
}

/**
 * Builds the exact setData payload for a trader create (also used for dry-run preview).
 * All three objects write TRDR — SUPPLIER stamps SODTYPE=12, CREDITOR 16, DEBTOR 15.
 */
export function buildTraderPayload(kind: 'supplier', input: CreateTraderInput, countries?: SoftoneCountry[]): { OBJECT: 'SUPPLIER'; KEY: ''; DATA: { SUPPLIER: Record<string, unknown>[] } };
export function buildTraderPayload(kind: 'creditor', input: CreateTraderInput, countries?: SoftoneCountry[]): { OBJECT: 'CREDITOR'; KEY: ''; DATA: { CREDITOR: Record<string, unknown>[] } };
export function buildTraderPayload(kind: 'debtor', input: CreateTraderInput, countries?: SoftoneCountry[]): { OBJECT: 'DEBTOR'; KEY: ''; DATA: { DEBTOR: Record<string, unknown>[] } };
export function buildTraderPayload(kind: TraderKind, input: CreateTraderInput, countries?: SoftoneCountry[]): { OBJECT: TraderObject; KEY: ''; DATA: Record<string, Record<string, unknown>[]> };
export function buildTraderPayload(kind: TraderKind, input: CreateTraderInput, countries: SoftoneCountry[] = []) {
  const object = TRADER_OBJECT[kind];
  return { OBJECT: object, KEY: '' as const, DATA: { [object]: [traderRow(input, countries)] } };
}

/** Builds the exact setData payload for a supplier create (also used for dry-run preview). */
export function buildSupplierPayload(input: CreateSupplierInput): { OBJECT: 'SUPPLIER'; KEY: ''; DATA: { SUPPLIER: Record<string, unknown>[] } } {
  return buildTraderPayload('supplier', input);
}

/**
 * Creates a new trader in SoftOne (setData on object SUPPLIER/CREDITOR/DEBTOR → TRDR; the
 * SODTYPE is set by the object). Required fields beyond CODE/NAME carry schema
 * defaults. Returns the new TRDR id + the assigned CODE.
 *
 * `success: true` ΔΕΝ αποδεικνύει ότι η γραμμή έμεινε: διαβάζουμε ΠΑΝΤΑ πίσω τη
 * γραμμή του TRDR και επιβεβαιώνουμε ότι υπάρχει ΚΑΙ ότι το SODTYPE είναι αυτό που
 * αντιστοιχεί στο object — αλλιώς πετάμε (ο καλών δεν πρέπει να καθρεφτίσει φάντασμα).
 */
export async function softoneCreateTrader(
  kind: TraderKind,
  input: CreateTraderInput,
  countries: SoftoneCountry[] = [],
): Promise<{ trdr: number; code: string }> {
  const object = TRADER_OBJECT[kind];
  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>(
    'setData', buildTraderPayload(kind, input, countries),
  );
  if (res.success === false || res.id == null) {
    throw new SoftoneError(res.error ?? `setData ${object} απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  const trdr = Number(res.id);
  // Ο κωδικός ΕΠΙΑΣΕ θέση τη στιγμή που το setData πέτυχε — όχι όταν επιβεβαιωθεί.
  // Το καθάρισμα γίνεται εδώ, ΠΡΙΝ τον read-back: αν ο read-back πετάξει (δίκτυο,
  // λάθος SODTYPE), ο μόλις δεσμευμένος κωδικός θα έμενε στη μνήμη ως ελεύθερος
  // για έως 60s και η επόμενη πρόταση θα συγκρουόταν μαζί του.
  clearTraderCodeCache(kind);
  const back = await softoneGetTable('TRDR', ['TRDR', 'CODE', 'SODTYPE'], `TRDR=${trdr}`);
  const row = back.find((r) => Number(r.TRDR) === trdr) ?? back[0];
  const expected = TRADER_KIND_SODTYPE[kind];
  if (!row || Number(row.SODTYPE) !== expected) {
    throw new SoftoneError(
      `Η εγγραφή δεν επιβεβαιώθηκε στο SoftOne (TRDR ${trdr}, SODTYPE ${row?.SODTYPE ?? '—'} ≠ ${expected}).`,
    );
  }
  // Το CODE το επιβεβαιώνει η ίδια η γραμμή του TRDR, όχι η αίτησή μας.
  return { trdr, code: row.CODE || input.code || '' };
}

/** Creates a new supplier (SODTYPE=12). Thin wrapper over {@link softoneCreateTrader}. */
export async function softoneCreateSupplier(
  input: CreateSupplierInput,
  countries: SoftoneCountry[] = [],
): Promise<{ trdr: number; code: string }> {
  return softoneCreateTrader('supplier', input, countries);
}

/** Creates a new creditor (SODTYPE=16) — object CREDITOR, ίδιο payload με SUPPLIER. */
export async function softoneCreateCreditor(
  input: CreateTraderInput,
  countries: SoftoneCountry[] = [],
): Promise<{ trdr: number; code: string }> {
  return softoneCreateTrader('creditor', input, countries);
}

/** Creates a new debtor (SODTYPE=15) — object DEBTOR «Χρεώστες», ίδιο payload με SUPPLIER. */
export async function softoneCreateDebtor(
  input: CreateTraderInput,
  countries: SoftoneCountry[] = [],
): Promise<{ trdr: number; code: string }> {
  return softoneCreateTrader('debtor', input, countries);
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
 * Looks up a single issuer by ΑΦΜ across προμηθευτές (12), πιστωτές (16) and χρεώστες (15),
 * preferring a formal supplier, then a creditor, then a debtor when the ΑΦΜ exists as more than
 * one. Used by the OCR pipeline to tag scanned documents with their SoftOne trader.
 */
export async function softoneFindTraderByAfm(
  afm: string,
  opts: { prefer?: readonly number[] } = {},
): Promise<TraderLookupRow | null> {
  const clean = String(afm).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (!clean) return null;
  // Ένας ΞΕΝΟΣ εκδότης μπορεί να είναι ήδη καταχωρισμένος είτε με το πρόθεμα
  // χώρας («CY10123456A») είτε χωρίς («10123456A»): ρωτάμε και για τις δύο μορφές
  // και κρατάμε το πρώτο εύρημα.
  const bare = /^[A-Z]{2}[A-Z0-9]+$/.test(clean) ? clean.slice(2) : null;
  const variants = [clean, ...(bare ? [bare] : [])];
  const inList = variants.map((v) => `'${v}'`).join(',');
  const rows = await softoneGetTable(
    'TRDR', ['TRDR', 'CODE', 'NAME', 'SODTYPE'],
    `AFM IN (${inList}) AND SODTYPE IN (${ISSUER_SODTYPES.join(',')})`,
  );
  const valid = rows.filter((o) => Number.isFinite(Number(o.TRDR)));
  if (valid.length === 0) return null;
  // Η προτίμηση είναι ΡΗΤΗ όταν ο καλών ξέρει τι θέλει: η κεφαλίδα ενός `LINCREDOC` δέχεται
  // ΠΙΣΤΩΤΗ (16) και ενός `LINDEBDOC` ΧΡΕΩΣΤΗ (15), οπότε η προεπιλεγμένη προτίμηση «πρώτα
  // προμηθευτής» θα έδινε λάθος TRDR. Χωρίς `prefer`, η σειρά του ISSUER_SODTYPES (12 → 16 → 15)
  // είναι η σειρά προτίμησης — ο χρεώστης τελευταίος, ώστε κανένα έγγραφο που σήμερα λύνεται σε
  // προμηθευτή ή πιστωτή να μην αλλάξει αντιστοίχιση.
  const pref: readonly number[] = opts.prefer?.length ? opts.prefer : ISSUER_SODTYPES;
  // `rank` αντί για σκέτο `indexOf`: ένα SODTYPE εκτός της λίστας προτίμησης πρέπει να πάει
  // ΤΕΛΕΥΤΑΙΟ, ενώ το `indexOf` θα επέστρεφε -1 και θα το έφερνε πρώτο.
  const rank = (v: unknown) => {
    const i = pref.indexOf(Number(v));
    return i === -1 ? pref.length : i;
  };
  valid.sort((a, b) => rank(a.SODTYPE) - rank(b.SODTYPE));
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
  /**
   * Χαρακτηρισμός myDATA του μητρώου. Το EXPN κρατά ΔΥΟ ζεύγη: εσόδων (`CLASSTYPE`/
   * `CLASSCATEGORY`) και εξόδων (`CLASSTYPEX`/`CLASSCATEGORYEX`). Για παραστατικά που
   * ΛΑΜΒΑΝΟΥΜΕ ισχύει το ζεύγος των εξόδων.
   */
  classType: number | null;
  classTypeX: number | null;
  classCategory: number | null;
  classCategoryX: number | null;
  myDataVprc: number | null;
}

// Πεδία του EXPN που καθρεφτίζουμε τοπικά (επαληθευμένα στο schema του object EXPENSES).
const EXPN_FIELDS = [
  'EXPN', 'CODE', 'NAME', 'VAT', 'ISACTIVE',
  'CLASSTYPE', 'CLASSTYPEX', 'CLASSCATEGORY', 'CLASSCATEGORYEX', 'MYDATAVPRC',
];

/** '0' / '' / μη αριθμός → null. Το SoftOne γράφει 0 στα «κενά» FK. */
const intOrNull = (v: unknown): number | null => {
  const n = Number(str(v));
  return Number.isFinite(n) && n !== 0 ? n : null;
};

function mapExpense(o: Record<string, string>): ExpenseRow {
  return {
    expn: Number(o.EXPN),
    code: o.CODE,
    name: o.NAME,
    vat: idOrNull(o.VAT),
    isActive: o.ISACTIVE !== '0',
    classType: intOrNull(o.CLASSTYPE),
    classTypeX: intOrNull(o.CLASSTYPEX),
    classCategory: intOrNull(o.CLASSCATEGORY),
    classCategoryX: intOrNull(o.CLASSCATEGORYEX),
    myDataVprc: intOrNull(o.MYDATAVPRC),
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
  'INTRASTATFLAG', 'TURNOVRFLAG', 'USEBYITEM', 'EFKFLAG', 'HANDMD', 'ISEXPN',
] as const;

/** Σχεδιαστικές προεπιλογές του object EXPENSES — μόνο ως δίχτυ όταν λείπει πεδίο από το πρότυπο. */
const EXPENSE_FLAG_DEFAULTS: Record<string, unknown> = {
  CLCMD: 0, INCLMD: 0, VATMODE: 0, ISSTOCK: 0, STOCKMD: 0, SOVAL: 0, INVOICEFLAG: 1, KEPYOFLAG: 1,
  INTRASTATFLAG: 0, TURNOVRFLAG: 0, USEBYITEM: 0, EFKFLAG: 0, HANDMD: 0, ISEXPN: 0,
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
    throw new SoftoneError(res.error ?? `getData EXPENSES ${key} απέτυχε (code ${res.errorcode ?? '?'})`);
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
    throw new SoftoneError(res.error ?? `setData EXPENSES απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  const expn = Number(res.id);
  // Ο κωδικός δεσμεύτηκε ήδη — καθαρίζουμε ΠΡΙΝ τον read-back, ώστε μια αποτυχία εκεί να μην
  // αφήσει τον πιασμένο κωδικό καταγεγραμμένο ως ελεύθερο για έως 60s.
  clearItemCodeCache('expense');
  // Read back — «success: true» δεν σημαίνει ότι γράφτηκε.
  const back = await softoneGetTable('EXPN', EXPN_FIELDS, `EXPN=${expn}`);
  const row = back[0];
  if (!row || !Number.isFinite(Number(row.EXPN))) {
    throw new SoftoneError(`Το έξοδο ${expn} δεν βρέθηκε μετά τη δημιουργία (setData EXPENSES)`);
  }
  return { expn, code: row.CODE, name: row.NAME, templateExpn: template.expn };
}

// ============================================================
// Χρεοπιστώσεις — object LINEITEM (EditMaster) → πίνακας MTRL με SODTYPE 53
// Κατηγορίες δαπανών — object LINCATEGORY → πίνακας MTRCATEGORY με SODTYPE 53
// Λίστες χαρακτηρισμού myDATA — EditLists MYDATACLTYPE / MYDATACLCATEGORY
// ============================================================

/** MTRL.SODTYPE / MTRCATEGORY.SODTYPE: 51 είδη · 52 υπηρεσίες · 53 ΧΡΕΟΠΙΣΤΩΣΕΙΣ · 54 πάγια. */
export const LINEITEM_SODTYPE = 53;

export interface LineItemRow {
  /** MTRL της χρεοπίστωσης — ΑΥΤΟ μπαίνει στο `MTRL` μιας γραμμής LINLINES. */
  mtrl: number;
  code: string;
  name: string;
  vat: string | null;
  /** MTRTYPE («Τύπος», editor $LINTYPE) — απαιτούμενο πεδίο της γραμμής LINLINES. */
  mtrType: number | null;
  /** MTRCATEGORY → κατηγορία δαπάνης. */
  mtrCategory: number | null;
  classType: number | null;
  classCategory: number | null;
  myDataCode: string | null;
  myDataVprc: number | null;
  /**
   * ACNMSK «Γενικής» (editor ACNTGL) — ο λογαριασμός γενικής λογιστικής της χρεοπίστωσης.
   * `null` = κενό στο SoftOne. Συνήθως πλήρης κωδικός, αλλά ΜΠΟΡΕΙ να είναι μάσκα με `*`.
   */
  acnmsk: string | null;
  isActive: boolean;
}

const LINEITEM_FIELDS = [
  'MTRL', 'CODE', 'NAME', 'VAT', 'MTRTYPE', 'MTRCATEGORY', 'ISACTIVE',
  'CLASSTYPE', 'CLASSCATEGORY', 'MYDATACODE', 'MYDATAVPRC', 'ACNMSK',
];

function mapLineItem(o: Record<string, string>): LineItemRow {
  return {
    mtrl: Number(o.MTRL),
    code: o.CODE,
    name: o.NAME,
    vat: idOrNull(o.VAT),
    // ΟΧΙ `intOrNull`: το MTRTYPE 0 είναι έγκυρος τύπος (είναι και το default της γραμμής).
    mtrType: Number.isFinite(Number(str(o.MTRTYPE))) && str(o.MTRTYPE) !== '' ? Number(str(o.MTRTYPE)) : null,
    mtrCategory: intOrNull(o.MTRCATEGORY),
    classType: intOrNull(o.CLASSTYPE),
    classCategory: intOrNull(o.CLASSCATEGORY),
    myDataCode: idOrNull(o.MYDATACODE),
    myDataVprc: intOrNull(o.MYDATAVPRC),
    acnmsk: idOrNull(o.ACNMSK),
    isActive: o.ISACTIVE !== '0',
  };
}

/** Διαβάζει το μητρώο χρεοπιστώσεων (MTRL SODTYPE 53, ενεργές) με GetTable. Μόνο ΑΝΑΓΝΩΣΗ. */
export async function softoneFetchLineItems(): Promise<LineItemRow[]> {
  const rows = await softoneGetTable('MTRL', LINEITEM_FIELDS, `SODTYPE=${LINEITEM_SODTYPE} AND ISACTIVE=1`);
  return rows.map(mapLineItem).filter((r) => Number.isFinite(r.mtrl));
}

// ============================================================
// Λογιστικό σχέδιο — πίνακας ACNT (Γενική λογιστική). Μόνο ΑΝΑΓΝΩΣΗ.
// ============================================================

export interface AccountRow {
  acnt: number;
  code: string;
  name: string;
  /** ACNGRADE — βαθμίδα (1..4 στο ΕΓΛΣ του πελάτη). */
  grade: number | null;
  /** SODTYPE — 89 γενική, 90 ομάδα 9. */
  sodtype: number | null;
  isActive: boolean;
  /**
   * ACNMOVING «Κινείται» — ο λογαριασμός ΔΕΧΕΤΑΙ εγγραφές (αναλυτικός). `false` = συγκεντρωτικός.
   * `null` = η στήλη δεν ήρθε ή ήρθε κενή: ΑΓΝΩΣΤΟ, ποτέ «κινείται».
   * ΣΗΜ.: στον πελάτη το σχέδιο είναι `ACNT` και η κινησιμότητα `ACNMOVING`. Τα `GLMASTER`,
   * `ISFINAL`, `ACCNUM`, `GLTRNLINES` που αναφέρθηκαν ΔΕΝ υπάρχουν σε αυτή την εγκατάσταση.
   * Ούτε η βαθμίδα ούτε το «δεν έχει παιδιά» το αντικαθιστούν: 913 λογαριασμοί χωρίς παιδιά ΔΕΝ
   * κινούνται και 166 λογαριασμοί 2ης/3ης βαθμίδας κινούνται.
   */
  postable: boolean | null;
}

// Τα ονόματα επαληθεύτηκαν ζωντανά με GetTable / getTableFields (ο πίνακας ACNT δεν υπάρχει στο cached schema).
const ACNT_FIELDS = ['ACNT', 'CODE', 'NAME', 'ACNGRADE', 'SODTYPE', 'ISACTIVE', 'ACNMOVING'];

/**
 * Διαβάζει ΟΛΟ το λογιστικό σχέδιο (ACNT). Χωρίς φίλτρο ISACTIVE: ένας ανενεργός λογαριασμός
 * ΥΠΑΡΧΕΙ και πρέπει να φαίνεται ως τέτοιος, όχι ως «δεν υπάρχει».
 *
 * ΔΕΝ περνάει από το `softoneGetTable`: εκείνο αντιστοιχίζει τις στήλες ΜΕ ΤΗ ΣΕΙΡΑ που τις
 * ζητήσαμε, ενώ το GetTable ΠΑΡΑΛΕΙΠΕΙ σιωπηλά όποιο πεδίο δεν ξέρει (το είδαμε ζωντανά με
 * `FPRMS.GLTEMPLATES`) — και τότε κάθε στήλη μετά από αυτό διαβάζεται μετατοπισμένη. Εδώ
 * διαβάζουμε από το `model` της απάντησης και ΑΠΑΙΤΟΥΜΕ να υπάρχουν κωδικός και περιγραφή.
 */
export async function softoneFetchAccounts(): Promise<AccountRow[]> {
  return parseAccountsResponse(await softoneCall<GetTableResp & { model?: { name: string }[][] }>(
    'GetTable', { TABLE: 'ACNT', FIELDS: ACNT_FIELDS.join(','), FILTER: '' },
  ));
}

/**
 * Η ανάγνωση της απάντησης GetTable ACNT, ΚΑΘΑΡΗ ώστε να δοκιμάζεται. Το GetTable ΠΡΟΣΘΕΤΕΙ στήλες
 * που δεν ζητήσαμε (AFM, CODE1) και ΑΛΛΑΖΕΙ τη σειρά — γι' αυτό ΠΑΝΤΑ κατά όνομα από το `model`,
 * ποτέ κατά θέση. Και αρνείται «κοντή» απάντηση: αν το `count` λέει 5.203 και ήρθαν 50 γραμμές, δεν
 * είναι λογιστικό σχέδιο, είναι κομμάτι του.
 */
export function parseAccountsResponse(res: GetTableResp & { model?: { name: string }[][] }): AccountRow[] {
  if (res.success === false) {
    throw new SoftoneError(`GetTable ACNT απέτυχε: ${res.error ?? `code ${res.errorcode ?? '?'}`}`);
  }
  const cols = (res.model?.[0] ?? []).map((m) => String(m?.name ?? '').toUpperCase());
  const at = (f: string) => cols.indexOf(f);
  for (const f of ['ACNT', 'CODE', 'NAME']) {
    if (at(f) < 0) throw new SoftoneError(`GetTable ACNT: λείπει η στήλη ${f} από την απάντηση`);
  }
  const cell = (r: unknown[], f: string): string => {
    const i = at(f);
    return i < 0 || r[i] == null ? '' : String(r[i]).trim();
  };
  const data = res.data ?? [];
  if (typeof res.count === 'number' && res.count !== data.length) {
    throw new SoftoneError(`GetTable ACNT: δηλώνει ${res.count} λογαριασμούς αλλά επέστρεψε ${data.length} — ελλιπής απάντηση`);
  }
  return data
    .map((r) => ({
      acnt: Number(cell(r, 'ACNT')),
      code: cell(r, 'CODE'),
      name: cell(r, 'NAME'),
      grade: intOrNull(cell(r, 'ACNGRADE')),
      sodtype: intOrNull(cell(r, 'SODTYPE')),
      // Στήλη που δεν ήρθε = δεν ξέρουμε ⇒ ενεργός (όπως και τα υπόλοιπα μητρώα).
      isActive: cell(r, 'ISACTIVE') !== '0',
      // Αυστηρά: μόνο «1» / «0» κρίνουν. Οτιδήποτε άλλο (λείπει η στήλη, κενό) = άγνωστο.
      postable: cell(r, 'ACNMOVING') === '1' ? true : cell(r, 'ACNMOVING') === '0' ? false : null,
    }))
    .filter((r) => Number.isFinite(r.acnt) && r.acnt > 0 && r.code !== '');
}

export interface LineCategoryRow {
  mtrCategory: number;
  code: string;
  name: string;
  vat: string | null;
  acnmsk: string | null;
  isActive: boolean;
}

const LINCATEGORY_FIELDS = ['MTRCATEGORY', 'CODE', 'NAME', 'VAT', 'ACNMSK', 'ISACTIVE'];

const mapLineCategory = (o: Record<string, string>): LineCategoryRow => ({
  mtrCategory: Number(o.MTRCATEGORY),
  code: o.CODE,
  name: o.NAME,
  vat: idOrNull(o.VAT),
  acnmsk: idOrNull(o.ACNMSK),
  isActive: o.ISACTIVE !== '0',
});

/**
 * Διαβάζει τις κατηγορίες δαπανών (MTRCATEGORY SODTYPE 53). Ο πίνακας MTRCATEGORY είναι ΚΟΙΝΟΣ
 * για είδη/υπηρεσίες/χρεοπιστώσεις/πάγια και είναι company-scoped, γι' αυτό φιλτράρουμε και τα δύο.
 *
 * Αν η εγκατάσταση δεν εκθέτει στήλη SODTYPE, ΔΕΝ κατεβάζουμε σιωπηλά ΟΛΕΣ τις κατηγορίες σαν να
 * ήταν δαπανών: η εφεδρεία είναι ΡΗΤΗ (`allowUnfiltered`) και το αποτέλεσμα σημαδεύεται με
 * `filtered: false`, ώστε να φαίνεται στο UI ότι ο κατάλογος μπορεί να περιέχει και κατηγορίες
 * ειδών / υπηρεσιών / παγίων.
 */
export async function softoneFetchLineCategories(
  opts: { allowUnfiltered?: boolean } = {},
): Promise<{ rows: LineCategoryRow[]; filtered: boolean }> {
  const cfg = await loadSoftoneConfig().catch(() => null);
  const company = cfg?.company ? ` AND COMPANY=${cfg.company}` : '';
  try {
    const rows = await softoneGetTable(
      'MTRCATEGORY', LINCATEGORY_FIELDS, `SODTYPE=${LINEITEM_SODTYPE} AND ISACTIVE=1${company}`,
    );
    return { rows: rows.map(mapLineCategory).filter((r) => Number.isFinite(r.mtrCategory)), filtered: true };
  } catch (e) {
    const msg = String((e as Error)?.message ?? '');
    // Μόνο σφάλμα που αφορά όντως τη στήλη, και μόνο αν το ζήτησε ρητά ο καλών.
    if (!opts.allowUnfiltered || !/SODTYPE/i.test(msg)) throw e;
    const rows = await softoneGetTable('MTRCATEGORY', LINCATEGORY_FIELDS, `ISACTIVE=1${company}`);
    return { rows: rows.map(mapLineCategory).filter((r) => Number.isFinite(r.mtrCategory)), filtered: false };
  }
}

export interface MyDataClassRow {
  /** SOTYPE — η πλευρά (εσόδων / εξόδων) στην οποία ανήκει ο χαρακτηρισμός. */
  sotype: number;
  code: number;
  myDataCode: string | null;
  sohCode: string | null;
  name: string;
  isVat?: boolean;
}

/** EditList MYDATACLTYPE «Τύπος χαρακτηρισμού» — μητρώο ΑΝΑΦΟΡΑΣ, μόνο ανάγνωση. */
export async function softoneFetchMyDataClassTypes(): Promise<MyDataClassRow[]> {
  const rows = await softoneGetTable(
    'MYDATACLTYPE', ['SOTYPE', 'MYDATACLTYPE', 'MYDATACODE', 'SOHCODE', 'NAME', 'ISVAT'], '',
  );
  return rows
    .map((o) => ({
      sotype: Number(str(o.SOTYPE)) || 0,
      code: Number(str(o.MYDATACLTYPE)),
      myDataCode: idOrNull(o.MYDATACODE),
      sohCode: idOrNull(o.SOHCODE),
      name: cleanS1Label(o.NAME) || str(o.MYDATACODE),
      isVat: str(o.ISVAT) === '1',
    }))
    .filter((r) => Number.isFinite(r.code) && r.name);
}

/** EditList MYDATACLCATEGORY «Κατηγορία χαρακτηρισμού» — μητρώο ΑΝΑΦΟΡΑΣ, μόνο ανάγνωση. */
export async function softoneFetchMyDataClassCategories(): Promise<MyDataClassRow[]> {
  const rows = await softoneGetTable(
    'MYDATACLCATEGORY', ['SOTYPE', 'MYDATACLCATEGORY', 'MYDATACODE', 'SOHCODE', 'NAME'], '',
  );
  return rows
    .map((o) => ({
      sotype: Number(str(o.SOTYPE)) || 0,
      code: Number(str(o.MYDATACLCATEGORY)),
      myDataCode: idOrNull(o.MYDATACODE),
      sohCode: idOrNull(o.SOHCODE),
      name: cleanS1Label(o.NAME) || str(o.MYDATACODE),
    }))
    .filter((r) => Number.isFinite(r.code) && r.name);
}

// ============================================================
// Αναλυτική ανά γραμμή — κέντρα κόστους, έργα, δραστηριότητες
// Και τα τρία μπαίνουν ΑΝΑ ΓΡΑΜΜΗ σε ITELINES / SRVLINES / LINLINES (ποτέ σε EXPANAL) και είναι
// ΠΡΟΑΙΡΕΤΙΚΑ στο SoftOne. Μόνο ΑΝΑΓΝΩΣΗ.
// ============================================================

export interface CostCenterRow {
  costcntr: number;
  code: string;
  name: string;
  name2: string | null;
  sohCode: string | null;
  acnmsk: string | null;
  isActive: boolean;
}

/** Object PRSCOSTCNTR «Κέντρα κόστους» → DB πίνακας COSTCNTR. */
export async function softoneFetchCostCenters(): Promise<CostCenterRow[]> {
  const rows = await softoneGetTable(
    'COSTCNTR', ['COSTCNTR', 'CODE', 'NAME', 'NAME2', 'SOHCODE', 'ACNMSK', 'ISACTIVE'], 'ISACTIVE=1',
  );
  return rows
    .map((o) => ({
      costcntr: Number(o.COSTCNTR),
      code: o.CODE,
      name: cleanS1Label(o.NAME) || o.CODE,
      name2: idOrNull(o.NAME2),
      sohCode: idOrNull(o.SOHCODE),
      acnmsk: idOrNull(o.ACNMSK),
      isActive: o.ISACTIVE !== '0',
    }))
    .filter((r) => Number.isFinite(r.costcntr) && r.costcntr !== 0);
}

export interface ProjectRow {
  prjc: number;
  code: string;
  name: string;
  /** TRDR («Πελάτης») — επιτρέπει να δείξουμε πρώτα τα έργα ΤΟΥ εκδότη του παραστατικού. */
  trdr: number | null;
  prjType: number | null;
  isActive: boolean;
}

/** Object PRJC «Έργα» → DB πίνακας PRJC. */
export async function softoneFetchProjects(): Promise<ProjectRow[]> {
  const rows = await softoneGetTable(
    'PRJC', ['PRJC', 'CODE', 'NAME', 'TRDR', 'PRJTYPE', 'ISACTIVE'], 'ISACTIVE=1',
  );
  return rows
    .map((o) => ({
      prjc: Number(o.PRJC),
      code: o.CODE,
      name: cleanS1Label(o.NAME) || o.CODE,
      trdr: intOrNull(o.TRDR),
      prjType: intOrNull(o.PRJTYPE),
      isActive: o.ISACTIVE !== '0',
    }))
    .filter((r) => Number.isFinite(r.prjc) && r.prjc !== 0);
}

export interface ProjectStageRow {
  prjcStage: number;
  code: string;
  name: string;
  isActive: boolean;
}

/** Object PRJCSTAGE «Δραστηριότητες» → DB πίνακας PRJCSTAGE («Κατηγορία δραστηριότητας» στη γραμμή). */
export async function softoneFetchProjectStages(): Promise<ProjectStageRow[]> {
  const rows = await softoneGetTable('PRJCSTAGE', ['PRJCSTAGE', 'CODE', 'NAME', 'ISACTIVE'], 'ISACTIVE=1');
  return rows
    .map((o) => ({
      prjcStage: Number(o.PRJCSTAGE),
      code: o.CODE,
      // Το NAME είναι προαιρετικό στο SoftOne: χωρίς αυτό, η σύντμηση ΕΙΝΑΙ το όνομα.
      name: cleanS1Label(o.NAME) || o.CODE,
      isActive: o.ISACTIVE !== '0',
    }))
    .filter((r) => Number.isFinite(r.prjcStage) && r.prjcStage !== 0);
}

// ============================================================
// Εμπορικές κατηγορίες ειδών — object ITECATEGORY (EditMaster) → πίνακας MTRCATEGORY
// ============================================================

/**
 * Δημιουργεί **εμπορική κατηγορία είδους** στο SoftOne.
 *
 * ΓΙΑΤΙ `ITECATEGORY` και όχι `MTRCATEGORY`: το σκέτο όνομα πίνακα ΔΕΝ είναι object εγγραφής —
 * το `setData` πάνω του γυρίζει `success: true` και **δεν γράφει τίποτα** (καταγεγραμμένο σε
 * ζωντανό tenant). Το πραγματικό EditMaster είναι το `ITECATEGORY` («Εμπορικές κατηγορίες
 * ειδών»), με πίνακα `MTRCATEGORY`.
 *
 * Τι απαιτεί το schema του object: `MTRCATEGORY` (Smallint, **required**, ΟΧΙ AutoInc, χωρίς
 * default), `CODE` (Σύντμηση, ≤12, required), `NAME` (≤128, required), `ISACTIVE` (default 1),
 * `KEPYO` (default 1). Επειδή το κλειδί δεν είναι AutoInc, το δίνουμε εμείς ως `max + 1` — και
 * αν το SoftOne επιστρέψει δικό του `id`, εκείνο κερδίζει στον έλεγχο.
 *
 * `success: true` ΔΕΝ αποδεικνύει ότι γράφτηκε: διαβάζουμε **πάντα** πίσω τη γραμμή και
 * επιβεβαιώνουμε την περιγραφή — αλλιώς πετάμε και ο καλών δεν καθρεφτίζει φάντασμα.
 */
export interface CreateItemCategoryResult {
  mtrCategory: number;
  code: string;
  name: string;
}

/** Σύντμηση από περιγραφή: κεφαλαία, χωρίς σημεία στίξης, ≤12 χαρακτήρες (πεδίο `CODE`). */
export function itemCategoryAbbrev(name: string): string {
  const s = String(name ?? '')
    .toUpperCase()
    .replace(/[^0-9A-ZΑ-ΩΆΈΉΊΌΎΏΪΫ]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 12);
}

export async function softoneCreateItemCategory(input: {
  name: string;
  /** Σύντμηση· κενή ⇒ παράγεται από την περιγραφή και «σπρώχνεται» μέχρι να είναι ελεύθερη. */
  code?: string | null;
}): Promise<CreateItemCategoryResult> {
  const name = String(input.name ?? '').trim().slice(0, 128);
  if (!name) throw new SoftoneError('Η περιγραφή της κατηγορίας είναι υποχρεωτική.');

  const cfg = await loadSoftoneConfig().catch(() => null);
  const companyFilter = cfg?.company ? `COMPANY=${cfg.company}` : '';
  const existing = await softoneGetTable('MTRCATEGORY', ['MTRCATEGORY', 'CODE', 'NAME'], companyFilter);

  const takenCodes = new Set(existing.map((r) => str(r.CODE).toUpperCase()).filter(Boolean));
  const takenNames = new Set(existing.map((r) => str(r.NAME).toUpperCase()).filter(Boolean));
  if (takenNames.has(name.toUpperCase())) {
    throw new SoftoneError(`Υπάρχει ήδη εμπορική κατηγορία «${name}».`);
  }

  // Σύντμηση: ό,τι έδωσε ο χρήστης, αλλιώς από την περιγραφή· και στις δύο περιπτώσεις
  // ΕΛΕΓΧΕΤΑΙ ότι είναι ελεύθερη — αν όχι, παίρνει αριθμητικό επίθεμα.
  const wanted = (String(input.code ?? '').trim() || itemCategoryAbbrev(name)).slice(0, 12) || 'ΚΑΤ';
  let code = wanted;
  for (let n = 2; takenCodes.has(code.toUpperCase()) && n < 1000; n += 1) {
    const suffix = String(n);
    code = `${wanted.slice(0, 12 - suffix.length)}${suffix}`;
  }
  if (takenCodes.has(code.toUpperCase())) {
    throw new SoftoneError('Δεν βρέθηκε ελεύθερη σύντμηση για την κατηγορία.');
  }

  const nextId = existing.reduce((max, r) => Math.max(max, Number(r.MTRCATEGORY) || 0), 0) + 1;

  const res = await softoneCall<{ success?: boolean; error?: string; errorcode?: number; id?: string | number }>(
    'setData',
    { OBJECT: 'ITECATEGORY', KEY: '', DATA: { ITECATEGORY: [{ MTRCATEGORY: nextId, CODE: code, NAME: name, ISACTIVE: 1, KEPYO: 1 }] } },
  );
  if (res.success === false) {
    throw new SoftoneError(res.error ?? `setData ITECATEGORY απέτυχε (code ${res.errorcode ?? '?'})`);
  }
  const id = Number(res.id) || nextId;

  // ΑΝΑΓΝΩΣΗ ΠΙΣΩ — υποχρεωτική. Το `success: true` των memory tables είναι γνωστό ότι λέει
  // ψέματα, οπότε η γραμμή πρέπει να υπάρχει ΚΑΙ να έχει την περιγραφή που στείλαμε.
  const back = await softoneGetTable('MTRCATEGORY', ['MTRCATEGORY', 'CODE', 'NAME'], `MTRCATEGORY=${id}`);
  const row = back.find((r) => Number(r.MTRCATEGORY) === id);
  if (!row || str(row.NAME).toUpperCase() !== name.toUpperCase()) {
    throw new SoftoneError(
      `Η κατηγορία ΔΕΝ δημιουργήθηκε: δεν επιβεβαιώθηκε στο SoftOne μετά την εγγραφή `
      + `(MTRCATEGORY ${id}, περιγραφή «${row?.NAME ?? '—'}»). Δοκίμασε ξανά ή φτιάξ' την μέσα στο SoftOne.`,
    );
  }
  return { mtrCategory: id, code: row.CODE || code, name: row.NAME || name };
}
