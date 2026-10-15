// SERVER: «Από δελτίο αποστολής» — εύρεση, σύγκριση και μετασχηματισμός σε τιμολόγιο αγοράς.
//
// Ροή (βλ. wiki ocr/delivery-note):
//   1. `deliveryNoteOverview` — τα ανοιχτά δελτία του προμηθευτή, με πρόταση (ο αριθμός δελτίου που
//      τυπώνει το τιμολόγιο) και τη σύγκριση γραμμή-γραμμή για την πρόταση.
//   2. `compareWithNotes` — ίδια σύγκριση για όσα δελτία επιλέξει ο χρήστης.
//   3. `convertFromNotes` — ΞΑΝΑΔΙΑΒΑΖΕΙ τα δελτία (ίσως τιμολογήθηκαν στο μεταξύ), ξανακρίνει, και
//      καταχωρεί μέσω της ΙΔΙΑΣ ροής με την απλή καταχώριση (`postDocumentToSoftone`): ίδια εμπόδια,
//      ίδιος έλεγχος διπλοτύπου, `calculate` πριν, read-back μετά.
import 'server-only';
import { prisma } from '@/lib/db';
import { discountFields, purchaseQtyPrice } from './purdoc-payload';
import { gatherForConversion, postDocumentToSoftone, blockerMessage, PostError, POSTING_ENABLED_KEY, POST_ERROR_TEXT, type ConversionSpec } from './post-softone';
import { getSetting } from '@/lib/settings';
import {
  planConversion, noteScore, VERDICT_TEXT, type InvoiceLine, type LineVerdict, type NoteLine,
} from './delivery-note-match';
import { fetchOpenDeliveryNotes, loadConversionMap, type DeliveryNote } from '@/lib/softone-sync/delivery-notes';

export interface NoteSummary {
  findoc: number; fincode: string | null; series: number; date: string | null;
  transformed: number; total: number | null; score: number; lineCount: number;
}

export interface CompareView {
  status: 'match' | 'partial' | 'blocked';
  /** Σειρά-στόχος (π.χ. 2061) και η περιγραφή της. */
  target: { series: number; label: string } | null;
  lines: {
    rowIndex: number; name: string | null; qty1: number; status: LineVerdict['status']; text: string;
    links: { findoc: number; fincode: string | null; mtrlines: number; qty1: number }[];
  }[];
  /** Ό,τι μένει ανοιχτό στα δελτία μετά τον μετασχηματισμό. */
  leftovers: { findoc: number; fincode: string | null; mtrlines: number; code: string | null; name: string | null; open1: number; left1: number }[];
  /** Γιατί δεν επιτρέπεται (επιπλέον των γραμμών): εμπόδια καταχώρισης, άλλη σειρά-στόχος, κ.λπ. */
  problems: string[];
}

const docRefs = (deliveryNote: string | null | undefined): string[] => {
  const raw = String(deliveryNote ?? '').trim();
  if (!raw) return [];
  return [raw, ...raw.split(/[,;&+/]|\bκαι\b/i).map((t) => t.trim()).filter(Boolean)];
};

/** Οι γραμμές του τιμολογίου όπως θα τις έστελνε η καταχώριση — σε βασικές μονάδες. */
async function invoiceLines(id: string) {
  const g = await gatherForConversion(id);
  const byRow = new Map(g.ctx.lines.map((l) => [l.rowIndex, l]));
  const lines: InvoiceLine[] = [];
  g.document.lines.forEach((line, i) => {
    const m = byRow.get(i);
    if (!m || m.omit) return;
    const stock = m.mtrl != null && m.isService !== true && m.asset == null;
    const other = !stock && (m.mtrl != null || m.expn != null || m.lin != null || m.asset != null || (m.allocations?.length ?? 0) > 0);
    const qp = purchaseQtyPrice(Number(line.quantity ?? 1) || 1, Number(line.unitPrice ?? 0) || 0, m.buyRatio, m.qtyInBase === true);
    const r = Number(m.buyRatio) > 0 ? Number(m.buyRatio) : 1;
    lines.push({
      rowIndex: i,
      mtrl: stock ? (m.mtrl as number) : null,
      isService: other,
      qty1: Math.round(qp.QTY * r * 1_000_000) / 1_000_000,
      name: line.name ?? null,
      hasDiscountAmount: discountFields(line).DISC1VAL != null,
    });
  });
  return { g, lines };
}

