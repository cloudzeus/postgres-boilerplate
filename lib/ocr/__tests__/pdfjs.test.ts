import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolvePdfWorkerSrc, getPdfjs } from '../pdfjs';

// ---------------------------------------------------------------------------
// Regression guard for the bug where the pdfjs worker was resolved with
// `createRequire(import.meta.url)`. Inside the bundled Next runtime Turbopack
// rewrites that `require.resolve` into an INTERNAL MODULE ID — a
// "[project]/… (ecmascript)" string in dev, a plain NUMBER in the production
// build — instead of a filesystem path. `GlobalWorkerOptions.workerSrc`'s setter
// throws on a non-string, and pdfjs cannot import a "[project]/…" specifier, so
// the PDF text layer never loaded and every digital PDF fell through to the
// expensive vision path.
//
// These tests are therefore deliberately literal: the resolver must return a
// STRING that is an EXISTING FILE. "Truthy" is not good enough — the old code
// returned truthy values in both broken runtimes.
// ---------------------------------------------------------------------------
describe('resolvePdfWorkerSrc', () => {
  it('returns a string path to a file that actually exists on disk', () => {
    const src = resolvePdfWorkerSrc();
    expect(typeof src).toBe('string');
    expect(src).toBeTruthy();
    expect(path.isAbsolute(src as string)).toBe(true);
    expect(existsSync(src as string)).toBe(true);
    expect(statSync(src as string).isFile()).toBe(true);
    expect(statSync(src as string).size).toBeGreaterThan(0);
    expect(path.basename(src as string)).toBe('pdf.worker.mjs');
  });

  it('does not return a bundler module id', () => {
    const src = resolvePdfWorkerSrc() as string;
    expect(src.startsWith('[project]')).toBe(false);
    expect(src).not.toMatch(/\(ecmascript\)/);
  });

  it('is cached (same value on repeated calls)', () => {
    expect(resolvePdfWorkerSrc()).toBe(resolvePdfWorkerSrc());
  });

  it('agrees with resolving from the application root (process.cwd())', () => {
    // This is the strategy the fix relies on: node_modules lives next to the app
    // root package.json in dev, under `next start`, and in the Docker standalone
    // image (where the app runs from /app).
    const fromAppRoot = createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')).href)
      .resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    expect(resolvePdfWorkerSrc()).toBe(fromAppRoot);
  });
});

describe('getPdfjs', () => {
  it('loads pdfjs with a string workerSrc that GlobalWorkerOptions accepts', async () => {
    const pdfjs = await getPdfjs();
    // The setter throws "Invalid `workerSrc` type." on anything non-string, which
    // is exactly how the production build failed.
    expect(typeof pdfjs.GlobalWorkerOptions.workerSrc).toBe('string');
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(resolvePdfWorkerSrc());
    expect(typeof pdfjs.getDocument).toBe('function');
  });

  it('returns the same cached module instance', async () => {
    expect(await getPdfjs()).toBe(await getPdfjs());
  });
});
