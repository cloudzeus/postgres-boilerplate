// lib/templates/detect.ts — SERVER. "Name this region" and "find what the accountant circled" (spec §14.1-6/7).
import 'server-only';
import sharp from 'sharp';
import { callVision, prepareCrop, type UsageRef } from './vision';
import { parseDetectField, parseMarks, type DetectedField, type DetectedMark } from './detect-parse';
import type { Bbox } from './schema';

const FIELD_PROMPT = [
  'You are labelling one region of a scanned business document (Greek or English) for a data-extraction template.',
  'Return ONLY JSON: {"label":"<short field name in the document\'s language, e.g. Αριθμός παραστατικού>","value":"<the raw value printed or handwritten in the region>","kind":"SINGLE"|"TABLE","valueType":"TEXT"|"NUMBER"|"CURRENCY"|"DATE"|"LIST","columns":[{"label":"...","valueType":"..."}]}.',
  'If the region shows a caption next to a value: label = the caption without its colon, value = the value. If it shows only a value: invent a short descriptive label.',
  'If it shows a table header or table rows: kind = "TABLE" and list every column; otherwise columns = [].',
  'No markdown, no explanation.',
].join('\n');

/** `field` is null when the model answered with something that is not JSON — the caller turns that into an error, not into an empty field. */
export async function detectFieldFromCrop(pageBuf: Buffer, bbox: Bbox, opts: { taken: Iterable<string>; fallbackLabel: string; ref?: UsageRef }): Promise<{ field: DetectedField | null; model: string; tokensUsed: number | null }> {
  const crop = await prepareCrop(pageBuf, bbox);
  const r = await callVision(crop, FIELD_PROMPT, 'template.detect_field', opts.ref);
  return { field: parseDetectField(r.content, { taken: opts.taken, fallbackLabel: opts.fallbackLabel }), model: r.model, tokensUsed: r.tokensUsed };
}

const MARKS_PROMPT = [
  'This is a full page of a scanned business document. An accountant has marked by hand what must be extracted: hand-drawn circles or ellipses around printed values, and handwritten notes (accounting codes such as 60.64.00.000.010, amounts, words).',
  'Return ONLY JSON: {"marks":[{"label":"<the printed caption of the circled value, or a short name>","value":"<the text inside the mark, exactly as printed or written>","valueType":"TEXT"|"NUMBER"|"CURRENCY"|"DATE","box_2d":[ymin,xmin,ymax,xmax]}]}.',
  'box_2d is on a 0-1000 grid over the whole image (y grows downwards) and must contain the entire circle or note. One entry per circle and per handwritten note. Ignore stamps such as ΚΑΤΕΧΩΡΗΘΗ, signatures and ticks. At most 20 entries. No markdown.',
].join('\n');

const ALL_PROMPT = [
  'This is a full page of a scanned business document (Greek or English). List every labelled value a data-extraction template could want: document number, dates, codes, amounts, quantities with units, identifiers, registration plates, account numbers, handwritten notes. Skip long free text, addresses, legal footers and marketing.',
  'Return ONLY JSON: {"marks":[{"label":"<the printed caption, without its colon>","value":"<the value exactly as printed or written>","valueType":"TEXT"|"NUMBER"|"CURRENCY"|"DATE","box_2d":[ymin,xmin,ymax,xmax]}]}.',
  'box_2d is on a 0-1000 grid over the whole image (y grows downwards) and must contain the value (and its caption when adjacent). At most 20 entries, most important first. No markdown.',
].join('\n');

export type DetectMode = 'marks' | 'all';

/**
 * Whole-page detection. `marks` = only what the accountant circled/wrote; `all` = every labelled value
 * (clean samples). The bitmap is downscaled (boxes are normalized, so scale is irrelevant) and kept in
 * colour — pen marks matter — and shipped as JPEG: a full page of scan is several MB as PNG.
 * `marks` is null when the model answered with something that is not JSON.
 */
export async function detectMarksOnPage(pageBuf: Buffer, opts: { taken: Iterable<string>; mode?: DetectMode; max?: number; ref?: UsageRef }): Promise<{ marks: DetectedMark[] | null; model: string; tokensUsed: number | null }> {
  const img = await sharp(pageBuf).resize({ width: 1600, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const r = await callVision(img, opts.mode === 'all' ? ALL_PROMPT : MARKS_PROMPT, opts.mode === 'all' ? 'template.detect_all' : 'template.detect_marks', opts.ref, 'image/jpeg');
  return { marks: parseMarks(r.content, { taken: opts.taken, max: opts.max }), model: r.model, tokensUsed: r.tokensUsed };
}
