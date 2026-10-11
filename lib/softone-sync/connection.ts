// lib/softone-sync/connection.ts — SERVER. Η ΤΑΥΤΟΤΗΤΑ της σύνδεσης με το SoftOne.
//
// ΤΟ ΠΡΟΒΛΗΜΑ ΠΟΥ ΛΥΝΕΙ. Οι βοηθητικοί πίνακες (συναλλασσόμενοι, είδη, λογαριασμοί, σειρές)
// είναι ΚΑΘΡΕΦΤΗΣ μιας συγκεκριμένης εγκατάστασης SoftOne: κρατούν τα ΑΡΙΘΜΗΤΙΚΑ ΚΛΕΙΔΙΑ της
// (TRDR, MTRL, σειρές). Αυτά τα κλειδιά ΔΕΝ σημαίνουν τίποτα σε άλλη εγκατάσταση — το TRDR 3374
// είναι άλλος συναλλασσόμενος αλλού, όχι «ο ίδιος, πιο παλιός».
//
// Μέχρι τώρα η αλλαγή λογαριασμού περνούσε ΑΠΑΡΑΤΗΡΗΤΗ: άλλαζες Serial/χρήστη στις Ρυθμίσεις και
// η εφαρμογή συνέχιζε να δείχνει τους καθρέφτες της ΠΑΛΙΑΣ εγκατάστασης σαν έγκυρους. Η επόμενη
// καταχώριση θα έδειχνε σε λάθος εγγραφές — σιωπηλά.
//
// Εδώ μπαίνει το σημείο ελέγχου: κάθε επιτυχημένη σύνδεση παράγει ένα `tenantKey`, κάθε
// συγχρονισμός σφραγίζεται με αυτό, και ό,τι φέρει ΑΛΛΟ κλειδί θεωρείται ΞΕΝΟ — όχι «παλιό».
//
// ΜΟΝΟ ΑΝΑΓΝΩΣΕΙΣ προς το SoftOne. Καμία `setData` δεν φεύγει από αυτό το αρχείο.
import 'server-only';
import { prisma } from '@/lib/db';
import { getSetting, setSetting } from '@/lib/settings';
import {
  loadSoftoneConfig, softoneFetch, softoneLogin, softoneAuthenticate,
  SoftoneConfigError, SoftoneTransportError,
} from '@/lib/softone';
import type { SyncTable } from './resync';

/** Το setting που κρατά την τελευταία ταυτότητα που είδαμε, για να συγκρίνεται με την τωρινή. */
const TENANT_KEY_SETTING = 'integrations.softoneTenantKey';
/** Το σήμα «άλλαξε εγκατάσταση και δεν το έχει δει άνθρωπος ακόμη». */
const TENANT_PENDING_SETTING = 'integrations.softoneTenantChangePending';

/** Γιατί δεν έχουμε σύνδεση. Η διάκριση ορίζει ΤΙ λέμε στον χρήστη και τι μπορεί να κάνει. */
export type ConnectionFailure =
  /** Λείπουν ρυθμίσεις — δεν έχει γίνει καν ρύθμιση. */
  | 'config'
  /** Ο host δεν απαντά, ή δεν δημοσιεύει `/s1services` (404). Καμία ρύθμιση μέσα στην εφαρμογή δεν το φτιάχνει. */
  | 'unreachable'
  /** Ο host απαντά, αλλά το `login` απέρριψε χρήστη/κωδικό/AppID. */
  | 'credentials'
  /** Το `login` πέρασε, το `authenticate` όχι: λάθος εταιρεία/υποκατάστημα/module/refid. */
  | 'scope';

