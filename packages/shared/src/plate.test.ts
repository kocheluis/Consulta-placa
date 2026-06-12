import { describe, it, expect } from 'vitest';
import {
  normalizePlate,
  isValidPlate,
  formatPlateDisplay,
  assertValidPlate,
  InvalidPlateError,
} from './plate.js';

describe('normalizePlate', () => {
  it('quita guiones y espacios y pasa a mayúsculas', () => {
    expect(normalizePlate('abc-123')).toBe('ABC123');
    expect(normalizePlate(' a1b 234 ')).toBe('A1B234');
    expect(normalizePlate('SA-1234')).toBe('SA1234');
  });
});

describe('isValidPlate', () => {
  it('acepta formatos peruanos válidos', () => {
    expect(isValidPlate('ABC-123')).toBe(true); // moderno autos
    expect(isValidPlate('A1B-234')).toBe(true); // alfanumérico
    expect(isValidPlate('SA-1234')).toBe(true); // antiguo
    expect(isValidPlate('ABC-12')).toBe(true); // moto
  });

  it('rechaza entradas inválidas', () => {
    expect(isValidPlate('')).toBe(false);
    expect(isValidPlate('AB')).toBe(false);
    expect(isValidPlate('ABCDEFG')).toBe(false);
    expect(isValidPlate('1234567')).toBe(false);
    expect(isValidPlate('AB-12')).toBe(false); // muy corta / patrón no reconocido
    expect(isValidPlate('@#$%')).toBe(false);
  });
});

describe('formatPlateDisplay', () => {
  it('inserta el guión en la posición correcta', () => {
    expect(formatPlateDisplay('abc123')).toBe('ABC-123');
    expect(formatPlateDisplay('A1B234')).toBe('A1B-234');
    expect(formatPlateDisplay('SA1234')).toBe('SA-1234');
    expect(formatPlateDisplay('ABC12')).toBe('ABC-12');
  });
});

describe('assertValidPlate', () => {
  it('devuelve la placa normalizada si es válida', () => {
    expect(assertValidPlate('abc-123')).toBe('ABC123');
  });

  it('lanza InvalidPlateError si es inválida', () => {
    expect(() => assertValidPlate('xx')).toThrow(InvalidPlateError);
  });
});
