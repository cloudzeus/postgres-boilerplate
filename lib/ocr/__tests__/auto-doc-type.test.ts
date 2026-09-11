// lib/ocr/__tests__/auto-doc-type.test.ts
// Ο τύπος «Αυτόματα»: ΜΙΑ κλήση στο μοντέλο, και το είδος βγαίνει από το `document.kind` που
// απαντάει. Τα δύο πράγματα που πρέπει να αποδειχθούν εδώ είναι ότι (α) ένα παραστατικό διαβάζεται
// ακριβώς όπως πριν και (β) ένα ελεύθερο κείμενο ΔΕΝ πυροδοτεί το ακριβό δεύτερο πέρασμα επειδή
// «του λείπουν» τα υποχρεωτικά ενός τιμολογίου.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { net, usage, own } = vi.hoisted(() => ({
  net: { fetchWithRetry: vi.fn() },
  usage: { logAiUsage: vi.fn(), providerFromUrl: () => 'gemini' },
  own: { resolveOwnAfm: vi.fn() },
}));

vi.mock('@/lib/ocr/fetch-retry', () => net);
vi.mock('@/lib/ai/usage', () => usage);
vi.mock('@/lib/ocr/own-afm', () => own);
vi.mock('@/lib/settings', () => ({
  getSetting: vi.fn(async (key: string) => (key.endsWith('ApiKey') ? 'test-key' : undefined)),
}));

import { extractDocument } from '../extract';
import { buildSystemPrompt, resolveDocType, REQUIRED_PATHS } from '../templates';
import { missingRequired } from '../extract-merge';
import { coerceDocument } from '../canonical';

/** Μία απάντηση του vision endpoint (OpenAI-compatible σχήμα). */
const reply = (payload: unknown) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { total_tokens: 7 } }),
});

