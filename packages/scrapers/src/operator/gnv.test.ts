import { describe, it, expect } from 'vitest';
import { isGasVehicle } from './sources.js';
import { gasFuelSignal } from './index.js';

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

describe('gasFuelSignal (señal de gas robusta: ficha + conversión en asientos)', () => {
  it('ficha vigente a gas → la devuelve tal cual', () => {
    expect(gasFuelSignal({ caracteristicas: { fuel: 'BI-COMBUSTIBLE GNV' }, timeline: [] })).toBe('BI-COMBUSTIBLE GNV');
  });

  it('caso BRA514: ficha dice GASOLINA pero hay asiento de conversión a GNV → gas', () => {
    const r = {
      caracteristicas: { fuel: 'GASOLINA' },
      timeline: [
        { acto: 'Compra-Venta', caracteristicas: { fuel: 'GASOLINA' } },
        { acto: 'Cambio de Características. CONVERSIÓN A BI-COMBUSTIBLE GNV', caracteristicas: null },
      ],
    };
    const sig = gasFuelSignal(r);
    expect(isGasVehicle(sig)).toBe(true);
    expect(sig).toMatch(/conversión registral/i);
  });

  it('una ficha histórica a gas (aunque la más reciente no) → gas', () => {
    const r = {
      caracteristicas: { fuel: 'GASOLINA' },
      timeline: [
        { acto: 'Inscripción', caracteristicas: { fuel: 'GNV' } },
        { acto: 'Compra-Venta', caracteristicas: { fuel: 'GASOLINA' } },
      ],
    };
    expect(gasFuelSignal(r)).toBe('GNV');
  });

  it('vehículo sin gas (ficha gasolina, ningún asiento de conversión) → devuelve la ficha (no-gas)', () => {
    const r = {
      caracteristicas: { fuel: 'GASOLINA' },
      timeline: [{ acto: 'Compra-Venta', caracteristicas: { fuel: 'GASOLINA' } }],
    };
    expect(gasFuelSignal(r)).toBe('GASOLINA');
    expect(isGasVehicle(gasFuelSignal(r))).toBe(false);
  });

  it('sin ficha y sin conversión → null (el gate marcará "no ejecutada")', () => {
    expect(gasFuelSignal({ caracteristicas: null, timeline: [] })).toBeNull();
    expect(gasFuelSignal(null)).toBeNull();
  });
});
