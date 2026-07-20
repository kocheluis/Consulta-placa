import { describe, it, expect } from 'vitest';
import { maskOwnerName, maskDoc, isCompanyName } from './mask.js';

describe('maskOwnerName (PII del titular, Ley 29733)', () => {
  it('persona "APELLIDOS, NOMBRES" → nombres completos + apellidos recortados', () => {
    expect(maskOwnerName('PEREZ GARCIA, JUAN CARLOS')).toBe('JUAN CARLOS PER**** GAR****');
    expect(maskOwnerName('RODRIGUEZ TORRES, MARIA ELENA')).toBe('MARIA ELENA ROD**** TOR****');
    expect(maskOwnerName('PEREZ, JUAN')).toBe('JUAN PER****');
  });

  it('empresa (persona jurídica) → NO se enmascara', () => {
    for (const c of [
      'QUALITAS COMPAÑIA DE SEGUROS S.A.',
      'TRANSPORTES Y SERVICIOS ABC S.A.C.',
      'INVERSIONES XYZ E.I.R.L.',
      'BANCO DE CREDITO DEL PERU',
    ]) {
      expect(maskOwnerName(c)).toBe(c);
      expect(isCompanyName(c)).toBe(true);
    }
  });

  it('apellido corto revela menos; partículas se dejan', () => {
    expect(maskOwnerName('DE LA CRUZ, ANA')).toBe('ANA DE LA CRU****'); // "DE"/"LA" ≤2 se dejan; "CRUZ"→CRU****
    expect(maskOwnerName('COX, LUIS')).toBe('LUIS C***'); // apellido de 3 letras → 1 + ***
  });

  it('multipropietario / sin coma → enmascara todos los tokens (parcial, seguro)', () => {
    expect(maskOwnerName('PEREZ GARCIA, JUAN RODRIGUEZ TORRES, MARIA'))
      .toBe('PER**** GAR**** JUA**** ROD**** TOR**** MAR****');
    expect(maskOwnerName('PEREZ GARCIA JUAN')).toBe('PER**** GAR**** JUA****'); // sin coma
  });

  it('vacío/nulo → null', () => {
    expect(maskOwnerName('')).toBeNull();
    expect(maskOwnerName(null)).toBeNull();
    expect(maskOwnerName(undefined)).toBeNull();
  });
});

describe('maskDoc (documento del titular)', () => {
  it('DNI/CE de persona → 3 primeros + ****', () => {
    expect(maskDoc('DNI 08701061')).toBe('DNI 087****');
    expect(maskDoc('CE 001234567')).toBe('CE 001****');
  });
  it('RUC de empresa (20…) → público; RUC 10… (persona) → recortado', () => {
    expect(maskDoc('RUC 20601234567')).toBe('RUC 20601234567');
    expect(maskDoc('RUC 10087010612')).toBe('RUC 100****');
  });
  it('vacío/nulo → null', () => {
    expect(maskDoc(null)).toBeNull();
    expect(maskDoc('')).toBeNull();
  });
});
