// Χειροκίνητη διόρθωση γραμμών ενός σκαναρισμένου παραστατικού — καθαρό module (χωρίς I/O).
//
// Η ανάγνωση μπορεί να χάσει γραμμή (Contabo: η πρώτη γραμμή 43,00 € δεν διαβάστηκε), να διαβάσει
// το υποσύνολο ως γραμμή, ή να γράψει λάθος ποσότητα/τιμή. Ο χρήστης πρέπει να το διορθώνει ΕΔΩ,
// χωρίς να χάνονται οι αντιστοιχίσεις SoftOne, τα κέντρα κόστους και οι επιμερισμοί των ΑΛΛΩΝ γραμμών.
// Γι' αυτό η επεξεργασία είναι ΠΡΑΞΕΙΣ ανά γραμμή (πρόσθεσε / άλλαξε / αφαίρεσε), όχι «ξαναχτίσε όλες».

export interface LineValues {
  name: string;
  code: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  /** Έκπτωση % (όπως την κρατά το κανονικό έγγραφο). */
  discount: number | null;
  /** Καθαρή αξία γραμμής (μετά την έκπτωση, χωρίς ΦΠΑ). */
  net: number | null;
  vatRate: number | null;
}

export interface LineEditOps {
  update?: Array<{ rowIndex: number } & Partial<LineValues>>;
  add?: LineValues[];
  remove?: number[];
}

export interface LineEditPlan {
  /** Οι γραμμές μετά την επεξεργασία, με τη σειρά τους (οι νέες στο τέλος). */
  lines: Array<{ values: LineValues; from: number | null }>;
  /** Παλιό rowIndex → νέο (μόνο για όσες μένουν). */
  moved: Map<number, number>;
  removed: number[];
  /** Γραμμές που άλλαξε η ΤΑΥΤΟΤΗΤΑ τους (περιγραφή/κωδικός): η αυτόματη αντιστοίχιση ξαναγίνεται. */
  identityChanged: number[];
  errors: string[];
}

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const txt = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s : null;
};

/** Καθαρή αξία από ποσότητα × τιμή × (1 − έκπτωση%). `null` όταν λείπει ποσότητα ή τιμή. */
export function computeNet(quantity: number | null, unitPrice: number | null, discountPct: number | null): number | null {
  if (quantity == null || unitPrice == null) return null;
  return round2(quantity * unitPrice * (1 - (discountPct ?? 0) / 100));
}

function check(v: LineValues, label: string): string[] {
  const out: string[] = [];
  if (!txt(v.name)) out.push(`${label}: χρειάζεται περιγραφή.`);
  if (v.net == null) out.push(`${label}: χρειάζεται καθαρή αξία (ή ποσότητα και τιμή).`);
  if (v.vatRate != null && (v.vatRate < 0 || v.vatRate > 100)) out.push(`${label}: ο ΦΠΑ είναι ποσοστό 0–100.`);
  if (v.discount != null && (v.discount < 0 || v.discount > 100)) out.push(`${label}: η έκπτωση είναι ποσοστό 0–100.`);
  if (v.name && v.name.length > 500) out.push(`${label}: η περιγραφή είναι έως 500 χαρακτήρες.`);
  return out;
}

export function planLineEdit(current: LineValues[], ops: LineEditOps): LineEditPlan {
  const errors: string[] = [];
  const remove = new Set(ops.remove ?? []);
  for (const r of remove) if (!Number.isInteger(r) || r < 0 || r >= current.length) errors.push(`Δεν υπάρχει γραμμή ${r + 1}.`);
  const updates = new Map((ops.update ?? []).map((u) => [u.rowIndex, u]));
  for (const k of updates.keys()) {
    if (!Number.isInteger(k) || k < 0 || k >= current.length) errors.push(`Δεν υπάρχει γραμμή ${k + 1}.`);
    else if (remove.has(k)) errors.push(`Η γραμμή ${k + 1} δεν γίνεται να αλλάξει και να αφαιρεθεί μαζί.`);
  }

  const lines: LineEditPlan['lines'] = [];
  const moved = new Map<number, number>();
  const identityChanged: number[] = [];
  current.forEach((cur, i) => {
    if (remove.has(i)) return;
    const u = updates.get(i);
    const next: LineValues = u ? {
      name: u.name !== undefined ? (txt(u.name) ?? '') : cur.name,
      code: u.code !== undefined ? txt(u.code) : cur.code,
      unit: u.unit !== undefined ? txt(u.unit) : cur.unit,
      quantity: u.quantity !== undefined ? u.quantity : cur.quantity,
      unitPrice: u.unitPrice !== undefined ? u.unitPrice : cur.unitPrice,
      discount: u.discount !== undefined ? u.discount : cur.discount,
      net: u.net !== undefined ? u.net : cur.net,
      vatRate: u.vatRate !== undefined ? u.vatRate : cur.vatRate,
    } : cur;
    if (u) errors.push(...check(next, `Γραμμή ${i + 1}`));
    const to = lines.length;
    moved.set(i, to);
    if (u && ((txt(next.name) ?? '') !== (txt(cur.name) ?? '') || (txt(next.code) ?? '') !== (txt(cur.code) ?? ''))) identityChanged.push(to);
    lines.push({ values: next, from: i });
  });
  (ops.add ?? []).forEach((a, k) => {
    const v: LineValues = {
      name: txt(a.name) ?? '', code: txt(a.code), unit: txt(a.unit),
      quantity: a.quantity, unitPrice: a.unitPrice, discount: a.discount,
      net: a.net ?? computeNet(a.quantity, a.unitPrice, a.discount), vatRate: a.vatRate,
    };
    errors.push(...check(v, `Νέα γραμμή ${k + 1}`));
    lines.push({ values: v, from: null });
  });
  if (!lines.length) errors.push('Το παραστατικό πρέπει να έχει τουλάχιστον μία γραμμή.');
  return { lines, moved, removed: [...remove].sort((a, b) => a - b), identityChanged, errors };
}

/** Σύνοψη για το UI και το ιστορικό: πόσες γραμμές προστέθηκαν/άλλαξαν/αφαιρέθηκαν. */
export function describeLineEdit(ops: LineEditOps): string {
  const parts: string[] = [];
  const a = ops.add?.length ?? 0, u = ops.update?.length ?? 0, r = ops.remove?.length ?? 0;
  if (a) parts.push(a === 1 ? '1 νέα γραμμή' : `${a} νέες γραμμές`);
  if (u) parts.push(u === 1 ? '1 γραμμή άλλαξε' : `${u} γραμμές άλλαξαν`);
  if (r) parts.push(r === 1 ? '1 γραμμή αφαιρέθηκε' : `${r} γραμμές αφαιρέθηκαν`);
  return parts.join(' · ') || 'Καμία αλλαγή';
}
