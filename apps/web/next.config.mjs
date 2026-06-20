/** Cabeceras de seguridad para toda la web. */
const isDev = process.env.NODE_ENV !== 'production';

// En desarrollo la API corre en http://127.0.0.1:3001 (otro origen y http), así que
// connect-src debe permitir orígenes locales (y ws: para el HMR de Next). En
// producción la API es https (Render) y basta con 'self' https:.
const connectSrc = isDev
  ? "connect-src 'self' https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
  : "connect-src 'self' https:";

const securityHeaders = [
  // Evita que la página sea embebida en iframes (clickjacking).
  { key: 'X-Frame-Options', value: 'DENY' },
  // Evita el MIME-sniffing.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // No filtrar la URL completa como referer a terceros.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Forzar HTTPS por 2 años (HSTS).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Desactivar APIs sensibles del navegador que la app no usa.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Content-Security-Policy: limita de dónde se cargan recursos (defensa XSS).
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      connectSrc,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/shared'],
  // Los tests e2e (Playwright) no forman parte del build de la app.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
