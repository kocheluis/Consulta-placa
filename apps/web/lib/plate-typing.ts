import { isValidPlate, normalizePlate } from '@app/shared';

/**
 * Formato de la placa MIENTRAS se escribe (validación en línea): mayúsculas, sin símbolos y con el
 * guion puesto solo. Antiguas de 2 letras + 4 dígitos (SA-1234) llevan el guion tras la 2ª letra; el
 * resto (ABC-123, A1B-234, motos ABC-12) tras el 3er carácter.
 */
export function typePlate(raw: string): { display: string; normalized: string; valid: boolean } {
  const n = normalizePlate(raw).replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const cut = /^[A-Z]{2}[0-9]/.test(n) ? 2 : 3;
  const display = n.length > cut ? `${n.slice(0, cut)}-${n.slice(cut)}` : n;
  return { display, normalized: n, valid: isValidPlate(n) };
}
