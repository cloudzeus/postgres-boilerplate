import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { cachedGeocodeAddressParts } from '@/lib/geocode-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  address: z.string().trim().min(1, 'Χρειάζεται διεύθυνση').max(300),
  countryHint: z.string().trim().regex(/^[A-Za-z]{2}$/).nullish(),
});

// POST { address, countryHint? } — αναλύει μια ελεύθερη διεύθυνση σε χώρα/πόλη/ΤΚ/συντεταγμένες.
// Το χρειάζεται η ουρά «Νέοι συναλλασσόμενοι» για ΞΕΝΟΥΣ εκδότες, όπου δεν υπάρχει
// μητρώο ΑΑΔΕ — δουλεύει όμως και για ελληνικές διευθύνσεις.
//
// Το route είναι πλέον ΜΝΗΜΟΝΙΚΟ: κάθε διακριτή (κανονικοποιημένη) διεύθυνση ρωτά τον
// πάροχο μία και μόνη φορά. Το `cached: true` στην απάντηση σημαίνει «καμία χρέωση».
export async function POST(req: Request) {
  await requirePermission('ocr.categorize');

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const { found, parts, cached } = await cachedGeocodeAddressParts(parsed.data.address, {
    countryHint: parsed.data.countryHint ?? null,
  });
  // Καμία αποτυχία δεν γίνεται 5xx: το UI δείχνει απλώς «δεν βρέθηκε».
  if (!found || !parts) return NextResponse.json({ found: false, cached });
  return NextResponse.json({ found: true, cached, ...parts });
}
