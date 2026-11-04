const isDev = process.env.NODE_ENV !== 'production';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseHttp = supabaseUrl ? new URL(supabaseUrl).origin : 'https://*.supabase.co';
const supabaseWs = supabaseHttp.replace(/^http/, 'ws');

// Next.js inlines bootstrap scripts, so script-src needs 'unsafe-inline' unless every page is rendered with a nonce.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${supabaseHttp}`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseHttp} ${supabaseWs} https://api.open-meteo.com https://geocoding-api.open-meteo.com${isDev ? ' ws:' : ''}`,
  'frame-src https://maps.google.com https://www.google.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep ESLint enabled during production builds. Warnings are non-fatal; errors fail the build.
  eslint: { ignoreDuringBuilds: false },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