const INVOICE_ANSWER = {
  kind: 'invoice',
  type: { label: 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ', series: 'ΤΠΥ', number: '17' },
  date: '2026-06-22',
  issuer: { name: 'ΚΑΠΑΛΙΝΕ ΑΕ', vat: '999863881' },
  recipient: { name: 'DGESPA ΑΕ', vat: '094014201' },
  lines: [{ name: 'Υπηρεσίες', quantity: 1, unitPrice: 100, net: 100, vatRate: 24, vatAmount: 24, total: 124 }],
  totals: { net: 100, vatAmount: 24, total: 124, payable: 124 },
};

const GENERAL_ANSWER = {
  kind: 'general',
  notes: 'Επιστολή προς τον Δήμο Αθηναίων.',
  custom: {
    title: 'Αίτηση χορήγησης βεβαίωσης',
    fullText: 'Αξιότιμε κύριε Δήμαρχε, με την παρούσα αιτούμαι…',
    summary: 'Αίτηση για βεβαίωση. Απευθύνεται στον Δήμαρχο. Δεν αφορά συναλλαγή.',
    keywords: ['αίτηση', 'βεβαίωση'],
  },
};

const run = (docType: 'auto' | 'invoice' | 'receipt' | 'general_text') =>
  extractDocument({ buffer: Buffer.from('not-a-real-image'), mimeType: 'image/png', docType, language: 'el' });

beforeEach(() => {
  vi.clearAllMocks();
  own.resolveOwnAfm.mockResolvedValue(null);
});

describe('«Αυτόματα» — το prompt', () => {
  it('χρησιμοποιεί το σχήμα του τιμολογίου συν την παράγραφο ταξινόμησης', () => {
    const auto = buildSystemPrompt('auto', 'el');
    const invoice = buildSystemPrompt('invoice', 'el');
    expect(auto).toContain('"vatBreakdown"');          // το ίδιο (υπερσύνολο) σχήμα
    expect(auto).toMatch(/DOCUMENT CLASSIFICATION/);
    expect(auto).toMatch(/`kind` to "general"/);
    expect(auto).toMatch(/custom\.fullText|"fullText"/);
    expect(auto).not.toBe(invoice);
    expect(invoice).not.toMatch(/DOCUMENT CLASSIFICATION/);
  });

  it('το ρητό «ελεύθερο κείμενο» κρατάει το παλιό, στενό prompt', () => {
    const general = buildSystemPrompt('general_text', 'el');
    expect(general).toMatch(/text digitization module/);
    expect(general).not.toMatch(/DOCUMENT CLASSIFICATION/);
    expect(general).not.toContain('"vatBreakdown"');
  });

  it('η απόδειξη εξακολουθεί να διαβάζεται με το prompt του τιμολογίου', () => {
    expect(buildSystemPrompt('receipt', 'el')).toBe(buildSystemPrompt('invoice', 'el'));
  });
});

describe('«Αυτόματα» — τι κρίνει το αποτέλεσμα', () => {
  it('resolveDocType: ρητή επιλογή κερδίζει, «auto» ακολουθεί το kind', () => {
    expect(resolveDocType('invoice', 'receipt')).toBe('invoice');
    expect(resolveDocType('general_text', 'invoice')).toBe('general_text');
    expect(resolveDocType('auto', 'invoice')).toBe('invoice');
    expect(resolveDocType('auto', 'receipt')).toBe('receipt');
    expect(resolveDocType('auto', 'general')).toBe('general_text');
  });

  it('ένα γενικό έγγραφο δεν μετράει τα υποχρεωτικά του τιμολογίου', () => {
    const general = coerceDocument(GENERAL_ANSWER);
    expect(general.kind).toBe('general');
    // Με τα υποχρεωτικά του τιμολογίου θα «έλειπαν» και τα 7 — άρα σίγουρη επανεκτέλεση.
    expect(REQUIRED_PATHS.auto).toHaveLength(7);
    expect(missingRequired(general, 'auto')).toBe(0);
  });

  it('ένα άδειο γενικό έγγραφο μετράει τα δικά του υποχρεωτικά (τίτλος + κείμενο)', () => {
    const empty = coerceDocument({ kind: 'general' });
    expect(missingRequired(empty, 'auto')).toBe(2);
  });
});

describe('«Αυτόματα» — extractDocument', () => {
  it('παραστατικό: γίνεται τιμολόγιο και τα πεδία επιβιώνουν, με ΜΙΑ κλήση', async () => {
    net.fetchWithRetry.mockResolvedValue(reply(INVOICE_ANSWER));
    const res = await run('auto');
    expect(res.document.kind).toBe('invoice');
    expect(res.document.issuer.vat).toBe('999863881');
    expect(res.document.type.number).toBe('17');
    expect(res.document.totals.total).toBe(124);
    expect(res.data.vatNumber).toBe('999863881');
    expect(net.fetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('ελεύθερο κείμενο: γίνεται general, κρατάει τίτλο/κείμενο και ΔΕΝ ξαναδιαβάζεται ακριβά', async () => {
    net.fetchWithRetry.mockResolvedValue(reply(GENERAL_ANSWER));
    const res = await run('auto');
    expect(res.document.kind).toBe('general');
    expect(res.document.custom.title).toBe('Αίτηση χορήγησης βεβαίωσης');
    expect(res.document.custom.fullText).toMatch(/Αξιότιμε/);
    expect(res.document.issuer.name).toBeNull();
    expect(res.document.totals.total).toBeNull();
    // Η προβολή που διαβάζει η καρτέλα έχει τα κλειδιά του ελεύθερου κειμένου.
    expect(res.data.title).toBe('Αίτηση χορήγησης βεβαίωσης');
    // ΜΙΑ κλήση: κανένα δεύτερο πέρασμα με gemini-2.5-pro.
    expect(net.fetchWithRetry).toHaveBeenCalledTimes(1);
  });

  it('ένα ΔΥΣΚΟΛΟ παραστατικό εξακολουθεί να πυροδοτεί το δεύτερο πέρασμα', async () => {
    net.fetchWithRetry.mockResolvedValue(reply({ kind: 'invoice', issuer: { name: 'ΚΑΠΟΙΟΣ' } }));
    await run('auto');
    expect(net.fetchWithRetry).toHaveBeenCalledTimes(2);
    const models = net.fetchWithRetry.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).model);
    expect(models[1]).toBe('gemini-2.5-pro');
  });

  it('το ρητό «ελεύθερο κείμενο» παραμένει general ό,τι κι αν απαντήσει το μοντέλο', async () => {
    net.fetchWithRetry.mockResolvedValue(reply(INVOICE_ANSWER));
    const res = await run('general_text');
    expect(res.document.kind).toBe('general');
  });
});
