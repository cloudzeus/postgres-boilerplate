// lib/__tests__/serve-file.test.ts
// Το route που δίνει το πρωτότυπο αρχείο στον viewer. Ένα PDF δεν εμφανίζεται μέχρι ο browser να
// μπορέσει να ζητήσει κομμάτια — άρα εδώ ελέγχουμε συμπεριφορά HTTP, όχι περιεχόμενο:
// 206 με σωστό κομμάτι, 200 με μήκος, 304, 416, και ότι τα δικαιώματα ελέγχονται ΠΑΝΤΑ.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { db, rbac, bunny } = vi.hoisted(() => ({
  db: { ocrDocument: { findUnique: vi.fn() }, ocrBatch: { findUnique: vi.fn() } },
  rbac: { requirePermission: vi.fn() },
  bunny: { bunnyHead: vi.fn(), bunnyStream: vi.fn(), bunnyDownload: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/bunny', () => bunny);
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn().mockResolvedValue(null) }));

import { GET as getFile } from '@/app/api/admin/ocr/[id]/file/route';
import { GET as getBatchSource } from '@/app/api/admin/ocr/batches/[id]/source/route';
import { parseRange } from '@/lib/http-range';
import { storedFileEtag, __clearHeadCache } from '@/lib/serve-file';

const SIZE = 3_428_707;
const KEY = 'ocr/energa.pdf';
const ETAG = '"d41d8cd98f00b204e9800998ecf8427e"';
const ctx = (id = 'doc1') => ({ params: Promise.resolve({ id }) });