async function itemNames(mtrls: number[]) {
  const rows = mtrls.length
    ? await prisma.softoneItem.findMany({ where: { mtrl: { in: [...new Set(mtrls)] } }, select: { mtrl: true, code: true, name: true } })
    : [];
  return new Map(rows.map((r) => [r.mtrl, r]));
}

async function seriesLabel(series: number): Promise<string> {
  const t = await prisma.purchaseDocType.findUnique({ where: { code: String(series) }, select: { name: true, abbrev: true } }).catch(() => null);
  return t ? `${t.abbrev ? `${t.abbrev} · ` : ''}${t.name} (${series})` : `Σειρά ${series}`;
}

function summarize(n: DeliveryNote, refs: string[], mtrls: number[]): NoteSummary {
  return {
    findoc: n.findoc, fincode: n.fincode, series: n.series, date: n.date, transformed: n.transformed, total: n.total,
    score: noteScore({ fincode: n.fincode, mtrls: n.lines.map((l) => l.mtrl) }, refs, mtrls),
    lineCount: n.lines.length,
  };
}

async function buildView(id: string, notes: DeliveryNote[], conversionMap: Map<number, number>) {
  const { g, lines } = await invoiceLines(id);
  const noteLines: NoteLine[] = notes.flatMap((n) => n.lines);
  const plan = planConversion(lines, noteLines);
  const problems: string[] = [];

  const targets = [...new Set(notes.map((n) => conversionMap.get(n.series)).filter((v): v is number => v != null))];
  if (targets.length > 1) problems.push('Τα επιλεγμένα δελτία μετασχηματίζονται σε διαφορετικές σειρές τιμολογίου — επίλεξε δελτία της ίδιας σειράς.');
  const target = targets.length === 1 ? { series: targets[0], label: await seriesLabel(targets[0]) } : null;
  if ((await getSetting<boolean>(POSTING_ENABLED_KEY).catch(() => false)) !== true) problems.push(POST_ERROR_TEXT.posting_disabled);
  if (g.doc.postStatus === 'POSTED') problems.push(`Το παραστατικό έχει ήδη καταχωριστεί${g.doc.postedRef ? ` (FINDOC ${g.doc.postedRef})` : ''}.`);

  // Τα εμπόδια της καταχώρισης ΜΕ τη σειρά-στόχο και τη σύνδεση — ό,τι θα έλεγε και το κουμπί.
  if (target && plan.links.size) {
    const spec: ConversionSpec = { series: target.series, links: plan.links, findocs: notes.map((n) => n.findoc) };
    const withConv = await gatherForConversion(id, spec);
    for (const b of withConv.blockers) problems.push(blockerMessage(b, withConv.accounts));
  }

  const code = new Map(notes.map((n) => [n.findoc, n.fincode]));
  const names = await itemNames(noteLines.map((l) => l.mtrl));
  const byRow = new Map(lines.map((l) => [l.rowIndex, l]));
  const view: CompareView = {
    status: problems.length ? 'blocked' : plan.status,
    target,
    lines: plan.lines.map((v) => {
      const l = byRow.get(v.rowIndex);
      const links = 'links' in v ? v.links : [];
      return {
        rowIndex: v.rowIndex, name: l?.name ?? null, qty1: l?.qty1 ?? 0, status: v.status,
        text: v.status === 'excess' ? `${VERDICT_TEXT.excess} (λείπουν ${v.missing1.toLocaleString('el-GR')} βασικές μονάδες)` : VERDICT_TEXT[v.status],
        links: links.map((s) => ({ ...s, fincode: code.get(s.findoc) ?? null })),
      };
    }),
    leftovers: plan.rest.filter((r) => r.left1 > 1e-6).map((r) => ({
      findoc: r.findoc, fincode: code.get(r.findoc) ?? null, mtrlines: r.mtrlines,
      code: names.get(r.mtrl)?.code ?? null, name: names.get(r.mtrl)?.name ?? null, open1: r.open1, left1: r.left1,
    })),
    problems,
  };
  return { view, plan, target, g };
}

async function trdrOf(id: string): Promise<number> {
  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { softoneTrdr: true } });
  if (!doc) throw new PostError('not_found', 'Το έγγραφο δεν βρέθηκε');
  if (!doc.softoneTrdr) throw new PostError('no_trader', 'Ο προμηθευτής δεν έχει δεθεί με καρτέλα SoftOne — χωρίς αυτόν δεν βρίσκονται τα δελτία του.');
  return doc.softoneTrdr;
}

