import { describe, it, expect } from 'vitest';
import { maskOwnerName, maskDoc, isCompanyName, maskHistorialParties } from './mask.js';

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

describe('maskHistorialParties (dueños ANTERIORES en los asientos del historial)', () => {
  it('caso real BEM617: apellidos+DNI enmascarados; nombre de pila, roles y estado civil visibles', () => {
    const raw = 'SOCIEDAD CONYUGAL AGREDA VILLANUEVA DE VARGAS OLINDA QUERY DNI 32775111 Casado VARGAS RODRIGUEZ CESAR ERNESTO DNI 06725079 Casado';
    const out = maskHistorialParties(raw)!;
    expect(out).not.toContain('32775111');
    expect(out).not.toContain('06725079');
    expect(out).not.toMatch(/VILLANUEVA|RODRIGUEZ|OLINDA|CESAR\b/); // 2º apellido (y nombres previos al último) ocultos
    expect(out).toMatch(/AGREDA/); // 1er apellido → COMPLETO (persona 1)
    expect(out).toMatch(/VARGAS/); // 1er apellido → COMPLETO (persona 2)
    expect(out).toContain('QUERY'); // último token sin coma = nombre de pila → visible
    expect(out).toContain('ERNESTO');
    expect(out).toContain('DNI 32775****'); // 5 dígitos visibles
    expect(out).toContain('DNI 06725****');
    expect(out).toContain('SOCIEDAD CONYUGAL'); // régimen visible (contexto, no PII)
    expect(out).toContain('Casado'); // estado civil visible
  });

  it('caso real M5U034: "PERSONA NATURAL" es etiqueta (visible) y el nombre de pila se muestra', () => {
    const out = maskHistorialParties('PERSONA NATURAL BALLADARES LARA YOLANDA DNI 16412345 Soltero')!;
    expect(out).toContain('PERSONA NATURAL'); // tipo de persona: NO es un nombre
    expect(out).toContain('YOLANDA'); // nombre de pila visible
    expect(out).toContain('BALLADARES'); // 1er apellido → COMPLETO
    expect(out).not.toMatch(/LARA\b|16412345/); // 2º apellido y DNI completo ocultos
    expect(out).toContain('DNI 16412****');
    expect(out).toContain('Soltero');
  });

  it('con coma ("APELLIDOS, NOMBRES") los nombres tras la coma quedan visibles', () => {
    const out = maskHistorialParties('GARCIA TORRES, MARIA ELENA DNI 06725079')!;
    expect(out).toContain('MARIA ELENA');
    expect(out).toContain('GARCIA'); // 1er apellido → COMPLETO
    expect(out).not.toMatch(/TORRES/); // 2º apellido oculto
    expect(out).toContain('DNI 06725****');
  });

  it('un solo token de nombre → se enmascara (no sabemos si es apellido)', () => {
    const out = maskHistorialParties('GARCIA DNI 12345678')!;
    expect(out).not.toContain('GARCIA');
    expect(out).toContain('DNI 12345****');
  });

  it('empresa acreedora (sin DNI) → INTACTA', () => {
    const raw = 'Acreedor: BBVA CONSUMER FINANCE ENTIDAD DE DESARROLLO A LA PEQUEÑA Y MICRO EMPRE';
    expect(maskHistorialParties(raw)).toBe(raw);
  });

  it('mixto empresa + persona: solo los apellidos de la persona se enmascaran', () => {
    const out = maskHistorialParties('Deudor: VARGAS RODRIGUEZ, CESAR ERNESTO DNI 06725079 · Acreedor: BANCO SANTANDER PERU S.A.')!;
    expect(out).toContain('BANCO SANTANDER PERU S.A.'); // razón social intacta
    expect(out).toContain('Deudor:'); // rol visible
    expect(out).toContain('VARGAS'); // 1er apellido → COMPLETO
    expect(out).not.toMatch(/RODRIGUEZ/); // 2º apellido oculto
    expect(out).toContain('CESAR ERNESTO'); // nombres tras la coma → visibles
    expect(out).toContain('DNI 06725****');
  });

  it('DNI suelto (sin nombre pegado) igual se recorta; texto sin PII no se toca', () => {
    expect(maskHistorialParties('titular con DNI 08701061')).toBe('titular con DNI 08701****');
    expect(maskHistorialParties('Compra-Venta · US$ 21,290.00')).toBe('Compra-Venta · US$ 21,290.00');
    expect(maskHistorialParties(null)).toBeNull();
  });

  it('sociedad conyugal separada por " · ": enmascara AMBOS cónyuges (apellidos + DNI)', () => {
    const raw = 'SOCIEDAD CONYUGAL · UBIDIA CASALLO DE VELAZCO HERMENEGILDA AIDE DNI 08712345 Casado · VELAZCO DONAYRE MARCOS DNI 08767890 Casado';
    const out = maskHistorialParties(raw)!;
    expect(out).toContain('SOCIEDAD CONYUGAL'); // etiqueta visible (contexto)
    expect(out).toContain('UBIDIA'); // 1er apellido persona 1 → COMPLETO
    expect(out).toMatch(/VELAZCO DON/); // 1er apellido persona 2 → COMPLETO
    expect(out).not.toMatch(/CASALLO|DONAYRE/); // 2º apellido de ambos enmascarado
    expect(out).not.toMatch(/08712345|08767890/); // ningún DNI completo
    expect(out).toContain('08712****'); // documentos recortados a 5 dígitos
    expect(out).toContain('08767****');
    expect(out).toContain('AIDE'); // nombre de pila visible
    expect(out).toContain('MARCOS'); // nombre de pila visible
  });
});

describe('maskDoc (documento del titular)', () => {
  it('DNI/CE de persona → 5 primeros + ****', () => {
    expect(maskDoc('DNI 08701061')).toBe('DNI 08701****');
    expect(maskDoc('CE 001234567')).toBe('CE 00123****');
  });
  it('RUC de empresa (20…) → público; RUC 10… (persona) → recortado', () => {
    expect(maskDoc('RUC 20601234567')).toBe('RUC 20601234567');
    expect(maskDoc('RUC 10087010612')).toBe('RUC 10087****');
  });
  it('vacío/nulo → null', () => {
    expect(maskDoc(null)).toBeNull();
    expect(maskDoc('')).toBeNull();
  });
});
