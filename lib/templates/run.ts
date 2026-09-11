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
// Το κανονικό έγγραφο και ο ΕΝΑΣ γραφέας του (μαζί με τα παράγωγα: extractedData, γραμμές, issuerAfm).
import { loadDocumentJson, saveDocumentJson } from '@/lib/ocr/document';
import { normalizeDocument, type DocumentJson } from '@/lib/ocr/canonical';
import { extractTemplateFields } from './extract';
import { applyRules, type RuleDef } from './conditions';
import { projectToDocument } from './mapping';
import { toRunOutput } from './output';
import { TEMPLATE_INCLUDE, toConditionDto, toFieldDef, toMappingDto } from './serialize';
import { sendRuleNotifications } from './notify';
import {
  applySetFields, baseOcrSnapshot, buildReviewFlags, canPost, crossCheckOcr, decideOutcome, extrasFrom,
  mappingFellBack, pickMapping, readFlags, setDocumentPath, tableFellThrough,
  type RunFlags,
} from './run-logic';
import { ADAPTIVE_PREFIX, recomputeFieldFlags, type StoredFlags } from './run-flags';
import { toLastGood, updateLastGood } from './adaptive';
import { RUN_INCLUDE, type RunWithTemplate } from './run-dto';
import { isValidBbox, type FieldValue, type MappingRowInvoice, type Region, type RunOutcome, type RunTrigger } from './schema';
import { findTemplateForVat } from './match-vat';
import { markUnknownForm, recognizeTemplate, type RecognizedBy } from './recognize';

export type { RunOutcome, RunTrigger };
// Re-exported where it has always lived: every caller of the runner asks it this question too.
export { findTemplateForVat };

// The widened-box reason itself lives in `run-flags.ts` — the recomputation owns it (a correction of
// the field must lift it), and this module only re-exports it for the callers that already import it here.
export { ADAPTIVE_PREFIX };

/**
 * A reading worth learning from: produced by a READER (not typed by a human, not written by a rule),
 * non-empty, and carrying the box it came from. A manual correction is exactly the case to skip —
 * the human disagreed with what was read, so the position that produced it is not a good position.
 */
function learnable(v: FieldValue | undefined): v is FieldValue & { page: number; bbox: [number, number, number, number] } {
  return !!v && (v.source === 'text' || v.source === 'vision') && v.value != null && v.value !== ''
    && typeof v.page === 'number' && isValidBbox(v.bbox);
}

/**
 * Fold the positions these fields were read at into `TemplateField.lastGood` (spec §17.2) and report
 * which keys were actually learned, so the run can record them and never learn the same reading
 * twice (every later correction on the SAME run re-runs `finalizeRunEdit`).
 *
 * Bookkeeping: a failure here is logged and swallowed — nothing about a run's outcome depends on it.
 */
async function learnLastGood(
  templateId: string,
  rows: { key: string; lastGood: unknown }[],
  values: Record<string, FieldValue>,
  keys: string[],
): Promise<string[]> {
  const at = new Date().toISOString();
  const done: string[] = [];
  for (const key of keys) {
    const v = values[key];
    const row = rows.find((r) => r.key === key);
    if (!row || !learnable(v)) continue;
    const next = updateLastGood(toLastGood(row.lastGood), v.page, v.bbox, at);
    try {
      await prisma.templateField.update({
        where: { templateId_key: { templateId, key } },
        data: { lastGood: next as unknown as Prisma.InputJsonValue },
      });
      done.push(key);
    } catch (e) {
      console.error('[templates] lastGood not stored', templateId, key, (e as Error).message);
    }
  }
  return done;
}

/** Public base URL for the links inside notification emails ('' → the email names the file instead of linking). */
const APP_URL = () => process.env.APP_URL ?? '';

/**
 * Persist a projection onto the document: the canonical `document` and — when the projection
 * rebuilt the lines — the `OcrInvoiceItem` rows that mirror it. Shared by the runner and by a manual
 * correction of a run (`PATCH /template-runs/[runId]`) so both apply the projection by exactly the
 * same rule. `previous` is the document the projection started from: `projectToDocument` hands back
 * the SAME `lines` reference when the mapping has no line rows, which is how "the lines changed" is
 * detected without comparing every cell.
 */
