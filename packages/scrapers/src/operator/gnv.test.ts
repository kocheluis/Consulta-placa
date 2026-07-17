import { describe, it, expect } from 'vitest';
import { isGasVehicle } from './sources.js';

describe('isGasVehicle (gate de fuentes GNV: solo si el vehículo es a gas)', () => {
  it('detecta vehículos a gas (característica del asiento SPRL)', () => {
    for (const f of ['GNV', 'BI-COMBUSTIBLE GNV', 'BI COMBUSTIBLE', 'GAS NATURAL', 'GLP', 'DUAL / GNV', 'gnv']) {
      expect(isGasVehicle(f)).toBe(true);
    }
  });

  it('NO matchea combustibles líquidos ni "GASOLINA" (sin frontera tras GAS)', () => {
    for (const f of ['GASOLINA', 'DIESEL', 'PETROLEO', 'ELECTRICO', 'HÍBRIDO GASOLINA']) {
      expect(isGasVehicle(f)).toBe(false);
    }
  });

  it('null/undefined/vacío = no aplica (no se corre GNV)', () => {
    expect(isGasVehicle(null)).toBe(false);
    expect(isGasVehicle(undefined)).toBe(false);
    expect(isGasVehicle('')).toBe(false);
  });
});
