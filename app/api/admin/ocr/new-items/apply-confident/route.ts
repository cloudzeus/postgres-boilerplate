import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { applyMatchToGroup, loadItemQueue, QueueError } from '@/lib/ocr/queues';
import { bulkPicks } from '@/lib/ocr/bulk-apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Όλες οι ομάδες θέλουν πρόταση εδώ — αλλιώς το «μαζικά» θα έπιανε μόνο τις πρώτες της οθόνης. */
const SUGGEST_ALL = 500;

/**
 * «Δέξου όλες τις σίγουρες προτάσεις» για την ουρά «Είδη & έξοδα».
 *
 * GET  → ΠΡΟΕΠΙΣΚΟΠΗΣΗ: ποιες ομάδες θα εφαρμοστούν και σε τι. Δεν γράφει τίποτα.
 * POST → εφαρμόζει τις ΙΔΙΕΣ, μία-μία, και επιστρέφει τι έγινε ανά ομάδα.
 *
 * Ο κανόνας του «σίγουρη» ζει στο `lib/ocr/bulk-apply.ts` και είναι συντηρητικός: μόνο
 * ντετερμινιστικές προτάσεις (κωδικός / όνομα / μνήμη) πάνω από το κατώφλι, και μόνο σε ομάδα
 * που ξέρει τι είδους είναι. Οι προτάσεις του μοντέλου ΔΕΝ περνούν από εδώ.
 */
async function plan() {
  const { groups } = await loadItemQueue({ suggestFor: SUGGEST_ALL });
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const picks = bulkPicks(groups.map((g) => ({
    key: g.key, category: g.category, suggestions: g.suggestions,
  })));
  return { groups, byKey, picks };
}

export async function GET() {
  await requirePermission('ocr.categorize');
  const { groups, byKey, picks } = await plan();
  return NextResponse.json({
    total: groups.length,
    applicable: picks.length,
    lines: picks.reduce((n, p) => n + (byKey.get(p.key)?.lineCount ?? 0), 0),
    items: picks.map((p) => {
      const g = byKey.get(p.key)!;
      return {
        pattern: g.pattern, supplier: g.supplier, lineCount: g.lineCount, docCount: g.docCount,
        code: p.code, name: p.name, by: p.by, score: p.score,
      };
    }),
  });
}

export async function POST() {
  const u = await requirePermission('ocr.categorize');
  const { byKey, picks } = await plan();

  const results: { pattern: string; code: string; lines: number; error?: string }[] = [];
  for (const p of picks) {
    const g = byKey.get(p.key);
    if (!g) continue;
    try {
      const r = await applyMatchToGroup({
        afm: g.afm, pattern: g.pattern,
        target: { mtrl: p.mtrl, expn: p.expn, lin: p.lin },
        userId: u.id,
      });
      results.push({ pattern: g.pattern, code: p.code, lines: r.linesUpdated });
    } catch (e) {
      // Μία ομάδα που σκάει ΔΕΝ ακυρώνει τις υπόλοιπες: ο χρήστης πάτησε ένα κουμπί για δεκάδες
      // ομάδες, και μια αποτυχία στη μέση θα άφηνε τη μισή δουλειά αναπάντητη.
      results.push({
        pattern: g.pattern, code: p.code, lines: 0,
        error: e instanceof QueueError ? e.message : String((e as Error)?.message ?? e),
      });
    }
  }

  const applied = results.filter((r) => !r.error);
  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.items.bulk_apply_confident', resource: 'ocr_queue',
    metadata: { groups: applied.length, lines: applied.reduce((n, r) => n + r.lines, 0), failed: results.length - applied.length },
  }).catch(() => null);

  return NextResponse.json({
    ok: true,
    groups: applied.length,
    lines: applied.reduce((n, r) => n + r.lines, 0),
    failed: results.filter((r) => r.error),
    results,
  });
}
