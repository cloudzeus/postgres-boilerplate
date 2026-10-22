// Τα βίντεο-επεξηγήσεις της βοήθειας (Remotion, motion-studio · compositions `Dgespa-<key>-16x9`).
// Σερβίρονται από το Bunny CDN (ελαφριά έκδοση 720p για τη σελίδα). Στο MDX: <Video id="Expenses" />.
// Νέο βίντεο: composition στο motion-studio → render → `scripts/publish.mjs` → URLs εδώ.

export interface WikiVideo { title: string; summary: string; mp4: string; webm: string; poster: string; seconds: number }

export const WIKI_VIDEOS: Record<string, WikiVideo> = {};

/** Το HTML του <Video id="…" />: χωρίς autoplay, `preload="none"` (κατεβαίνει μόνο αν πατηθεί play). */
export function videoHtml(id: string, caption?: string): string {
  const v = WIKI_VIDEOS[id];
  if (!v) return `<div class="wiki-callout wiki-callout-info">\n\nΤο βίντεο «${id}» δεν είναι ακόμη διαθέσιμο.\n\n</div>`;
  const cap = (caption ?? v.title).replace(/"/g, '&quot;');
  const mins = `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')}`;
  return `<figure class="wiki-video"><video controls preload="none" playsinline poster="${v.poster}" aria-label="${cap}"><source src="${v.webm}" type="video/webm" /><source src="${v.mp4}" type="video/mp4" /></video><figcaption><strong>▶ ${cap}</strong> · ${mins} · χωρίς ήχο, με υπότιτλους</figcaption></figure>`;
}