export interface ConnectionProbe {
  ok: boolean;
  /** Η ταυτότητα της εγκατάστασης, μόνο σε επιτυχία. */
  tenantKey: string | null;
  endpoint: string | null;
  /** Serial number της εγκατάστασης, όπως το δίνει το `login`. */
  serialNo: string | null;
  version: string | null;
  failure: ConnectionFailure | null;
  /** Μήνυμα για τον χρήστη, στα Ελληνικά, με το τι να κάνει. */
  message: string;
  checkedAt: string;
  /**
   * ΟΙ ΕΓΚΥΡΟΙ ΣΥΝΔΥΑΣΜΟΙ εταιρείας/υποκαταστήματος/module/χρήστη, όπως τους επιστρέφει το
   * `login`. Γεμίζει ΜΟΝΟ σε αποτυχία `scope` — και είναι η διαφορά ανάμεσα σε «κάτι δεν πάει
   * καλά» και «να τι να βάλεις». Χωρίς αυτό ο χρήστης θα μάντευε τέσσερις αριθμούς.
   */
  options: ScopeOption[];
}

export interface ScopeOption {
  company: string | null; companyName: string | null;
  branch: string | null; branchName: string | null;
  module: string | null; refid: string | null; refidName: string | null;
}

/** Το `objs` του `login` έρχεται με ονόματα πεδίων σε ΚΕΦΑΛΑΙΑ και όχι πάντα τα ίδια. */
function scopeOptions(objs: unknown): ScopeOption[] {
  if (!Array.isArray(objs)) return [];
  const pick = (o: Record<string, unknown>, ...keys: string[]): string | null => {
    for (const k of keys) {
      const v = o[k] ?? o[k.toUpperCase()] ?? o[k.toLowerCase()];
      if (v != null && v !== '') return String(v);
    }
    return null;
  };
  return objs
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o) => ({
      company: pick(o, 'COMPANY'), companyName: pick(o, 'COMPANYNAME'),
      branch: pick(o, 'BRANCH'), branchName: pick(o, 'BRANCHNAME'),
      module: pick(o, 'MODULE'),
      refid: pick(o, 'REFID'), refidName: pick(o, 'REFIDNAME', 'USERNAME'),
    }));
}

/**
 * Η ταυτότητα μιας εγκατάστασης+εμβέλειας.
 *
 * Δεν φτάνει ο host: ο ΙΔΙΟΣ host με άλλη ΕΤΑΙΡΕΙΑ είναι άλλος κόσμος δεδομένων (άλλοι
 * λογαριασμοί, άλλες σειρές). Το serial number μπαίνει γιατί ένας υποτομέας μπορεί να
 * ξαναχρησιμοποιηθεί για άλλη εγκατάσταση.
 */
export function tenantKeyOf(p: {
  endpoint: string; serialNo?: string | null;
  company?: string | null; branch?: string | null; module?: string | null; refid?: string | null;
}): string {
  const host = (() => { try { return new URL(p.endpoint).host; } catch { return p.endpoint; } })();
  return [
    host,
    `sn=${p.serialNo ?? '?'}`,
    `co=${p.company ?? '?'}`,
    `br=${p.branch ?? '?'}`,
    `mod=${p.module ?? '?'}`,
    `ref=${p.refid ?? '?'}`,
  ].join('|');
}

/**
 * ΦΘΗΝΟΣ έλεγχος ζωής: απαντά ο host; Χωρίς διαπιστευτήρια, χωρίς session.
 *
 * Υπάρχει ξεχωριστά από το `probeConnection` γιατί απαντά στο ΠΡΩΤΟ ερώτημα κάθε διάγνωσης —
 * «φταίει το δίκτυο ή εμείς;» — σε ένα αίτημα και χωρίς να καίει login. Ένα 404 εδώ σημαίνει
 * ότι η εγκατάσταση δεν δημοσιεύει Web Services σε αυτή τη διεύθυνση, και κανένας κωδικός
 * δεν πρόκειται να το αλλάξει.
 */
