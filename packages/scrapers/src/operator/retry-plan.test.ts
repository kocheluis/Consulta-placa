import { describe, it, expect } from 'vitest';
import { computeErrorRetryPlan } from './retry-plan.js';

const CATALOG = ['sunarp', 'historial', 'mtc-citv', 'satp-papeletas', 'fise-gnv', 'infogas-gnv', 'sbs-soat'];
const NO_RERUN = new Set(['fise-gnv', 'infogas-gnv']);
const r = (source: string, status: string) => ({ source, status });

describe('computeErrorRetryPlan (reintento solo-errores del usuario)', () => {
  it('caso real CUP664: re-corre historial/mtc/satp; excluye el relay GNV; reusa las buenas', () => {
    const results = [
      r('SUNARP', 'ENCONTRADO'),
      r('HISTORIAL', 'ERROR'),
      r('MTC_CITV', 'ERROR'),
      r('SATP_PAPELETAS', 'ERROR'),
      r('FISE_GNV', 'ERROR'),
      r('INFOGAS_GNV', 'ERROR'),
      r('SBS_SOAT', 'SIN_REGISTRO'),
    ];
    const p = computeErrorRetryPlan(results, CATALOG, NO_RERUN);
    expect(p.rerun).toEqual(['historial', 'mtc-citv', 'satp-papeletas']);
    // reuse conserva las buenas Y las no-rerun falladas (Opción B: su previo tal cual)
    expect(p.reuse.map((x) => x.source)).toEqual(['SUNARP', 'FISE_GNV', 'INFOGAS_GNV', 'SBS_SOAT']);
  });

  it('sin errores → rerun vacío (nada que reparar) y todo reusado', () => {
    const results = [r('SUNARP', 'ENCONTRADO'), r('SBS_SOAT', 'SIN_REGISTRO')];
    const p = computeErrorRetryPlan(results, CATALOG, NO_RERUN);
    expect(p.rerun).toEqual([]);
    expect(p.reuse).toHaveLength(2);
  });

  it('fuente fallida que YA NO está en el catálogo → no se re-corre (no colgar el pipeline) pero se conserva', () => {
    const results = [r('FUENTE_RETIRADA', 'ERROR'), r('SUNARP', 'ENCONTRADO')];
    const p = computeErrorRetryPlan(results, CATALOG, NO_RERUN);
    expect(p.rerun).toEqual([]);
    expect(p.reuse.map((x) => x.source)).toEqual(['FUENTE_RETIRADA', 'SUNARP']);
  });

  it('normaliza mayúsculas/guiones (SATP_PAPELETAS ↔ satp-papeletas) y no duplica', () => {
    const results = [r('SATP_PAPELETAS', 'ERROR'), r('satp-papeletas', 'ERROR')];
    const p = computeErrorRetryPlan(results, CATALOG, NO_RERUN);
    expect(p.rerun).toEqual(['satp-papeletas']);
    expect(p.reuse).toHaveLength(0);
  });
});
