// lib/ocr/pdfjs.ts — SERVER. Single place where the pdfjs-dist worker is located and
// where the pdfjs module is loaded/configured.
//
// WHY THIS FILE EXISTS
// --------------------
// Every caller used to do:
//     createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
// That is correct under plain node / tsx / vitest, but Turbopack REWRITES a
// `require.resolve` with a literal specifier at build time into its own internal
// module id instead of a filesystem path. Measured on this app:
//
//   next dev    → "[project]/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs
//                  [app-route] (ecmascript)"   (a string, but not a path)
//   next build  → 508824                       (a NUMBER)
//
// `GlobalWorkerOptions.workerSrc`'s setter THROWS on a non-string, and pdfjs cannot
// import a "[project]/…" specifier. So:
//   • lib/ocr/extract.ts rethrew → extractOcr treated the PDF as a scan → PAID
//     vision run for a document whose text was free.
//   • lib/templates/pdf-text.ts assigned inside a bare `catch {}`, so in the
//     production build the throwing setter was swallowed and workerSrc stayed "" —
//     it worked there only by accident, and still failed outright in dev.
//
// Passing a NON-LITERAL specifier (the WORKER_SPECIFIER const below) also keeps
// Turbopack from statically rewriting the call at all.
//
// The fix: resolve from the APPLICATION ROOT (`process.cwd()`), where node_modules
// actually lives — true in dev, in `next start`, and in the Docker standalone image
// (the app runs from /app with /app/node_modules next to it).
import 'server-only';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKER_SUBPATH = 'legacy/build/pdf.worker.mjs';
const WORKER_SPECIFIER = `pdfjs-dist/${WORKER_SUBPATH}`;

let _resolved: string | null | undefined;
let _warned = false;

/** Try one resolution strategy; returns a path only if the file really exists. */
function tryResolve(fn: () => string): string | null {
  try {
    const p = fn();
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Absolute filesystem path of the pdfjs worker, or null when every strategy failed.
 * Cached for the life of the process (including the null, so we warn only once).
 */
export function resolvePdfWorkerSrc(): string | null {
  if (_resolved !== undefined) return _resolved;

  const appRootRequire = () => createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')).href);

  const candidates: Array<() => string> = [
    // 1. From the app root — node_modules lives next to package.json in dev, in
    //    `next start`, and in the Docker standalone image.
    () => appRootRequire().resolve(WORKER_SPECIFIER),
    // 2. Same root, but go via the package root in case the package `exports` map
    //    ever stops exposing the worker subpath.
    () => path.join(path.dirname(appRootRequire().resolve('pdfjs-dist/package.json')), WORKER_SUBPATH),
    // 3. From this module's own URL — the historical behaviour. Correct under plain
    //    node / tsx / vitest; harmless in the bundle, where it either throws or
    //    yields something `existsSync` rejects.
    () => createRequire(import.meta.url).resolve(WORKER_SPECIFIER),
    // 4. Last resort: walk up from cwd looking for a node_modules copy (pnpm-ish or
    //    monorepo layouts where the app root is a package below the install root).
    () => {
      let dir = process.cwd();
      for (;;) {
        const p = path.join(dir, 'node_modules', 'pdfjs-dist', WORKER_SUBPATH);
        if (existsSync(p)) return p;
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
      return '';
    },
  ];

  for (const c of candidates) {
    const hit = tryResolve(c);
    if (hit) { _resolved = hit; return hit; }
  }

  if (!_warned) {
    _warned = true;
    console.warn(
      `[pdfjs] Could not resolve ${WORKER_SPECIFIER} from any candidate root (cwd=${process.cwd()}). ` +
      'pdfjs will fall back to its in-process "fake worker", which in this runtime returns no text — ' +
      'digital PDFs will be sent down the paid vision path.',
    );
  }
  _resolved = null;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pdfjs: Promise<any> | null = null;

/**
 * Loads pdfjs-dist (legacy build) with `GlobalWorkerOptions.workerSrc` pointed at a
 * real worker file. Cached per process; a rejected promise is cleared so a transient
 * boot-time failure cannot poison every later call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPdfjs(): Promise<any> {
  if (!_pdfjs) {
    _pdfjs = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const workerSrc = resolvePdfWorkerSrc();
      if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    })().catch((e) => { _pdfjs = null; throw e; });
  }
  return _pdfjs;
}

/**
 * Best-effort: configure the shared pdfjs worker path BEFORE a wrapper library
 * (`pdf-to-img`) loads pdfjs itself. Never throws.
 */
export async function primePdfjsWorker(): Promise<void> {
  try { await getPdfjs(); } catch { /* wrapper will use its own fallback */ }
}