export async function persistProjection(documentId: string, projected: DocumentJson, previous: DocumentJson): Promise<void> {
  const linesChanged = projected.lines !== previous.lines;
  await saveDocumentJson(documentId, projected, { replaceItems: linesChanged });
  // The lines moved underneath the document: auto-match the new codes and recompute
  // `itemsTotal`/`itemsMatched`, which would otherwise still describe the rows we just deleted.
  // (`saveDocumentJson` carries the manual matches over.) Bookkeeping — never fatal.
  if (linesChanged) await matchDocItems(documentId).catch(() => null);
}

export async function runTemplateOnDocument(input: { documentId: string; templateId: string; trigger: RunTrigger; recognizedBy?: RecognizedBy }): Promise<RunOutcome> {
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
  // Πώς βρέθηκε αυτό το πρότυπο (§14.7) — ταξιδεύει στα flags ώστε μια εκτέλεση που «μαντεύτηκε»
  // από τη διάταξη να ξεχωρίζει από μία που ζητήθηκε ονομαστικά.
  const recognizedBy = input.recognizedBy ?? null;
  // Το κανονικό έγγραφο, όπως το άφησε το βασικό OCR. Ό,τι διαβάσει το πρότυπο γράφεται ΠΑΝΩ του.
  const document = await loadDocumentJson(doc.id);
  // What the base OCR read, captured NOW — the projection below overwrites the document with the
  // template's own values, and every later re-check of «Ασυμφωνία …» (a correction, a re-read) needs
  // the independent reading to compare against. Stored on the run; see `baseOcrSnapshot`.
  const baseOcr = baseOcrSnapshot(document);

  try {
    const buffer = await bunnyDownload(doc.storageKey);
    const ex = await extractTemplateFields(buffer, doc.mimeType, fields, { ref: { refType: 'OcrDocument', refId: doc.id } });
    const applied = applyRules(rules, {
      values: ex.values,
      valueTypes: Object.fromEntries(fields.map((f) => [f.key, f.valueType])),
      extras: extrasFrom(document, doc._count.items, ex.pageCount),
    });
    const values = applySetFields(ex.values, fields, applied.setFields);
    const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
    const adaptiveKeys = ex.adaptive ?? [];

    // What the READ has to say about itself — missing required fields, read errors, widened reads,
    // and whatever the rules concluded — keyed by field as well as in prose. Shared with the batch
    // scanner (`jobs.ts`), which owes the user exactly the same verdicts about a file.
    const flags: RunFlags = readFlags({
      fields, values, mode: t.mode, errors: ex.errors, adaptive: adaptiveKeys, rules: applied.flags,
    });
    // Everything below appends to the same object the UI reads its per-field colours from.
    const fieldFlags = flags.fields;
    if (mappingFellBack(mappings, applied.mappingName)) {
      flags.review.push(`Ο κανόνας ζήτησε mapping «${applied.mappingName}» που δεν υπάρχει`);
    }

    // Projection — MANUAL runs never rewrite the document.
    const mapping = t.mode === 'MANUAL' ? null : pickMapping(mappings, applied.mappingName);
    let projected = document;
    if (mapping) {
      const rows = mapping.rows as MappingRowInvoice[];
      projected = projectToDocument(values, rows, document, fields);
      for (const s of applied.setFields) {
        if (!s.invoiceKey) continue;
        const next = setDocumentPath(projected, s.invoiceKey, s.value);
        if (next) projected = next;
      }

      // The template still wins the projection — but where it contradicts the base OCR on an amount,
      // a number or the date, say so instead of silently preferring one reader over the other.
      for (const c of crossCheckOcr(rows, values, baseOcr, labelOf)) {
        if (!flags.review.includes(c.reason)) flags.review.push(c.reason);
        if (!fieldFlags[c.fieldKey]) fieldFlags[c.fieldKey] = 'review';
      }

      // A table the model could not read must not replace real invoice lines with an empty list:
      // keep the OCR's lines (same array reference → the rows are left alone) and flag it.
      const keptTable = tableFellThrough(rows, values, document);
      if (keptTable) {
        projected = { ...projected, lines: document.lines };
        const reason = `Ο πίνακας «${labelOf(keptTable)}» δεν διαβάστηκε — κρατήθηκαν οι γραμμές του OCR`;
        if (!flags.review.includes(reason)) flags.review.push(reason);
      }
      // Persist the document changes BEFORE posting, so the poster sees the mapped data.
      await persistProjection(doc.id, projected, document);
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
          if (e instanceof PostError && e.code === 'already_posted') {
            // Already in the ERP — a re-run of the same template must not queue the document for a
            // second posting. That is the outcome the run wanted, so the run is POSTED, not BLOCKED.
            const reason = e.message || POST_ERROR_TEXT.already_posted;
            if (!flags.review.includes(reason)) flags.review.push(reason);
          } else if (e instanceof PostError) {
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
    // `createdAt` is set explicitly so the envelope's `extractedAt` and the run's own timestamp are
    // the SAME instant — the JSON the user downloads must not claim a different moment than the card.
    // A run that ended without anyone having to intervene is the template's own confirmation that
    // the widened box was the right place to look: fold it into `lastGood` now, so the NEXT document
    // is searched there from the start. A run that stopped for review learns nothing yet — its
    // corrections (or its untouched values) go through `finalizeRunEdit` instead.
    const learned = status === 'EXTRACTED' || status === 'POSTED'
      ? await learnLastGood(t.id, t.fields, values, adaptiveKeys)
      : [];

    const createdAt = new Date();
    const run = await prisma.templateRun.create({
      data: {
        ...base,
        status,
        createdAt,
        values: values as unknown as Prisma.InputJsonValue,
        matched: applied.matched as unknown as Prisma.InputJsonValue,
        flags: { ...flags, notified: [] as string[], learned, baseOcr, ...(recognizedBy && { recognizedBy }) } as unknown as Prisma.InputJsonValue,
        // The canonical document this run produced (spec §17.1) — the whole output of the run, frozen
        // at the moment it ran. A later re-run of the same template writes its own row.
        // `normalizeDocument` because that is what `saveDocumentJson` stored: the downloaded envelope
        // must not disagree with the document the ERP posts from over a date format or a numeric string.
        output: toRunOutput({ slug: t.slug, file: doc.fileName, documentId: doc.id, createdAt, document: normalizeDocument(projected) }) as unknown as Prisma.InputJsonValue,
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
        .update({ where: { id: run.id }, data: { flags: { ...flags, notified, learned, baseOcr, ...(recognizedBy && { recognizedBy }) } as unknown as Prisma.InputJsonValue } })
        .catch((e) => console.error('[templates] notified flags not stored', run.id, (e as Error).message));
    }

    // Bookkeeping only: the run already exists and is returned even if this write fails, so it must
    // never fall through to the outer catch (that would write a second, FAILED, run for the same work).
    await prisma
      .$transaction([
        prisma.ocrDocument.update({ where: { id: doc.id }, data: { reviewFlags: buildReviewFlags(t, status, run.id, flags, recognizedBy) as unknown as Prisma.InputJsonValue } }),
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

// ─── Editing a run after the fact ───────────────────────────────────────────
// A human corrects a value (PATCH) or re-reads one field with a box they just moved (reread). Both
// end in exactly the same three writes, and they live here so the two paths can never drift apart.

/**
 * Whether `runId` is the document's LATEST run. An older run is a historical record: editing it
 * would re-project stale values over the document and leave the banner describing a different run,
 * so both edit paths answer 409 `not_latest` when this is false.
 */
export async function isLatestRun(documentId: string, runId: string): Promise<boolean> {
  const latest = await prisma.templateRun.findFirst({
    where: { documentId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return latest?.id === runId;
}

/**
 * Persist edited values on a run: recompute the flags the values own, re-project onto the document
 * (never in MANUAL mode, same rule as the runner), refresh the run's output envelope and the
 * document's banner. The caller has already refused a run that is not the document's latest, which
 * is what makes moving the banner safe.
 */
export async function finalizeRunEdit(input: {
  run: RunWithTemplate;
  values: Record<string, FieldValue>;
}): Promise<RunWithTemplate> {
  const { run, values } = input;
  const t = run.template;
  const fields = [...t.fields].sort((a, b) => a.order - b.order).map(toFieldDef);
  const mapping = t.mode === 'MANUAL' ? null : pickMapping(t.mappings.map(toMappingDto), run.mappingName || null);
  const rows = (mapping?.rows ?? []) as MappingRowInvoice[];

  const [document, docRow] = await Promise.all([
    loadDocumentJson(run.documentId),
    prisma.ocrDocument.findUnique({ where: { id: run.documentId }, select: { fileName: true } }),
  ]);

  // The cross-check compares against `flags.baseOcr` (the pre-projection snapshot the run stored),
  // NOT against the live document — by now that is this run's own projection.
  const flags = recomputeFieldFlags({ flags: run.flags as StoredFlags | null, fields, values, mode: t.mode, rows });

  // Every value this edit LEAVES as the reader produced it is a confirmed position (spec §17.2): the
  // human looked at the run and did not correct it. `flags.learned` records what this run already
  // taught the template, so correcting a second field does not fold the first one's box in again.
  const already = new Set(flags.learned ?? []);
  const learned = await learnLastGood(
    t.id, t.fields, values,
    fields.map((f) => f.key).filter((k) => !already.has(k)),
  );
  flags.learned = [...already, ...learned];

  // A correction is only worth anything if it reaches the document the ERP posts from — but a
  // template with no INVOICE mapping has nothing to project.
  const projected = mapping ? projectToDocument(values, rows, document, fields) : document;

  const updated = await prisma.templateRun.update({
    where: { id: run.id },
    data: {
      values: values as unknown as Prisma.InputJsonValue,
      flags: flags as unknown as Prisma.InputJsonValue,
      // The envelope is rewritten from the corrected document — a downloaded JSON that still showed
      // the pre-correction value would be the very thing the correction was made to fix.
      output: toRunOutput({
        slug: t.slug, file: docRow?.fileName ?? '', documentId: run.documentId,
        createdAt: run.createdAt, document: normalizeDocument(projected),
      }) as unknown as Prisma.InputJsonValue,
    },
    include: RUN_INCLUDE,
  });

  if (mapping) await persistProjection(run.documentId, projected, document);

  await prisma.ocrDocument
    .update({ where: { id: run.documentId }, data: { reviewFlags: buildReviewFlags(t, run.status, run.id, flags) as unknown as Prisma.InputJsonValue } })
    .catch((e) => console.error('[templates] reviewFlags refresh failed', run.id, (e as Error).message));

  return updated;
}

/** Why a re-read could not happen. The route turns each into its own status code. */
export type RereadError = 'not_found' | 'not_latest' | 'posted' | 'unknown_field' | 'no_region' | 'bad_page' | 'read_failed';

/** `renderPage` throws exactly this when the region names a page the document does not have. */
const PAGE_OUT_OF_RANGE = 'page out of range';
export type RereadResult =
  | { ok: true; run: RunWithTemplate; value: FieldValue; region: Region; overridden: boolean; model: string | null; tokensUsed: number }
  | { ok: false; error: RereadError };

/**
 * Read ONE field of a document again — the «Επανάγνωση» affordance of spec §16: rescan only the box
 * that did not work out, optionally with a region the user just moved or resized on the canvas.
 * The adjusted box is stored on the RUN (`values[key].page/bbox`), not on the template: it describes
 * this one document. Saving it for future documents is a separate, explicit act on the template.
 * Never throws for a failed read — the caller gets a code back.
 */
export async function rereadField(input: { documentId: string; runId: string; fieldKey: string; region?: Region }): Promise<RereadResult> {
  const run = await prisma.templateRun.findUnique({ where: { id: input.runId }, include: RUN_INCLUDE });
  if (!run || run.documentId !== input.documentId) return { ok: false, error: 'not_found' };
  if (!(await isLatestRun(input.documentId, input.runId))) return { ok: false, error: 'not_latest' };
  // A POSTED run has already reached the ERP: re-reading it would re-project over the very data
  // SoftOne was given, and nothing here can take that back.
  if (run.status === 'POSTED') return { ok: false, error: 'posted' };

  const doc = await prisma.ocrDocument.findUnique({ where: { id: input.documentId }, select: { storageKey: true, mimeType: true } });
  if (!doc) return { ok: false, error: 'not_found' };

  const fields = [...run.template.fields].sort((a, b) => a.order - b.order).map(toFieldDef);
  const field = fields.find((f) => f.key === input.fieldKey);
  if (!field) return { ok: false, error: 'unknown_field' };

  const prev = ((run.values as unknown as Record<string, FieldValue>) ?? {})[field.key];
  // Which box to read: the one the user just drew, else the one this run actually used (a previous
  // per-document adjustment), else the template's own region.
  const region: Region | null =
    input.region ?? (prev?.bbox && prev.page != null ? { page: prev.page, bbox: prev.bbox } : null) ?? field.region;
  if (!region) return { ok: false, error: 'no_region' };

  let buffer: Buffer;
  try {
    buffer = await bunnyDownload(doc.storageKey);
  } catch (e) {
    console.error('[templates] reread: file unavailable', input.documentId, (e as Error).message);
    return { ok: false, error: 'read_failed' };
  }

  const ex = await extractTemplateFields(buffer, doc.mimeType, [{ ...field, region }], { ref: { refType: 'OcrDocument', refId: input.documentId } })
    .catch((e) => {
      console.error('[templates] reread failed', input.documentId, field.key, (e as Error).message);
      return null;
    });
  if (!ex) return { ok: false, error: 'read_failed' };
  if (ex.errors.length) {
    // The extractor's message names the model/provider — log it, hand the browser one fixed code.
    console.error('[templates] reread errors', input.documentId, field.key, ex.errors);
    // …except a page the document does not have: that is the CALLER's box, not a failure of the
    // reader, and «Μη έγκυρη σελίδα» is something the user can actually act on.
    if (ex.errors.some((e) => e.message === PAGE_OUT_OF_RANGE)) return { ok: false, error: 'bad_page' };
    return { ok: false, error: 'read_failed' };
  }

  // The value carries the box it was read from, so the next re-read starts where this one left off
  // and the canvas keeps drawing the region the value actually came from.
  //
  // …EXCEPT when only the widened second look found it: then the box that produced the value is the
  // one the MODEL located, not the one we asked for. Overwriting it with the requested region would
  // draw the canvas box around empty paper, and — worse — teach `lastGood` a position the value was
  // demonstrably NOT at. The adaptive read's own coordinates win.
  const readAdaptively = (ex.adaptive ?? []).includes(field.key);
  const read = ex.values[field.key];
  const value: FieldValue = readAdaptively && isValidBbox(read.bbox) && read.page != null
    ? read
    : { ...read, page: region.page, bbox: region.bbox };

  // The vision call takes seconds, and a re-run of the template can land in the middle of it. Ask
  // again, now: `finalizeRunEdit` projects onto the document and moves its banner, so committing
  // against a run that is no longer the latest would overwrite the newer run's work with ours.
  if (!(await isLatestRun(input.documentId, input.runId))) return { ok: false, error: 'not_latest' };

  // The SAME run can also have moved: a manual correction (PATCH) on another field commits while the
  // model is reading. `values` and `flags` were snapshotted before the read, so writing them back
  // would silently undo that correction. Re-read the row and put ONLY our field on top of it.
  const fresh = await prisma.templateRun.findUnique({ where: { id: input.runId }, include: RUN_INCLUDE });
  if (!fresh || fresh.documentId !== input.documentId) return { ok: false, error: 'not_found' };
  const merged = { ...((fresh.values as unknown as Record<string, FieldValue>) ?? {}), [field.key]: value };

  // The verdict the runner writes for an adaptive read needs no help here: `value.adaptive` travels
  // with the value, and `finalizeRunEdit` → `recomputeFieldFlags` rebuilds the reason from it — which
  // is also what makes the reason LIFT when the next re-read lands inside the drawn region.
  const updated = await finalizeRunEdit({ run: fresh, values: merged });
  return { ok: true, run: updated, value, region, overridden: input.region != null, model: ex.model, tokensUsed: ex.tokensUsed };
}

/**
 * Convenience for the upload/reextract hooks: find the template this document belongs to and run it.
 * Never throws.
 *
 * The ΑΦΜ is only the FIRST question (spec §14.7): a document whose issuer has no template is then
 * compared by layout against every trained one, and only when that fails too is it marked «άγνωστο
 * έντυπο» — a flag the list shows, so a human picks the template once and the sample they make out
 * of it teaches the recogniser for next time.
 */
export async function runMatchingTemplate(documentId: string, vat: unknown, trigger: RunTrigger): Promise<RunOutcome | null> {
  try {
    const found = await recognizeTemplate(documentId, vat);
    if (!found) {
      await markUnknownForm(documentId);
      return null;
    }
    return await runTemplateOnDocument({ documentId, templateId: found.templateId, trigger, recognizedBy: found.by });
  } catch (e) {
    console.error('[templates] runMatchingTemplate', (e as Error).message);
    return null;
  }
}
