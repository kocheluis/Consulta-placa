import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSbs } from './parser.js';
import type { InsurancePolicy, SiniestroIndicator } from '@app/shared';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '__fixtures__', name), 'utf8');

describe('parseSbs', () => {
  it('extrae SOAT vigente y "sin siniestros"', () => {
    const results = parseSbs(fixture('con-soat.html'));
    const seguros = results.find((r) => r.kind === 'SEGUROS')!;
    const siniestro = results.find((r) => r.kind === 'SINIESTRALIDAD')!;

    expect(seguros.status).toBe('AVAILABLE');
    const policy = seguros.payload as InsurancePolicy;
    expect(policy.hasActiveSoat).toBe(true);
    expect(policy.insurer).toBe('LA POSITIVA SEGUROS');
    expect(policy.policyNumber).toBe('SOAT-2025-0123456');
    expect(policy.validTo).toBe('2026-03-01');

    expect(siniestro.status).toBe('AVAILABLE');
    expect((siniestro.payload as SiniestroIndicator).hasSiniestro).toBe(false);
  });

  it('detecta sin SOAT vigente y con siniestro', () => {
    const results = parseSbs(fixture('sin-soat-con-siniestro.html'));
    const policy = results.find((r) => r.kind === 'SEGUROS')!.payload as InsurancePolicy;
    const siniestro = results.find((r) => r.kind === 'SINIESTRALIDAD')!
      .payload as SiniestroIndicator;
    expect(policy.hasActiveSoat).toBe(false);
    expect(siniestro.hasSiniestro).toBe(true);
    expect(siniestro.periodYears).toBe(5);
  });
});
