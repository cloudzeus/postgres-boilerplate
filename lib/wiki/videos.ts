// Τα βίντεο-επεξηγήσεις της βοήθειας (Remotion, motion-studio · compositions `Dgespa-<key>-16x9`).
// Σερβίρονται από το Bunny CDN (ελαφριά έκδοση 720p για τη σελίδα). Στο MDX: <Video id="Expenses" />.
// Νέο βίντεο: composition στο motion-studio → render → `scripts/publish.mjs` → URLs εδώ.

export interface WikiVideo { title: string; summary: string; mp4: string; webm: string; poster: string; seconds: number }

export const WIKI_VIDEOS: Record<string, WikiVideo> = {
  Basics: {
    title: "Από το χαρτί στη SoftOne",
    summary: "Τι κάνει η εφαρμογή με κάθε τιμολόγιο, βήμα-βήμα, και τι χρειάζεται από εσένα.",
    mp4: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Basics-16x9-720-1cb7116b97.mp4',
    webm: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Basics-16x9-720-f6a6e1c18c.webm',
    poster: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Basics-16x9-720-poster-71716e71ac.jpg',
    seconds: 63,
  },
  Expenses: {
    title: "Δαπάνη, έξοδο, κατηγορία εξόδου",
    summary: "Η διαφορά δαπάνης και αγοράς για την αποθήκη, και γιατί «Έξοδο» και «Χρεοπίστωση» είναι το ίδιο πράγμα.",
    mp4: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Expenses-16x9-720-e806f393d7.mp4',
    webm: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Expenses-16x9-720-bdabc0cb38.webm',
    poster: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Expenses-16x9-720-poster-65d37356e6.jpg',
    seconds: 73,
  },
  Kinds: {
    title: "Είδος, υπηρεσία, πάγιο ή κατηγορία εξόδου;",
    summary: "Τέσσερις ερωτήσεις για να διαλέξεις «τι αφορά» μια γραμμή — και τι συμβαίνει μετά στη SoftOne.",
    mp4: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Kinds-16x9-720-8810d08b27.mp4',
    webm: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Kinds-16x9-720-a9b7454d0d.webm',
    poster: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Kinds-16x9-720-poster-77ca3717b7.jpg',
    seconds: 67,
  },
  Accounts: {
    title: "Λογαριασμοί & χρηματικοί λογαριασμοί",
    summary: "Πώς είναι οργανωμένο το λογιστικό σχέδιο, τι είναι χρέωση/πίστωση και πού «ζουν» τα χρήματα (ταμείο, τράπεζες).",
    mp4: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Accounts-16x9-720-2237057f65.mp4',
    webm: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Accounts-16x9-720-a1eabfcdbd.webm',
    poster: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Accounts-16x9-720-poster-c6089b47c3.jpg',
    seconds: 76,
  },
  Assets: {
    title: "Πάγια & απόσβεση",
    summary: "Γιατί ένα laptop δεν γίνεται έξοδο μονομιάς, πώς υπολογίζεται η απόσβεση και πώς καταχωρίζεται ένα πάγιο.",
    mp4: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Assets-16x9-720-d4b2e2bab0.mp4',
    webm: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Assets-16x9-720-774dd5b5f0.webm',
    poster: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Assets-16x9-720-poster-1fa6901aee.jpg',
    seconds: 62,
  },
  Split: {
    title: "Μοίρασμα σε λογαριασμούς & κέντρα κόστους",
    summary: "Πότε μια γραμμή χωρίζεται σε κομμάτια: σε διαφορετικές κατηγορίες εξόδου ή στα τμήματα της επιχείρησης.",
    mp4: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Split-16x9-720-b5e9b7353d.mp4',
    webm: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Split-16x9-720-10c6066371.webm',
    poster: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Split-16x9-720-poster-4a81a70630.jpg',
    seconds: 62,
  },
  Vat: {
    title: "ΦΠΑ, παρακράτηση, πιστωτικό",
    summary: "Γιατί ο ΦΠΑ δεν είναι έξοδο, πώς η παρακράτηση μειώνει το πληρωτέο και τι είναι το πιστωτικό τιμολόγιο.",
    mp4: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Vat-16x9-720-a41410af6b.mp4',
    webm: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Vat-16x9-720-175822cb07.webm',
    poster: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Vat-16x9-720-poster-79d9cc83a1.jpg',
    seconds: 74,
  },
  Serials: {
    title: "Σειριακοί αριθμοί (S/N)",
    summary: "Πώς οι σειριακοί του τιμολογίου αγοράς μπαίνουν στο είδος, ώστε να υπάρχουν σε κάθε πώληση, εγγύηση και επισκευή.",
    mp4: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Serials-16x9-720-2039c12d4c.mp4',
    webm: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Serials-16x9-720-176ef05286.webm',
    poster: 'https://espa-stamos.b-cdn.net/media/videos/Dgespa-Serials-16x9-720-poster-9d47e2ca8b.jpg',
    seconds: 61,
  },
};

/** Το HTML του <Video id="…" />: χωρίς autoplay, `preload="none"` (κατεβαίνει μόνο αν πατηθεί play). */
export function videoHtml(id: string, caption?: string): string {
  const v = WIKI_VIDEOS[id];
  if (!v) return `<div class="wiki-callout wiki-callout-info">\n\nΤο βίντεο «${id}» δεν είναι ακόμη διαθέσιμο.\n\n</div>`;
  const cap = (caption ?? v.title).replace(/"/g, '&quot;');
  const mins = `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')}`;
  return `<figure class="wiki-video"><video controls preload="none" playsinline poster="${v.poster}" aria-label="${cap}"><source src="${v.webm}" type="video/webm" /><source src="${v.mp4}" type="video/mp4" /></video><figcaption><strong>▶ ${cap}</strong> · ${mins} · χωρίς ήχο, με υπότιτλους</figcaption></figure>`;
}
