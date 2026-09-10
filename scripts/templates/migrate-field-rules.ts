// scripts/templates/migrate-field-rules.ts — ONE-OFF. Carries the legacy «Ειδικά πεδία προμηθευτών»
// (`SupplierFieldRule`) over to extraction templates before the tables are dropped (spec §7, §15.8).
//
// One DRAFT / MANUAL template per ΑΦΜ (rules of both docTypes land in the same template, because a
// template is no longer tied to a document type), one TemplateField per active rule. `SupplierTemplate`
// rows are backed up but NOT migrated — `example` was a few-shot sample, not a field definition.
//
// Idempotent: a ΑΦΜ that already owns a «Μεταφερμένο: …» template is skipped, so a re-run after a
// partial failure only fills in what is missing.
//
// Usage: npm run templates:migrate-field-rules -- [--dry]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../lib/db';
import { COLOR_PALETTE, isValidBbox, templateSlug, uniqueKey, type Bbox } from '../../lib/templates/schema';

const MIGRATED_PREFIX = 'Μεταφερμένο: ';

// The `SupplierFieldRule` / `SupplierTemplate` tables (and Prisma models) are dropped by migration
// 20260910130000_drop_supplier_field_rules. This script now reads them through $queryRawUnsafe with
// locally-declared types, so it keeps compiling after the models are gone — and fails with a clear
// Greek message instead of a Prisma "Unknown model" error once the tables themselves are dropped.
type Rule = {
  id: string;
  vatNumber: string;
  docType: string;
  key: string;
  label: string;
  description: string | null;
  regionHint: unknown;
  scope: string;
  valueType: string;
  isActive: boolean;
  supplierName: string | null;
};

type LegacyTemplate = {
  id: string;
  vatNumber: string;
  docType: string;
  supplierName: string | null;
  example: unknown;
  fieldHints: unknown;
  sampleDocId: string | null;
  thumbUrl: string | null;
  timesUsed: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const TABLE_MISSING = '42P01'; // Postgres: "relation does not exist"

/** True when the error is Postgres' "relation does not exist" (the legacy tables were dropped). */
function isMissingTableError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown; meta?: unknown } | null;
  if (err?.code !== 'P2010') return false;
  // Prisma's driver-adapter raw-query errors nest the original Postgres error code under
  // meta.driverAdapterError.cause.originalCode; fall back to scanning the message for the
  // Postgres SQLSTATE / "does not exist" in case that shape changes across Prisma versions.
  const cause = (err.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined)
    ?.driverAdapterError?.cause;
  if (cause?.originalCode === TABLE_MISSING) return true;
  const message = String(err.message ?? '');
  return message.includes(TABLE_MISSING) || message.includes('does not exist');
}

/** `{ page, bbox }` from a legacy 🎯 marker, or null when the hint is missing/malformed. */
function regionOf(regionHint: unknown): { page: number; bbox: Bbox } | null {
  const rh = regionHint as { page?: unknown; bbox?: unknown } | null;
  if (!rh || !isValidBbox(rh.bbox)) return null;
  return { page: Number.isInteger(rh.page) ? (rh.page as number) : 0, bbox: rh.bbox };
}

type Plan = {
  vatNumber: string;
  supplierName: string | null;
  name: string;
  slug: string;
  fields: { key: string; label: string; kind: 'SINGLE' | 'TABLE'; valueType: 'TEXT' | 'LIST'; color: string; region: unknown; columns: unknown; aiHint: string | null; order: number }[];
};

