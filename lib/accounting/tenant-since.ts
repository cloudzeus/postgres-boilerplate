// lib/accounting/tenant-since.ts — SERVER. Από πότε ισχύει η τρέχουσα εγκατάσταση SoftOne.
//
// Οι αλλαγές που έκανε η εφαρμογή σε ΠΡΟΗΓΟΥΜΕΝΗ εγκατάσταση (άλλο serial/εταιρεία) δεν αφορούν ούτε
// τον λογιστή ούτε τον integrator της τρέχουσας. Όριο = η τελευταία αλλαγή εγκατάστασης που κατέγραψε
// η σύνδεση (`SoftoneConnectionEvent` kind 'tenant_changed'). Χωρίς τέτοια, όλο το ιστορικό.
import 'server-only';
import { prisma } from '@/lib/db';

export async function currentTenantSince(): Promise<Date | null> {
  const ev = await prisma.softoneConnectionEvent.findFirst({
    where: { kind: 'tenant_changed' }, orderBy: { at: 'desc' }, select: { at: true },
  });
  return ev?.at ?? null;
}
