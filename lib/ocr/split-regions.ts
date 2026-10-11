// lib/ocr/split-regions.ts — SERVER (sharp), χωρίς βάση / δίκτυο.
//
// ΠΟΛΛΑ ΠΑΡΑΣΤΑΤΙΚΑ ΣΕ ΜΙΑ ΣΕΛΙΔΑ. Ο υπάρχων διαχωρισμός κόβει PDF ΑΝΑ ΣΕΛΙΔΑ. Στο σκανάρισμα
// όμως συνηθίζεται να μπαίνουν δύο αποδείξεις (καυσίμων, ταξί, διοδίων) ΔΙΠΛΑ-ΔΙΠΛΑ στο ίδιο
// φύλλο — και τότε η εξαγωγή είτε διαβάζει τη μία και χάνει την άλλη, είτε τις ανακατεύει.
// Πραγματικό παράδειγμα: SKM_C284, ΜΥΡΤΕΑ αριστερά + ΚΑΛΥΨΩ δεξιά, 40 € η καθεμία.
//
// ΠΩΣ: ντετερμινιστικά, όχι με μοντέλο. Μετράμε το «μελάνι» κάθε στήλης (και γραμμής) της
// σελίδας και ψάχνουμε την πιο φαρδιά ΛΕΥΚΗ λωρίδα που χωρίζει το περιεχόμενο σε δύο. Ένα μοντέλο
// που επιστρέφει πλαίσια μπορεί να κόψει μέσα από αριθμό· μια λευκή λωρίδα δεν κόβει τίποτα.
import sharp from 'sharp';

/** Περιοχή σε κανονικοποιημένες συντεταγμένες 0–1: x, y, πλάτος, ύψος. */
export type Region = [number, number, number, number];

export interface SplitPlan {
  /** 'none' = δεν βρέθηκε καθαρή λευκή λωρίδα — η σελίδα είναι ΕΝΑ παραστατικό. */
  axis: 'vertical' | 'horizontal' | 'none';
  regions: Region[];
  /** Πόσο φαρδιά ήταν η λευκή λωρίδα, ως ποσοστό της διάστασης — για να κρίνει ο χρήστης. */
  gapRatio: number;
}

/** Φωτεινότητα κάτω από αυτό = μελάνι. Τα σκαναρίσματα έχουν γκρίζο φόντο, όχι καθαρό λευκό. */
const INK = 150;
/** Στήλη «λευκή» = λιγότερο από τόσο μελάνι (θόρυβος σκαναρίσματος, σκόνη, σκιά διπλώματος). */
const BLANK_FRACTION = 0.004;
/** Η λωρίδα πρέπει να είναι τουλάχιστον τόσο φαρδιά για να μετρήσει ως διαχωριστικό. */
const MIN_GAP = 0.012;

function profile(px: Buffer, w: number, h: number, axis: 'col' | 'row'): number[] {
  const n = axis === 'col' ? w : h;
  const out = new Array<number>(n).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[y * w + x] < INK) out[axis === 'col' ? x : y]++;
    }
  }
  return out;
}

/** Τα όρια του περιεχομένου (πρώτη/τελευταία μη λευκή θέση). */
function bounds(p: number[], blank: number): [number, number] | null {
  let a = 0, b = p.length - 1;
  while (a < p.length && p[a] <= blank) a++;
  while (b > a && p[b] <= blank) b--;
  return a < b ? [a, b] : null;
}

/**
 * Η πιο φαρδιά λευκή λωρίδα ΜΕΣΑ στο περιεχόμενο, στο κεντρικό 20–80 % του (ώστε ένα λευκό
 * περιθώριο στην άκρη να μη θεωρηθεί διαχωριστικό).
 */
function widestGap(p: number[], blank: number): { from: number; to: number } | null {
  const bd = bounds(p, blank);
  if (!bd) return null;
  const [a, b] = bd;
  const lo = a + Math.floor((b - a) * 0.2), hi = a + Math.ceil((b - a) * 0.8);
  let best: { from: number; to: number } | null = null;
  let run = -1;
  for (let i = lo; i <= hi + 1; i++) {
    const empty = i <= hi && p[i] <= blank;
    if (empty && run < 0) run = i;
    if (!empty && run >= 0) {
      if (!best || i - run > best.to - best.from) best = { from: run, to: i };
      run = -1;
    }
  }
  return best;
}

/** Σφιχτό πλαίσιο περιεχομένου μέσα σε ένα κομμάτι, με λίγο περιθώριο. */
function tight(px: Buffer, w: number, h: number, x0: number, x1: number, y0: number, y1: number, pad: number): Region {
  let minX = x1, maxX = x0, minY = y1, maxY = y0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (px[y * w + x] < INK) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX <= minX || maxY <= minY) { minX = x0; maxX = x1; minY = y0; maxY = y1; }
  const px0 = Math.max(x0, minX - pad), py0 = Math.max(y0, minY - pad);
  const px1 = Math.min(x1, maxX + pad), py1 = Math.min(y1, maxY + pad);
  return [px0 / w, py0 / h, (px1 - px0) / w, (py1 - py0) / h];
}

/**
 * Βρίσκει αν μια σελίδα (εικόνα) περιέχει ΔΥΟ παραστατικά χωρισμένα με λευκή λωρίδα, και πού.
 * Δοκιμάζει πρώτα κάθετη κοπή (δίπλα-δίπλα — το συνηθέστερο στις αποδείξεις), μετά οριζόντια.
 */
export async function planSplit(image: Buffer): Promise<SplitPlan> {
  // Σμίκρυνση για ταχύτητα: η λευκή λωρίδα φαίνεται εξίσου καλά στα 1200px.
  const { data, info } = await sharp(image).greyscale().resize({ width: 1200, withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const pad = Math.round(Math.min(w, h) * 0.01);

  for (const axis of ['vertical', 'horizontal'] as const) {
    const p = profile(data, w, h, axis === 'vertical' ? 'col' : 'row');
    const blank = (axis === 'vertical' ? h : w) * BLANK_FRACTION;
    const gap = widestGap(p, blank);
    const size = axis === 'vertical' ? w : h;
    if (!gap || (gap.to - gap.from) / size < MIN_GAP) continue;
    const cut = Math.round((gap.from + gap.to) / 2);
    const regions: Region[] = axis === 'vertical'
      ? [tight(data, w, h, 0, cut, 0, h, pad), tight(data, w, h, cut, w, 0, h, pad)]
      : [tight(data, w, h, 0, w, 0, cut, pad), tight(data, w, h, 0, w, cut, h, pad)];
    return { axis, regions, gapRatio: (gap.to - gap.from) / size };
  }
  return { axis: 'none', regions: [[0, 0, 1, 1]], gapRatio: 0 };
}

/** Κόβει μια περιοχή από την εικόνα ΣΤΗΝ ΠΛΗΡΗ ανάλυση και τη δίνει ως PNG. */
export async function cropRegion(image: Buffer, r: Region): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  const left = Math.max(0, Math.round(r[0] * W)), top = Math.max(0, Math.round(r[1] * H));
  const width = Math.min(W - left, Math.round(r[2] * W)), height = Math.min(H - top, Math.round(r[3] * H));
  return sharp(image).extract({ left, top, width, height }).png().toBuffer();
}
