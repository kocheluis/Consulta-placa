import { describe, it, expect } from 'vitest';
import { buildReport } from './assemble.js';
import { SectionKind, SectionStatus, SourceId } from './enums.js';
import type { SourceResult } from './report.js';

const base = {
  id: 'r1',
  plateDisplay: 'ABC-123',
  plateNormalized: 'ABC123',
  generatedAt: '2026-06-12T10:00:00Z',
};

describe('buildReport', () => {
  it('siempre añade las 4 secciones "Próximamente" y el disclaimer', () => {
    const report = buildReport({ ...base, sources: [] });
    const comingSoon = report.sections.filter((s) => s.status === SectionStatus.COMING_SOON);
    expect(comingSoon.map((s) => s.kind).sort()).toEqual(
      [
        SectionKind.DEUDA_BANCARIA,
        SectionKind.GNV,
        SectionKind.PAPELETAS,
        SectionKind.PNP,
      ].sort(),
    );
    expect(report.disclaimer).toContain('referencial');
  });

  it('consolida el vehículo y minimiza el titular con su nota', () => {
    const sources: SourceResult[] = [
      {
        kind: SectionKind.REGISTRAL,
        source: SourceId.SUNARP,
        status: SectionStatus.AVAILABLE,
        fetchedAt: base.generatedAt,
        vehicle: { brand: 'TOYOTA', model: 'YARIS', year: 2019, stolenAlert: false },
        ownerName: 'PEREZ, JUAN',
      },
    ];
    const report = buildReport({ ...base, sources });
    expect(report.status).toBe('COMPLETE');
    expect(report.vehicle?.brand).toBe('TOYOTA');
    expect(report.vehicle?.owner).toEqual({ name: 'PEREZ, JUAN', note: expect.any(String) });
  });

  it('deduplica SEGUROS de SBS y APESEG en una sola sección, prefiriendo AVAILABLE', () => {
    const sources: SourceResult[] = [
      {
        kind: SectionKind.SEGUROS,
        source: SourceId.SBS,
        status: SectionStatus.AVAILABLE,
        fetchedAt: base.generatedAt,
        payload: { hasActiveSoat: true },
      },
      {
        kind: SectionKind.SEGUROS,
        source: SourceId.APESEG,
        status: SectionStatus.UNAVAILABLE,
        fetchedAt: null,
      },
    ];
    const report = buildReport({ ...base, sources });
    const seguros = report.sections.filter((s) => s.kind === SectionKind.SEGUROS);
    expect(seguros).toHaveLength(1);
    expect(seguros[0]!.source).toBe(SourceId.SBS);
    expect(seguros[0]!.status).toBe('AVAILABLE');
  });

  it('marca PARTIAL si una sección MVP queda UNAVAILABLE', () => {
    const sources: SourceResult[] = [
      {
        kind: SectionKind.SINIESTRALIDAD,
        source: SourceId.SBS,
        status: SectionStatus.UNAVAILABLE,
        fetchedAt: null,
        errorReason: 'SOURCE_TIMEOUT',
      },
    ];
    const report = buildReport({ ...base, sources });
    expect(report.status).toBe('PARTIAL');
  });
});
