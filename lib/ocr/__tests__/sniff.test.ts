import { describe, it, expect } from 'vitest';
import { sniffImageType, isPdfBuffer } from '../rasterize';

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
const jpeg = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.from('\0\x10JFIF', 'latin1')]);
const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1')]);

describe('sniffImageType', () => {
  it('recognises a PNG signature', () => {
    expect(sniffImageType(png)).toBe('image/png');
  });
  it('recognises a JPEG SOI + marker', () => {
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
  });
  it('recognises a RIFF....WEBP container', () => {
    expect(sniffImageType(webp)).toBe('image/webp');
  });
  it('returns null for bytes it does not know (PDF, text, truncated headers)', () => {
    expect(sniffImageType(Buffer.from('%PDF-1.4 hello', 'latin1'))).toBeNull();
    expect(sniffImageType(Buffer.from('this is definitely not an image', 'latin1'))).toBeNull();
    expect(sniffImageType(Buffer.from('89504e', 'hex'))).toBeNull();
    // RIFF container that is not WEBP (e.g. a WAV) must not pass.
    expect(sniffImageType(Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WAVE', 'latin1')]))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
  it('is disjoint from isPdfBuffer', () => {
    const pdf = Buffer.from('%PDF-1.7\n', 'latin1');
    expect(isPdfBuffer(pdf)).toBe(true);
    expect(sniffImageType(pdf)).toBeNull();
    expect(isPdfBuffer(png)).toBe(false);
  });
});
