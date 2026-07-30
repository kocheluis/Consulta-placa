import { describe, it, expect } from 'vitest';
import { classifyPublicUse } from './transporte.js';

describe('classifyPublicUse (tipo de uso del asiento + categoría)', () => {
  it('particular → NO público (el caso de la captura: "Vehiculos Particulares (Categoria M)")', () => {
    expect(classifyPublicUse('Vehiculos Particulares (Categoria M)', 'M1')).toEqual({ isPublic: false, kind: null });
    expect(classifyPublicUse('PARTICULAR', 'M1').isPublic).toBe(false);
    expect(classifyPublicUse(null, 'M1').isPublic).toBe(false);
  });

  it('taxi/colectivo M1 → público, pasajeros liviano', () => {
    const r = classifyPublicUse('Taxis y Colectivos (Categoría M1)', 'M1');
    expect(r.isPublic).toBe(true);
    expect(r.kind).toContain('taxi / colectivo');
  });

  it('mototaxi/trimoto (B-I) → público, viaje corto', () => {
    expect(classifyPublicUse('Mototaxis y Trimotos (Clase B-I)', 'B-I').kind).toContain('Mototaxi');
    expect(classifyPublicUse('Servicio público de pasajeros en trimoto', null).kind).toContain('Mototaxi');
  });

  it('M2 microbús y M3 ómnibus → transporte público masivo', () => {
    expect(classifyPublicUse('Transporte público de pasajeros', 'M2').kind).toContain('Microbús');
    expect(classifyPublicUse('Transporte urbano e interprovincial', 'M3').kind).toContain('Ómnibus');
    expect(classifyPublicUse('Servicio de ómnibus interprovincial', null).kind).toContain('Ómnibus');
  });

  it('público sin categoría reconocible pero con taxi en el texto → automóvil taxi', () => {
    expect(classifyPublicUse('Servicio de taxi', null).kind).toContain('taxi / colectivo');
  });
});
