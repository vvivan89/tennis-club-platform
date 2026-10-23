/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep ESLint enabled during production builds. Warnings are non-fatal; errors fail the build.
  eslint: { ignoreDuringBuilds: false },
};
export default nextConfig;