/** Ψεύτικο αντικείμενο: το byte στη θέση i είναι i % 251, άρα κάθε κομμάτι είναι αναγνωρίσιμο. */
function objectSlice(start: number, end: number) {
  return Uint8Array.from({ length: end - start + 1 }, (_, i) => (start + i) % 251);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

const req = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/admin/ocr/doc1/file', { headers });

beforeEach(() => {
  vi.clearAllMocks();
  __clearHeadCache();
  rbac.requirePermission.mockResolvedValue({ id: 'u1', email: 'a@b.gr' });
  db.ocrDocument.findUnique.mockResolvedValue({
    id: 'doc1', storageKey: KEY, mimeType: 'application/pdf', fileName: 'energa.pdf',
  });
  db.ocrBatch.findUnique.mockResolvedValue({ sourceKey: KEY, sourceName: 'stack.pdf' });
  bunny.bunnyHead.mockResolvedValue({ size: SIZE, etag: ETAG, contentType: 'application/pdf' });
  bunny.bunnyStream.mockImplementation(async (_key: string, range?: { start: number; end: number }) => {
    const start = range?.start ?? 0;
    const end = range?.end ?? SIZE - 1;
    return {
      body: streamOf(objectSlice(start, end)),
      contentLength: end - start + 1,
      contentRange: range ? `bytes ${start}-${end}/${SIZE}` : null,
      etag: ETAG,
    };
  });
});

describe('GET /api/admin/ocr/[id]/file', () => {
  it('απαντά 206 με ΑΚΡΙΒΩΣ το ζητούμενο κομμάτι', async () => {
    const res = await getFile(req({ range: 'bytes=0-1023' }), ctx());
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-1023/${SIZE}`);
    expect(res.headers.get('content-length')).toBe('1024');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(1024);
    expect(body).toEqual(objectSlice(0, 1023));
  });

  it('το 206 ζητάει από το storage ΜΟΝΟ το κομμάτι — δεν κατεβάζει ολόκληρο το αρχείο', async () => {
    await getFile(req({ range: 'bytes=1000-1999' }), ctx());
    expect(bunny.bunnyStream).toHaveBeenCalledWith(KEY, { start: 1000, end: 1999 });
    expect(bunny.bunnyDownload).not.toHaveBeenCalled();
  });

  it('ανοιχτό εύρος `bytes=N-` φτάνει ως το τέλος του αρχείου', async () => {
    const res = await getFile(req({ range: `bytes=${SIZE - 10}-` }), ctx());
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${SIZE - 10}-${SIZE - 1}/${SIZE}`);
    expect(res.headers.get('content-length')).toBe('10');
  });

  it('suffix εύρος `bytes=-N` δίνει τα τελευταία N bytes', async () => {
    const res = await getFile(req({ range: 'bytes=-500' }), ctx());
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${SIZE - 500}-${SIZE - 1}/${SIZE}`);
  });

  it('σκέτο GET: 200 με Content-Length και Accept-Ranges', async () => {
    const res = await getFile(req(), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('inline');
  });

  it('το Cache-Control παραμένει private αλλά ΟΧΙ no-store — και δίνει validator', async () => {
    const res = await getFile(req(), ctx());
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toContain('private');
    expect(cc).not.toContain('no-store');
    expect(cc).toContain('must-revalidate');
    expect(res.headers.get('etag')).toBe(ETAG);
  });

  it('If-None-Match που ταιριάζει → 304 χωρίς σώμα και χωρίς κατέβασμα', async () => {
    const first = await getFile(req(), ctx());
    const etag = first.headers.get('etag')!;
    bunny.bunnyStream.mockClear();
    const res = await getFile(req({ 'if-none-match': etag }), ctx());
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    expect(bunny.bunnyStream).not.toHaveBeenCalled();
  });

  it('εύρος εκτός αρχείου → 416 με Content-Range: bytes */size', async () => {
    const res = await getFile(req({ range: `bytes=${SIZE + 10}-${SIZE + 20}` }), ctx());
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
    expect(bunny.bunnyStream).not.toHaveBeenCalled();
  });

  it('πολλαπλά εύρη: δεν στέλνουμε multipart — ολόκληρο σώμα με 200', async () => {
    const res = await getFile(req({ range: 'bytes=0-9,20-29' }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
  });

  it('If-Range που ΔΕΝ ταιριάζει ακυρώνει το εύρος → 200 ολόκληρο', async () => {
    const res = await getFile(req({ range: 'bytes=0-1023', 'if-range': '"stale"' }), ctx());
    expect(res.status).toBe(200);
  });

  it('τα δικαιώματα ελέγχονται ΚΑΙ στη διαδρομή του range — η άρνηση δεν σερβίρει bytes', async () => {
    rbac.requirePermission.mockRejectedValue(new Error('forbidden'));
    await expect(getFile(req({ range: 'bytes=0-1023' }), ctx())).rejects.toThrow('forbidden');
    expect(db.ocrDocument.findUnique).not.toHaveBeenCalled();
    expect(bunny.bunnyHead).not.toHaveBeenCalled();
    expect(bunny.bunnyStream).not.toHaveBeenCalled();
  });

  it('το μέγεθος ζητιέται ΜΙΑ φορά ανά κλειδί — ο viewer κάνει δεκάδες range αιτήματα', async () => {
    await getFile(req({ range: 'bytes=0-1023' }), ctx());
    await getFile(req({ range: 'bytes=1024-2047' }), ctx());
    await getFile(req({ range: 'bytes=2048-3071' }), ctx());
    expect(bunny.bunnyHead).toHaveBeenCalledTimes(1);
    expect(bunny.bunnyStream).toHaveBeenCalledTimes(3);
  });

  it('άγνωστο έγγραφο → 404', async () => {
    db.ocrDocument.findUnique.mockResolvedValue(null);
    const res = await getFile(req({ range: 'bytes=0-1023' }), ctx());
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/ocr/batches/[id]/source', () => {
  it('τιμά κι αυτό τα εύρη — η στοίβα σάρωσης είναι το μεγαλύτερο αρχείο', async () => {
    const res = await getBatchSource(req({ range: 'bytes=0-1023' }), ctx('b1'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-1023/${SIZE}`);
    expect(bunny.bunnyStream).toHaveBeenCalledWith(KEY, { start: 0, end: 1023 });
  });

  it('σκέτο GET: 200 με Content-Length', async () => {
    const res = await getBatchSource(req(), ctx('b1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
  });

  it('τα δικαιώματα ελέγχονται πριν από οτιδήποτε', async () => {
    rbac.requirePermission.mockRejectedValue(new Error('forbidden'));
    await expect(getBatchSource(req({ range: 'bytes=0-1023' }), ctx('b1'))).rejects.toThrow('forbidden');
    expect(bunny.bunnyHead).not.toHaveBeenCalled();
  });
});

describe('parseRange', () => {
  it.each([
    ['bytes=0-99', { kind: 'ok', start: 0, end: 99 }],
    ['bytes=100-', { kind: 'ok', start: 100, end: 999 }],
    ['bytes=-100', { kind: 'ok', start: 900, end: 999 }],
    ['bytes=-5000', { kind: 'ok', start: 0, end: 999 }],   // suffix μεγαλύτερο από το αρχείο
    ['bytes=0-99999', { kind: 'ok', start: 0, end: 999 }], // end πέρα από το τέλος: κόβεται
    ['bytes = 0-99', { kind: 'ok', start: 0, end: 99 }],
  ])('%s', (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected);
  });

  it('εύρη εκτός αρχείου', () => {
    expect(parseRange('bytes=1000-1100', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ό,τι δεν καταλαβαίνουμε το αγνοούμε αντί να σκάσουμε', () => {
    expect(parseRange(null, 1000)).toEqual({ kind: 'none' });
    expect(parseRange('', 1000)).toEqual({ kind: 'none' });
    expect(parseRange('items=0-9', 1000)).toEqual({ kind: 'ignored' });
    expect(parseRange('bytes=abc', 1000)).toEqual({ kind: 'ignored' });
    expect(parseRange('bytes=-', 1000)).toEqual({ kind: 'ignored' });
    expect(parseRange('bytes=90-10', 1000)).toEqual({ kind: 'ignored' });
    expect(parseRange('bytes=0-9,20-29', 1000)).toEqual({ kind: 'ignored' });
  });
});

describe('storedFileEtag', () => {
  it('προτιμά το ETag του storage, κανονικοποιημένο', () => {
    expect(storedFileEtag(KEY, SIZE, 'W/"abc"')).toBe('"abc"');
    expect(storedFileEtag(KEY, SIZE, '"abc"')).toBe('"abc"');
  });

  it('χωρίς ETag από το storage, το (κλειδί, μέγεθος) το αντικαθιστά σταθερά', () => {
    const a = storedFileEtag(KEY, SIZE, null);
    expect(a).toMatch(/^"[0-9a-f]{40}"$/);
    expect(storedFileEtag(KEY, SIZE, null)).toBe(a);
    expect(storedFileEtag(KEY, SIZE + 1, null)).not.toBe(a);
    expect(storedFileEtag('ocr/other.pdf', SIZE, null)).not.toBe(a);
  });
});
