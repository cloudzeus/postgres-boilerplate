// lib/templates/run.ts — SERVER. Runs one template on one OcrDocument (spec §3β + §15).
// Only a missing document/template throws (bad input). Everything that can fail while the run is in
// flight — extraction, projection, posting, notification — is turned into a BLOCKED or FAILED run:
// the document itself stays COMPLETED and the caller always gets a RunOutcome back.
import 'server-only';
import type { Prisma, TemplateRunStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bunnyDownload } from '@/lib/bunny';
import { POST_ERROR_TEXT, PostError, postDocumentToSoftone } from '@/lib/ocr/post-softone';
import { matchDocItems } from '@/lib/ocr/softone-match';
import { extractTemplateFields } from './extract';
import { applyRules, type RuleDef } from './conditions';
import { projectToInvoice } from './mapping';
import { TEMPLATE_INCLUDE, toConditionDto, toFieldDef, toMappingDto } from './serialize';
import { sendRuleNotifications } from './notify';
import {
  applySetFields, buildReviewFlags, canPost, crossCheckOcr, decideOutcome, extrasFrom, itemsToRows,
  mappingFellBack, pickMapping, requiredMissing, setInvoicePath, tableFellThrough,
  type FieldFlag, type ItemRow, type RunFlags,
} from './run-logic';
import { normalizeVat, type MappingRowInvoice, type RunOutcome, type RunTrigger } from './schema';

export type { RunOutcome, RunTrigger };

/** Public base URL for the links inside notification emails ('' → the email names the file instead of linking). */
const APP_URL = () => process.env.APP_URL ?? '';

/**
 * Persist a projection onto the document: the mapped `extractedData` and, when the mapping rebuilt
 * `items`, the `OcrInvoiceItem` rows that mirror it. Shared by the runner and by a manual correction
 * of a run (`PATCH /template-runs/[runId]`) so both apply the projection by exactly the same rule.
 * `previousItems` is the `items` array the projection started from — `projectToInvoice` returns the
 * same reference when the mapping has no line rows, which is how "the lines changed" is detected.
 */
/** The SoftOne match on an invoice line — expensive to compute, and sometimes made BY HAND. */
type SoftoneCarry = Pick<SoftoneColumns, 'softoneMtrl' | 'softoneCode' | 'softoneName' | 'softoneIsService' | 'softoneMatchedBy'>;
type SoftoneColumns = { rowIndex: number; code: string | null; softoneMtrl: number | null; softoneCode: string | null; softoneName: string | null; softoneIsService: boolean | null; softoneMatchedBy: string | null };

const CARRY_SELECT = { rowIndex: true, code: true, softoneMtrl: true, softoneCode: true, softoneName: true, softoneIsService: true, softoneMatchedBy: true } as const;
const carryOf = (o: SoftoneColumns): SoftoneCarry =>
  ({ softoneMtrl: o.softoneMtrl, softoneCode: o.softoneCode, softoneName: o.softoneName, softoneIsService: o.softoneIsService, softoneMatchedBy: o.softoneMatchedBy });

/**
 * Pairs each rebuilt line with the row it replaces, so the SoftOne match survives the rebuild.
 * Same `rowIndex` first (a re-run of the same template on the same document produces the same lines
 * in the same order) — but only when the codes do not actively contradict each other, because
 * carrying an MTRL onto a line that is now a DIFFERENT article would post the wrong item. Otherwise
 * the row that carries the same `code`, wherever it moved to.
 */
function carryForward(rows: ItemRow[], old: SoftoneColumns[]): SoftoneCarry[] {
  const byIndex = new Map(old.map((o) => [o.rowIndex, o]));
  const byCode = new Map(old.filter((o) => (o.code ?? '').trim()).map((o) => [(o.code ?? '').trim(), o]));
  return rows.map((r) => {
    const code = (r.code ?? '').trim();
    const sameIndex = byIndex.get(r.rowIndex);
    const oldCode = (sameIndex?.code ?? '').trim();
    const hit = sameIndex && (!code || !oldCode || code === oldCode) ? sameIndex : (code ? byCode.get(code) : undefined);
    return hit ? carryOf(hit) : { softoneMtrl: null, softoneCode: null, softoneName: null, softoneIsService: null, softoneMatchedBy: null };
  });
}

