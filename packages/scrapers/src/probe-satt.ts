// Probe en vivo del runner SATT Trujillo (récord de papeletas por placa), desde una IP residencial.
// Valida el flujo completo de producción: registro (GET) → búsqueda con placa-con-guion → parse +
// captura. Uso: npx tsx src/probe-satt.ts <PLACA> [DNI_REGISTRO]
import { chromium } from 'playwright';
import { runSattPapeletas } from './operator/sources.js';

const plate = process.argv[2] ?? 'EGU257';
const dni = process.argv[3] ?? null;

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'es-PE' });
  const page = await ctx.newPage();
  const shot = `satt-probe-${plate}.png`;
  const dummySolver = {} as never; // SATT no usa captcha
  const r = await runSattPapeletas(page, plate, dummySolver, shot, dni);
  console.log(JSON.stringify({ status: r.status, summary: r.summary, data: r.data, ms: r.ms, screenshot: r.screenshot }, null, 2));
  await browser.close();
};
main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