export async function softoneReachable(): Promise<{ reachable: boolean; endpoint: string | null; message: string }> {
  let endpoint: string;
  try {
    endpoint = (await loadSoftoneConfig()).endpoint;
  } catch (e) {
    return { reachable: false, endpoint: null, message: (e as Error).message };
  }
  try {
    await softoneFetch(endpoint, { service: 'ping' });
    return { reachable: true, endpoint, message: 'Ο διακομιστής SoftOne απαντά.' };
  } catch (e) {
    if (e instanceof SoftoneTransportError) return { reachable: false, endpoint, message: e.message };
    // Απάντησε κάτι που διαβάστηκε ως JSON — ο host ζει, ό,τι κι αν λέει το `ping`.
    return { reachable: true, endpoint, message: 'Ο διακομιστής SoftOne απαντά.' };
  }
}

/**
 * ΠΛΗΡΗΣ έλεγχος: login → authenticate → ταυτότητα. Καταγράφει το αποτέλεσμα στο ημερολόγιο
 * σύνδεσης και, αν η εγκατάσταση ΑΛΛΑΞΕ, σηκώνει τη σημαία που περιμένει ανθρώπινη απόφαση.
 */
export async function probeConnection(): Promise<ConnectionProbe> {
  const checkedAt = new Date().toISOString();
  const fail = (failure: ConnectionFailure, message: string, options: ScopeOption[] = []): ConnectionProbe =>
    ({ ok: false, tenantKey: null, endpoint: null, serialNo: null, version: null, failure, message, checkedAt, options });

  let cfg;
  try {
    cfg = await loadSoftoneConfig();
  } catch (e) {
    if (e instanceof SoftoneConfigError) return fail('config', e.message);
    throw e;
  }

  let login;
  try {
    login = await softoneLogin(cfg);
  } catch (e) {
    const message = e instanceof SoftoneTransportError
      ? e.message
      : `Ο διακομιστής SoftOne δεν απάντησε σωστά: ${(e as Error).message}`;
    await recordEvent('down', { detail: { failure: 'unreachable', message } });
    return { ...fail('unreachable', message), endpoint: cfg.endpoint };
  }
  if (!login.success || !login.clientID) {
    const message = `Το SoftOne απέρριψε τα στοιχεία σύνδεσης: ${login.error ?? 'άγνωστο σφάλμα'}. Έλεγξε Web Account, κωδικό και AppID.`;
    await recordEvent('down', { detail: { failure: 'credentials', message } });
    return { ...fail('credentials', message), endpoint: cfg.endpoint };
  }

  let auth;
  try {
    auth = await softoneAuthenticate(cfg, login.clientID);
  } catch (e) {
    const message = (e as Error).message;
    await recordEvent('down', { detail: { failure: 'unreachable', message } });
    return { ...fail('unreachable', message), endpoint: cfg.endpoint };
  }
  if (!auth.success || !auth.clientID) {
    const options = scopeOptions(login.objs);
    const shown = options.slice(0, 6).map(
      (o) => `COMPANY ${o.company}${o.companyName ? ` (${o.companyName})` : ''} · BRANCH ${o.branch} · MODULE ${o.module} · REFID ${o.refid}`,
    );
    const message = [
      `Ο χρήστης συνδέθηκε, αλλά απορρίφθηκε ο συνδυασμός Εταιρεία ${cfg.company ?? '—'} / Υποκατάστημα ${cfg.branch ?? '—'} / Module ${cfg.module ?? '—'} / RefID ${cfg.refid ?? '—'}`,
      `(${auth.error ?? 'άγνωστο σφάλμα'}).`,
      options.length
        ? `Έγκυροι συνδυασμοί για αυτόν τον λογαριασμό: ${shown.join(' | ')}${options.length > shown.length ? ' …' : ''}`
        : 'Το SoftOne δεν επέστρεψε διαθέσιμους συνδυασμούς.',
    ].join(' ');
    await recordEvent('down', { detail: { failure: 'scope', message, options } });
    return { ...fail('scope', message, options), endpoint: cfg.endpoint };
  }

  const serialNo = typeof login.sn === 'string' ? login.sn : null;
  const version = typeof login.ver === 'string' ? login.ver : null;
  const tenantKey = tenantKeyOf({
    endpoint: cfg.endpoint, serialNo,
    company: cfg.company, branch: cfg.branch, module: cfg.module, refid: cfg.refid,
  });

  const prev = (await getSetting<string>(TENANT_KEY_SETTING)) || null;
  if (prev !== tenantKey) {
    await setSetting(TENANT_KEY_SETTING, tenantKey);
    if (prev) {
      // ΔΕΝ καθαρίζουμε τίποτα μόνοι μας: η διαγραφή καθρεφτών είναι απόφαση ανθρώπου. Σηκώνουμε
      // τη σημαία, και μέχρι να απαντηθεί, ό,τι έχει ξένο κλειδί θεωρείται αναξιόπιστο.
      await setSetting(TENANT_PENDING_SETTING, JSON.stringify({ from: prev, to: tenantKey, at: checkedAt }));
      await recordEvent('tenant_changed', { tenantKey, prevTenantKey: prev });
    }
  }
  await recordEvent('up', { tenantKey });

  return {
    ok: true, tenantKey, endpoint: cfg.endpoint, serialNo, version,
    failure: null, checkedAt, options: scopeOptions(login.objs),
    message: `Συνδεδεμένο${serialNo ? ` — serial ${serialNo}` : ''}${version ? `, έκδοση ${version}` : ''}.`,
  };
}

