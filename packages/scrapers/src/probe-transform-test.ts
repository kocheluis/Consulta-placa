/* eslint-disable no-console */
// Smoke test del transform: ¿toWebReport mapea el resultado SBS → InsurancePolicy con los 7 campos?
import { readFileSync } from 'node:fs';
import { toWebReport } from './operator/report-transform.js';

const path = process.argv[2] ?? '/root/out/SBS2/reporte.json';
const j = JSON.parse(readFileSync(path, 'utf8')) as { results: Parameters<typeof toWebReport>[1] };
const rep = toWebReport('BVH305', j.results, '2026-06-30T00:00:00Z', 'smoke');
const seg = rep.sections.find((s) => s.kind === 'SEGUROS');
console.log('SEGUROS →', JSON.stringify(seg?.payload ?? seg, null, 1));
process.exit(0);