async function main() {
  const dry = process.argv.slice(2).includes('--dry');

  let rules: Rule[];
  let legacyTemplates: LegacyTemplate[];
  try {
    [rules, legacyTemplates] = await Promise.all([
      prisma.$queryRawUnsafe<Rule[]>('SELECT * FROM "SupplierFieldRule" WHERE "isActive" = true'),
      prisma.$queryRawUnsafe<LegacyTemplate[]>('SELECT * FROM "SupplierTemplate"'),
    ]);
  } catch (e) {
    if (isMissingTableError(e)) {
      console.log('Οι παλιοί πίνακες δεν υπάρχουν πια — δεν υπάρχει τίποτα να μεταφερθεί.');
      return;
    }
    throw e;
  }

  // Backup FIRST, before anything is written, so nothing is lost when the tables are dropped.
  // (Only active SupplierFieldRule rows are fetched — see the query above; inactive ones were
  // never migrated and are expected to already be captured in an earlier backup run.)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), '.local', 'backup');
  const backupPath = path.join(backupDir, `legacy-field-rules-${stamp}.json`);
  if (!dry) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), supplierFieldRules: rules, supplierTemplates: legacyTemplates }, null, 2));
  }
  console.log(`backup ${dry ? '(θα γραφόταν) →' : '→'} ${backupPath}  (${rules.length} rules, ${legacyTemplates.length} legacy templates)`);

  const active = (rules as unknown as Rule[]).filter((r) => r.isActive);
  const inactive = rules.length - active.length;

  const byVat = new Map<string, Rule[]>();
  for (const r of active) {
    const list = byVat.get(r.vatNumber) ?? [];
    list.push(r);
    byVat.set(r.vatNumber, list);
  }

  // Already-migrated ΑΦΜ (idempotency) and every slug in use (uniqueness).
  const existing = await prisma.extractionTemplate.findMany({ select: { slug: true, name: true, vatNumber: true } });
  const takenSlugs = new Set(existing.map((t) => t.slug));
  const doneVats = new Set(existing.filter((t) => t.name.startsWith(MIGRATED_PREFIX) && t.vatNumber).map((t) => t.vatNumber as string));

  const plans: Plan[] = [];
  const skipped: { vatNumber: string; rules: number }[] = [];

  for (const [vatNumber, vatRules] of [...byVat.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (doneVats.has(vatNumber)) { skipped.push({ vatNumber, rules: vatRules.length }); continue; }
    const supplierName = vatRules.find((r) => r.supplierName)?.supplierName ?? null;
    const name = `${MIGRATED_PREFIX}${supplierName ?? vatNumber}`;
    const slug = uniqueKey(templateSlug(name), takenSlugs);
    takenSlugs.add(slug);

    const keys = new Set<string>();
    const fields = vatRules.map((r, i) => {
      const key = uniqueKey(r.key, keys);
      keys.add(key);
      const kind = r.scope === 'line' ? ('TABLE' as const) : ('SINGLE' as const);
      const valueType = r.valueType === 'list' ? ('LIST' as const) : ('TEXT' as const);
      return {
        key,
        label: r.label,
        kind,
        valueType,
        color: COLOR_PALETTE[i % COLOR_PALETTE.length],
        region: regionOf(r.regionHint),
        columns: kind === 'TABLE' ? [{ key: 'value', label: r.label, valueType }] : null,
        aiHint: r.description ?? null,
        order: i,
      };
    });
    plans.push({ vatNumber, supplierName, name, slug, fields });
  }

  // Summary table — the plan, before anything is written.
  const w = (s: string, n: number) => (s.length > n - 2 ? `${s.slice(0, n - 3)}…  ` : s.padEnd(n));
  console.log(`\n${w('ΑΦΜ', 11)}${w('Προμηθευτής', 32)}${w('slug', 34)}${w('πεδία', 7)}περιοχές`);
  console.log('-'.repeat(92));
  for (const p of plans) {
    const withRegion = p.fields.filter((f) => f.region).length;
    console.log(`${w(p.vatNumber, 11)}${w(p.supplierName ?? '—', 32)}${w(p.slug, 34)}${w(String(p.fields.length), 7)}${withRegion}`);
  }
  console.log('-'.repeat(92));
  console.log(
    `${plans.length} πρότυπα προς δημιουργία · ${plans.reduce((n, p) => n + p.fields.length, 0)} πεδία · ` +
      `${skipped.length} ΑΦΜ ήδη μεταφερμένα · ${inactive} ανενεργοί κανόνες αγνοήθηκαν · ` +
      `${legacyTemplates.length} SupplierTemplate ΔΕΝ μεταφέρονται (few-shot παραδείγματα, μόνο backup)`,
  );

  if (dry) { console.log('\n--dry: δεν γράφτηκε τίποτα.'); return; }
  if (plans.length === 0) { console.log('\nΤίποτα προς μεταφορά.'); return; }

  let created = 0;
  for (const p of plans) {
    await prisma.extractionTemplate.create({
      data: {
        name: p.name,
        slug: p.slug,
        vatNumber: p.vatNumber,
        supplierName: p.supplierName,
        mode: 'MANUAL',
        status: 'DRAFT',
        department: 'Μεταφορά ειδικών πεδίων',
        fields: {
          create: p.fields.map((f) => ({
            key: f.key,
            label: f.label,
            kind: f.kind,
            valueType: f.valueType,
            color: f.color,
            region: f.region === null ? undefined : (f.region as object),
            columns: f.columns === null ? undefined : (f.columns as object),
            aiHint: f.aiHint,
            required: false,
            order: f.order,
          })),
        },
      },
    });
    created += 1;
    console.log(`✓ ${p.slug} (${p.fields.length} πεδία)`);
  }
  console.log(`\nΔημιουργήθηκαν ${created} πρότυπα.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