/** Η ταυτότητα που ξέρουμε ΧΩΡΙΣ δίκτυο. `null` όταν δεν έχει γίνει ποτέ επιτυχημένη σύνδεση. */
export async function knownTenantKey(): Promise<string | null> {
  return (await getSetting<string>(TENANT_KEY_SETTING)) || null;
}

/** Η εκκρεμής αλλαγή εγκατάστασης, αν υπάρχει. */
export async function pendingTenantChange(): Promise<{ from: string; to: string; at: string } | null> {
  const raw = await getSetting<string>(TENANT_PENDING_SETTING);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { from?: unknown; to?: unknown; at?: unknown };
    return typeof v.from === 'string' && typeof v.to === 'string' && typeof v.at === 'string'
      ? { from: v.from, to: v.to, at: v.at } : null;
  } catch { return null; }
}

/** Ο χρήστης είδε την αλλαγή και ξανακατέβασε τα μητρώα: η σημαία πέφτει. */
export async function clearTenantChange(): Promise<void> {
  await setSetting(TENANT_PENDING_SETTING, '');
}

/** Σφραγίδα συγχρονισμού: ΠΟΙΟΣ πίνακας, για ΠΟΙΑ εγκατάσταση, ΠΟΤΕ, με πόσες γραμμές. */
export async function stampMirror(table: SyncTable, rows: number): Promise<void> {
  const tenantKey = (await knownTenantKey()) ?? 'unknown';
  const syncedAt = new Date();
  await prisma.softoneMirrorState.upsert({
    where: { table },
    update: { tenantKey, syncedAt, rows },
    create: { table, tenantKey, syncedAt, rows },
  });
}

export interface MirrorTrust {
  table: string;
  tenantKey: string | null;
  syncedAt: Date | null;
  rows: number;
  /** `true` όταν ο καθρέφτης κατέβηκε από ΑΛΛΗ εγκατάσταση από την τωρινή. */
  foreign: boolean;
  /**
   * `'unknown'` = έχει δεδομένα αλλά ΚΑΜΙΑ σφραγίδα εγκατάστασης.
   *
   * Αυτό δεν είναι θεωρητικό: κάθε πίνακας που κατέβηκε ΠΡΙΝ υπάρξει η σφραγίδα είναι τέτοιος.
   * Δεν μπορούμε να ξέρουμε από πού ήρθε — και «δεν ξέρω» πάνω σε αριθμητικά κλειδιά ERP είναι
   * πρακτικά «μην το εμπιστεύεσαι».
   */
  provenance: 'current' | 'foreign' | 'unknown';
}

