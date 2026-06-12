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
});
