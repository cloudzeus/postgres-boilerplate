import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePermission } from '@/lib/rbac';
import { suggestExpensesWithAi, MAX_GROUPS } from '@/lib/ocr/expense-ai';
import { suggestAnalyticsWithAi } from '@/lib/ocr/analytics-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  groups: z.array(z.object({
    key: z.string().trim().min(1).max(260),
    afm: z.string().trim().max(20).default(''),
    pattern: z.string().trim().min(1).max(200),
    sample: z.string().trim().max(400).nullish(),
    code: z.string().trim().max(60).nullish(),
  })).min(1).max(MAX_GROUPS),
  categoryId: z.number().int().positive().nullish(),
  /** TRDR του εκδότη — στενεύει τα έργα σε αυτά του συναλλασσομένου. */
  trdr: z.number().int().positive().nullish(),
  /** `false` για να ζητηθεί μόνο η δαπάνη (π.χ. όταν η σειρά στέλνει EXPANAL). */
  analytics: z.boolean().optional(),
});

// POST — ΠΡΟΤΑΣΗ δαπάνης με AI, μόνο για τις ομάδες που δεν έλυσε ο φθηνός δρόμος.
// Τρέχει ΜΟΝΟ όταν το ζητήσει ο χρήστης (κουμπί «Πρόταση με AI»), ποτέ αυτόματα.
export async function POST(req: Request) {
  const u = await requirePermission('ocr.categorize');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const { groups, categoryId, trdr, analytics } = parsed.data;
  // ΕΝΑ κλικ, ΜΙΑ παρτίδα ανά επίπεδο: δαπάνη και αναλυτική ζητιούνται μαζί ώστε ο χρήστης να μην
  // πατάει τρία κουμπιά. Κάθε πλευρά έχει τη δική της λευκή λίστα και τη δική της κρυφή μνήμη.
  const [expense, analyticsResult] = await Promise.all([
    suggestExpensesWithAi({ groups, categoryId, userId: u.id }),
    analytics === false
      ? Promise.resolve({ suggestions: [], asked: 0, cached: 0, degraded: false })
      : suggestAnalyticsWithAi({ groups, trdr, userId: u.id }),
  ]);
  return NextResponse.json({
    ...expense,
    analytics: analyticsResult.suggestions,
    analyticsAsked: analyticsResult.asked,
    // «Υποβαθμισμένο» μόνο όταν ΚΑΜΙΑ πλευρά δεν απάντησε — αλλιώς κάτι χρήσιμο γύρισε.
    degraded: expense.degraded && analyticsResult.degraded,
  });
}
