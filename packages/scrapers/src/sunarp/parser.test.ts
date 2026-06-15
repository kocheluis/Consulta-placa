import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSunarp } from './parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '__fixtures__', name), 'utf8');

describe('parseSunarp', () => {
  it('extrae los datos registrales de un vehículo sin robo', () => {
    const [result] = parseSunarp(fixture('normal.html'), 'ABC-123');
    expect(result!.status).toBe('AVAILABLE');
    expect(result!.source).toBe('SUNARP');
    expect(result!.kind).toBe('REGISTRAL');
    expect(result!.fetchedAt).not.toBeNull();
    expect(result!.vehicle).toMatchObject({
      brand: 'TOYOTA',
      model: 'YARIS',
      year: 2019,
      color: 'PLOMO',
      engineNumber: '2NR1234567',
      stolenAlert: false,
    });
    expect(result!.ownerName).toBe('PEREZ GARCIA, JUAN CARLOS');
  });

  it('detecta la anotación de robo y la placa anterior', () => {
    const [result] = parseSunarp(fixture('stolen.html'), 'XYZ-789');
    expect(result!.status).toBe('AVAILABLE');
    expect(result!.vehicle?.stolenAlert).toBe(true);
    expect(result!.vehicle?.platePrevious).toBe('AB-1234');
    expect((result!.payload as { stolenAlert: boolean }).stolenAlert).toBe(true);
  });

  it('parsea la estructura real (Nº prefijo, estado, anotaciones, sede, año de modelo)', () => {
    const [result] = parseSunarp(fixture('real-sunarp.html'), 'XYZ-987');
    expect(result!.status).toBe('AVAILABLE');
    expect(result!.vehicle).toMatchObject({
      brand: 'TOYOTA',
      model: 'HILUX',
      color: 'ROJO',
      serie: '8AJBA3FS4N1234567',
      vin: '8AJBA3FS4N1234567',
      engineNumber: '1GD9876543',
      year: 2024,
      registralStatus: 'EN CIRCULACION',
      annotations: 'NINGUNA',
      sede: 'LIMA',
      stolenAlert: false,
    });
    // "PLACA ANTERIOR: NINGUNA" debe quedar como sin dato.
    expect(result!.vehicle?.platePrevious).toBeNull();
    expect(result!.ownerName).toBe('RODRIGUEZ TORRES, MARIA ELENA');
  });

  it('devuelve NOT_FOUND cuando no hay registros', () => {
    const [result] = parseSunarp(fixture('not-found.html'), 'ZZZ-999');
    expect(result!.status).toBe('NOT_FOUND');
    expect(result!.vehicle).toBeUndefined();
  });
});
