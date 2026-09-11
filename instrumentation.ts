// instrumentation.ts — τρέχει μία φορά όταν σηκώνεται ο server (Next 16: ενεργό από μόνο του, χωρίς
// flag). Το μόνο που κάνουμε εδώ είναι να ξεκινήσουμε τον worker των εργασιών σάρωσης (spec §12).
//
// Ο έλεγχος runtime είναι απαραίτητος: το `register()` καλείται και για το edge runtime, όπου δεν
// υπάρχουν ούτε `setInterval` με `unref`, ούτε Prisma, ούτε Bunny. Το `startJobWorker` ξαναρωτά τα
// ίδια (και για `JOBS_DISABLED` και για τα tests) — ο έλεγχος εδώ υπάρχει για να μη ΦΟΡΤΩΘΕΙ καν το
// module του worker εκεί που δεν μπορεί να τρέξει.
//
// Τίποτα εδώ δεν επιτρέπεται να πετάξει: μια εξαίρεση στο `register()` κρατά τον server κάτω, και
// ένας worker που δεν ξεκίνησε είναι πολύ μικρότερο πρόβλημα από έναν server που δεν σηκώθηκε.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.JOBS_DISABLED === '1') return;
  try {
    const { startJobWorker } = await import('./lib/templates/jobs');
    startJobWorker();
  } catch (e) {
    console.error('[instrumentation] job worker not started', (e as Error).message);
  }
}