export async function applyProjectionToDocument(documentId: string, nextData: Record<string, unknown> | null, previousItems: unknown): Promise<void> {
  const itemsChanged = nextData != null && nextData.items !== previousItems && Array.isArray(nextData.items);
  const docUpdate: Prisma.OcrDocumentUpdateInput = {};
  if (nextData) docUpdate.extractedData = nextData as Prisma.InputJsonValue;
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (itemsChanged) {
    // The rows are replaced wholesale, so anything not in `itemsToRows` is lost unless it is read
    // first — including a match a human made by hand in the matching UI.
    const old = (await prisma.ocrInvoiceItem
      .findMany({ where: { documentId }, select: CARRY_SELECT })
      .catch(() => [])) as SoftoneColumns[];
    const rows = itemsToRows(nextData!.items as unknown[]);
    const carried = carryForward(rows, old);
    ops.push(prisma.ocrInvoiceItem.deleteMany({ where: { documentId } }));
    ops.push(prisma.ocrInvoiceItem.createMany({ data: rows.map((r, i) => ({ ...r, ...carried[i], documentId })) }));
  }
  if (Object.keys(docUpdate).length || ops.length) {
    await prisma.$transaction([prisma.ocrDocument.update({ where: { id: documentId }, data: docUpdate }), ...ops]);
  }
  // The lines moved underneath the document: auto-match the new codes and recompute
  // `itemsTotal`/`itemsMatched`, which would otherwise still describe the rows we just deleted.
  // (`matchDocItems` preserves the manual matches carried above.) Bookkeeping — never fatal.
  if (itemsChanged) await matchDocItems(documentId).catch(() => null);
}

