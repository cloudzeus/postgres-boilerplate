import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { getSetting } from '@/lib/settings';
import { applyMatchToGroup, loadItemQueue, QueueError } from '@/lib/ocr/queues';
import { splitCandidates, type CreateCandidate, type CreateKind } from '@/lib/ocr/create-plan';
import { VAT_RATE_MAP_SETTING, buildVatRateMap, parseVatRateOverrides } from '@/lib/ocr/vat-map';
import { softoneCreateItem, softoneNextItemCode } from '@/lib/softone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUGGEST_NONE = 0;

/**
 * «Δημιούργησε ό,τι λείπει από το μητρώο» — για τις ομάδες της ουράς «Είδη & έξοδα».
 *
 * GET  → η ΛΙΣΤΑ προς έγκριση: τι θα δημιουργηθεί, με τι κωδικό, και τι μένει απ' έξω και γιατί.
 * POST → δημιουργεί **μόνο τα `keys` που στέλνει ο χρήστης** (τα τσεκαρισμένα), και μετά δένει
 *        τις γραμμές της κάθε ομάδας στη νέα εγγραφή.
 *
 * Καμία εγγραφή χωρίς ρητό τσεκ: το μοντέλο μπορεί να προτείνει τύπο, αλλά η δημιουργία καρτέλας
 * στο SoftOne είναι μόνιμη και δεν γίνεται σιωπηλά (απόφαση χρήστη, 23/09/2026).
 */
async function candidates(): Promise<{ list: CreateCandidate[]; byKey: Map<string, Awaited<ReturnType<typeof loadItemQueue>>['groups'][number]> }> {
  const [{ groups }, vatRows, vatSetting] = await Promise.all([
    loadItemQueue({ suggestFor: SUGGEST_NONE }),
    prisma.vatCategory.findMany({ where: { isActive: true }, select: { code: true, descr: true, rate: true } }),
    getSetting<unknown>(VAT_RATE_MAP_SETTING, {}),
  ]);
  const vat = buildVatRateMap(vatRows.map((r) => ({ ...r, isActive: true })), parseVatRateOverrides(vatSetting));

  // Ο συντελεστής της ομάδας: ΜΟΝΟ αν όλες οι γραμμές της συμφωνούν. Δύο συντελεστές στην ίδια
  // περιγραφή σημαίνει ότι δεν είναι ένα είδος — δεν διαλέγουμε εμείς ποιο.
  const lineIds = groups.flatMap((g) => g.lines.map((l) => l.id));
  const rows = await prisma.ocrInvoiceItem.findMany({ where: { id: { in: lineIds } }, select: { id: true, vatRate: true } });
  const rateById = new Map(rows.map((r) => [r.id, r.vatRate]));

  const byKey = new Map(groups.map((g) => [g.key, g]));
  const list: CreateCandidate[] = groups.map((g) => {
    const rates = new Set(g.lines.map((l) => String(rateById.get(l.id) ?? '')).filter(Boolean));
    const rate = rates.size === 1 ? Number([...rates][0]) : null;
    const vatId = rate != null && Number.isFinite(rate) && vat.byRate[rate] != null ? String(vat.byRate[rate]) : null;
    return {
      key: g.key,
      kind: (g.category as CreateKind | null) ?? null,
      code: g.code,
      sample: g.sample || g.pattern,
      vatId,
      // Η μονάδα δεν ζει στη γραμμή του μητρώου· τη δίνει ο χρήστης μία φορά για όλη την παρτίδα.
      unitId: null,
      duplicateOf: null,
    };
  });
  return { list, byKey };
}

export async function GET() {
  await requirePermission('ocr.categorize');
  const { list, byKey } = await candidates();
  // Η μονάδα λείπει εξ ορισμού στο GET — δείχνουμε τι ΘΑ γινόταν αν δοθεί.
  const withUnit = list.map((c) => ({ ...c, unitId: c.unitId ?? 'ΘΑ ΔΟΘΕΙ' }));
  const { ready, blocked } = splitCandidates(withUnit);
  return NextResponse.json({
    total: list.length,
    ready: ready.map((p) => {
      const g = byKey.get(p.key)!;
      return { key: p.key, kind: p.kind, code: p.code, name: p.name, vatId: p.vatId, supplier: g.supplier, lineCount: g.lineCount, docCount: g.docCount };
    }),
    blocked: blocked.map((b) => ({ ...b, supplier: byKey.get(b.key)?.supplier ?? null, lineCount: byKey.get(b.key)?.lineCount ?? 0 })),
  });
}

const Body = z.object({
  /** Τα ΤΣΕΚΑΡΙΣΜΕΝΑ κλειδιά ομάδων — τίποτα δεν δημιουργείται εκτός αυτών. */
  keys: z.array(z.string().trim().min(1)).min(1).max(200),
  /** Η μονάδα μέτρησης για όλη την παρτίδα (`MTRUNIT`) — ο χρήστης τη διαλέγει μία φορά. */
  unit: z.string().trim().min(1).max(20),
});

export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  const wanted = new Set(parsed.data.keys);

  const { list, byKey } = await candidates();
  const { ready } = splitCandidates(list.filter((c) => wanted.has(c.key)).map((c) => ({ ...c, unitId: parsed.data.unit })));

  const results: { key: string; code: string; name: string; mtrl?: number; lines?: number; error?: string }[] = [];
  for (const p of ready) {
    const g = byKey.get(p.key);
    if (!g) continue;
    try {
      // Ο κωδικός του προμηθευτή αν είναι ελεύθερος, αλλιώς ο επόμενος δικός μας — ΙΔΙΟΣ κανόνας
      // με τη φόρμα δημιουργίας, ώστε να μην αποκλίνει η μαζική από τη μονήρη διαδρομή.
      const next = await softoneNextItemCode(p.kind, { mask: '', supplierCode: p.code ?? undefined }).catch(() => null);
      const code = next?.code ?? p.code;
      if (!code) { results.push({ key: p.key, code: '—', name: p.name, error: 'δεν βρέθηκε ελεύθερος κωδικός' }); continue; }
      const mtrl = await softoneCreateItem({
        code, name: p.name, isService: p.kind === 'service', vat: p.vatId, unit: p.unitId,
      });
      const r = await applyMatchToGroup({
        afm: g.afm, pattern: g.pattern, target: { mtrl }, isService: p.kind === 'service', userId: u.id,
      });
      results.push({ key: p.key, code, name: p.name, mtrl, lines: r.linesUpdated });
    } catch (e) {
      results.push({
        key: p.key, code: p.code ?? '—', name: p.name,
        error: e instanceof QueueError ? e.message : String((e as Error)?.message ?? e).slice(0, 200),
      });
    }
  }

  const okRows = results.filter((r) => !r.error);
  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'ocr.items.bulk_create_missing', resource: 'ocr_queue',
    metadata: { created: okRows.length, lines: okRows.reduce((n, r) => n + (r.lines ?? 0), 0), failed: results.length - okRows.length },
  }).catch(() => null);

  return NextResponse.json({
    ok: true,
    created: okRows.length,
    lines: okRows.reduce((n, r) => n + (r.lines ?? 0), 0),
    failed: results.filter((r) => r.error),
    results,
  });
}
