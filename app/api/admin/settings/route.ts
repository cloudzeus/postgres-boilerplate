import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { SETTING_CATALOG, maskSecret, setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';
import { clearCachedToken } from '@/lib/softone';

/**
 * Κλειδιά που ορίζουν ΠΟΙΑ σύνδεση SoftOne είναι η τρέχουσα. Το `lib/softone.ts` κρατάει το μόνιμο
 * `clientID` σε cache (μνήμη + `AppSetting`) για 30 λεπτά: αλλάζοντας εταιρία/υποκατάστημα ή
 * διαπιστευτήρια χωρίς να το πετάξουμε, η εφαρμογή θα συνέχιζε να μιλάει στο SoftOne με συνεδρία
 * δεμένη στην ΠΑΛΙΑ εταιρία μέχρι να λήξει το token ή να τύχει μια κλήση να σκάσει με -101.
 *
 * Το ίδιο το `integrations.softoneTokenCache` ΔΕΝ είναι στον κατάλογο, άρα δεν φτάνει ποτέ εδώ ως
 * update — μόνο οι ρυθμίσεις που το ακυρώνουν.
 */
const SOFTONE_CONNECTION_KEYS = new Set([
  'integrations.softoneSerial',
  'integrations.softoneAppId',
  'integrations.softoneUser',
  'integrations.softonePass',
  'integrations.softoneCompany',
  'integrations.softoneBranch',
  'integrations.softoneModule',
  'integrations.softoneRefid',
]);

export async function GET() {
  const u = await requirePermission('system.settings');
  const rows = await prisma.appSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const settings = SETTING_CATALOG.map((def) => {
    const raw = map.get(def.key) ?? def.defaultValue ?? null;
    return {
      key: def.key,
      category: def.category,
      label: def.label,
      type: def.type,
      isSecret: !!def.isSecret,
      value: def.isSecret && typeof raw === 'string' ? maskSecret(raw) : raw,
      hasValue: map.has(def.key),
    };
  });
  return NextResponse.json({ settings, _meta: { actor: u.email } });
}

const PutSchema = z.object({
  updates: z.array(z.object({ key: z.string(), value: z.any() })).min(1),
});

export async function PUT(req: Request) {
  const u = await requirePermission('system.settings');
  const body = await req.json();
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid', issues: parsed.error.issues }, { status: 400 });

  const knownKeys = new Set(SETTING_CATALOG.map((s) => s.key));
  const filtered = parsed.data.updates.filter((u) => knownKeys.has(u.key));

  const written: string[] = [];
  for (const upd of filtered) {
    // Skip empty masked secrets ("••••…") — means user didn't change them
    if (typeof upd.value === 'string' && upd.value.startsWith('••••')) continue;
    await setSetting(upd.key, upd.value, u.id);
    written.push(upd.key);
  }

  // Η σύνδεση άλλαξε ⇒ το cached token της παλιάς συνεδρίας δεν επιτρέπεται να ξαναχρησιμοποιηθεί.
  // Το `await` είναι ουσιαστικό: το token ζει και στο `AppSetting`, και μέχρι να σβηστεί ΕΚΕΙ
  // κάθε επόμενο αίτημα μπορεί να το ξαναδιαβάσει και να μιλήσει στην ΠΑΛΙΑ εταιρία.
  const softoneChanged = written.some((k) => SOFTONE_CONNECTION_KEYS.has(k));
  let tokenCleared = !softoneChanged;
  let tokenClearError: string | null = null;
  if (softoneChanged) {
    try {
      await clearCachedToken();
      tokenCleared = true;
    } catch (e) {
      // Οι ρυθμίσεις ΕΧΟΥΝ ήδη γραφτεί — δεν τις γυρνάμε πίσω. Λέμε όμως καθαρά ότι το παλιό
      // token μπορεί να επιβιώνει, ώστε ο διαχειριστής να ξαναπατήσει αποθήκευση.
      tokenClearError = (e as Error).message;
    }
  }

  await logAudit({
    userId: u.id, userEmail: u.email,
    action: 'settings.update', resource: 'setting',
    metadata: {
      keys: filtered.map((f) => f.key),
      softoneConnectionChanged: softoneChanged,
      ...(tokenClearError ? { softoneTokenClearError: tokenClearError } : {}),
    },
  });

  // Το UI χρειάζεται τη σημαία για να προτείνει «Συγχρονισμός όλων»: με αλλαγή εταιρίας ή
  // υποκαταστήματος, ΚΑΘΕ ήδη συγχρονισμένος βοηθητικός πίνακας περιγράφει την προηγούμενη
  // σύνδεση — δεν είναι απλώς «παλιός», είναι λάθος.
  return NextResponse.json({
    ok: true,
    updated: filtered.length,
    softoneConnectionChanged: softoneChanged,
    softoneKeysChanged: written.filter((k) => SOFTONE_CONNECTION_KEYS.has(k)),
    softoneTokenCleared: tokenCleared,
    ...(tokenClearError
      ? { warning: `Οι ρυθμίσεις αποθηκεύτηκαν, αλλά το αποθηκευμένο token SoftOne δεν σβήστηκε: ${tokenClearError}` }
      : {}),
  });
}
