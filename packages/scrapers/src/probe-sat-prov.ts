// Probe en vivo de las SAT provinciales (récord de papeletas por placa), desde IP residencial.
// Uso: npx tsx src/probe-sat-prov.ts <satp|satch|satcaj|sataqp> <PLACA>
import { chromium } from 'playwright';
import { runSatpPapeletas, runSatchPapeletas, runSatCajamarca, runSatArequipa } from './operator/sources.js';

const which = process.argv[2] ?? 'satp';
const plate = process.argv[3] ?? 'P2B937';
const RUNNERS: Record<string, typeof runSatpPapeletas> = {
  satp: runSatpPapeletas, satch: runSatchPapeletas, satcaj: runSatCajamarca, sataqp: runSatArequipa,
};
const runner = RUNNERS[which] ?? runSatpPapeletas;

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'es-PE' });
  const page = await ctx.newPage();
  const shot = `${which}-probe-${plate}.png`;
  const r = await runner(page, plate, {} as never, shot);
  console.log(JSON.stringify({ status: r.status, summary: r.summary, data: { ...r.data, detalle: (r.data as { detalle?: unknown[] })?.detalle?.slice?.(0, 3), texto: undefined }, ms: r.ms }, null, 2));
  await browser.close();
};
main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
