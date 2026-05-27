import path from 'path';

const nextConfig = {
  reactStrictMode: true,
  sassOptions: {
    includePaths: [path.join(process.cwd(), 'styles')],
  },
  experimental: {
    serverActions: { bodySizeLimit: '500mb' },
  },
  serverExternalPackages: ['sharp', 'pdf-to-img', 'pdfjs-dist', 'pdf-parse', 'unpdf'],
};

export default nextConfig;