/** The ACTIVE template linked to this issuer ΑΦΜ (most recently updated wins). */
export async function findTemplateForVat(vat: unknown): Promise<string | null> {
  const afm = normalizeVat(vat);
  if (!afm) return null;
  const t = await prisma.extractionTemplate.findFirst({
    where: { vatNumber: afm, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return t?.id ?? null;
}

export async function runTemplateOnDocument(input: { documentId: string; templateId: string; trigger: RunTrigger }): Promise<RunOutcome> {
  const started = Date.now();
  const [doc, t] = await Promise.all([
    prisma.ocrDocument.findUnique({ where: { id: input.documentId }, include: { _count: { select: { items: true } } } }),
    prisma.extractionTemplate.findUnique({ where: { id: input.templateId }, include: TEMPLATE_INCLUDE }),
  ]);
  if (!doc) throw new Error('document not found');
  if (!t) throw new Error('template not found');

  const fields = [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef);
  const rules: RuleDef[] = [...t.conditions].sort((a, b) => a.order - b.order).map(toConditionDto);
  const mappings = t.mappings.map(toMappingDto);
  const base = { templateId: t.id, templateVersion: t.version, documentId: doc.id, trigger: input.trigger };
  const extracted = (doc.extractedData ?? {}) as Record<string, unknown>;

  try {
    const buffer = await bunnyDownload(doc.storageKey);
    const ex = await extractTemplateFields(buffer, doc.mimeType, fields, { ref: { refType: 'OcrDocument', refId: doc.id } });
    const applied = applyRules(rules, {
      values: ex.values,
      valueTypes: Object.fromEntries(fields.map((f) => [f.key, f.valueType])),
      extras: extrasFrom(extracted, doc._count.items, ex.pageCount),
    });
    const values = applySetFields(ex.values, fields, applied.setFields);
    const missing = requiredMissing(fields, values);
    const missingLabels = missing.map((f) => `Λείπει υποχρεωτικό πεδίο «${f.label}»`);
    const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
    const readErrors = ex.errors.map((e) => `Σφάλμα ανάγνωσης «${labelOf(e.fieldKey)}»: ${e.message}`);

    // The same two verdicts, keyed by field, for the UI. A rule's FLAG_REVIEW/BLOCK_POSTING reason is
    // free prose about the document as a whole, so it names no field and adds nothing here.
    const fieldFlags: Record<string, FieldFlag> = {};
    for (const f of missing) fieldFlags[f.key] = t.mode === 'AUTO' ? 'blocked' : 'review';
    for (const e of ex.errors) if (!fieldFlags[e.fieldKey]) fieldFlags[e.fieldKey] = 'review';

    const blocked = [...applied.flags.blocked, ...(t.mode === 'AUTO' ? missingLabels : [])];
    // Everything that blocks is also worth a human's eyes, so the blocked reasons are mirrored into
    // `review` (deduped — a missing required field would otherwise land in both lists twice).
    const flags: RunFlags = { review: [...new Set([...applied.flags.review, ...missingLabels, ...readErrors, ...blocked])], blocked, fields: fieldFlags };
    if (mappingFellBack(mappings, applied.mappingName)) {
      flags.review.push(`Ο κανόνας ζήτησε mapping «${applied.mappingName}» που δεν υπάρχει`);
    }

    // Projection — MANUAL runs never rewrite the document.
    const mapping = t.mode === 'MANUAL' ? null : pickMapping(mappings, applied.mappingName);
    let nextData: Record<string, unknown> | null = null;
    if (mapping) {
      const rows = mapping.rows as MappingRowInvoice[];
      nextData = projectToInvoice(values, rows, extracted);
      for (const s of applied.setFields) if (s.invoiceKey) setInvoicePath(nextData, s.invoiceKey, s.value);

      // The template still wins the projection — but where it contradicts the base OCR on an amount,
      // a number or the date, say so instead of silently preferring one reader over the other.
      for (const c of crossCheckOcr(rows, values, extracted, labelOf)) {
        if (!flags.review.includes(c.reason)) flags.review.push(c.reason);
        if (!fieldFlags[c.fieldKey]) fieldFlags[c.fieldKey] = 'review';
      }

      // A table the model could not read must not replace real invoice lines with an empty list:
      // keep the OCR's lines (same array reference → the rows are left alone) and flag it.
      const keptTable = tableFellThrough(rows, values, extracted);
      if (keptTable) {
        nextData.items = extracted.items;
        const reason = `Ο πίνακας «${labelOf(keptTable)}» δεν διαβάστηκε — κρατήθηκαν οι γραμμές του OCR`;
        if (!flags.review.includes(reason)) flags.review.push(reason);
      }
    }
    // Persist the document changes BEFORE posting, so the poster sees the mapped data.
    await applyProjectionToDocument(doc.id, nextData, extracted.items);

    const decision = decideOutcome(t.mode, flags);
    let status: TemplateRunStatus = decision === 'POST' ? 'POSTED' : decision;
    let error: string | null = null;
    if (decision === 'POST') {
      if (!canPost(t.mode, flags)) {
        status = 'BLOCKED';
      } else {
        try {
          await postDocumentToSoftone(doc.id);
        } catch (e) {
          if (e instanceof PostError) {
            // A precondition the document does not meet yet: blocked, not failed — a human fixes it and reposts.
            status = 'BLOCKED';
            const reason = POST_ERROR_TEXT[e.code] ?? e.message;
            flags.blocked.push(reason);
            if (!flags.review.includes(reason)) flags.review.push(reason);
          } else {
            status = 'FAILED';
            error = `Ανάρτηση: ${(e as Error).message}`.slice(0, 2000);
          }
        }
      }
    }

    // NOTIFY — once per document and rule, across all previous runs of this document.
    const previous = await prisma.templateRun.findMany({ where: { documentId: doc.id }, select: { flags: true } });
    const alreadyNotified = previous.flatMap((r) => (r.flags as { notified?: string[] } | null)?.notified ?? []);

    // The run row is written BEFORE the emails go out: a send that hangs or crashes the process must
    // not cost us the run itself. The ids that were actually notified are folded in afterwards.
    const run = await prisma.templateRun.create({
      data: {
        ...base,
        status,
        values: values as unknown as Prisma.InputJsonValue,
        matched: applied.matched as unknown as Prisma.InputJsonValue,
        flags: { ...flags, notified: [] as string[] } as unknown as Prisma.InputJsonValue,
        mappingName: mapping?.name ?? '',
        model: ex.model,
        tokensUsed: ex.tokensUsed,
        durationMs: Date.now() - started,
        error,
      },
    });

    const notified = await sendRuleNotifications({
      docId: doc.id,
      fileName: doc.fileName,
      templateName: t.name,
      defaultEmails: t.notifyEmails,
      appUrl: APP_URL(),
      values: values as Record<string, { value: unknown; color: string }>,
      notifications: applied.notifications,
      alreadyNotified,
    }).catch((e) => {
      console.error('[templates] notify failed', run.id, (e as Error).message);
      return [] as string[];
    });
    if (notified.length) {
      await prisma.templateRun
        .update({ where: { id: run.id }, data: { flags: { ...flags, notified } as unknown as Prisma.InputJsonValue } })
        .catch((e) => console.error('[templates] notified flags not stored', run.id, (e as Error).message));
    }

    // Bookkeeping only: the run already exists and is returned even if this write fails, so it must
    // never fall through to the outer catch (that would write a second, FAILED, run for the same work).
    await prisma
      .$transaction([
        prisma.ocrDocument.update({ where: { id: doc.id }, data: { reviewFlags: buildReviewFlags(t, status, run.id, flags) as unknown as Prisma.InputJsonValue } }),
        prisma.extractionTemplate.update({ where: { id: t.id }, data: { timesUsed: { increment: 1 } } }),
      ])
      .catch((e) => console.error('[templates] run bookkeeping failed', run.id, (e as Error).message));
    return { runId: run.id, status, flags, error };
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 2000);
    console.error('[templates] run failed', t.slug, doc.id, error);
    // A crash learned NOTHING about the document, so it must not un-block it: the reasons the last
    // successful run left on `reviewFlags` are carried forward, or a re-run that happens to blow up
    // would hand a human the «Έγκριση → ανάρτηση» button on a document a rule had blocked.
    const prev = (doc.reviewFlags ?? null) as { review?: string[]; blocked?: string[] } | null;
    const carried = { review: prev?.review ?? [], blocked: prev?.blocked ?? [], fields: {} };
    try {
      const run = await prisma.templateRun.create({
        // The carried flags go on the RUN row as well, not just on the document: the run card reads
        // its reasons from the run it is showing, and a FAILED run with no flags could not explain
        // why the posting is still blocked.
        data: { ...base, status: 'FAILED', values: {}, matched: [], flags: carried as unknown as Prisma.InputJsonValue, mappingName: '', durationMs: Date.now() - started, error },
      });
      await prisma.ocrDocument
        .update({ where: { id: doc.id }, data: { reviewFlags: buildReviewFlags(t, 'FAILED', run.id, carried) as unknown as Prisma.InputJsonValue } })
        .catch(() => null);
      return { runId: run.id, status: 'FAILED', flags: carried, error };
    } catch (e2) {
      // The database itself is unavailable: report the failure to the caller rather than throwing
      // out of a function whose whole contract is "never throws for a failed run".
      console.error('[templates] failed run could not be recorded', doc.id, (e2 as Error).message);
      return { runId: '', status: 'FAILED', flags: carried, error };
    }
  }
}

/** Convenience for the upload/reextract hooks: match by ΑΦΜ and run; never throws. */
export async function runMatchingTemplate(documentId: string, vat: unknown, trigger: RunTrigger): Promise<RunOutcome | null> {
  try {
    const templateId = await findTemplateForVat(vat);
    if (!templateId) return null;
    return await runTemplateOnDocument({ documentId, templateId, trigger });
  } catch (e) {
    console.error('[templates] runMatchingTemplate', (e as Error).message);
    return null;
  }
}
