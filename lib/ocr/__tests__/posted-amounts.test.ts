// «Διόρθωση ποσών στη SoftOne» — συνθετικά δεδομένα, χωρίς ζωντανή SoftOne.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, s1, post } = vi.hoisted(() => ({
  db: { ocrDocument: { findUnique: vi.fn(), update: vi.fn() } },
  s1: { softoneCall: vi.fn(), softoneGetData: vi.fn() },
  post: { gatherForConversion: vi.fn(), expectedNetOf: (d: { lines: { net: number }[] }) => d.lines.reduce((t, l) => t + l.net, 0) },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/softone', () => s1);
vi.mock('@/lib/ocr/post-softone', () => ({ ...post, PostError: class extends Error {} }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import { checkPostedAmounts, fixPostedAmounts } from '../posted-amounts';

const GATHERED = {
  document: { lines: [{ net: 100 }, { net: 50 }], totals: { vatAmount: 36, total: 186 } },
  ctx: { target: { lines: 'LINLINES' } },
  payload: { OBJECT: 'LINCREDOC', DATA: { LINLINES: [{ MTRL: 7, LINEVAL: 100 }, { MTRL: 8, LINEVAL: 50 }] } },
};
const savedZero = {
  LINCREDOC: [{ NETAMNT: '0', VATAMNT: '0', SUMAMNT: '0' }],
  LINLINES: [{ LINENUM: '1', MTRL: '7', LINEVAL: '0', COMMENTS: 'Α' }, { LINENUM: '2', MTRL: '8', LINEVAL: '0', COMMENTS: 'Β' }],
};
const calc = (net: string, vat: string, total: string) => ({ success: true, data: { LINCREDOC: [{ NETAMNT: net, VATAMNT: vat, SUMAMNT: total }] } });

beforeEach(() => {
  vi.clearAllMocks();
  db.ocrDocument.findUnique.mockResolvedValue({ postStatus: 'POSTED', postedRef: '115601', postError: null });
  db.ocrDocument.update.mockResolvedValue({});
  post.gatherForConversion.mockResolvedValue(GATHERED);
});

describe('checkPostedAmounts', () => {
  it('μηδενικό στη SoftOne ⇒ διορθώνεται, με προεπισκόπηση από calculate ΜΕ ΤΟ ΙΔΙΟ KEY', async () => {
    s1.softoneGetData.mockResolvedValue(savedZero);
    s1.softoneCall.mockResolvedValue(calc('150', '36', '186'));
    const c = await checkPostedAmounts('d1');
    expect(c).toMatchObject({ status: 'mismatch', fixable: true, preview: { net: 150, vat: 36, total: 186 }, vatWarning: null });
    expect(s1.softoneCall).toHaveBeenCalledWith('calculate', expect.objectContaining({ KEY: '115601' }));
  });
  it('οι γραμμές άλλαξαν στη SoftOne ⇒ ΔΕΝ μαντεύουμε', async () => {
    s1.softoneGetData.mockResolvedValue({ ...savedZero, LINLINES: [savedZero.LINLINES[0]] });
    const c = await checkPostedAmounts('d1');
    expect(c.fixable).toBe(false);
    expect(c.reason).toMatch(/δεν είναι πια ίδιες/);
    expect(s1.softoneCall).not.toHaveBeenCalled();
  });
  it('διαφορά ΦΠΑ μετά τη διόρθωση ⇒ προειδοποίηση που θέλει αποδοχή', async () => {
    s1.softoneGetData.mockResolvedValue(savedZero);
    s1.softoneCall.mockResolvedValue(calc('150', '57.09', '207.09'));
    expect((await checkPostedAmounts('d1')).vatWarning).toMatch(/διαφορά/);
  });
  it('σωστά ποσά ⇒ ok, καμία κλήση calculate', async () => {
    s1.softoneGetData.mockResolvedValue({ LINCREDOC: [{ NETAMNT: '150', VATAMNT: '36', SUMAMNT: '186' }] });
    expect((await checkPostedAmounts('d1')).status).toBe('ok');
    expect(s1.softoneCall).not.toHaveBeenCalled();
  });
});

describe('fixPostedAmounts', () => {
  it('setData με ΟΛΑ τα LINENUM και μόνο LINEVAL, μετά νέα ανάγνωση', async () => {
    s1.softoneGetData.mockResolvedValueOnce(savedZero).mockResolvedValueOnce({ LINCREDOC: [{ NETAMNT: '150', VATAMNT: '36', SUMAMNT: '186' }] });
    s1.softoneCall.mockImplementation(async (service: string) => (service === 'calculate' ? calc('150', '36', '186') : { success: true }));
    const out = await fixPostedAmounts('d1', { acknowledgeVat: false, actor: null });
    expect(out.after).toEqual({ net: 150, vat: 36, total: 186 });
    expect(s1.softoneCall).toHaveBeenCalledWith('setData', {
      OBJECT: 'LINCREDOC', KEY: '115601',
      DATA: { LINLINES: [{ LINENUM: 1, MTRL: 7, LINEVAL: 100 }, { LINENUM: 2, MTRL: 8, LINEVAL: 50 }] },
    });
  });
  it('διαφορά ΦΠΑ χωρίς αποδοχή ⇒ καμία εγγραφή', async () => {
    s1.softoneGetData.mockResolvedValue(savedZero);
    s1.softoneCall.mockResolvedValue(calc('150', '57.09', '207.09'));
    await expect(fixPostedAmounts('d1', { acknowledgeVat: false, actor: null })).rejects.toThrow(/Επιβεβαίωσε/);
    expect(s1.softoneCall.mock.calls.some((c) => c[0] === 'setData')).toBe(false);
  });
  it('success αλλά η νέα ανάγνωση δείχνει ακόμη μηδέν ⇒ σφάλμα, όχι «διορθώθηκε»', async () => {
    s1.softoneGetData.mockResolvedValue(savedZero);
    s1.softoneCall.mockImplementation(async (service: string) => (service === 'calculate' ? calc('150', '36', '186') : { success: true }));
    await expect(fixPostedAmounts('d1', { acknowledgeVat: false, actor: null })).rejects.toThrow(/νέα ανάγνωση/);
  });
});
