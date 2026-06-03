import path from 'path';

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Types are clean (verified via `tsc --noEmit`), so the build enforces them.
  // ESLint is intentionally not run during the production build — lint belongs
  // in CI, and `next build` would otherwise fail on lint errors.
  eslint: { ignoreDuringBuilds: true },
  sassOptions: {
    includePaths: [path.join(process.cwd(), 'styles')],
  },
  experimental: {
    serverActions: { bodySizeLimit: '500mb' },
  },
  serverExternalPackages: ['sharp', 'pdf-to-img', 'pdfjs-dist', 'pdf-parse', 'unpdf'],
};

export default nextConfig;
