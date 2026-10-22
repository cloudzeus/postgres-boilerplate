// SERVER: ζωντανή ανάγνωση της παρακολούθησης σειριακών (`MTRSNUSE`, `SNCODEMSK`) για λίγα είδη.
// Μόνο ανάγνωση (GetTable). Μικρή μνήμη 2′: η προεπισκόπηση τρέχει σε κάθε άνοιγμα, αλλά ο χρήστης
// που μόλις ενεργοποίησε «SN» στην καρτέλα του είδους πρέπει να το δει σχεδόν αμέσως.
import 'server-only';
import { softoneGetTable } from '@/lib/softone';

type SnInfo = { snUse: number; snMask: string | null };
const TTL_MS = 2 * 60_000;
const cache = new Map<number, { at: number; v: SnInfo }>();

/** MTRL → παρακολούθηση. Ό,τι η SoftOne δεν απάντησε απλώς λείπει από τον χάρτη (= άγνωστο). */
export async function serialTrackingFor(mtrls: readonly number[]): Promise<Map<number, SnInfo>> {
  const out = new Map<number, SnInfo>();
  const now = Date.now();
  const need = [...new Set(mtrls.filter((m) => Number.isInteger(m) && m > 0))].filter((m) => {
    const c = cache.get(m);
    if (c && now - c.at < TTL_MS) { out.set(m, c.v); return false; }
    return true;
  });
  if (!need.length) return out;
  const rows = await softoneGetTable('MTRL', ['MTRL', 'MTRSNUSE', 'SNCODEMSK'], `MTRL IN (${need.join(',')})`).catch(() => []);
  for (const r of rows) {
    const mtrl = Number(r.MTRL);
    const snUse = Number(r.MTRSNUSE);
    if (!Number.isFinite(mtrl) || !Number.isFinite(snUse)) continue;
    const v = { snUse, snMask: (r.SNCODEMSK ?? '').trim() || null };
    cache.set(mtrl, { at: now, v });
    out.set(mtrl, v);
  }
  return out;
}
