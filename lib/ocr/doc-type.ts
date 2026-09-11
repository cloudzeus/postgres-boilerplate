import 'server-only';
import { prisma } from '@/lib/db';
import { classifySeries, type ClassifyResult, type SeriesCandidate } from './doc-type-classify';
import { callTextLLM, resolveCfg } from './extract';

/**
 * Ενεργοποιημένες σειρές: αγορών (PurchaseDocType, SOSOURCE 1251) ∪ πιστωτών
 * (SoftoneDocSeries, SOSOURCE 1653). Μόνο αυτές μπορεί να επιλέξει ο ταξινομητής (spec §1.1).
 */
export async function loadEnabledSeries(): Promise<SeriesCandidate[]> {
  const [purchases, creditors] = await Promise.all([
    prisma.purchaseDocType.findMany({
      where: { enabled: true, isActive: true },
      select: { code: true, abbrev: true, name: true },
    }),
    prisma.softoneDocSeries.findMany({
      where: { enabled: true, isActive: true, sosource: 1653 },
      select: { code: true, abbrev: true, name: true, sosource: true },
    }),
  ]);
  return [
    ...purchases.map((x) => ({ ...x, kind: 'purchase' as const, sosource: 1251 })),
    ...creditors.map((x) => ({ ...x, kind: 'creditor' as const })),
  ];
}

/** `softoneKind` του εγγράφου (ετικέτα SoftOne) → πλευρά για τον ταξινομητή. */
const issuerKindOf = (softoneKind: string | null): 'supplier' | 'creditor' | null =>
  softoneKind === 'Προμηθευτής' ? 'supplier' : softoneKind === 'Πιστωτής' ? 'creditor' : null;

/**
 * Ταξινομεί το έγγραφο σε μία ενεργοποιημένη σειρά και το αποθηκεύει.
 * Δεν ξαναγράφει ποτέ χειροκίνητη επιλογή (`seriesBy === 'manual'`). Δεν πετάει ποτέ:
 * τρέχει best-effort μέσα στη ροή upload/reextract.
 */
export async function classifyDocument(docId: string): Promise<{ code: string; confidence: number } | null> {
  try {
    const doc = await prisma.ocrDocument.findUnique({
      where: { id: docId },
      select: { extractedData: true, softoneKind: true, invoiceKind: true, seriesBy: true },
    });
    if (!doc || doc.seriesBy === 'manual') return null;

    const candidates = await loadEnabledSeries();
    if (!candidates.length) return null;

    const d = (doc.extractedData ?? {}) as Record<string, unknown>;
    let r = classifySeries(
      {
        documentTypeLabel: typeof d.documentTypeLabel === 'string' ? d.documentTypeLabel : null,
        issuerKind: issuerKindOf(doc.softoneKind),
        totalAmount: typeof d.totalAmount === 'number' ? d.totalAmount : null,
        invoiceKind: (doc.invoiceKind as 'service' | 'product' | 'mixed' | null) ?? null,
      },
      candidates,
    );
    if (!r) return null;

    // Ισοπαλία (< 0,15 διαφορά): ρωτάμε το μοντέλο κειμένου με τις υποψήφιες σειρές (spec §1.3).
    if (r.tie) {
      const options = r.alternatives
        .map((a) => candidates.find((c) => c.code === a.code))
        .filter((c): c is SeriesCandidate => Boolean(c));
      // Αν το μοντέλο δεν απαντήσει, κρατάμε τον νικητή της βαθμολογίας (με τη χαμηλή βεβαιότητα της ισοπαλίας).
      const picked = await modelTieBreak(docId, d, options).catch((e) => {
        console.error('[doc-type] tie-break failed', docId, (e as Error).message);
        return null;
      });
      if (picked) {
        r = {
          ...r,
          code: picked.code,
          sosource: picked.sosource,
          kind: picked.kind,
          confidence: Math.max(r.confidence, 0.7),
          reason: `${r.reason} · επιλογή μοντέλου`,
          tie: false,
        } satisfies ClassifyResult;
      }
    }

    await prisma.ocrDocument.update({
      where: { id: docId },
      data: {
        softoneSeries: r.code,
        seriesSource: r.sosource,
        seriesConfidence: r.confidence,
        seriesReason: r.reason,
        seriesBy: 'auto',
      },
    });
    return { code: r.code, confidence: r.confidence };
  } catch (e) {
    console.error('[doc-type] classify failed', docId, (e as Error).message);
    return null;
  }
}

/**
 * Το `callTextLLM` στέλνει `response_format: json_object`, άρα ζητάμε ρητά JSON
 * `{"code":"…"}`. Το κόστος καταγράφεται μέσα στο `callTextLLM` (operation `ocr.classify_series`).
 */
async function modelTieBreak(
  docId: string, d: Record<string, unknown>, options: SeriesCandidate[],
): Promise<SeriesCandidate | null> {
  if (options.length < 2) return null;
  const cfg = await resolveCfg();
  if (!cfg.textKey) return null;
  const list = options
    .map((o) => `${o.code}: ${o.abbrev ?? ''} ${o.name} (${o.kind === 'purchase' ? 'αγορών' : 'πιστωτών'})`)
    .join('\n');
  const lines = Array.isArray(d.items)
    ? (d.items as { name?: unknown }[]).slice(0, 5).map((i) => String(i?.name ?? '')).join('; ')
    : '';
  const system = 'You classify Greek purchase documents into ONE SoftOne document series. '
    + 'Answer with JSON only: {"code":"<series code from the list>"}.';
  const user = `Document: type «${d.documentTypeLabel ?? ''}», issuer «${d.companyName ?? ''}», `
    + `total ${d.totalAmount ?? ''}, lines: ${lines}\n\nSeries:\n${list}\n\nReply {"code":"…"}.`;
  const out = await callTextLLM(cfg, system, user, {
    operation: 'ocr.classify_series', refType: 'OcrDocument', refId: docId,
  });
  const raw = String(out?.content ?? '');
  let code: string | null = null;
  try {
    const parsed = JSON.parse(raw) as { code?: unknown };
    if (parsed && parsed.code != null) code = String(parsed.code).trim();
  } catch {
    // Το μοντέλο αγνόησε το json_object (ή γύρισε σκέτο κωδικό): κρατάμε τον πρώτο αριθμό.
    code = raw.match(/\d{3,6}/)?.[0] ?? null;
  }
  if (!code) return null;
  return options.find((o) => o.code === code) ?? null;
}
