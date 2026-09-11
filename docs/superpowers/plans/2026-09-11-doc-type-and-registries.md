# Doc-type detection, «Νέοι συναλλασσόμενοι», «Είδη & έξοδα» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify every scanned document into an enabled SoftOne series (purchases 1251 / creditors 1653) at scan time; add two queue pages where the user creates missing traders (suppliers/creditors) and matches or creates items/services/expenses for unmatched invoice lines, with a memory so the next scan matches automatically.

**Architecture:** Spec `docs/superpowers/specs/2026-09-11-doc-type-and-registries-design.md` (read it fully first). Pure logic in `lib/ocr/doc-type-classify.ts` and `lib/ocr/line-match.ts` (vitest). Server orchestration in `lib/ocr/doc-type.ts`, SoftOne helpers in `lib/softone.ts` (file is 1.1k lines, `file` reports it as "data" because of Greek — use `grep -a`). Routes under `app/api/admin/ocr/{new-traders,new-items}/**`. Shared queue UI `components/admin/queue-layout.tsx`. Pages `app/admin/ocr/new-traders`, `app/admin/ocr/new-items`. DG design system + ui-ux-pro-max rules (master–detail, keyboard-first, dense, status = icon + text, no modals in the main flow).

**Tech Stack:** Next.js 16, React 19, Prisma 7 (PostgreSQL, hand-written SQL migrations applied with `npx prisma migrate deploy`), zod 4, vitest 4, SoftOne Web Services via existing `softoneCall`/`softoneGetTable` (two-step auth, cp1253 handled inside `lib/softone.ts`), react-icons/fi, sonner, TanStack table where lists are tabular.

