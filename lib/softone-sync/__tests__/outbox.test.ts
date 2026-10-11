// ΤΟ ΠΙΟ ΕΠΙΚΙΝΔΥΝΟ ΣΗΜΕΙΟ ΟΛΗΣ ΤΗΣ ΟΥΡΑΣ είναι η απόφαση «ξαναστέλνω ή όχι».
//
// Λάθος προς τη μία πλευρά = χαμένη δουλειά. Λάθος προς την άλλη = ΔΙΠΛΟΣ συναλλασσόμενος ή
// διπλό παραστατικό στο ERP του πελάτη, που κανείς δεν βλέπει μέχρι το κλείσιμο. Γι' αυτό ο
// πίνακας αποφάσεων δοκιμάζεται ρητά, περίπτωση-περίπτωση.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  softoneOutbox: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  softoneMirrorState: { upsert: vi.fn(), findMany: vi.fn() },
  softoneConnectionEvent: { create: vi.fn(), findFirst: vi.fn() },
}));
const softoneCall = vi.hoisted(() => vi.fn());
const knownTenantKey = vi.hoisted(() => vi.fn(async () => 'host|sn=1|co=1000|br=1000|mod=0|ref=15'));
const softoneReachable = vi.hoisted(() => vi.fn(async () => ({ reachable: true, endpoint: 'e', message: '' })));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('server-only', () => ({}));
vi.mock('../connection', () => ({
  knownTenantKey: () => knownTenantKey(),
  softoneReachable: () => softoneReachable(),
}));
vi.mock('../outbox-jobs', () => ({ OUTBOX_JOBS: {} }));
vi.mock('@/lib/softone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/softone')>('@/lib/softone');
  return { ...actual, softoneCall: (...a: unknown[]) => softoneCall(...a) };
});

import { sendItem } from '../outbox';
import { SoftoneError, SoftoneTransportError, SoftoneConfigError } from '@/lib/softone';

const ITEM = {
  id: 'o1', tenantKey: 'host|sn=1|co=1000|br=1000|mod=0|ref=15',
  kind: 'trader.create', label: 'Πιστωτής Χ', service: 'setData',
  payload: { OBJECT: 'CREDITOR' }, idempotencyKey: 'k1',
  status: 'PENDING' as never, attempts: 0, lastError: null, result: null,
  createdById: null, createdAt: new Date(), updatedAt: new Date(), sentAt: null,
};

/** Η κατάσταση που γράφτηκε στη βάση από την τελευταία `update`. */
const written = () => db.softoneOutbox.update.mock.calls.at(-1)?.[0]?.data?.status;

beforeEach(() => {
  vi.clearAllMocks();
  db.softoneOutbox.update.mockImplementation(async () => ITEM);
  knownTenantKey.mockResolvedValue('host|sn=1|co=1000|br=1000|mod=0|ref=15');
});

describe('sendItem — ο πίνακας αποφάσεων', () => {
  it('επιτυχία ⇒ SENT', async () => {
    softoneCall.mockResolvedValue({ success: true, id: '42' });
    expect((await sendItem(ITEM)).status).toBe('sent');
    expect(written()).toBe('SENT');
  });

  it('το ERP απάντησε success:false ⇒ REJECTED, ΟΧΙ επανάληψη', async () => {
    softoneCall.mockResolvedValue({ success: false, error: 'Δεν έχετε συμπληρώσει το πεδίο Φ.Π.Α.' });
    const r = await sendItem(ITEM);
    expect(r.status).toBe('rejected');
    expect(written()).toBe('REJECTED');
    // Το μήνυμα του ERP περνά ΑΥΤΟΥΣΙΟ — είναι η μόνη οδηγία που έχει ο χρήστης.
    expect(r).toMatchObject({ message: expect.stringContaining('Φ.Π.Α.') });
  });

  it.each([
    ['DNS/άρνηση σύνδεσης', new SoftoneTransportError('δεν απάντησε', 'not_sent', null)],
    ['HTTP 404 — δεν δημοσιεύεται η υπηρεσία', new SoftoneTransportError('404', 'not_sent', 404)],
    ['λείπουν ρυθμίσεις', new SoftoneConfigError('Λείπουν ρυθμίσεις SoftOne: Subdomain')],
  ])('%s ⇒ μένει PENDING και θα ξαναφύγει μόνο του', async (_label, err) => {
    softoneCall.mockRejectedValue(err);
    expect((await sendItem(ITEM)).status).toBe('queued');
    expect(written()).toBe('PENDING');
  });

  it('διακοπή εν πτήσει ⇒ NEEDS_REVIEW, ΠΟΤΕ αυτόματη επανάληψη', async () => {
    softoneCall.mockRejectedValue(new SoftoneTransportError('ECONNRESET', 'unknown', null));
    const r = await sendItem(ITEM);
    expect(r.status).toBe('needs_review');
    expect(written()).toBe('NEEDS_REVIEW');
    expect(r).toMatchObject({ message: expect.stringContaining('ΙΣΩΣ εκτελέστηκε') });
  });

  it('επιχειρησιακό σφάλμα μέσα από εργασία ⇒ REJECTED (όχι ατέρμονη ουρά)', async () => {
    softoneCall.mockRejectedValue(new SoftoneError('Η εγγραφή δεν επιβεβαιώθηκε στο SoftOne.'));
    expect((await sendItem(ITEM)).status).toBe('rejected');
    expect(written()).toBe('REJECTED');
  });

  it('εργασία ΑΛΛΗΣ εγκατάστασης ΔΕΝ εκτελείται ποτέ', async () => {
    knownTenantKey.mockResolvedValue('αλλος-host|sn=9|co=2000|br=1000|mod=0|ref=1');
    const r = await sendItem(ITEM);
    expect(r.status).toBe('needs_review');
    expect(written()).toBe('NEEDS_REVIEW');
    // Το κρίσιμο: δεν έφυγε ΤΙΠΟΤΑ προς το ERP.
    expect(softoneCall).not.toHaveBeenCalled();
  });
});
