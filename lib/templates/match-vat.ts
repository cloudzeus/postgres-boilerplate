// lib/templates/match-vat.ts — SERVER. «Ποιο πρότυπο ανήκει σε αυτό το ΑΦΜ;»
//
// Ζει μόνο του (κι όχι μέσα στον runner) ώστε ο αναγνωριστής διάταξης να μπορεί να το ρωτήσει
// πρώτος χωρίς να δημιουργήσει κύκλο εισαγωγών με το `run.ts`, που με τη σειρά του τον καλεί.
import 'server-only';
import { prisma } from '@/lib/db';
import { normalizeVat } from './schema';

/** The ACTIVE template linked to this issuer ΑΦΜ (most recently updated wins). */
export async function findTemplateForVat(vat: unknown): Promise<string | null> {
  const afm = normalizeVat(vat);
  if (!afm) return null;
  const t = await prisma.extractionTemplate.findFirst({
    where: { vatNumber: afm, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return t?.id ?? null;
}
