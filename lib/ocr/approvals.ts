// Εγκρίσεις καταχώρισης — όρια ποσού και επίπεδα. Καθαρό module (χωρίς I/O).
//
// «Το AI προτείνει, οι κανόνες ελέγχουν, ο άνθρωπος εγκρίνει όπου ο κίνδυνος το απαιτεί.»
//   • σύνολο ≥ όριο 1 ⇒ έγκριση από ρόλο της λίστας 1·
//   • σύνολο ≥ όριο 2 ⇒ ΕΠΙΠΛΕΟΝ έγκριση από ΑΛΛΟΝ χρήστη, ρόλου της λίστας 2 (τέσσερα μάτια)·
//   • προαιρετικά: έγκριση επιπέδου 1 και όταν υπάρχουν παρατηρήσεις (αμφίβολο παραστατικό).
// Η έγκριση δένεται με ένα αποτύπωμα (σύνολα, εκδότης, σειρά, γραμμές): αν αλλάξει κάτι από αυτά μετά,
// η έγκριση ΔΕΝ ισχύει — κανείς δεν εγκρίνει κάτι και καταχωρείται κάτι άλλο.

export interface ApprovalConfig {
  enabled: boolean;
  level1Amount: number;
  level1Roles: string[];
  level2Amount: number;
  level2Roles: string[];
  whenWarnings: boolean;
}

export interface ApprovalRecord {
  level: number;
  decision: 'APPROVED' | 'REJECTED' | string;
  userId: string | null;
  userEmail: string | null;
  comment: string | null;
  fingerprint: string;
  createdAt: Date | string;
}

export interface ApprovalStatus {
  required: number[];
  /** Γιατί χρειάζεται (για το μήνυμα). */
  reason: string | null;
  approved: number[];
  missing: number[];
  rejected: ApprovalRecord | null;
  satisfied: boolean;
}

export const parseRoles = (v: unknown): string[] => String(v ?? '').split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
const eur = (v: number) => `${v.toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

export function requiredLevels(total: number | null, cfg: ApprovalConfig, hasWarnings: boolean): { levels: number[]; reason: string | null } {
  if (!cfg.enabled) return { levels: [], reason: null };
  const t = Math.abs(total ?? 0);
  if (cfg.level2Amount > 0 && t >= cfg.level2Amount) return { levels: [1, 2], reason: `σύνολο ${eur(t)} ≥ ${eur(cfg.level2Amount)}: δύο εγκρίσεις από διαφορετικούς χρήστες` };
  if (cfg.level1Amount > 0 && t >= cfg.level1Amount) return { levels: [1], reason: `σύνολο ${eur(t)} ≥ ${eur(cfg.level1Amount)}` };
  if (cfg.whenWarnings && hasWarnings) return { levels: [1], reason: 'το παραστατικό έχει παρατηρήσεις' };
  return { levels: [], reason: null };
}

/**
 * Ποιες εγκρίσεις ισχύουν: μόνο όσες έγιναν με το ΤΡΕΧΟΝ αποτύπωμα, η τελευταία απόφαση ανά επίπεδο
 * μετράει, και το επίπεδο 2 πρέπει να είναι από ΑΛΛΟΝ χρήστη από το επίπεδο 1.
 */
export function approvalStatus(required: number[], reason: string | null, records: readonly ApprovalRecord[], fingerprint: string): ApprovalStatus {
  const current = records.filter((r) => r.fingerprint === fingerprint)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const last = new Map<number, ApprovalRecord>();
  for (const r of current) last.set(r.level, r);
  const rejected = [...last.values()].find((r) => r.decision === 'REJECTED') ?? null;
  const approved: number[] = [];
  for (const lvl of required) {
    const r = last.get(lvl);
    if (r?.decision !== 'APPROVED') continue;
    if (lvl === 2) {
      const l1 = last.get(1);
      if (l1?.decision === 'APPROVED' && l1.userId && l1.userId === r.userId) continue; // τέσσερα μάτια
    }
    approved.push(lvl);
  }
  const missing = required.filter((l) => !approved.includes(l));
  return { required, reason, approved, missing, rejected, satisfied: !rejected && missing.length === 0 };
}

/** Μπορεί ο χρήστης να εγκρίνει ΑΥΤΟ το επίπεδο; (Ο SUPER_ADMIN πάντα.) */
export function canApproveLevel(level: number, roleKey: string | null | undefined, cfg: ApprovalConfig): boolean {
  const role = String(roleKey ?? '').toUpperCase();
  if (role === 'SUPER_ADMIN') return true;
  return (level === 1 ? cfg.level1Roles : cfg.level2Roles).includes(role);
}

/** Αποτύπωμα του παραστατικού όπως θα καταχωριστεί — αλλαγή ποσού/εκδότη/σειράς/γραμμών ακυρώνει την έγκριση. */
export function approvalFingerprint(input: {
  total: number | null; net: number | null; vat: number | null; trdr: number | null; series: string | null;
  number: string | null; date: string | null; lines: { net: number | null }[];
}): string {
  const raw = [input.total, input.net, input.vat, input.trdr, input.series, input.number, input.date, ...input.lines.map((l) => l.net)].map((v) => String(v ?? '')).join('|');
  // FNV-1a 32-bit: αρκεί για «άλλαξε κάτι;» — δεν είναι κρυπτογραφικό.
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function approvalBlockerMessage(s: ApprovalStatus): string {
  if (s.rejected) return `Η καταχώριση απορρίφθηκε${s.rejected.userEmail ? ` από ${s.rejected.userEmail}` : ''}${s.rejected.comment ? `: «${s.rejected.comment}»` : ''}. Διόρθωσε το παραστατικό (η αλλαγή ζητά νέα έγκριση) ή ζήτησε επανεξέταση.`;
  const need = s.missing.map((l) => (l === 1 ? 'επιπέδου 1' : 'επιπέδου 2 (από άλλον χρήστη)')).join(' και ');
  return `Χρειάζεται έγκριση ${need} πριν την καταχώριση — ${s.reason ?? 'κανόνας εγκρίσεων'}. Έχουν δοθεί ${s.approved.length} από ${s.required.length}.`;
}
