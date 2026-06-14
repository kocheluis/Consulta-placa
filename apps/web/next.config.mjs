/** Cabeceras de seguridad para toda la web. */
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' https:",
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