/**
 * Πού ζει ο κάθε καθρέφτης, ώστε να μετρηθούν και οι ΑΣΦΡΑΓΙΣΤΟΙ.
 *
 * Χωρίς αυτόν τον πίνακα, ένα μητρώο γεμάτο δεδομένα άλλης εγκατάστασης θα ήταν ΑΟΡΑΤΟ: η
 * `SoftoneMirrorState` δεν θα είχε γραμμή γι' αυτό, άρα ούτε «ξένο» θα φαινόταν ούτε «άδειο».
 */
const MIRROR_COUNTERS: { table: SyncTable; count: () => Promise<number> }[] = [
  { table: 'traders', count: () => prisma.softoneTrader.count() },
  { table: 'items', count: () => prisma.softoneItem.count() },
  { table: 'accounts', count: () => prisma.softoneAccount.count() },
  { table: 'lineitems', count: () => prisma.softoneLineItem.count() },
  { table: 'expenses', count: () => prisma.softoneExpense.count() },
  { table: 'docseries', count: () => prisma.softoneDocSeries.count() },
  { table: 'lookups', count: () => prisma.softoneLookup.count() },
  { table: 'costcenters', count: () => prisma.softoneCostCenter.count() },
  { table: 'projects', count: () => prisma.softoneProject.count() },
];

/**
 * Η εμπιστοσύνη κάθε καθρέφτη απέναντι στην ΤΩΡΙΝΗ εγκατάσταση.
 *
 * Πίνακας που λείπει εντελώς ΔΕΝ είναι «ξένος» — είναι ασυγχρόνιστος, και το λέει η απουσία του.
 * Ξένος είναι μόνο αυτός που έχει δεδομένα ΑΛΛΗΣ εγκατάστασης: αυτά είναι χειρότερα από το τίποτα,
 * γιατί μοιάζουν έγκυρα.
 */
export async function mirrorTrust(): Promise<MirrorTrust[]> {
  const current = await knownTenantKey();
  const stamped = await prisma.softoneMirrorState.findMany({ orderBy: { table: 'asc' } });
  const byTable = new Map(stamped.map((r) => [r.table, r]));

  const out: MirrorTrust[] = stamped.map((r) => {
    const foreign = current != null && r.tenantKey !== current;
    return {
      table: r.table, tenantKey: r.tenantKey, syncedAt: r.syncedAt, rows: r.rows,
      foreign, provenance: foreign ? 'foreign' as const : 'current' as const,
    };
  });

  // Οι ΑΣΦΡΑΓΙΣΤΟΙ: έχουν δεδομένα, δεν έχουν καταγωγή.
  for (const m of MIRROR_COUNTERS) {
    if (byTable.has(m.table)) continue;
    const rows = await m.count().catch(() => 0);
    if (rows > 0) {
      out.push({ table: m.table, tenantKey: null, syncedAt: null, rows, foreign: false, provenance: 'unknown' });
    }
  }
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

async function recordEvent(
  kind: 'up' | 'down' | 'tenant_changed',
  p: { tenantKey?: string | null; prevTenantKey?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  // Το ημερολόγιο δεν είναι ποτέ λόγος να αποτύχει μια κλήση: αν δεν γραφτεί, χάνεται μια γραμμή
  // ιστορικού — δεν χαλάει η διάγνωση που μόλις έτρεξε.
  try {
    // «Πάνω» γράφεται μόνο στην ΑΛΛΑΓΗ κατάστασης, αλλιώς το ημερολόγιο γεμίζει με χιλιάδες
    // πανομοιότυπες γραμμές από τον περιοδικό έλεγχο και παύει να διαβάζεται.
    if (kind === 'up') {
      const last = await prisma.softoneConnectionEvent.findFirst({ orderBy: { at: 'desc' } });
      if (last?.kind === 'up') return;
    }
    await prisma.softoneConnectionEvent.create({
      data: {
        kind,
        tenantKey: p.tenantKey ?? null,
        prevTenantKey: p.prevTenantKey ?? null,
        detail: (p.detail ?? undefined) as never,
      },
    });
  } catch { /* ιστορικό, όχι κρίσιμη διαδρομή */ }
}
