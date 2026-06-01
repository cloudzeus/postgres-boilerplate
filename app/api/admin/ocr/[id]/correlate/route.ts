import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { deepseekChat } from '@/lib/deepseek';

export const runtime = 'nodejs';

// Correlates an OCR invoice's line codes with SoftOne items (by CODE / CODE2
// factory / CODE1 EAN, from the local mirror) and asks DeepSeek whether the
// invoice is a service or product invoice.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requirePermission('ocr.read');
  const { id } = await ctx.params;

  const doc = await prisma.ocrDocument.findUnique({
    where: { id },
    select: {
      extractedData: true,
      items: { orderBy: { rowIndex: 'asc' }, select: { id: true, rowIndex: true, code: true, name: true } },
    },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const lines = doc.items.map((it) => ({ id: it.id, rowIndex: it.rowIndex, code: (it.code ?? '').trim(), name: it.name }));
  const codes = Array.from(new Set(lines.map((l) => l.code).filter(Boolean)));

  // One query against the local SoftOne items mirror.
  const matches = codes.length
    ? await prisma.softoneItem.findMany({
        where: { OR: [{ code: { in: codes } }, { code2: { in: codes } }, { code1: { in: codes } }] },
        select: { mtrl: true, code: true, code1: true, code2: true, name: true, isService: true },
      })
    : [];

  const byCode = new Map(matches.map((m) => [m.code, m]));
  const byCode2 = new Map(matches.filter((m) => m.code2).map((m) => [m.code2!, m]));
  const byCode1 = new Map(matches.filter((m) => m.code1).map((m) => [m.code1!, m]));

  const resultLines = lines.map((l) => {
    // Invoice line carries the supplier/manufacturer code → prefer factory(CODE2)/EAN(CODE1), then CODE.
    let m = null as (typeof matches)[number] | null;
    let matchedBy: 'code2' | 'code1' | 'code' | null = null;
    if (l.code) {
      if (byCode2.has(l.code)) { m = byCode2.get(l.code)!; matchedBy = 'code2'; }
      else if (byCode1.has(l.code)) { m = byCode1.get(l.code)!; matchedBy = 'code1'; }
      else if (byCode.has(l.code)) { m = byCode.get(l.code)!; matchedBy = 'code'; }
    }
    return {
      id: l.id,
      rowIndex: l.rowIndex,
      lineCode: l.code || null,
      lineName: l.name,
      match: m ? { mtrl: m.mtrl, code: m.code, code1: m.code1, code2: m.code2, name: m.name, isService: m.isService } : null,
      matchedBy,
    };
  });

  // Persist line matches (keep manual matches — only overwrite non-manual rows).
  await Promise.all(resultLines.map((l) =>
    prisma.ocrInvoiceItem.updateMany({
      where: { id: l.id, NOT: { softoneMatchedBy: 'manual' } },
      data: l.match
        ? { softoneMtrl: l.match.mtrl, softoneCode: l.match.code, softoneName: l.match.name, softoneIsService: l.match.isService, softoneMatchedBy: l.matchedBy }
        : { softoneMtrl: null, softoneCode: null, softoneName: null, softoneIsService: null, softoneMatchedBy: null },
    }),
  ));

  // DeepSeek classification of invoice type (best-effort).
  let invoiceType: 'service' | 'product' | 'mixed' | 'unknown' = 'unknown';
  let reason = '';
  try {
    const ed = (doc.extractedData ?? {}) as Record<string, unknown>;
    const issuer = String(ed.companyName ?? ed.storeName ?? '');
    const lineList = lines.slice(0, 40).map((l) => `- ${l.name}`).join('\n');
    const out = await deepseekChat([
      {
        role: 'system',
        content:
          'Είσαι ταξινομητής ελληνικών τιμολογίων. Με βάση τον εκδότη και τις γραμμές, αποφάσισε αν πρόκειται για ' +
          'Τιμολόγιο Παροχής Υπηρεσιών (service), Τιμολόγιο Προϊόντων/Αγαθών (product), ή mixed. ' +
          'Απάντησε ΜΟΝΟ με JSON: {"type":"service|product|mixed","reason":"σύντομη αιτιολογία στα ελληνικά"}.',
      },
      { role: 'user', content: `Εκδότης: ${issuer}\nΓραμμές:\n${lineList}` },
    ], { temperature: 0 });
    const json = JSON.parse(out.replace(/^```json\s*|\s*```$/g, '').trim());
    if (['service', 'product', 'mixed'].includes(json.type)) invoiceType = json.type;
    reason = String(json.reason ?? '');
  } catch {
    // leave 'unknown' if DeepSeek/JSON fails
  }

  if (invoiceType !== 'unknown') {
    await prisma.ocrDocument.update({ where: { id }, data: { invoiceKind: invoiceType } });
  }

  const matchedCount = resultLines.filter((l) => l.match).length;
  // Persist the line-match tally for the reconciliation status (εκκρεμότητα) derivation.
  await prisma.ocrDocument.update({
    where: { id },
    data: { itemsTotal: resultLines.length, itemsMatched: matchedCount },
  }).catch(() => {});

  return NextResponse.json({
    invoiceType, reason,
    totalLines: resultLines.length,
    matchedCount,
    lines: resultLines,
  });
}
