// lib/item-supplier.ts — ΚΑΘΑΡΟ. Κωδικός και τιμή αγοράς ΑΝΑ ΠΡΟΜΗΘΕΥΤΗ σε ΥΠΑΡΧΟΝ είδος.
//
// Το ίδιο είδος (π.χ. «Γάντια νιτριλίου») το αγοράζουμε από πολλούς προμηθευτές, ο καθένας με τον
// ΔΙΚΟ ΤΟΥ κωδικό και τη δική του τιμή. Στη SoftOne (object ITEM):
//   MTRSUPCODE «Εναλλακτικοί κωδικοί προμηθευτών»: TRDR, MTRSUPCODE, MTRSUPNAME, ISACTIVE
//   MTRSUPPRCS «Τιμές προμηθευτών»: TRDR, SOCURRENCY, SUPPRICE (τιμή συμφωνίας), SUPDISC1..3,
//              SUPDATE (ισχύει έως), PARDAYS, MIN/MAXQTYORD — και LASTPRICE/LASTBUYDATE (μόνο ανάγνωση:
//              τα γράφει η SoftOne από τις αγορές).
//
// ΚΑΝΟΝΑΣ setData σε πίνακες γραμμών: ΚΑΘΕ υπάρχουσα γραμμή ξαναστέλνεται με το LINENUM της — μια
// γραμμή που λείπει ΔΙΑΓΡΑΦΕΤΑΙ. Γι' αυτό το σχέδιο χτίζεται ΠΑΝΤΑ από φρέσκια ανάγνωση (getData)
// και στέλνει μόνο τους πίνακες που αλλάζουν.

export interface SupCodeRow { linenum: number; trdr: number; code: string; name: string | null; active: boolean }
export interface SupPriceRow {
  linenum: number; trdr: number; currency: number | null;
  code: string | null; name: string | null; active: boolean;
  price: number | null; disc1: number | null; disc2: number | null; disc3: number | null;
  validUntil: string | null; leadDays: number | null; minQty: number | null; maxQty: number | null; webpage: string | null;
  lastPrice: number | null; lastBuyDate: string | null;
}
export interface ItemSupplierState { mtrl: number; codes: SupCodeRow[]; prices: SupPriceRow[] }

export interface ItemSupplierChange {
  trdr: number;
  /** Ο κωδικός του είδους ΣΤΟΝ ΠΡΟΜΗΘΕΥΤΗ (όπως τυπώνεται στο τιμολόγιό του). Κενό = καμία αλλαγή. */
  code?: string | null;
  /** Η περιγραφή του είδους στον προμηθευτή. */
  name?: string | null;
  /** Τιμή συμφωνίας (καθαρή, ανά ΒΑΣΙΚΗ μονάδα). `null` = καμία αλλαγή. */
  price?: number | null;
  disc1?: number | null;
  /** Νόμισμα (SOCURRENCY) για ΝΕΑ γραμμή τιμής — συνήθως 100 = EURO. */
  currency?: number | null;
}

export interface ItemSupplierPlan {
  /** Τι αλλάζει, σε ανθρώπινη γλώσσα (για την προεπισκόπηση). */
  changes: string[];
  /** `null` = τίποτα να σταλεί. */
  payload: { OBJECT: 'ITEM'; KEY: number; DATA: Record<string, Record<string, unknown>[]> } | null;
}

const NEW_LINENUM = 9000001;
const clean = (s: string | null | undefined) => String(s ?? '').trim();

