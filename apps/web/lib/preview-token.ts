import { createHmac, timingSafeEqual } from 'node:crypto';

const normPlaca = (p: string): string => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Verifica un token de preview del operador (opción B: enlace firmado con expiración).
 *
 * El token es `${exp}.${sigBase64url}` donde `sig = HMAC-SHA256(`${placa}:${exp}`, secreto)`.
 * El secreto compartido (OPERATOR_PREVIEW_TOKEN) NUNCA viaja en la URL — solo la firma. Ventaja
 * frente al token estático: un enlace filtrado (logs de CDN, historial, Referer) **muere al
 * expirar** y solo abre **esa** placa; no es un bearer eterno para todas las placas.
 *
 * Devuelve true solo si la firma coincide (comparación en tiempo constante) y no ha expirado.
 * Debe correr en runtime Node (usa `node:crypto`); el route de reporte ya declara runtime='nodejs'.
 */
export function verifyPreviewToken(placa: string, token: string, secret: string): boolean {
  if (!secret || !token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = createHmac('sha256', secret).update(`${normPlaca(placa)}:${exp}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
