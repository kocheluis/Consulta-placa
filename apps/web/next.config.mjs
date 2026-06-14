/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/shared'],
  // Los tests e2e (Playwright) no forman parte del build de la app.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
