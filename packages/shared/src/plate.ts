/**
 * Normalización y validación de placas vehiculares peruanas.
 *
 * Formatos soportados (tras normalizar: mayúsculas, sin espacios ni guiones):
 *  - Moderno autos (3 letras + 3 dígitos):        ABC123       p.ej. ABC-123
 *  - Moderno alfanumérico (L D L + 3 dígitos):    A1B234       p.ej. A1B-234
 *  - Antiguo (2 letras + 4 dígitos):              SA1234       p.ej. SA-1234
 *  - Moto/menor (3 letras + 2 dígitos):           ABC12        p.ej. ABC-12
 *
 * La validación es deliberadamente permisiva con formatos históricos: el objetivo
 * es rechazar entradas claramente inválidas antes de encolar una consulta (FR-002),
 * no replicar el algoritmo exacto de asignación de SUNARP.
 */

const PLATE_PATTERNS: readonly RegExp[] = [
  /^[A-Z]{3}[0-9]{3}$/, // ABC123
  /^[A-Z][0-9][A-Z][0-9]{3}$/, // A1B234
  /^[A-Z]{2}[0-9]{4}$/, // SA1234 (antiguo)
  /^[A-Z]{3}[0-9]{2}$/, // ABC12 (moto)
];

/** Quita espacios, guiones y pasa a mayúsculas. No valida. */
export function normalizePlate(input: string): string {
  return input.normalize('NFKC').replace(/[\s-]/g, '').toUpperCase();
}

/** Indica si la placa (ya normalizada o no) cumple algún formato peruano conocido. */
export function isValidPlate(input: string): boolean {
  const normalized = normalizePlate(input);
  if (normalized.length < 5 || normalized.length > 6) return false;
  return PLATE_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Formato legible para mostrar: inserta un guión antes de los últimos 3 dígitos
 * cuando aplica (ABC123 → ABC-123, A1B234 → A1B-234, SA1234 → SA-1234).
 * Si no se reconoce el patrón, devuelve la placa normalizada sin guión.
 */
export function formatPlateDisplay(input: string): string {
  const normalized = normalizePlate(input);
  if (/^[A-Z]{3}[0-9]{3}$/.test(normalized) || /^[A-Z][0-9][A-Z][0-9]{3}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  }
  if (/^[A-Z]{2}[0-9]{4}$/.test(normalized)) {
    return `${normalized.slice(0, 2)}-${normalized.slice(2)}`;
  }
  if (/^[A-Z]{3}[0-9]{2}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  }
  return normalized;
}

export class InvalidPlateError extends Error {
  constructor(public readonly input: string) {
    super(`Placa inválida: "${input}"`);
    this.name = 'InvalidPlateError';
  }
}

/** Normaliza y valida; lanza InvalidPlateError si no es válida. */
export function assertValidPlate(input: string): string {
  const normalized = normalizePlate(input);
  if (!isValidPlate(normalized)) throw new InvalidPlateError(input);
  return normalized;
}