**Conventions:** type-check `rm -rf .next/dev/types; npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "^.next/"` (no output); `npm test`; Greek UI; inline hex only for data/status colours; `cursor-pointer` on clickable non-buttons; wiki entry per page (`docs/wiki/ocr/*.mdx`, `helpAnchors`, `npm run wiki:index`); never `migrate dev`/`reset`; SoftOne writes only through `softoneCall('setData', …)`, read back after write; commit per task; stage only your own files.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/migrations/20260911100000_doc_type_registries/migration.sql`, `prisma/schema.prisma` | series columns, `softoneExpn`, `SoftoneExpense`, `LineMatchRule`, `IgnoredIssuer` |
| `lib/ocr/doc-type-classify.ts` (+test) | pure: Greek normalisation, family lexicon, candidate scoring, tie detection |
| `lib/ocr/doc-type.ts` | server: load enabled candidates, issuer kind, model tie-break, persist |
| `lib/ocr/extract.ts` | export `callTextLLM`/`resolveCfg` for the tie-break |
| `lib/softone.ts` | `softoneFindTraderByAfm` (12→16), `buildTraderPayload`, `softoneCreateCreditor`, `softoneFetchExpenses`, `softoneCreateExpense` |
| `lib/ocr/softone-match.ts` | `buildSoftoneMatch` uses traders (12/16); `matchDocItems` applies `LineMatchRule` |
| `lib/ocr/line-match.ts` (+test) | pure: `normalizeLineText`, `groupKey`, `dice`, `scoreCandidates`, `suggestTraderKind` |
| `app/api/admin/metadata/sync-expenses-softone/route.ts` | mirror EXPN |
| `app/api/admin/ocr/new-traders/route.ts`, `[afm]/{create,link,ignore}/route.ts` | traders queue API |
| `app/api/admin/ocr/new-items/route.ts`, `suggest/route.ts`, `match/route.ts`, `create/route.ts`, `skip/route.ts` | items queue API |
| `app/api/admin/ocr/queues/counts/route.ts` | sidebar badges |
| `components/admin/queue-layout.tsx`, `components/admin/use-queue-keys.ts` | shared master–detail queue |
| `app/admin/ocr/new-traders/{page,queue-client,trader-panel}.tsx` | page 1 |
| `app/admin/ocr/new-items/{page,queue-client,item-panel}.tsx` | page 2 |
| `app/admin/ocr/ocr-table.tsx`, `app/admin/ocr/page.tsx`, `app/admin/ocr/[id]/page.tsx` | «Σειρά» column with confidence, doc-page line |
| `components/admin/sidebar.tsx`, `app/admin/ocr/matching/page.tsx` (redirect) | navigation |
| `docs/wiki/ocr/{doc-type,new-traders,new-items}.mdx`, `docs/manual/CHANGELOG.md` | docs |

---

### Task 1: Migration + Prisma models

**Files:** Create `prisma/migrations/20260911100000_doc_type_registries/migration.sql`; Modify `prisma/schema.prisma`.

- [ ] **Step 1: SQL**
```sql
-- Doc-type classification result on the document; expense links on lines; new registries (spec 2026-09-11 §5).
ALTER TABLE "OcrDocument" ADD COLUMN "seriesSource" INTEGER;
ALTER TABLE "OcrDocument" ADD COLUMN "seriesConfidence" DOUBLE PRECISION;
ALTER TABLE "OcrDocument" ADD COLUMN "seriesReason" TEXT;
ALTER TABLE "OcrDocument" ADD COLUMN "seriesBy" TEXT;
ALTER TABLE "OcrInvoiceItem" ADD COLUMN "softoneExpn" INTEGER;
CREATE INDEX "OcrInvoiceItem_softoneExpn_idx" ON "OcrInvoiceItem"("softoneExpn");
CREATE TABLE "SoftoneExpense" (
  "id" SERIAL PRIMARY KEY, "expn" INTEGER NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "vat" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true, "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SoftoneExpense_expn_key" ON "SoftoneExpense"("expn");
CREATE INDEX "SoftoneExpense_name_idx" ON "SoftoneExpense"("name");
CREATE INDEX "SoftoneExpense_code_idx" ON "SoftoneExpense"("code");
CREATE TABLE "LineMatchRule" (
  "id" TEXT PRIMARY KEY, "afm" TEXT, "pattern" TEXT NOT NULL, "mtrl" INTEGER, "expn" INTEGER,
  "isService" BOOLEAN NOT NULL DEFAULT false, "timesUsed" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "LineMatchRule_afm_pattern_key" ON "LineMatchRule"("afm", "pattern");
CREATE INDEX "LineMatchRule_pattern_idx" ON "LineMatchRule"("pattern");
CREATE TABLE "IgnoredIssuer" (
  "afm" TEXT PRIMARY KEY, "reason" TEXT, "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
Note: Postgres treats NULL `afm` as distinct in the unique index — generic rules use `afm = ''` (empty string), never NULL. Document this in the model comment.

- [ ] **Step 2: Prisma** — `OcrDocument`: after `softoneSeries String?` add `seriesSource Int?`, `seriesConfidence Float?`, `seriesReason String?`, `seriesBy String?  // auto | manual`. `OcrInvoiceItem`: `softoneExpn Int?` + `@@index([softoneExpn])`. New models:
```prisma
// Έξοδα SoftOne (EditMaster EXPENSES, πίνακας EXPN) — μητρώο για την αντιστοίχιση γραμμών.
model SoftoneExpense { id Int @id @default(autoincrement()); expn Int @unique; code String; name String; vat String?; isActive Boolean @default(true); syncedAt DateTime @default(now()); @@index([name]); @@index([code]) }
// Μνήμη αντιστοίχισης γραμμών: (ΑΦΜ εκδότη ή '' για γενικό, κανονικοποιημένο κείμενο) → είδος/υπηρεσία/έξοδο.
model LineMatchRule { id String @id @default(cuid()); afm String @default(""); pattern String; mtrl Int?; expn Int?; isService Boolean @default(false); timesUsed Int @default(0); createdById String?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; @@unique([afm, pattern]); @@index([pattern]) }
// Εκδότες που ο χρήστης επέλεξε να μη δημιουργήσει στο SoftOne.
model IgnoredIssuer { afm String @id; reason String?; createdById String?; createdAt DateTime @default(now()) }
```
(`afm` NOT NULL DEFAULT '' in SQL too — adjust the SQL: `"afm" TEXT NOT NULL DEFAULT ''`.)
- [ ] **Step 3:** `npx prisma migrate status` (expect up to date, 24 migrations) → `npx prisma migrate deploy` → `npx prisma generate`; tsc clean; `npm test` green. Commit `feat(ocr): series classification columns, expense links, expense/rule/ignore registries`.

---

### Task 2: Pure classifier `lib/ocr/doc-type-classify.ts`

**Files:** Create `lib/ocr/doc-type-classify.ts`, `lib/ocr/__tests__/doc-type-classify.test.ts`.

- [ ] **Step 1: Tests**
```ts
import { describe, it, expect } from 'vitest';
import { normalizeGreek, familyOf, classifySeries, type SeriesCandidate } from '../doc-type-classify';
const C = (code: string, abbrev: string, name: string, kind: 'purchase' | 'creditor', sosource = kind === 'purchase' ? 1251 : 1653): SeriesCandidate => ({ code, abbrev, name, kind, sosource });
const purchases = [C('2061', 'ΤΙΜΑ', 'Τιμολόγιο Αγοράς', 'purchase'), C('2062', 'ΤΔΑΠ', 'Τιμολόγιο Αγοράς-Δελτίο Αποστολής', 'purchase'), C('2081', 'ΠΤΑ', 'Πιστωτικό Τιμολόγιο Αγοράς', 'purchase'), C('2041', 'ΔΕΑΠ', 'Δελτίο Αποστολής Προμηθευτή', 'purchase')];
const creditors = [C('1001', 'ΤΠΥ', 'Τιμολόγιο Παροχής Υπηρεσιών', 'creditor'), C('1002', 'ΑΠΥ', 'Απόδειξη Παροχής Υπηρεσιών', 'creditor'), C('1003', 'ΠΤΠΥ', 'Πιστωτικό Παροχής Υπηρεσιών', 'creditor')];
const all = [...purchases, ...creditors];

describe('normalizeGreek', () => {
  it('uppercases, strips accents and punctuation', () => { expect(normalizeGreek('Τιμολόγιο – Δελτίο Αποστολής')).toBe('ΤΙΜΟΛΟΓΙΟ ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ'); });
});
describe('familyOf', () => {
  it.each([
    ['ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'TPY'], ['ΤΠΥ', 'TPY'], ['Τιμολόγιο – Δελτίο Αποστολής', 'TDA'], ['ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ ΤΙΜΟΛΟΓΙΟ', 'TDA'],
    ['ΤΙΜΟΛΟΓΙΟ', 'TIM'], ['ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ', 'TIM'], ['ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ', 'DA'], ['ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ', 'PT'], ['ΠΙΣΤΩΤΙΚΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'PT'],
    ['ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', 'APY'], ['ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ', 'ALP'], ['ΛΟΓΑΡΙΑΣΜΟΣ ΡΕΥΜΑΤΟΣ', 'LOG'], ['ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ', 'LOG'], ['INVOICE', 'TIM'], ['CREDIT NOTE', 'PT'], ['DEBIT NOTE', 'TIM'], ['', null],
  ])('%s → %s', (label, fam) => { expect(familyOf(label)).toBe(fam); });
});
describe('classifySeries', () => {
  it('picks the creditor ΤΠΥ for a service invoice from a creditor', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', issuerKind: 'creditor', totalAmount: 229.4, invoiceKind: 'service' }, all);
    expect(r?.code).toBe('1001'); expect(r!.confidence).toBeGreaterThan(0.8); expect(r!.tie).toBe(false);
  });
  it('restricts to purchase series for a supplier and prefers ΤΔΑΠ for a combined label', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ – ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ', issuerKind: 'supplier', totalAmount: 100, invoiceKind: 'product' }, all);
    expect(r?.code).toBe('2062');
  });
  it('a negative total or a credit label goes to the credit series of the right side', () => {
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: 'supplier', totalAmount: -50, invoiceKind: 'product' }, all)?.code).toBe('2081');
    expect(classifySeries({ documentTypeLabel: 'ΠΙΣΤΩΤΙΚΟ', issuerKind: 'creditor', totalAmount: 10, invoiceKind: 'service' }, all)?.code).toBe('1003');
  });
  it('unknown issuer: considers both sides, uses invoiceKind to break the tie, and flags near-ties', () => {
    const r = classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: null }, all);
    expect(['2061', '1001']).toContain(r?.code); expect(r!.tie).toBe(true);
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 10, invoiceKind: 'service' }, all)?.code).toBe('1001');
  });
  it('returns null with no candidates and a low-confidence fallback for an unknown label', () => {
    expect(classifySeries({ documentTypeLabel: 'ΤΙΜΟΛΟΓΙΟ', issuerKind: null, totalAmount: 1, invoiceKind: null }, [])).toBeNull();
    const r = classifySeries({ documentTypeLabel: 'ΚΑΤΙ ΠΕΡΙΕΡΓΟ', issuerKind: 'supplier', totalAmount: 1, invoiceKind: 'product' }, all);
    expect(r?.confidence ?? 0).toBeLessThan(0.5);
  });
  it('utility bills map to ΤΠΥ of a creditor', () => {
    expect(classifySeries({ documentTypeLabel: 'ΕΚΚΑΘΑΡΙΣΤΙΚΟΣ ΛΟΓΑΡΙΑΣΜΟΣ', issuerKind: null, totalAmount: 78298.47, invoiceKind: 'service' }, all)?.code).toBe('1001');
  });
});
```
- [ ] **Step 2: Implement**
```ts
// lib/ocr/doc-type-classify.ts — PURE. Maps a scanned document to one of the ENABLED SoftOne series (spec 2026-09-11 §1).
export type SeriesKind = 'purchase' | 'creditor';
export type SeriesCandidate = { code: string; abbrev: string | null; name: string; kind: SeriesKind; sosource: number };
export type Family = 'TPY' | 'TDA' | 'TIM' | 'DA' | 'PT' | 'APY' | 'ALP' | 'LOG';
export type ClassifyInput = { documentTypeLabel: string | null | undefined; issuerKind: 'supplier' | 'creditor' | null; totalAmount: number | null | undefined; invoiceKind: 'service' | 'product' | 'mixed' | null | undefined; myDataType?: string | null };
export type ClassifyResult = { code: string; sosource: number; kind: SeriesKind; confidence: number; reason: string; tie: boolean; alternatives: { code: string; abbrev: string | null; name: string; score: number }[] };

export function normalizeGreek(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-ZΑ-Ω0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// Order matters: more specific families first.
const FAMILY_RULES: [Family, RegExp][] = [
  ['PT', /ΠΙΣΤΩΤ|CREDIT NOTE|CREDIT INVOICE/],
  ['TDA', /(ΤΙΜΟΛΟΓΙΟ.*ΔΕΛΤΙΟ ΑΠΟΣΤΟΛ|ΔΕΛΤΙΟ ΑΠΟΣΤΟΛ.*ΤΙΜΟΛΟΓΙΟ|\bΤΔΑ\b|\bΤΔΑΠ\b|\bΔΑΤ\b)/],
  ['TPY', /(ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ|\bΤΠΥ\b|SERVICE INVOICE)/],
  ['APY', /(ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ|\bΑΠΥ\b)/],
  ['ALP', /(ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚ|\bΑΛΠ\b|RECEIPT)/],
  ['LOG', /(ΛΟΓΑΡΙΑΣΜΟΣ|ΕΚΚΑΘΑΡΙΣΤΙΚ|BILL)/],
  ['DA', /(ΔΕΛΤΙΟ ΑΠΟΣΤΟΛ|\bΔΑ\b|DELIVERY NOTE)/],
  ['TIM', /(ΤΙΜΟΛΟΓΙΟ|\bΤΙΜ\b|INVOICE|DEBIT NOTE)/],
];
export function familyOf(label: string | null | undefined): Family | null {
  const n = normalizeGreek(label ?? ''); if (!n) return null;
  for (const [fam, re] of FAMILY_RULES) if (re.test(n)) return fam;
  return null;
}
/** Family of a SERIES from its abbrev + name (same lexicon). */
export function seriesFamily(c: SeriesCandidate): Family | null { return familyOf(`${c.abbrev ?? ''} ${c.name}`); }
const SERVICE_FAMILIES = new Set<Family>(['TPY', 'APY', 'LOG']);
const GOODS_FAMILIES = new Set<Family>(['TIM', 'TDA', 'DA']);
/** How well a document family fits a series family (0–1). */
function familyAffinity(doc: Family | null, series: Family | null): number {
  if (!doc || !series) return 0.2;
  if (doc === series) return 1;
  if (doc === 'LOG' && series === 'TPY') return 0.9;
  if (doc === 'TDA' && series === 'TIM') return 0.6;
  if (doc === 'TIM' && series === 'TDA') return 0.5;
  if (doc === 'APY' && series === 'TPY') return 0.5;
  if (SERVICE_FAMILIES.has(doc) && SERVICE_FAMILIES.has(series)) return 0.4;
  if (GOODS_FAMILIES.has(doc) && GOODS_FAMILIES.has(series)) return 0.4;
  return 0.1;
}
export function classifySeries(input: ClassifyInput, candidates: SeriesCandidate[]): ClassifyResult | null {
  if (!candidates.length) return null;
  const docFam = familyOf(input.documentTypeLabel);
  const isCredit = docFam === 'PT' || (typeof input.totalAmount === 'number' && input.totalAmount < 0);
  const pool = input.issuerKind === 'supplier' ? candidates.filter((c) => c.kind === 'purchase') : input.issuerKind === 'creditor' ? candidates.filter((c) => c.kind === 'creditor') : candidates;
  const scored = (pool.length ? pool : candidates).map((c) => {
    const sf = seriesFamily(c);
    const creditSeries = sf === 'PT';
    let score = isCredit ? (creditSeries ? 1 : 0.05) : (creditSeries ? 0.02 : familyAffinity(docFam === 'PT' ? null : docFam, sf));
    // Side hint when the issuer is unknown: services → creditors, goods → purchases.
    if (!input.issuerKind && input.invoiceKind) {
      const wantsCreditor = input.invoiceKind === 'service';
      if ((c.kind === 'creditor') === wantsCreditor) score += 0.15; else score -= 0.15;
    }
    if (!input.issuerKind && !input.invoiceKind && docFam && (SERVICE_FAMILIES.has(docFam) ? c.kind !== 'creditor' : GOODS_FAMILIES.has(docFam) ? c.kind !== 'purchase' : false)) score -= 0.1;
    return { c, score: Math.max(0, Math.min(1, score)), sf };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0]; const second = scored[1];
  const gap = second ? best.score - second.score : 1;
  const confidence = Math.max(0, Math.min(1, best.score * (gap < 0.15 ? 0.75 : 1)));
  const reason = [docFam ? `τύπος «${input.documentTypeLabel}» → ${docFam}` : 'χωρίς τυπωμένο τύπο', input.issuerKind === 'supplier' ? 'εκδότης προμηθευτής' : input.issuerKind === 'creditor' ? 'εκδότης πιστωτής' : 'εκδότης άγνωστος', isCredit ? 'πιστωτικό' : null, input.invoiceKind ? `περιεχόμενο ${input.invoiceKind}` : null].filter(Boolean).join(' · ');
  return { code: best.c.code, sosource: best.c.sosource, kind: best.c.kind, confidence, reason, tie: gap < 0.15 && !!second, alternatives: scored.slice(0, 5).map((s) => ({ code: s.c.code, abbrev: s.c.abbrev, name: s.c.name, score: Math.round(s.score * 100) / 100 })) };
}
```
Adjust weights only if a test fails for a good reason; state it.
- [ ] **Step 3:** tests green; commit `feat(ocr): pure doc-type classifier over enabled SoftOne series`.

---

### Task 3: Server classification + hooks + list/doc UI

**Files:** Create `lib/ocr/doc-type.ts`, `lib/ocr/__tests__/doc-type.test.ts`; Modify `lib/ocr/extract.ts` (export `callTextLLM`, `resolveCfg` already exported), `app/api/admin/ocr/route.ts`, `app/api/admin/ocr/[id]/reextract/route.ts`, `app/api/admin/ocr/[id]/route.ts` (PATCH `softoneSeries` → `seriesBy: 'manual'`), `app/admin/ocr/page.tsx`, `app/admin/ocr/ocr-table.tsx`, `app/admin/ocr/[id]/page.tsx`.

- [ ] **Step 1: `lib/ocr/doc-type.ts`**
```ts
import 'server-only';
import { prisma } from '@/lib/db';
import { classifySeries, type SeriesCandidate } from './doc-type-classify';
import { logAiUsage, providerFromUrl } from '@/lib/ai/usage';
import { callTextLLM, resolveCfg } from './extract';

export async function loadEnabledSeries(): Promise<SeriesCandidate[]> {
  const [p, c] = await Promise.all([
    prisma.purchaseDocType.findMany({ where: { enabled: true, isActive: true }, select: { code: true, abbrev: true, name: true } }),
    prisma.softoneDocSeries.findMany({ where: { enabled: true, isActive: true, sosource: 1653 }, select: { code: true, abbrev: true, name: true, sosource: true } }),
  ]);
  return [...p.map((x) => ({ ...x, kind: 'purchase' as const, sosource: 1251 })), ...c.map((x) => ({ ...x, kind: 'creditor' as const }))];
}
const issuerKindOf = (softoneKind: string | null): 'supplier' | 'creditor' | null => softoneKind === 'Προμηθευτής' ? 'supplier' : softoneKind === 'Πιστωτής' ? 'creditor' : null;

/** Classifies and persists unless the user chose manually. Never throws. */
export async function classifyDocument(docId: string): Promise<{ code: string; confidence: number } | null> {
  try {
    const doc = await prisma.ocrDocument.findUnique({ where: { id: docId }, select: { extractedData: true, softoneKind: true, invoiceKind: true, seriesBy: true, fileName: true } });
    if (!doc || doc.seriesBy === 'manual') return null;
    const candidates = await loadEnabledSeries();
    if (!candidates.length) return null;
    const d = (doc.extractedData ?? {}) as Record<string, unknown>;
    let r = classifySeries({ documentTypeLabel: d.documentTypeLabel as string | null, issuerKind: issuerKindOf(doc.softoneKind), totalAmount: typeof d.totalAmount === 'number' ? d.totalAmount : null, invoiceKind: doc.invoiceKind as 'service' | 'product' | 'mixed' | null }, candidates);
    if (!r) return null;
    if (r.tie) { const picked = await modelTieBreak(docId, d, r.alternatives.map((a) => candidates.find((c) => c.code === a.code)!).filter(Boolean)); if (picked) r = { ...r, code: picked.code, sosource: picked.sosource, kind: picked.kind, confidence: Math.max(r.confidence, 0.7), reason: `${r.reason} · επιλογή μοντέλου`, tie: false }; }
    await prisma.ocrDocument.update({ where: { id: docId }, data: { softoneSeries: r.code, seriesSource: r.sosource, seriesConfidence: r.confidence, seriesReason: r.reason, seriesBy: 'auto' } });
    return { code: r.code, confidence: r.confidence };
  } catch (e) { console.error('[doc-type] classify failed', docId, (e as Error).message); return null; }
}
async function modelTieBreak(docId: string, d: Record<string, unknown>, options: SeriesCandidate[]): Promise<SeriesCandidate | null> {
  const cfg = await resolveCfg();
  const list = options.map((o) => `${o.code}: ${o.abbrev ?? ''} ${o.name} (${o.kind === 'purchase' ? 'αγορών' : 'πιστωτών'})`).join('\n');
  const system = `You classify Greek purchase documents into ONE SoftOne document series. Reply with ONLY the series code from the list.`;
  const user = `Document: type «${d.documentTypeLabel ?? ''}», issuer «${d.companyName ?? ''}», total ${d.totalAmount ?? ''}, lines: ${Array.isArray(d.items) ? (d.items as { name?: string }[]).slice(0, 5).map((i) => i.name).join('; ') : ''}\n\nSeries:\n${list}`;
  const out = await callTextLLM(cfg, system, user);
  void logAiUsage({ scope: 'OCR_TEXT', provider: providerFromUrl(cfg.textUrl), model: out.model, operation: 'ocr.classify_series', inputTokens: 0, outputTokens: 0, totalTokens: out.tokens ?? 0, refType: 'OcrDocument', refId: docId });
  const code = String(out.content ?? '').match(/\d{3,5}/)?.[0];
  return options.find((o) => o.code === code) ?? null;
}
```
Check `AiScope` values in `lib/ai/usage.ts` / Prisma enum and use the text scope that exists (e.g. `OCR_TEXT`); check `callTextLLM`'s return shape (`{ content, model, tokens }`) and adapt. Export `callTextLLM` from `extract.ts`.
- [ ] **Step 2: Tests** (mock `@/lib/db`, `./extract`, `@/lib/ai/usage`): persists auto result; skips when `seriesBy === 'manual'`; returns null with no enabled series; tie → model called with the alternatives and the chosen code persisted; never throws when prisma rejects.
- [ ] **Step 3: Hooks** — upload route: after `buildSoftoneMatch`/duplicate check and before the template run, `await classifyDocument(doc.id)`; reextract likewise; PATCH `[id]` with `softoneSeries` also sets `seriesBy: 'manual'`, `seriesConfidence: 1`, `seriesReason: 'χειροκίνητη επιλογή'` (and `seriesSource` from the matching candidate — look it up in both registries).
- [ ] **Step 4: UI** — `page.tsx` selects the four new columns; `OcrRow` gains `seriesConfidence`, `seriesReason`, `seriesBy`, `seriesSource`; the existing series cell shows a confidence dot before the abbrev (`#047857` ≥ 0.8 «σίγουρο», `#B45309` < 0.8 «να ελεγχθεί», grey none) with `title={seriesReason}` and an `aria-label` including the Greek word; the combobox options are grouped «Αγορών» / «Πιστωτών» (pass creditor series from `softoneDocSeries` where `enabled && sosource=1653` into `seriesRows`). When no series is enabled at all, the column header shows a link «Ενεργοποίησε σειρές» → `/admin/doc-series`. Document page header line: «Τύπος: <abbrev> — <name> · <NN %> · <reason>» under the file meta when `softoneSeries` is set.
- [ ] **Step 5:** tsc, tests, `npx next build`; commit `feat(ocr): classify scanned documents into enabled SoftOne series`.

---

### Task 4: SoftOne helpers — creditors, expenses, trader lookup

**Files:** Modify `lib/softone.ts`, `lib/ocr/softone-match.ts`; Create `app/api/admin/metadata/sync-expenses-softone/route.ts`; Modify `components/admin/items-table-client.tsx` + `app/admin/items/page.tsx` (third tab «Έξοδα») and the reference-data registry entry (`app/api/admin/metadata/registry` / `reference-data-client.tsx` — follow how «Είδη» is listed).

- [ ] **Step 1: Traders** — in `lib/softone.ts` (use `grep -a`): generalise `buildSupplierPayload` into `buildTraderPayload(kind: 'supplier' | 'creditor', input)` returning `OBJECT: 'SUPPLIER' | 'CREDITOR'` with the same row (keep `buildSupplierPayload` as a thin wrapper for the existing route); add `softoneCreateCreditor(input)` mirroring `softoneCreateSupplier` (setData on `CREDITOR`, read back the row by id via `getData` or `GetTable TRDR` to fetch `CODE`); add `softoneFindTraderByAfm(afm)` that queries `TRDR` with `SODTYPE IN (12,16)` and prefers 12, returning `{ trdr, code, name, kind: 'Προμηθευτής' | 'Πιστωτής', sodtype }`. `buildSoftoneMatch` uses it (so creditor issuers are matched and `softoneKind` is right). Keep `softoneFindSupplierByAfm` for callers.
- [ ] **Step 2: Expenses** — `softoneFetchExpenses()` → `softoneGetTable('EXPN', 'EXPN,CODE,NAME,VAT,ISACTIVE', 'ISACTIVE=1')` (verify the field names against the skill schema: `~/.claude/skills/softone/data/softone-full-schema.json.gz`, object `EXPENSES`, table `EXPN`; if `VAT` does not exist drop it). `softoneCreateExpense({ code, name, vat? })`: read-before-write — `getData` OBJECT `EXPENSES` on the most recently used expense (first active row) to copy the required flag fields `CLCMD, INCLMD, VATMODE, ISSTOCK, STOCKMD, SOVAL, INVOICEFLAG, KEPYOFLAG` (log which template row was used), then `setData { OBJECT: 'EXPENSES', KEY: '', DATA: { EXPENSES: [{ CODE, NAME, ISACTIVE: 1, VAT?, ...flags }] } }`, check `success` and read back by id. Export `buildExpensePayload` for the dry-run.
- [ ] **Step 3: Sync route** `POST /api/admin/metadata/sync-expenses-softone` (permission as `sync-items-softone`): upsert `SoftoneExpense` rows, deactivate missing, return counts; add the «Έξοδα» tab to `/admin/items` (columns code, name, vat, active) with its own sync button, and the registry entry in reference data (follow the existing pattern for items).
- [ ] **Step 4:** tsc, `npm test`; run the sync once against the live SoftOne (`curl` is not authenticated — instead run a small `npx tsx --import ./scripts/templates/register.mjs` script calling `softoneFetchExpenses()` and print the count; do NOT create anything in SoftOne). Commit `feat(softone): creditor creation, trader lookup by ΑΦΜ (12/16), expenses registry sync`.

---

### Task 5: Pure line matching + memory in `matchDocItems`

**Files:** Create `lib/ocr/line-match.ts`, `lib/ocr/__tests__/line-match.test.ts`; Modify `lib/ocr/softone-match.ts` (+ test `lib/ocr/__tests__/softone-match.test.ts` if absent, with prisma mocked).

- [ ] **Step 1: Tests**
```ts
import { describe, it, expect } from 'vitest';
import { normalizeLineText, dice, scoreCandidates, groupLines, suggestTraderKind } from '../line-match';
describe('normalizeLineText', () => {
  it('lowercases, strips accents/punctuation/amounts and collapses spaces', () => {
    expect(normalizeLineText('ΥΓΡΟ ΑΖΩΤΟ  9.560 KG – 0,29200 €')).toBe('υγρο αζωτο kg');
    expect(normalizeLineText('Μεταφορές CONEX (7)')).toBe('μεταφορες conex');
  });
});
describe('dice', () => {
  it('is 1 for identical, 0 for disjoint, symmetric', () => { expect(dice('αζωτο υγρο', 'υγρο αζωτο')).toBeGreaterThan(0.7); expect(dice('abc', 'xyz')).toBe(0); expect(dice('a b', 'a b')).toBe(1); });
});
describe('scoreCandidates', () => {
  const cands = [{ id: 'm1', kind: 'product' as const, code: '00022', name: 'ΥΓΡΟ ΑΖΩΤΟ', code1: null, code2: null }, { id: 'm2', kind: 'product' as const, code: '76-71106', name: 'Ξηρός πάγος τροφίμων 16mm', code1: '4003773035114', code2: null }, { id: 'e1', kind: 'expense' as const, code: '6231', name: 'Λήψη υπηρεσιών', code1: null, code2: null }];
  it('exact code/barcode wins with 1.0, then name similarity', () => {
    const r = scoreCandidates({ code: '4003773035114', name: 'ΜΥΤΟΤΣΙΜΠΙΔΟ' }, cands);
    expect(r[0]).toMatchObject({ id: 'm2', score: 1, by: 'code1' });
    const s = scoreCandidates({ code: null, name: 'υγρο αζωτο 12.080 kg' }, cands);
    expect(s[0].id).toBe('m1'); expect(s[0].by).toBe('name'); expect(s[0].score).toBeGreaterThan(0.6);
  });
  it('drops candidates below 0.3 and caps at 5', () => { expect(scoreCandidates({ code: null, name: 'zzz' }, cands)).toEqual([]); });
});
describe('groupLines', () => {
  it('groups by issuer ΑΦΜ + normalized text, counting lines and documents', () => {
    const g = groupLines([{ id: '1', afm: '094073495', docId: 'a', name: 'ΥΓΡΟ ΑΖΩΤΟ 9.560 KG', code: '00022' }, { id: '2', afm: '094073495', docId: 'b', name: 'Υγρό Άζωτο 12.080 kg', code: '00022' }, { id: '3', afm: '1', docId: 'a', name: 'ΥΓΡΟ ΑΖΩΤΟ', code: null }]);
    expect(g).toHaveLength(2); expect(g[0]).toMatchObject({ afm: '094073495', pattern: 'υγρο αζωτο kg', lineIds: ['1', '2'], docCount: 2, code: '00022' });
  });
});
describe('suggestTraderKind', () => {
  it('creditor for service documents / creditor series, supplier otherwise', () => {
    expect(suggestTraderKind({ seriesKinds: ['creditor'], invoiceKinds: ['service'] })).toBe('creditor');
    expect(suggestTraderKind({ seriesKinds: [], invoiceKinds: ['product', 'mixed'] })).toBe('supplier');
    expect(suggestTraderKind({ seriesKinds: [], invoiceKinds: ['service', 'service', 'product'] })).toBe('creditor');
  });
});
```
- [ ] **Step 2: Implement** — `normalizeLineText`: NFD strip accents, lowercase, remove tokens that are numbers/amounts/units-with-numbers (`/^[\d.,]+(kg|lt|τεμ|€|%)?$/`), remove punctuation, collapse spaces, max 120 chars. `dice(a, b)` on character bigrams of the normalized strings. `scoreCandidates(line, cands)`: `by: 'code2' | 'code1' | 'code' | 'name'`; exact (case-insensitive, trimmed) code matches score 1; else `dice(normalize(line.name), normalize(cand.name))`; filter ≥ 0.3; sort desc; top 5. `groupLines(lines)` → `{ key, afm, pattern, code, sample: name, lineIds, docIds, docCount }[]` ordered by line count desc. `suggestTraderKind({ seriesKinds, invoiceKinds })` → 'creditor' if any creditor series or services ≥ half, else 'supplier'.
- [ ] **Step 3: Memory in `matchDocItems`** — after the code pass, for still-unmatched lines load `LineMatchRule` where `pattern IN (normalized names)` and `afm IN (doc issuer afm, '')`; prefer the issuer-specific rule; set `softoneMtrl/softoneExpn/softoneCode/softoneName/softoneIsService` and `softoneMatchedBy: 'memory'`, increment `timesUsed`. Lines with `softoneExpn` count as matched in the tallies. `softoneCode/Name` for expenses come from `SoftoneExpense`. Tests with mocked prisma: code match still first; memory applied; manual preserved.
- [ ] **Step 4:** commit `feat(ocr): line grouping/similarity and match memory`.

---

### Task 6: Queue APIs

**Files:** Create `app/api/admin/ocr/new-traders/route.ts`, `app/api/admin/ocr/new-traders/[afm]/create/route.ts`, `.../link/route.ts`, `.../ignore/route.ts`, `app/api/admin/ocr/new-items/route.ts`, `.../suggest/route.ts`, `.../match/route.ts`, `.../create/route.ts`, `.../skip/route.ts`, `app/api/admin/ocr/queues/counts/route.ts`; Create `lib/ocr/queues.ts` (server: `loadTraderQueue()`, `loadItemQueue()`, `applyTraderToDocs(afm, trader)`, `applyMatchToGroup(...)`).

- [ ] **Step 1: Traders queue** — `loadTraderQueue()`: docs `status COMPLETED, softoneTrdr null, softoneChecked not null`, exclude `IgnoredIssuer` afms; group by `normalizeAfm(extractedData.vatNumber)`; per group: most frequent `companyName`, first non-empty `companyDoy/companyProfession/companyAddress/companyPhone/companyEmail`, `docCount`, `total` (sum totalAmount), `lastDate`, `thumbUrl` of the newest, `suggestedKind` (`suggestTraderKind` over docs' `seriesSource`→kind and `invoiceKind`), `docs: [{ id, fileName, date, total, series }]` (≤ 10). Also `ignored: [{ afm, name, reason }]` when `?ignored=1`. `GET` (`ocr.read`) → `{ groups }`.
  - `POST [afm]/create` body zod `{ kind: 'supplier' | 'creditor', name, code?, doyCode?, profession?, address?, zip?, city?, phone?, email?, dryRun? }` → dry-run returns the payload; else `softoneCreateSupplier`/`softoneCreateCreditor`, mirror `SoftoneTrader` (sodtype 12/16, kind label), `applyTraderToDocs(afm, …)` updates ALL docs of that afm, audit `ocr.trader.create`; returns `{ trdr, code, name, kind, docsUpdated }`.
  - `POST [afm]/link { trdr }` → validates the trader (12/16) from `SoftoneTrader`, updates all docs, audit. `POST [afm]/ignore { reason? }` / `DELETE [afm]/ignore` → `IgnoredIssuer` upsert/delete. All mutations `ocr.categorize`.
- [ ] **Step 2: Items queue** — `loadItemQueue()`: lines `softoneMtrl null AND softoneExpn null AND softoneMatchedBy != 'skipped'` (take 2000) with their doc's issuer afm (`extractedData.vatNumber` normalised) and `softoneName`; `groupLines`; for the first 50 groups compute suggestions: candidates = `SoftoneItem` (isActive) matched by `code in [...]` OR `name contains` any of the 2 longest tokens of the pattern (min 4 chars) + `SoftoneExpense` similarly + `LineMatchRule` hits (score 0.95, by 'memory'); `scoreCandidates`. Category default: rule kind → else `softoneIsService` of the lines → else 'product'. `GET` → `{ groups: [{ key, afm, supplier, pattern, sample, code, lineCount, docCount, category, suggestions, lines: [{ id, docId, fileName, name, quantity, price, total }] (≤ 8) }], total }`; `GET suggest?afm&pattern` for lazy groups.
  - `POST match { afm, pattern, target: { mtrl } | { expn }, isService }` → update every line in the group (`softoneMtrl`/`softoneExpn`, code/name from the mirror, `softoneMatchedBy: 'manual'`), upsert `LineMatchRule`, refresh `itemsTotal/itemsMatched` for touched docs (reuse the tally code from `matchDocItems` — extract `refreshDocTallies(docIds)`), audit; returns `{ linesUpdated }`.
  - `POST create { afm, pattern, kind: 'product' | 'service' | 'expense', code, name, vat, unit?, price?, dryRun? }` → product/service: `softoneCreateItem` + mirror `SoftoneItem`; expense: `softoneCreateExpense` + mirror `SoftoneExpense`; then the same as `match`. `POST skip { afm, pattern }` → `softoneMatchedBy: 'skipped'` on the group's lines (reversible from the OCR line UI later).
- [ ] **Step 3: Counts** — `GET /api/admin/ocr/queues/counts` (`ocr.read`) → `{ traders: n, items: n }` (cheap: count distinct afm via `groupBy`, count unmatched lines' groups approximated by unmatched line count).
- [ ] **Step 4:** tests for `lib/ocr/queues.ts` grouping/aggregation with mocked prisma (trader group aggregation, ignore filtering, group suggestion assembly); tsc; commit `feat(ocr): queue APIs for new traders and unmatched lines`.

---

### Task 7: Shared queue UI

**Files:** Create `components/admin/queue-layout.tsx`, `components/admin/use-queue-keys.ts`; Modify `components/admin/sidebar.tsx`.

- [ ] **Step 1: `QueueLayout`** — props: `{ title, description, helpAnchor, icon, items: T[], getId, renderItem(item, { selected }), selectedId, onSelect, filters: { key, label, count }[], filter, onFilter, search, onSearch, progress: { done, total }, empty: ReactNode, children (detail panel) }`. Layout: `PageHeader` on top; below `div.grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]`; left column `section` with sticky top bar (search input with `FiSearch`, filter pills as `role="tablist"` buttons with counts, «Ν από Μ» + a 4px progress bar `bg-sisyphus-500`), then `ul role="listbox" aria-label` with `li role="option" aria-selected` rows (min-height 56px, `cursor-pointer`, hover `bg-[var(--cx-hover)]`, selected `bg-sisyphus-50 border-l-4 border-sisyphus-500`), virtualised only if > 200 (simple windowing not required — use `overflow-auto max-h-[calc(100dvh-14rem)]`). Right `aside` sticky `top-4` white card `shadow-fluent-2`; on `< lg` the aside renders below the list and the list row click scrolls to it (`scrollIntoView`), with a «Πίσω στη λίστα» link. Keyboard via `useQueueKeys({ ids, selectedId, onSelect, onPrimary, onEscape })`: `j`/`ArrowDown`, `k`/`ArrowUp`, `Enter` → `onPrimary`, `Escape` → `onEscape`; ignored when focus is in an input/textarea/select/contenteditable. A small legend «J/K επόμενο · Enter επιβεβαίωση» in the list footer. Motion: 150ms colour transitions only; respects `prefers-reduced-motion`.
- [ ] **Step 2: Sidebar** — replace «Αντιστοιχίσεις SoftOne» with two entries: `/admin/ocr/new-traders` «Νέοι συναλλασσόμενοι» (`FiUserPlus`) and `/admin/ocr/new-items` «Είδη & έξοδα» (`FiPackage`), each with a numeric badge fetched once on mount from `/api/admin/ocr/queues/counts` (client component; hide badge when 0). Keep permissions `ocr.read`.
- [ ] **Step 3:** tsc, `npx next build`; commit `feat(admin): shared queue layout with keyboard navigation; sidebar queue entries`.

---

### Task 8: Page «Νέοι συναλλασσόμενοι»

**Files:** Create `app/admin/ocr/new-traders/page.tsx` (server: `loadTraderQueue()`, permissions, tax offices list via `softoneFetchTaxOffices()` cached best-effort), `queue-client.tsx`, `trader-panel.tsx`, `components/admin/trader-search.tsx` (combobox over `SoftoneTrader` 12/16 — reuse `components/templates/supplier-search.tsx` pattern but searching both kinds; the API `GET /api/admin/softone/search?type=traders&q=` — check what `type` values the search route supports and extend it with `traders` (12+16) if needed).

- [ ] **Step 1: Row** — issuer name (bold), ΑΦΜ mono, chips «N παραστατικά» and «Σύνολο € x», suggested kind chip (Προμηθευτής `#EAF4FC/#0078D4` · Πιστωτής `#F3E8FF/#6D28D9`), newest date, 40px thumbnail.
- [ ] **Step 2: Panel** — header (name, ΑΦΜ copy button, chips); «Στοιχεία ΑΑΔΕ» block auto-loaded via `POST /api/admin/ocr/supplier-preview` with a skeleton, then a two-column comparison OCR ↔ ΑΑΔΕ per field with «Χρήση» buttons and a «Χρήση όλων από ΑΑΔΕ» link (error state «Η ΑΑΔΕ δεν απάντησε» with retry); form (segmented Προμηθευτής/Πιστωτής, Κωδικός, Επωνυμία*, ΑΦΜ locked, ΔΟΥ combobox from the tax-office list, Επάγγελμα, Διεύθυνση, ΤΚ, Πόλη, Τηλέφωνο, Email) with labels, inline validation on blur, error text under the field; documents list (≤ 10, links to `/admin/ocr/[id]`); actions row: primary «Δημιουργία στο SoftOne» (loading state, confirm-less; the dry-run preview is a `<details>` «Προεπισκόπηση setData» that fetches with `dryRun: true` when opened), secondary «Είναι υπάρχων…» (reveals `TraderSearch`; pick → link), tertiary «Αγνόηση» (asks for an optional reason inline, not a modal). After success: toast «Δημιουργήθηκε <name> (κωδ. <code>) — ενημερώθηκαν N παραστατικά», the row leaves the queue (optimistic), selection moves to the next, progress increments. Undo for ignore via toast action («Αναίρεση» → DELETE ignore). Empty state illustration (icon + «Όλοι οι εκδότες υπάρχουν στο SoftOne»).
- [ ] **Step 3:** tsc, `npm test`, `npx next build`; commit `feat(ocr): «Νέοι συναλλασσόμενοι» queue page`.

---

### Task 9: Page «Είδη & έξοδα»

**Files:** Create `app/admin/ocr/new-items/page.tsx`, `queue-client.tsx`, `item-panel.tsx`, `components/admin/registry-search.tsx` (combobox searching items/services/expenses via `GET /api/admin/softone/search?type=items|services|expenses` — extend the search route for `expenses` from `SoftoneExpense`).

- [ ] **Step 1: Row** — pattern text (bold, 2-line clamp), supplier name or ΑΦΜ, chips «×N γραμμές · M παραστατικά», category chip (Προϊόν `#EAF4FC/#0078D4`, Υπηρεσία `#E8F7F0/#047857`, Έξοδο `#FDF3E3/#B45309`), «χωρίς πρόταση» muted chip when suggestions are empty.
- [ ] **Step 2: Panel** — header (pattern, supplier, chips); sample lines table (name as printed, quantity, price, total, document link) ≤ 8; segmented «Προϊόν · Υπηρεσία · Έξοδο» (changes the suggestion list filter and the create form); suggestions list: each row code mono, name, kind chip, «NN %» bar (4px, width = score), reason («ίδιος κωδικός», «barcode», «μνήμη», «ομοιότητα ονόματος»), «Αντιστοίχιση» button — the first row is the default primary (Enter); `RegistrySearch` combobox «Άλλο είδος/έξοδο…»; «Δημιουργία στο SoftOne» toggles an inline form (Κωδικός* prefilled from the line code or a slug, Περιγραφή* prefilled, ΦΠΑ* select from `VatCategory`/`vatRate` of the lines, Μονάδα* for products/services (default «ΤΕΜ»), Τιμή optional) with dry-run `<details>` and submit; «Παράλειψη» tertiary. After match/create: toast «Αντιστοιχίστηκαν N γραμμές → <name>», row leaves the queue, next selected; the memory note «Θα εφαρμόζεται αυτόματα στον εκδότη …» appears in the toast. Lazy suggestions: when a group beyond the first 50 is selected, fetch `suggest` with a skeleton.
- [ ] **Step 3:** tsc, `npm test`, `npx next build`; commit `feat(ocr): «Είδη & έξοδα» queue page`.

---

### Task 10: Matching page retirement, wiki, changelog

**Files:** Modify `app/admin/ocr/matching/page.tsx` → `redirect('/admin/ocr/new-items')`, delete `matching-client.tsx`; delete `docs/wiki/ocr/ocr-matching.mdx` (fix `related:` references); create `docs/wiki/ocr/doc-type.mdx` (helpAnchors `[doc-type]`; link from the OCR list page `helpAnchor`? keep the list's existing anchor and reference from `ocr-overview`), `docs/wiki/ocr/new-traders.mdx` (`helpAnchors: [new-traders]`), `docs/wiki/ocr/new-items.mdx` (`helpAnchors: [new-items]`), each with Επισκόπηση, `<Steps>`, callouts (SoftOne writes are real — «Η δημιουργία γράφει στο SoftOne σας»; ignore is reversible; memory rules), keyboard shortcuts table; update `ocr-overview.mdx`; `npm run wiki:index`; CHANGELOG section «2026-09-11 — Τύπος παραστατικού, νέοι συναλλασσόμενοι, είδη & έξοδα». Commit `docs(ocr): wiki for doc-type detection and the two queues; retire the matching page`.

---

## Self-review
- Spec §1 → T2/T3; §2 → T4 (creditor/lookup), T6, T8; §3 → T4 (expenses), T5, T6, T9; §4 → T7, T10; §5 → T1; §6 → tests in T2/T3/T5/T6, permissions in T6.
- Types: `SeriesCandidate`/`ClassifyResult` (T2) used by T3; `softoneFindTraderByAfm`/`softoneCreateCreditor`/`softoneCreateExpense` (T4) used by T6; `groupLines`/`scoreCandidates`/`suggestTraderKind` (T5) used by T6; `QueueLayout`/`useQueueKeys` (T7) used by T8/T9; route contracts in T6 consumed by T8/T9.
- No placeholders; SoftOne write flows are read-before-write and read-back per CLAUDE.md.
