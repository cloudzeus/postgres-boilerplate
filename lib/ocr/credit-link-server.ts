// SERVER: υποψήφια αρχικά για ένα πιστωτικό και αποθήκευση της σύνδεσης. Βλ. `lib/ocr/credit-link.ts`.
import 'server-only';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { softoneGetTable } from '@/lib/softone';
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { normalizeAfm } from '@/lib/ocr/validate';
import { suggestOriginal, type CreditCandidate } from '@/lib/ocr/credit-link';

export class CreditLinkError extends Error {}

const eur = (v: number | null) => (v == null ? '' : ` · ${v.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const day = (s: unknown) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s ?? '')); return m ? m[1] : null; };

export async function creditCandidates(docId: string) {
  const doc = await prisma.ocrDocument.findUnique({ where: { id: docId }, select: { softoneTrdr: true, issuerAfm: true } });
  if (!doc) throw new CreditLinkError('Το παραστατικό δεν βρέθηκε.');
  const document = await loadDocumentJson(docId);
  const printed = document.references?.related ?? null;

  // (1) Ό,τι καταχώρισε η εφαρμογή από τον ίδιο εκδότη (ΑΦΜ) — με τον αριθμό όπως διαβάστηκε.
  const afm = normalizeAfm(document.issuer.vat) ?? doc.issuerAfm;
  const posted = afm ? await prisma.ocrDocument.findMany({
    where: { id: { not: docId }, postStatus: 'POSTED', issuerAfm: afm, postedRef: { not: null } },
    select: { postedRef: true, document: true, postedAt: true }, orderBy: { postedAt: 'desc' }, take: 50,
  }) : [];
  const fromApp: CreditCandidate[] = posted.flatMap((p) => {
    const d = p.document as { type?: { number?: string | null }; date?: string | null; totals?: { total?: number | null } } | null;
    const findoc = Number(p.postedRef);
    if (!Number.isFinite(findoc)) return [];
    const number = d?.type?.number ?? null;
    return [{ findoc, number, date: d?.date ?? null, total: d?.totals?.total ?? null, source: 'app' as const, label: `${number ?? `FINDOC ${findoc}`}${d?.date ? ` · ${d.date}` : ''}${eur(d?.totals?.total ?? null)}` }];
  });

  // (2) Στη SoftOne: παραστατικά του ίδιου συναλλασσομένου (και όσα έγιναν εκτός εφαρμογής).
  let fromSoftone: CreditCandidate[] = [];
  let softoneError: string | null = null;
  if (doc.softoneTrdr) {
    const rows = await softoneGetTable('FINDOC', ['FINDOC', 'FINCODE', 'TAXSERIESNUM', 'TRNDATE', 'SUMAMNT', 'ISCANCEL'], `TRDR=${doc.softoneTrdr}`)
      .catch((e: Error) => { softoneError = e.message; return []; });
    fromSoftone = rows
      .filter((r) => r.ISCANCEL !== '1')
      .map((r) => {
        const findoc = Number(r.FINDOC);
        const number = (r.TAXSERIESNUM || r.FINCODE || null) as string | null;
        const total = r.SUMAMNT == null || r.SUMAMNT === '' ? null : Number(r.SUMAMNT);
        return { findoc, number, date: day(r.TRNDATE), total, source: 'softone' as const, label: `${r.FINCODE || number || `FINDOC ${findoc}`}${day(r.TRNDATE) ? ` · ${day(r.TRNDATE)}` : ''}${eur(total)}` };
      })
      .filter((c) => Number.isFinite(c.findoc));
  }

  // Ίδιο FINDOC από τις δύο πηγές = ένας υποψήφιος (κρατάμε της εφαρμογής: έχει τον αριθμό του χαρτιού).
  const byFindoc = new Map<number, CreditCandidate>();
  for (const c of [...fromSoftone, ...fromApp]) byFindoc.set(c.findoc, c);
  const candidates = [...byFindoc.values()].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))).slice(0, 60);
  return {
    printed,
    printedMark: document.references?.relatedMark ?? null,
    linked: document.references?.linkedFindoc ?? null,
    linkedLabel: document.references?.linkedLabel ?? null,
    noLink: document.references?.noLink === true,
    suggested: suggestOriginal(printed, candidates),
    candidates,
    softoneError,
  };
}

export async function setCreditLink(
  docId: string,
  choice: { findoc: number | null; label?: string | null; noLink?: boolean },
  actor: { id: string; email: string } | null,
) {
  const meta = await prisma.ocrDocument.findUnique({ where: { id: docId }, select: { postStatus: true } });
  if (!meta) throw new CreditLinkError('Το παραστατικό δεν βρέθηκε.');
  if (meta.postStatus === 'POSTED') throw new CreditLinkError('Το πιστωτικό έχει ήδη καταχωριστεί — η σύνδεση αλλάζει πια μόνο στη SoftOne.');
  const doc = await loadDocumentJson(docId);
  const references = {
    ...doc.references,
    linkedFindoc: choice.noLink ? null : choice.findoc,
    linkedLabel: choice.noLink ? null : (choice.label ?? null),
    noLink: choice.noLink === true,
  };
  await saveDocumentJson(docId, { ...doc, references }, { replaceItems: false });
  if (actor) {
    await logAudit({
      userId: actor.id, userEmail: actor.email, action: 'ocr.credit.link', resource: 'ocr_document', resourceId: docId,
      metadata: { summary: choice.noLink ? 'Πιστωτικό χωρίς αρχικό' : `Σύνδεση με ${choice.label ?? `FINDOC ${choice.findoc}`}`, findoc: choice.findoc, noLink: choice.noLink === true },
    }).catch(() => null);
  }
  return references;
}