/** Τα ανοιχτά δελτία του προμηθευτή + πρόταση + σύγκριση για την πρόταση. Μόνο ΑΝΑΓΝΩΣΕΙΣ. */
export async function deliveryNoteOverview(id: string) {
  const trdr = await trdrOf(id);
  const map = await loadConversionMap();
  const [notes, { g, lines }] = await Promise.all([fetchOpenDeliveryNotes(trdr, [...map.keys()]), invoiceLines(id)]);
  const refs = docRefs(g.document.references?.deliveryNote);
  const invMtrls = lines.map((l) => l.mtrl).filter((v): v is number => v != null);
  const date = g.document.date ?? null;
  // Δελτίο ΜΕΤΑ το τιμολόγιο δεν μπορεί να είναι η πηγή του.
  const eligible = notes.filter((n) => !date || !n.date || n.date <= date);
  const candidates = eligible.map((n) => summarize(n, refs, invMtrls)).sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
  const byRef = candidates.filter((c) => c.score === 2).map((c) => c.findoc);
  const suggested = byRef.length ? byRef : candidates.filter((c) => c.score === 1).slice(0, 1).map((c) => c.findoc);
  const compare = suggested.length
    ? (await buildView(id, eligible.filter((n) => suggested.includes(n.findoc)), map)).view
    : null;
  return { candidates, suggested, compare, referencedNote: g.document.references?.deliveryNote ?? null, conversionMap: Object.fromEntries(map) };
}

/** Σύγκριση με τα δελτία που επέλεξε ο χρήστης (ζωντανή ανάγνωση). */
export async function compareWithNotes(id: string, findocs: number[]): Promise<CompareView> {
  const trdr = await trdrOf(id);
  const map = await loadConversionMap();
  const notes = await fetchOpenDeliveryNotes(trdr, [...map.keys()], findocs);
  const missing = findocs.filter((f) => !notes.some((n) => n.findoc === f));
  const { view } = await buildView(id, notes, map);
  if (missing.length) {
    view.problems.unshift(`Τα δελτία ${missing.join(', ')} δεν είναι πλέον ανοιχτά (μετασχηματίστηκαν ή ακυρώθηκαν στο μεταξύ).`);
    view.status = 'blocked';
  }
  return view;
}

/**
 * Ο ΜΕΤΑΣΧΗΜΑΤΙΣΜΟΣ. Ξαναδιαβάζει, ξανακρίνει, και καταχωρεί μόνο αν: όλες οι γραμμές είδους
 * καλύπτονται, κανένα εμπόδιο, και — όταν τα δελτία αφήνουν υπόλοιπο — ο χρήστης το αποδέχτηκε ρητά.
 */
export async function convertFromNotes(id: string, findocs: number[], opts: { acceptPartial: boolean; userId: string }) {
  if (!findocs.length) throw new PostError('conversion_check', 'Δεν επιλέχτηκε δελτίο αποστολής.');
  const trdr = await trdrOf(id);
  const map = await loadConversionMap();
  const notes = await fetchOpenDeliveryNotes(trdr, [...map.keys()], findocs);
  const missing = findocs.filter((f) => !notes.some((n) => n.findoc === f));
  if (missing.length) throw new PostError('conversion_check', `Τα δελτία ${missing.join(', ')} δεν είναι πλέον ανοιχτά — ξαναφόρτωσε τη σύγκριση.`);
  const { view, plan, target } = await buildView(id, notes, map);
  if (view.status === 'blocked' || !target) {
    throw new PostError('conversion_check', view.problems[0] ?? view.lines.find((l) => l.status !== 'covered' && l.status !== 'not_stock')?.text ?? 'Το τιμολόγιο δεν συμφωνεί με τα δελτία.');
  }
  if (view.status === 'partial' && !opts.acceptPartial) {
    throw new PostError('conversion_check', 'Τα δελτία αφήνουν υπόλοιπο — επιβεβαίωσε τον μερικό μετασχηματισμό.');
  }
  return postDocumentToSoftone(id, {
    syncTemplateRun: true, verified: true, verifiedById: opts.userId,
    conversion: { series: target.series, links: plan.links, findocs },
  });
}