function codeRowOut(r: SupCodeRow): Record<string, unknown> {
  return { LINENUM: r.linenum, TRDR: r.trdr, MTRSUPCODE: r.code, ...(r.name ? { MTRSUPNAME: r.name } : {}), ISACTIVE: r.active ? 1 : 0 };
}
function priceRowOut(r: SupPriceRow): Record<string, unknown> {
  const o: Record<string, unknown> = { LINENUM: r.linenum, TRDR: r.trdr, ISACTIVE: r.active ? 1 : 0 };
  if (r.currency != null) o.SOCURRENCY = r.currency;
  if (r.code) o.MTRSUPCODE = r.code;
  if (r.name) o.MTRSUPNAME = r.name;
  if (r.price != null) o.SUPPRICE = r.price;
  if (r.disc1 != null) o.SUPDISC1 = r.disc1;
  if (r.disc2 != null) o.SUPDISC2 = r.disc2;
  if (r.disc3 != null) o.SUPDISC3 = r.disc3;
  // Ημερομηνία ΠΑΝΤΑ ως «yyyy-mm-dd»: το «dd/mm/yyyy hh:mm» της ανάγνωσης θα το διάβαζε αλλιώς η SoftOne.
  const d = isoDate(r.validUntil);
  if (d) o.SUPDATE = d;
  if (r.leadDays != null) o.PARDAYS = r.leadDays;
  if (r.minQty != null) o.MINQTYORD = r.minQty;
  if (r.maxQty != null) o.MAXQTYORD = r.maxQty;
  if (r.webpage) o.WEBPAGE = r.webpage;
  return o;
}

