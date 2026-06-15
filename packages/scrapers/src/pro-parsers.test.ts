import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSat } from './sat/parser.js';
import { parseSutran } from './sutran/parser.js';
import { parseMtc } from './mtc/parser.js';
import { parseAtu } from './atu/parser.js';
import { parseOnpe } from './onpe/parser.js';
import type {
  PapeletasPayload,
  CapturaIndicator,
  RevisionTecnica,
  TransporteInfo,
  MultasElectorales,
} from '@app/shared';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (...p: string[]) => readFileSync(join(here, ...p), 'utf8');

describe('parsers PRO', () => {
  it('SAT → papeletas (con pendiente) + sin orden de captura', () => {
    const results = parseSat(fx('sat', '__fixtures__', 'con-papeletas.html'));
    const papeletas = results.find((r) => r.kind === 'PAPELETAS')!;
    const captura = results.find((r) => r.kind === 'CAPTURA')!;
    expect(papeletas.source).toBe('SAT');
    expect(papeletas.status).toBe('AVAILABLE');
    const p = papeletas.payload as PapeletasPayload;
    expect(p.total).toBe(2);
    expect(p.pendingAmount).toBe(336);
    expect(p.items[0]).toMatchObject({ type: 'Exceso de velocidad', amount: 336, status: 'PENDIENTE', entity: 'SAT' });
    expect((captura.payload as CapturaIndicator).hasCapture).toBe(false);
  });

  it('SUTRAN → papeleta de cinemómetro', () => {
    const [r] = parseSutran(fx('sutran', '__fixtures__', 'con-papeletas.html'));
    expect(r!.kind).toBe('PAPELETAS');
    expect(r!.source).toBe('SUTRAN');
    const p = r!.payload as PapeletasPayload;
    expect(p.total).toBe(1);
    expect(p.pendingAmount).toBe(432);
    expect(p.items[0]!.entity).toBe('SUTRAN');
  });

  it('MTC → revisión técnica vigente', () => {
    const [r] = parseMtc(fx('mtc', '__fixtures__', 'vigente.html'));
    expect(r!.kind).toBe('REVISION_TECNICA');
    const p = r!.payload as RevisionTecnica;
    expect(p.hasValid).toBe(true);
    expect(p.status).toBe('VIGENTE');
    expect(p.validUntil).toBe('2026-03-10');
    expect(p.result).toBe('APROBADO');
  });

  it('ATU → registrado como taxi', () => {
    const [r] = parseAtu(fx('atu', '__fixtures__', 'taxi.html'));
    expect(r!.kind).toBe('TRANSPORTE');
    const p = r!.payload as TransporteInfo;
    expect(p.isPublicTransport).toBe(true);
    expect(p.modality).toBe('TAXI');
  });

  it('ONPE → multa electoral con monto', () => {
    const [r] = parseOnpe(fx('onpe', '__fixtures__', 'con-multa.html'));
    expect(r!.kind).toBe('MULTAS_ELECTORALES');
    const p = r!.payload as MultasElectorales;
    expect(p.hasFine).toBe(true);
    expect(p.amount).toBe(96);
  });

  it('devuelven NOT_FOUND si no hay contenedor', () => {
    expect(parseMtc('<html></html>')[0]!.status).toBe('NOT_FOUND');
    expect(parseAtu('<html></html>')[0]!.status).toBe('NOT_FOUND');
    expect(parseOnpe('<html></html>')[0]!.status).toBe('NOT_FOUND');
  });
});
