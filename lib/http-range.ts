// Ανάλυση της κεφαλίδας `Range` κατά RFC 9110 §14.1, όσο χρειάζεται για να σερβίρουμε αρχεία.
//
// Γιατί υπάρχει: ο native PDF viewer του browser ΔΕΝ δείχνει σελίδα μέχρι να μπορέσει να ζητήσει
// κομμάτια — χωρίς 206 κατεβάζει ολόκληρο το αρχείο πριν εμφανίσει οτιδήποτε.
//
// Υποστηρίζουμε ΜΟΝΟ μονό εύρος. Πολλαπλά εύρη (`bytes=0-9,20-29`) θα απαιτούσαν
// `multipart/byteranges`· το RFC επιτρέπει ρητά στον server να τα αγνοήσει και να στείλει
// ολόκληρο το σώμα με 200 — αυτό κάνουμε (`kind: 'ignored'`).

export type RangeParse =
  | { kind: 'none' }            // δεν ζητήθηκε εύρος
  | { kind: 'ignored' }         // ασυνάρτητο ή πολλαπλό εύρος → σερβίρουμε ολόκληρο με 200
  | { kind: 'unsatisfiable' }   // συντακτικά σωστό αλλά εκτός αρχείου → 416
  | { kind: 'ok'; start: number; end: number }; // inclusive, μέσα στα όρια

/**
 * @param header η τιμή της `Range` (ή null)
 * @param size   το συνολικό μέγεθος του αντικειμένου σε bytes
 */
export function parseRange(header: string | null | undefined, size: number): RangeParse {
  if (!header) return { kind: 'none' };
  const spec = header.trim();
  if (!/^bytes\s*=/i.test(spec)) return { kind: 'ignored' };

  const value = spec.slice(spec.indexOf('=') + 1).trim();
  if (value.includes(',')) return { kind: 'ignored' }; // multi-range: δεν στέλνουμε multipart
  const m = /^(\d*)-(\d*)$/.exec(value);
  if (!m) return { kind: 'ignored' };

  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return { kind: 'ignored' };

  // Άδειο αρχείο: κάθε εύρος είναι εκτός ορίων.
  if (size <= 0) return { kind: 'unsatisfiable' };

  if (rawStart === '') {
    // suffix form: `-N` = τα τελευταία N bytes
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsatisfiable' };
    const start = Math.max(0, size - suffix);
    return { kind: 'ok', start, end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return { kind: 'unsatisfiable' };

  if (rawEnd === '') return { kind: 'ok', start, end: size - 1 }; // open-ended: `N-`

  const end = Number(rawEnd);
  if (!Number.isFinite(end) || end < start) return { kind: 'ignored' }; // ανάποδο εύρος: αγνοείται
  return { kind: 'ok', start, end: Math.min(end, size - 1) };
}
