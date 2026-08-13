import { describe, it, expect } from 'vitest';
import { parseSatpPapeletas, parseSatchRows, normalizeInfraccion, RNTV_MULTA, parseCajamarcaRecord, parseArequipa } from './sources.js';
import { toWebReport } from './report-transform.js';
import { SectionKind, type PapeletasPayload } from '@app/shared';
import type { OperatorSourceResult } from './index.js';

describe('SAT Piura (SATP) · parseSatpPapeletas', () => {
  it('con multas: cantidad + monto total del pie (P2B937 real)', () => {
    const r = parseSatpPapeletas('… CANTIDAD DE PAPELETAS 6 MONTO TOTAL DE LA DEUDA S/ 9,152.40 Placa: P2B937');
    expect(r.none).toBe(false);
    expect(r.count).toBe(6);
    expect(r.total).toBe(9152.40);
  });
  it('sin multas: none=true', () => {
    expect(parseSatpPapeletas('El contribuyente con placa CHU444 no presenta papeletas registradas.').none).toBe(true);
  });
});

describe('normalizeInfraccion (RNTV)', () => {
  it('G-58 → G58, M.27 → M27, L 4 → L04', () => {
    expect(normalizeInfraccion('G-58')).toBe('G58');
    expect(normalizeInfraccion('M.27')).toBe('M27');
    expect(normalizeInfraccion('L 4')).toBe('L04');
  });
  it('código inválido → null', () => expect(normalizeInfraccion('XYZ')).toBeNull());
  it('el mapa tiene los códigos clave con montos coherentes', () => {
    expect(RNTV_MULTA.G58).toBe(440); // grave
    expect(RNTV_MULTA.L04).toBe(220); // leve
    expect(RNTV_MULTA.M27).toBe(2750); // muy grave
  });
});

describe('SAT Chiclayo (SATCH) · parseSatchRows', () => {
  // [placa, nro, fecha, infractor, propietario, infraccion, estado]
  const row = (nro: string, fecha: string, code: string, estado: string): string[] =>
    ['M2G119', nro, fecha, 'NOMBRE INFRACTOR', 'NOMBRE PROPIETARIO', code, estado];

  it('todas canceladas → pending 0 (M2G119 real)', () => {
    const r = parseSatchRows([
      row('10000550649', '02/02/2013', 'G-58', 'Canc.'),
      row('10000648166', '22/09/2014', 'G-20', 'Canc.'),
    ]);
    expect(r.total).toBe(2);
    expect(r.pending).toBe(0);
    expect(r.estimate).toBe(0);
    expect(r.detalle).toHaveLength(0); // no expone nada (todas pagadas + PII)
  });

  it('pendientes → estima el monto por RNTV y NO incluye nombres (PII)', () => {
    const r = parseSatchRows([
      row('1', '01/01/2025', 'G-58', 'Pendiente'), // 440
      row('2', '02/01/2025', 'M-27', 'Pendiente'), // 2750
      row('3', '03/01/2025', 'L-04', 'Canc.'),     // cancelada → no cuenta
    ]);
    expect(r.pending).toBe(2);
    expect(r.estimate).toBe(3190); // 440 + 2750
    expect(r.detalle).toHaveLength(2);
    expect(JSON.stringify(r.detalle)).not.toContain('NOMBRE'); // sin infractor/propietario
    expect(r.detalle[0]).toMatchObject({ numero: '1', infraccion: 'G-58', monto: 440 });
  });
});

describe('SAT Cajamarca · parseCajamarcaRecord (API JSON)', () => {
  it('[] → sin papeletas (CHU444 real)', () => {
    const r = parseCajamarcaRecord([]);
    expect(r.count).toBe(0);
    expect(r.total).toBe(0);
    expect(r.detalle).toHaveLength(0);
  });
  it('mapea los campos del JSON y suma montoMulta; NO expone el nombre del infractor (PII)', () => {
    const r = parseCajamarcaRecord([
      { nroPapeleta: 'C-001', fechaInfraccion: '10/05/2024', personaInfractorId: 999, nombreInfractor: 'JUAN PEREZ', infraccion: 'G-58', montoMulta: 440, estadoPapeleta: 'Pendiente' },
      { nroPapeleta: 'C-002', fechaInfraccion: '11/05/2024', nombreInfractor: 'MARIA X', infraccion: 'M-27', montoMulta: 2750, estadoPapeleta: 'Pendiente' },
    ]);
    expect(r.count).toBe(2);
    expect(r.total).toBe(3190);
    expect(r.detalle[0]).toMatchObject({ numero: 'C-001', fecha: '10/05/2024', infraccion: 'G-58', monto: 440, estado: 'Pendiente' });
    expect(JSON.stringify(r.detalle)).not.toContain('PEREZ');
    expect(JSON.stringify(r.detalle)).not.toContain('999'); // ni el personaInfractorId
  });
});

