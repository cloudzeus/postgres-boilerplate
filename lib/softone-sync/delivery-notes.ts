// SERVER: τα ανοιχτά δελτία αποστολής αγορών ενός προμηθευτή (SoftOne, μόνο ΑΝΑΓΝΩΣΗ).
//
// «Ανοιχτό» = δεν έχει μετασχηματιστεί πλήρως (`FULLYTRANSF` 0 ή 2) και δεν είναι ακυρωμένο. Οι
// γραμμές του διαβάζονται ΖΩΝΤΑΝΑ κάθε φορά: ό,τι τιμολογήθηκε στο μεταξύ (από άλλον χρήστη ή από
// τη SoftOne) φαίνεται αμέσως στο `QTY1COV` — δεν κρατάμε αντίγραφο που θα μπορούσε να παλιώσει.
import 'server-only';
import { softoneGetTable, loadSoftoneConfig } from '@/lib/softone';
import { getSetting } from '@/lib/settings';
import { DEFAULT_CONVERSION_MAP, parseConversionMap, type NoteLine } from '@/lib/ocr/delivery-note-match';

export const CONVERSION_MAP_KEY = 'setup.deliveryNoteConversion';

export interface DeliveryNote {
  findoc: number;
  fincode: string | null;
  series: number;
  date: string | null;
  /** 0 = όχι, 2 = μερικώς. */
  transformed: number;
  total: number | null;
  lines: NoteLine[];
}

/** Σειρά δελτίου → σειρά τιμολογίου (Ρυθμίσεις → Αρχικοποίηση εφαρμογής). */
export async function loadConversionMap(): Promise<Map<number, number>> {
  const raw = await getSetting<string>(CONVERSION_MAP_KEY).catch(() => undefined);
  const m = parseConversionMap(raw ?? DEFAULT_CONVERSION_MAP);
  return m.size ? m : parseConversionMap(DEFAULT_CONVERSION_MAP);
}

const n = (v: unknown): number => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const s = (v: unknown): string | null => { const t = String(v ?? '').trim(); return t || null; };

async function companyFilter(): Promise<string> {
  const company = (await loadSoftoneConfig()).company?.trim();
  return company && Number.isFinite(Number(company)) ? ` AND COMPANY=${Number(company)}` : '';
}

/** Οι γραμμές ΕΙΔΩΝ των δελτίων, με ό,τι έχει ήδη καλυφθεί. */
export async function fetchNoteLines(notes: { findoc: number; fincode: string | null; date: string | null }[]): Promise<NoteLine[]> {
  if (!notes.length) return [];
  const byId = new Map(notes.map((x) => [x.findoc, x]));
  const rows = await softoneGetTable(
    'MTRLINES', ['FINDOC', 'MTRLINES', 'MTRL', 'QTY1', 'QTY1COV', 'QTY1CANC'],
    `FINDOC IN (${notes.map((x) => x.findoc).join(',')})`,
  );
  const out: NoteLine[] = [];
  for (const r of rows) {
    const findoc = n(r.FINDOC);
    const mtrl = n(r.MTRL);
    const note = byId.get(findoc);
    if (!note || !mtrl) continue;
    out.push({
      findoc, mtrlines: n(r.MTRLINES), mtrl,
      qty1: n(r.QTY1), covered1: n(r.QTY1COV) + n(r.QTY1CANC),
      noteDate: note.date, noteCode: note.fincode,
    });
  }
  return out;
}

/** Τα ανοιχτά δελτία του προμηθευτή στις σειρές του χάρτη μετασχηματισμού, νεότερα πρώτα. */
export async function fetchOpenDeliveryNotes(trdr: number, seriesList: number[], findocs?: number[]): Promise<DeliveryNote[]> {
  if (!Number.isFinite(trdr) || trdr <= 0 || !seriesList.length) return [];
  const only = findocs?.length ? ` AND FINDOC IN (${findocs.map(Number).filter(Number.isFinite).join(',')})` : '';
  const rows = await softoneGetTable(
    'FINDOC', ['FINDOC', 'FINCODE', 'SERIES', 'TRNDATE', 'FULLYTRANSF', 'ISCANCEL', 'SUMAMNT'],
    `SOSOURCE=1251 AND TRDR=${trdr} AND SERIES IN (${seriesList.join(',')}) AND ISCANCEL=0 AND FULLYTRANSF IN (0,2)${await companyFilter()}${only}`,
  );
  const heads = rows
    .map((r) => ({
      findoc: n(r.FINDOC), fincode: s(r.FINCODE), series: n(r.SERIES),
      date: s(r.TRNDATE)?.slice(0, 10) ?? null, transformed: n(r.FULLYTRANSF), total: r.SUMAMNT == null ? null : n(r.SUMAMNT),
    }))
    .filter((h) => h.findoc > 0)
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || b.findoc - a.findoc)
    .slice(0, 50);
  const lines = await fetchNoteLines(heads);
  return heads.map((h) => ({ ...h, lines: lines.filter((l) => l.findoc === h.findoc) }));
}

/** Μετά τον μετασχηματισμό: η κατάσταση των δελτίων (για το read-back). */
export async function fetchNoteState(findocs: number[]): Promise<{ findoc: number; transformed: number }[]> {
  if (!findocs.length) return [];
  const rows = await softoneGetTable('FINDOC', ['FINDOC', 'FULLYTRANSF'], `FINDOC IN (${findocs.join(',')})`);
  return rows.map((r) => ({ findoc: n(r.FINDOC), transformed: n(r.FULLYTRANSF) }));
}
