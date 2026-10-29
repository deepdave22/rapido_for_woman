import type { NextConfig } from 'next';
import { join } from 'node:path';

/** Strict headers: the dashboard loads nothing from third parties. */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "frame-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages are included.
  outputFileTracingRoot: join(__dirname, '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@saheli/api-client'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
