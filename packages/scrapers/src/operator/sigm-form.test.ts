import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSigmForm, fechaDeFolio, type PdfItem } from './sigm-form.js';
import { toWebReport } from './report-transform.js';

// Geometría REAL de un formulario de Modificación del SIGM (páginas ROTADAS, texto sin orden de
// lectura) con placa/motor/VIN/personas reemplazados por valores ficticios.
const items = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'sigm-form-modificacion.json'), 'utf8')) as PdfItem[];

describe('parseSigmForm (Detalle SIGM por geometría)', () => {
  const f = parseSigmForm(items, 'ABC123');

  it('datos generales: cada etiqueta con SU valor aunque la página venga rotada', () => {
    expect(f).toMatchObject({
      formulario: 'MODIFICACIÓN', numeroFormulario: '2026-648845',
      acreedor: 'BANCO DE CREDITO DEL PERU', acreedorRuc: '20100047218',
      tipoGarantia: 'GARANTIA MOBILIARIA', moneda: 'SOL', montoMaximo: 126505.8,
      finAviso: 'PLAZO INDETERMINADO', indicadorPosesion: 'NO', acuerdoPartes: 'NO', preinscripcion: 'NO',
      gmpa: 'SI', bienesParaUso: 'AMBOS', modeloDescripcion: 'MUSTANG DARK HORSE',
    });
  });

  it('bien específico: la fila de la tabla por columnas', () => {
    expect(f.bienes).toEqual([{ placa: 'ABC123', marca: 'FORD', modelo: 'MUSTANG', motor: 'M9900111', serie: '1FA6P8R06M9900111', vin: '1FA6P8R06M9900111' }]);
    expect(f.modificaciones).toEqual(['Se agregó el bien específico con número de placa ABC123']);
    expect(f.clausula).toMatch(/^EL CONTRATO ESTABLECE UN CRÉDITO GARANTIZADO/);
    expect(f.clausula).toMatch(/ENTIDAD OTORGANTE\.$/);
  });

  it('NUNCA extrae al deudor, su cónyuge ni a quien generó el formulario (Ley 29733)', () => {
    expect(JSON.stringify(f)).not.toMatch(/FULANO|MENGANA|11111111|22222222|33333333|OPERADOR|N0000000000X/);
  });
});

describe('fechaDeFolio', () => {
  it('el folio causal arranca con la fecha de constitución', () => {
    expect(fechaDeFolio('20260317000437760')).toBe('17/03/2026');
    expect(fechaDeFolio('123')).toBeNull();
    expect(fechaDeFolio('20261399000437760')).toBeNull();
  });
});

describe('reporte: gravamen SIGM con detalle del formulario', () => {
  it('monto máximo con moneda, bien, coincidencia de placa y sin deudor', () => {
    const garantia = parseSigmForm(items, 'ABC123');
    const r = toWebReport('ABC123', [{
      source: 'SIGM', label: 'SIGM', category: 'GRAVAMENES', status: 'ENCONTRADO', summary: '', ms: 1,
      data: { hasLiens: true, total: 1, items: [{ folio: '20260317000437760', fechaInscripcion: '15/06/2026 17:40:07', ultimaOperacion: 'MODIFICACIÓN',
        acreedor: 'BANCO DE CREDITO DEL PERU · RUC 20100047218', fechaConstitucion: '17/03/2026', garantia }] },
    }], '2026-11-07T00:00:00Z', 'x');
    const sec = r.sections.find((s) => s.kind === 'GRAVAMENES') as unknown as { payload: { items: Array<Record<string, unknown>> } };
    const it0 = sec.payload.items[0]!;
    expect(it0.amountLabel).toBe('S/ 126,505.80 (monto máximo garantizado)');
    expect(it0.garantia).toMatchObject({ constituida: '17/03/2026', placaCoincide: true, finAviso: 'PLAZO INDETERMINADO',
      bien: { marca: 'FORD', modelo: 'MUSTANG DARK HORSE', placa: 'ABC123' } });
    expect(JSON.stringify(r)).not.toMatch(/FULANO|MENGANA|11111111/);
  });
});