describe('SAT Arequipa · parseArequipa (fragmento HTML)', () => {
  it('alert "No se encontraron resultados" → none', () => {
    const r = parseArequipa("<script>alert('No se encontraron resultados');window.location='..';</script>");
    expect(r.none).toBe(true);
  });
  it('tabla con filas (fecha+importe) → detalle sin capturar nombres (PII); código y N° por patrón estricto', () => {
    const html = `<table>
      <tr><th>Papeleta</th><th>Fecha</th><th>Infractor</th><th>Falta</th><th>Importe</th></tr>
      <tr><td>1000123456</td><td>15/03/2025</td><td>JUAN PEREZ GARCIA</td><td>M.27</td><td>2,750.00</td></tr>
      <tr><td>1000987654</td><td>02/07/2024</td><td>MARIA LOPEZ</td><td>G-58</td><td>440.00</td></tr>
    </table>`;
    const r = parseArequipa(html);
    expect(r.none).toBe(false);
    expect(r.count).toBe(2);
    expect(r.total).toBe(3190); // 2750 + 440
    expect(r.detalle[0]).toMatchObject({ numero: '1000123456', fecha: '15/03/2025', infraccion: 'M.27', monto: 2750, estado: 'Pendiente' });
    expect(JSON.stringify(r.detalle)).not.toContain('PEREZ'); // el nombre NO entra
  });
});

describe('toWebReport · PAPELETAS con SATP y SATCH', () => {
  const AT = '2026-08-13T12:00:00.000Z';
  const res = (source: string, status: OperatorSourceResult['status'], data?: Record<string, unknown>): OperatorSourceResult =>
    ({ source, label: source, category: 'PAPELETAS', status, summary: '', ms: 1, ...(data ? { data } : {}) }) as OperatorSourceResult;
  const papeletasOf = (results: OperatorSourceResult[]): PapeletasPayload =>
    toWebReport('ABC123', results, AT, 'test').sections.find((s) => s.kind === SectionKind.PAPELETAS)?.payload as PapeletasPayload;

  it('las 5 jurisdicciones se agregan (Lima/Callao/Trujillo/Piura/Chiclayo)', () => {
    const p = papeletasOf([
      res('SAT_PAPELETAS', 'SIN_REGISTRO'),
      res('CALLAO_PAPELETAS', 'SIN_REGISTRO'),
      res('SATT_PAPELETAS', 'SIN_REGISTRO'),
      res('SATP_PAPELETAS', 'ENCONTRADO', { total: 9152.40, count: 6 }),
      res('SATCH_PAPELETAS', 'ENCONTRADO', { total: 3190, count: 2, estimado: true }),
    ]);
    expect(p.checkedScopes).toEqual(['Lima (SAT)', 'Callao', 'Trujillo (SATT)', 'Piura (SATP)', 'Chiclayo (SATCH)']);
    expect(p.count).toBe(8); // 6 + 2
    expect(p.pendingAmount).toBe(12342.40); // 9152.40 + 3190
    expect(p.items.map((i) => i.entity)).toEqual(['SAT Piura', 'SAT Chiclayo']);
    expect(p.items.find((i) => i.entity === 'SAT Chiclayo')?.type).toContain('estimado');
  });

  it('combina el DETALLE de todas las jurisdicciones, etiquetando entity y marcando el estimado', () => {
    const p = papeletasOf([
      res('SATP_PAPELETAS', 'ENCONTRADO', { total: 2779.60, count: 1, detalle: [
        { numero: 'M2017025413', fecha: '16/04/2017', infraccion: 'M.27', descripcion: 'CONDUCIR SIN CITV', monto: 2779.60, estado: 'ORD' },
      ] }),
      res('SATCH_PAPELETAS', 'ENCONTRADO', { total: 440, count: 1, estimado: true, detalle: [
        { numero: '1', fecha: '01/01/2025', infraccion: 'G-58', monto: 440, estado: 'Pendiente' },
      ] }),
    ]);
    expect(p.detalle).toHaveLength(2);
    const piura = p.detalle!.find((d) => d.infraccion === 'M.27')!;
    expect(piura.entity).toBe('SAT Piura');
    expect(piura.estimado).toBeFalsy(); // Piura trae monto real
    expect(piura.descripcion).toBe('CONDUCIR SIN CITV');
    const chiclayo = p.detalle!.find((d) => d.infraccion === 'G-58')!;
    expect(chiclayo.entity).toBe('SAT Chiclayo');
    expect(chiclayo.estimado).toBe(true); // Chiclayo = estimado RNTV
    expect(chiclayo.monto).toBe(440);
  });
});
