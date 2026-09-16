// Σερβίρισμα ενός αποθηκευμένου αρχείου (Bunny) σε browser, με σωστή συμπεριφορά HTTP.
//
// Το πρόβλημα που λύνει: ο native PDF viewer του browser ζητάει κομμάτια (`Range`) για να δείξει
// τη σελίδα 1 πριν κατέβει ολόκληρο το αρχείο και για να μετακινηθεί μέσα του. Ένα route που
// αγνοεί την `Range` και απαντά `no-store` τον αναγκάζει να ξανακατεβάζει ΟΛΟ το PDF σε κάθε
// κίνηση — γι' αυτό ένα σαρωμένο 3.4 MB έμοιαζε «κολλημένο».
//
// Το περιεχόμενο είναι ανά έγγραφο και πίσω από έλεγχο δικαιωμάτων: το `private` στο
// `Cache-Control` ΜΕΝΕΙ — ποτέ `public`, ποτέ cacheable από shared caches.
import { createHash } from 'node:crypto';
import { bunnyHead, bunnyStream } from '@/lib/bunny';
import { parseRange } from '@/lib/http-range';

const CACHE_CONTROL = 'private, max-age=0, must-revalidate';

// Το μέγεθος και το ETag ενός κλειδιού δεν αλλάζουν ποτέ: κάθε ανέβασμα γράφει ΝΕΟ κλειδί
// (`nanoid` στο όνομα) — δεν ξαναγράφουμε ποτέ πάνω σε υπάρχον. Άρα το `HeadObject` μπορεί να
// θυμηθεί: ο viewer κάνει δεκάδες range αιτήματα για το ΙΔΙΟ αρχείο και δεν έχει νόημα να
// πληρώνει μια διαδρομή μέχρι το Bunny σε καθένα για να μάθει ξανά το ίδιο νούμερο.
// Κρατάμε μόνο δύο αριθμούς ανά κλειδί, με οροφή, ώστε να μη γίνει διαρροή μνήμης.
const HEAD_CACHE_MAX = 500;
const headCache = new Map<string, { size: number; etag: string | null }>();

async function headOf(key: string): Promise<{ size: number; etag: string | null }> {
  const hit = headCache.get(key);
  if (hit) return hit;
  const head = await bunnyHead(key);
  const entry = { size: head.size, etag: head.etag };
  if (headCache.size >= HEAD_CACHE_MAX) headCache.delete(headCache.keys().next().value!);
  headCache.set(key, entry);
  return entry;
}

/** Μόνο για τα tests: καθαρίζει τη μνήμη των `HeadObject`. */
export function __clearHeadCache() {
  headCache.clear();
}

/**
 * Validator για ένα αποθηκευμένο αρχείο. Προτιμάμε το ETag του ίδιου του storage· αν λείπει,
 * το (κλειδί, μέγεθος) το ταυτοποιεί — τα κλειδιά δεν ξαναγράφονται με άλλο περιεχόμενο.
 */
export function storedFileEtag(key: string, size: number, storageEtag?: string | null): string {
  const raw = storageEtag?.replace(/^W\//, '').replace(/"/g, '').trim();
  if (raw) return `"${raw}"`;
  return `"${createHash('sha1').update(`${key}:${size}`).digest('hex')}"`;
}

export interface ServeStoredFileOpts {
  key: string;
  contentType: string;
  /** όνομα για το `Content-Disposition: inline` */
  fileName: string;
}

/**
 * Απαντά 200 / 206 / 304 / 416 για ένα αρχείο στο Bunny.
 *
 * Ο έλεγχος δικαιωμάτων ΔΕΝ γίνεται εδώ — ο καλών τον έχει ήδη κάνει πριν φτάσει εδώ, σε κάθε
 * διαδρομή (και στα 206/304): ένα range request δεν επιτρέπεται να είναι παρακαμπτήριος.
 */
export async function serveStoredFile(req: Request, opts: ServeStoredFileOpts): Promise<Response> {
  let head;
  try {
    head = await headOf(opts.key);
  } catch {
    return new Response('file unavailable', { status: 502 });
  }

  const etag = storedFileEtag(opts.key, head.size, head.etag);
  const disposition = `inline; filename="${encodeURIComponent(opts.fileName)}"`;
  const common: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': CACHE_CONTROL,
    ETag: etag,
  };

  if (matchesEtag(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: common });
  }

  // `If-Range` που δεν ταιριάζει σημαίνει «το αρχείο άλλαξε από τότε» → στέλνουμε ολόκληρο.
  const ifRange = req.headers.get('if-range');
  const rangeHeader = ifRange && !matchesEtag(ifRange, etag) ? null : req.headers.get('range');
  const range = parseRange(rangeHeader, head.size);

  if (range.kind === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...common, 'Content-Range': `bytes */${head.size}` },
    });
  }

  const slice = range.kind === 'ok' ? { start: range.start, end: range.end } : undefined;
  let stream;
  try {
    stream = await bunnyStream(opts.key, slice);
  } catch {
    return new Response('file unavailable', { status: 502 });
  }

  if (slice) {
    const length = slice.end - slice.start + 1;
    return new Response(stream.body, {
      status: 206,
      headers: {
        ...common,
        'Content-Type': opts.contentType,
        'Content-Disposition': disposition,
        'Content-Length': String(length),
        'Content-Range': `bytes ${slice.start}-${slice.end}/${head.size}`,
      },
    });
  }

  return new Response(stream.body, {
    status: 200,
    headers: {
      ...common,
      'Content-Type': opts.contentType,
      'Content-Disposition': disposition,
      'Content-Length': String(head.size),
    },
  });
}

/** `If-None-Match` / `If-Range`: λίστα από ETags ή `*`. Συγκρίνουμε αγνοώντας το `W/`. */
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  const want = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === want);
}
