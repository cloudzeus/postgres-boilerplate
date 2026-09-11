import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { countQueues } from '@/lib/ocr/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — εκκρεμότητες των δύο ουρών για τα badges του sidebar (spec §2/§3):
// `traders` = διακριτά ΑΦΜ χωρίς συναλλασσόμενο (χωρίς τους αγνοημένους),
// `items` = εκκρεμείς γραμμές παραστατικών.
export async function GET() {
  await requirePermission('ocr.read');
  return NextResponse.json(await countQueues());
}
