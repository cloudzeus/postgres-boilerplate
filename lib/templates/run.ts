// lib/templates/run.ts — SERVER. Runs one template on one OcrDocument (spec §3β + §15).
// Never throws for extraction/posting failures: every failure becomes a FAILED run, the document stays COMPLETED.
import 'server-only';
import type { Prisma, TemplateRunStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { bunnyDownload } from '@/lib/bunny';
import { postDocumentToSoftone } from '@/lib/ocr/post-softone';
import { extractTemplateFields } from './extract';
import { applyRules, type RuleDef } from './conditions';
import { projectToInvoice } from './mapping';
import { TEMPLATE_INCLUDE, toConditionDto, toFieldDef, toMappingDto } from './serialize';
import { sendRuleNotifications } from './notify';
import {
  applySetFields, buildReviewFlags, decideStatus, extrasFrom, itemsToRows, pickMapping, requiredMissing, setInvoicePath,
  type RunFlags,
} from './run-logic';
import type { MappingRowInvoice } from './schema';

export type RunTrigger = 'upload' | 'manual' | 'reextract';
export type RunOutcome = { runId: string; status: TemplateRunStatus; flags: RunFlags; error: string | null };

/** Public base URL for the links inside notification emails ('' → relative link, still readable). */
const APP_URL = () => process.env.APP_URL ?? '';

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
    prisma.ocrDocument.findUnique({ where: { id: input.documentId }, include: { items: { orderBy: { rowIndex: 'asc' } } } }),
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
    const pageCount = Math.max(1, ...fields.map((f) => (f.region?.page ?? 0) + 1));
    const applied = applyRules(rules, {
      values: ex.values,
      valueTypes: Object.fromEntries(fields.map((f) => [f.key, f.valueType])),
      extras: extrasFrom(extracted, doc.items.length, pageCount),
    });
    const values = applySetFields(ex.values, fields, applied.setFields);
    const missing = requiredMissing(fields, values);
    const missingLabels = missing.map((f) => `Λείπει υποχρεωτικό πεδίο «${f.label}»`);
    const flags: RunFlags = {
      review: [...applied.flags.review, ...missingLabels],
      blocked: [...applied.flags.blocked, ...(t.mode === 'AUTO' ? missingLabels : [])],
    };

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

    const decision = decideStatus(t.mode, flags);
    let status: TemplateRunStatus = decision === 'POST' ? 'POSTED' : decision;
    let error: string | null = null;
    if (decision === 'POST') {
      try {
        await postDocumentToSoftone(doc.id);
      } catch (e) {
        status = 'FAILED';
        error = `Ανάρτηση: ${(e as Error).message}`;
      }
    }

    // NOTIFY — once per document and rule, across all previous runs of this document.
    const previous = await prisma.templateRun.findMany({ where: { documentId: doc.id }, select: { flags: true } });
    const alreadyNotified = previous.flatMap((r) => (r.flags as { notified?: string[] } | null)?.notified ?? []);
    const notified = await sendRuleNotifications({
      docId: doc.id,
      fileName: doc.fileName,
      templateName: t.name,
      defaultEmails: t.notifyEmails,
      appUrl: APP_URL(),
      values: values as Record<string, { value: unknown; color: string }>,
      notifications: applied.matched.flatMap((m) =>
        m.actions
          .filter((a) => a.type === 'NOTIFY')
          .map((a) => ({ conditionId: m.id, subject: (a.params as { subject: string }).subject, emails: (a.params as { emails?: string }).emails })),
      ),
      alreadyNotified,
    });

    const run = await prisma.templateRun.create({
      data: {
        ...base,
        status,
        values: values as unknown as Prisma.InputJsonValue,
        matched: applied.matched as unknown as Prisma.InputJsonValue,
        flags: { ...flags, notified } as unknown as Prisma.InputJsonValue,
        mappingName: mapping?.name ?? '',
        model: ex.model,
        tokensUsed: ex.tokensUsed,
        durationMs: Date.now() - started,
        error,
      },
    });
    await prisma.$transaction([
      prisma.ocrDocument.update({ where: { id: doc.id }, data: { reviewFlags: buildReviewFlags(t, status, run.id, flags) as unknown as Prisma.InputJsonValue } }),
      prisma.extractionTemplate.update({ where: { id: t.id }, data: { timesUsed: { increment: 1 } } }),
    ]);
    return { runId: run.id, status, flags, error };
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 2000);
    console.error('[templates] run failed', t.slug, doc.id, error);
    const run = await prisma.templateRun.create({
      data: { ...base, status: 'FAILED', values: {}, matched: [], flags: undefined, mappingName: '', durationMs: Date.now() - started, error },
    });
    await prisma.ocrDocument
      .update({ where: { id: doc.id }, data: { reviewFlags: buildReviewFlags(t, 'FAILED', run.id, { review: [], blocked: [] }) as unknown as Prisma.InputJsonValue } })
      .catch(() => null);
    return { runId: run.id, status: 'FAILED', flags: { review: [], blocked: [] }, error };
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
