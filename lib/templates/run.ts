// lib/templates/run.ts — SERVER. Runs one template on one OcrDocument (spec §3β + §15).
// Only a missing document/template throws (bad input). Everything that can fail while the run is in
// flight — extraction, projection, posting, notification — is turned into a BLOCKED or FAILED run:
// the document itself stays COMPLETED and the caller always gets a RunOutcome back.
import 'server-only';
import type { Prisma, TemplateRunStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bunnyDownload } from '@/lib/bunny';
import { PostError, postDocumentToSoftone } from '@/lib/ocr/post-softone';
import { extractTemplateFields } from './extract';
import { applyRules, type RuleDef } from './conditions';
import { projectToInvoice } from './mapping';
import { TEMPLATE_INCLUDE, toConditionDto, toFieldDef, toMappingDto } from './serialize';
import { sendRuleNotifications } from './notify';
import {
  applySetFields, buildReviewFlags, canPost, decideOutcome, extrasFrom, itemsToRows, mappingFellBack,
  pickMapping, requiredMissing, setInvoicePath,
  type RunFlags,
} from './run-logic';
import type { MappingRowInvoice, RunTrigger } from './schema';

export type { RunTrigger };
export type RunOutcome = { runId: string; status: TemplateRunStatus; flags: RunFlags; error: string | null };

/** Public base URL for the links inside notification emails ('' → the email names the file instead of linking). */
const APP_URL = () => process.env.APP_URL ?? '';

/** A precondition the poster refuses on is a BLOCK, not a crash — say why in Greek. */
const POST_BLOCK_REASON: Record<PostError['code'], string> = {
  no_category: 'Δεν έχει οριστεί κατηγορία εγγράφου',
  not_completed: 'Το έγγραφο δεν έχει ολοκληρωθεί',
  not_found: 'Το έγγραφο δεν βρέθηκε',
};

/** The ACTIVE template linked to this issuer ΑΦΜ (most recently updated wins). */
export async function findTemplateForVat(vat: unknown): Promise<string | null> {
  const afm = String(vat ?? '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(afm)) return null;
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
    const missingLabels = requiredMissing(fields, values).map((f) => `Λείπει υποχρεωτικό πεδίο «${f.label}»`);
    const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
    const readErrors = ex.errors.map((e) => `Σφάλμα ανάγνωσης «${labelOf(e.fieldKey)}»: ${e.message}`);

    const blocked = [...applied.flags.blocked, ...(t.mode === 'AUTO' ? missingLabels : [])];
    // Everything that blocks is also worth a human's eyes, so the blocked reasons are mirrored into
    // `review` (deduped — a missing required field would otherwise land in both lists twice).
    const flags: RunFlags = { review: [...new Set([...applied.flags.review, ...missingLabels, ...readErrors, ...blocked])], blocked };
    if (mappingFellBack(mappings, applied.mappingName)) {
      flags.review.push(`Ο κανόνας ζήτησε mapping «${applied.mappingName}» που δεν υπάρχει`);
    }

    // Projection — MANUAL runs never rewrite the document.
    const mapping = t.mode === 'MANUAL' ? null : pickMapping(mappings, applied.mappingName);
    let nextData: Record<string, unknown> | null = null;
    if (mapping) {
      nextData = projectToInvoice(values, mapping.rows as MappingRowInvoice[], extracted);
      for (const s of applied.setFields) if (s.invoiceKey) setInvoicePath(nextData, s.invoiceKey, s.value);
    }
    // projectToInvoice only replaces `items` when the mapping has line rows; otherwise the array is the same reference.
    const itemsChanged = nextData != null && nextData.items !== extracted.items && Array.isArray(nextData.items);

    // Persist the document changes BEFORE posting, so the poster sees the mapped data.
    const docUpdate: Prisma.OcrDocumentUpdateInput = {};
    if (nextData) docUpdate.extractedData = nextData as Prisma.InputJsonValue;
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (itemsChanged) {
      ops.push(prisma.ocrInvoiceItem.deleteMany({ where: { documentId: doc.id } }));
      ops.push(prisma.ocrInvoiceItem.createMany({ data: itemsToRows(nextData!.items as unknown[]).map((r) => ({ ...r, documentId: doc.id })) }));
    }
    if (Object.keys(docUpdate).length || ops.length) {
      await prisma.$transaction([prisma.ocrDocument.update({ where: { id: doc.id }, data: docUpdate }), ...ops]);
    }

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
            const reason = POST_BLOCK_REASON[e.code] ?? e.message;
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
    try {
      const run = await prisma.templateRun.create({
        data: { ...base, status: 'FAILED', values: {}, matched: [], flags: undefined, mappingName: '', durationMs: Date.now() - started, error },
      });
      await prisma.ocrDocument
        .update({ where: { id: doc.id }, data: { reviewFlags: buildReviewFlags(t, 'FAILED', run.id, { review: [], blocked: [] }) as unknown as Prisma.InputJsonValue } })
        .catch(() => null);
      return { runId: run.id, status: 'FAILED', flags: { review: [], blocked: [] }, error };
    } catch (e2) {
      // The database itself is unavailable: report the failure to the caller rather than throwing
      // out of a function whose whole contract is "never throws for a failed run".
      console.error('[templates] failed run could not be recorded', doc.id, (e2 as Error).message);
      return { runId: '', status: 'FAILED', flags: { review: [], blocked: [] }, error };
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