/** «2026-12-31 00:00:00» / «2026-12-31» → «2026-12-31»· οτιδήποτε άλλο → `null` (δεν στέλνεται). */
export function isoDate(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const money = (n: number) => n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Το setData που φέρνει το είδος στην επιθυμητή κατάσταση — ή `null` αν είναι ήδη εκεί. ΚΑΘΑΡΟ. */
export function planItemSupplier(state: ItemSupplierState, ch: ItemSupplierChange, supplierLabel = 'τον προμηθευτή'): ItemSupplierPlan {
  const changes: string[] = [];
  const data: Record<string, Record<string, unknown>[]> = {};
  const code = clean(ch.code).slice(0, 50);
  const name = clean(ch.name).slice(0, 128) || null;

  // ── Κωδικός προμηθευτή: προστίθεται αν ΔΕΝ υπάρχει ήδη ο ίδιος για τον ίδιο προμηθευτή. Ένας
  //    προμηθευτής μπορεί να έχει ΠΟΛΛΟΥΣ κωδικούς για το ίδιο είδος — δεν αντικαθιστούμε κανέναν.
  if (code) {
    const same = state.codes.find((r) => r.trdr === ch.trdr && r.code.toUpperCase() === code.toUpperCase());
    if (!same) {
      data.MTRSUPCODE = [
        ...state.codes.map(codeRowOut),
        { LINENUM: NEW_LINENUM, TRDR: ch.trdr, MTRSUPCODE: code, ...(name ? { MTRSUPNAME: name } : {}), ISACTIVE: 1 },
      ];
      changes.push(`Νέος κωδικός προμηθευτή «${code}» για ${supplierLabel}.`);
    } else if (!same.active) {
      data.MTRSUPCODE = state.codes.map((r) => codeRowOut(r === same ? { ...r, active: true } : r));
      changes.push(`Επανενεργοποίηση του κωδικού «${code}» για ${supplierLabel}.`);
    }
  }

  // ── Τιμή συμφωνίας: ΜΙΑ γραμμή ανά προμηθευτή — ενημερώνεται αν υπάρχει, αλλιώς νέα.
  const price = ch.price != null && Number.isFinite(ch.price) && ch.price >= 0 ? Math.round(ch.price * 1e6) / 1e6 : null;
  const disc1 = ch.disc1 != null && Number.isFinite(ch.disc1) ? ch.disc1 : null;
  if (price != null) {
    const row = state.prices.find((r) => r.trdr === ch.trdr);
    if (!row) {
      data.MTRSUPPRCS = [
        ...state.prices.map(priceRowOut),
        {
          LINENUM: NEW_LINENUM, TRDR: ch.trdr, SOCURRENCY: ch.currency ?? 100, ISACTIVE: 1, SUPPRICE: price,
          ...(disc1 != null ? { SUPDISC1: disc1 } : {}), ...(code ? { MTRSUPCODE: code } : {}), ...(name ? { MTRSUPNAME: name } : {}),
        },
      ];
      changes.push(`Νέα τιμή αγοράς ${money(price)} € από ${supplierLabel}.`);
    } else if (row.price !== price || (disc1 != null && row.disc1 !== disc1) || !row.active) {
      data.MTRSUPPRCS = state.prices.map((r) => priceRowOut(r === row ? { ...r, price, active: true, ...(disc1 != null ? { disc1 } : {}) } : r));
      changes.push(`Τιμή αγοράς από ${supplierLabel}: ${row.price != null ? `${money(row.price)} €` : '—'} → ${money(price)} €.`);
    }
  }

  return {
    changes,
    payload: Object.keys(data).length ? { OBJECT: 'ITEM', KEY: state.mtrl, DATA: { ITEM: [{ MTRL: state.mtrl }], ...data } } : null,
  };
}

// ── Ανάγνωση (getData) → κατάσταση ────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const idOf = (v: unknown): number | null => num(String(v ?? '').split('|')[0]);
const str = (v: unknown) => { const s = String(v ?? '').trim(); return s || null; };

/** Η απάντηση `getData ITEM` → κατάσταση κωδικών/τιμών. ΚΑΘΑΡΟ. */
export function parseItemSupplierData(mtrl: number, data: Record<string, unknown> | null | undefined): ItemSupplierState {
  const rows = (k: string) => (Array.isArray((data ?? {})[k]) ? (data as Record<string, Record<string, unknown>[]>)[k] : []);
  return {
    mtrl,
    codes: rows('MTRSUPCODE')
      .map((r) => ({ linenum: num(r.LINENUM) ?? 0, trdr: idOf(r.TRDR) ?? 0, code: String(r.MTRSUPCODE ?? '').trim(), name: str(r.MTRSUPNAME), active: String(r.ISACTIVE ?? '1') !== '0' }))
      .filter((r) => r.linenum > 0 && r.trdr > 0 && r.code),
    prices: rows('MTRSUPPRCS')
      .map((r) => ({
        linenum: num(r.LINENUM) ?? 0, trdr: idOf(r.TRDR) ?? 0, currency: idOf(r.SOCURRENCY),
        code: str(r.MTRSUPCODE), name: str(r.MTRSUPNAME), active: String(r.ISACTIVE ?? '1') !== '0',
        price: num(r.SUPPRICE), disc1: num(r.SUPDISC1), disc2: num(r.SUPDISC2), disc3: num(r.SUPDISC3),
        validUntil: str(r.SUPDATE), leadDays: num(r.PARDAYS), minQty: num(r.MINQTYORD), maxQty: num(r.MAXQTYORD), webpage: str(r.WEBPAGE),
        lastPrice: num(r.LASTPRICE), lastBuyDate: str(r.LASTBUYDATE),
      }))
      .filter((r) => r.linenum > 0 && r.trdr > 0),
  };
}

/** Τα πεδία που διαβάζουμε — ΟΛΑ όσα ξαναστέλνονται, για να μη χαθεί τίποτα στην εγγραφή. */
export const ITEM_SUPPLIER_LOCATEINFO =
  'ITEM:MTRL,CODE,MTRSUP;'
  + 'MTRSUPCODE:LINENUM,TRDR,MTRSUPCODE,MTRSUPNAME,ISACTIVE;'
  + 'MTRSUPPRCS:LINENUM,TRDR,SOCURRENCY,MTRSUPCODE,MTRSUPNAME,ISACTIVE,WEBPAGE,SUPDATE,PARDAYS,SUPPRICE,SUPDISC1,SUPDISC2,SUPDISC3,MINQTYORD,MAXQTYORD,LASTPRICE,LASTBUYDATE';
