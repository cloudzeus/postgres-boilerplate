import path from 'path';

const nextConfig = {
  reactStrictMode: true,
  sassOptions: {
    includePaths: [path.join(process.cwd(), 'styles')],
  },
  experimental: {
    serverActions: { bodySizeLimit: '500mb' },
  },
  serverExternalPackages: ['sharp'],
};

export default nextConfig;
