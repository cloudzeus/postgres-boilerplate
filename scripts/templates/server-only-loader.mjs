// Maps the bare `server-only` specifier (provided by Next.js at build time) to the no-op mock so lib/* loads under tsx.
export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: new URL('../../lib/__mocks__/server-only.ts', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
