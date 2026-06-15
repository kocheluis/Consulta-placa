import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseApeseg } from './parser.js';
import type { InsurancePolicy } from '@app/shared';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '__fixtures__', name), 'utf8');

describe('parseApeseg', () => {
  it('extrae el estado del SOAT vigente', () => {
    const [seguros] = parseApeseg(fixture('vigente.html'));
    expect(seguros!.kind).toBe('SEGUROS');
    expect(seguros!.source).toBe('APESEG');
    expect(seguros!.status).toBe('AVAILABLE');
    const policy = seguros!.payload as InsurancePolicy;
    expect(policy.hasActiveSoat).toBe(true);
    expect(policy.insurer).toBe('RIMAC SEGUROS');
    expect(policy.validTo).toBe('2026-08-15');
  });

  it('parsea la estructura real (Compañía/Inicio/Fin/Uso/Clase/Tipo)', () => {
    const [seguros] = parseApeseg(fixture('real-apeseg.html'));
    expect(seguros!.status).toBe('AVAILABLE');
    const policy = seguros!.payload as InsurancePolicy;
    expect(policy.hasActiveSoat).toBe(true);
    expect(policy.insurer).toBe('INTERSEGURO');
    expect(policy.validFrom).toBe('27/09/2025');
    expect(policy.validTo).toBe('27/09/2026');
    expect(policy.certificate).toBe('D00000012345678');
    expect(policy.policyNumber).toBe('D00000012345678');
    expect(policy.use).toBe('PARTICULAR');
    expect(policy.vehicleClass).toBe('CAMIONETA SUV/RURAL');
    expect(policy.policyType).toBe('DIGITAL');
  });
});
