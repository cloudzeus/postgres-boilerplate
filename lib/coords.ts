/**
 * Συντεταγμένες — καθαρή λογική, χωρίς εξαρτήσεις (τρέχει και σε client component).
 *
 * Ζει σε δικό της αρχείο ακριβώς γι' αυτό: το `lib/geocode.ts` διαβάζει env και
 * χτυπά δίκτυο, το `lib/softone.ts` είναι `server-only` — ο έλεγχος όμως χρειάζεται
 * και στις δύο πλευρές, ώστε η φόρμα να μη δείχνει ποτέ κάτι που ο server θα κόψει.
 */

/**
 * Έγκυρο ζεύγος συντεταγμένων ή `null`.
 *
 * Το **(0, 0)** θεωρείται ΑΓΝΩΣΤΟ: είναι υπαρκτό σημείο στον Ατλαντικό και κανένας
 * συναλλασσόμενος δεν εδρεύει εκεί — ένας geocoder που «δεν ξέρει» δεν επιτρέπεται να
 * γράψει μηδενικά στο `TRDR.LATITUDE`/`LONGITUDE`. Το 0 σε ΜΙΑ μόνο συντεταγμένη
 * (ισημερινός ή Γκρίνουιτς) παραμένει έγκυρο.
 */
export function validCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  // `Number(null)` και `Number('')` είναι 0 — δηλαδή ΑΚΡΙΒΩΣ το σφάλμα που αυτή η
  // συνάρτηση υπάρχει για να αποτρέψει: μισό ζεύγος θα γινόταν «πλάτος 0».
  if (lat == null || lng == null || lat === '' || lng === '') return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

/** «37.975432, 23.734521» — σταθερά 6 δεκαδικά (≈ 10 cm· περισσότερα δεν λένε τίποτα). */
export function formatCoords(c: { lat: number; lng: number } | null): string {
  return c ? `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}` : '';
}
