import { chromium, type Frame } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Sondeo del flujo de papeletas de SAT Lima. principal.aspx es un FRAMESET; el
 * menú y los formularios viven dentro del frame (bienvenida.aspx). Este probe
 * entra al frame, vuelca el menú y sus enlaces/onclick para hallar cómo llegar
 * a "Consulta de papeletas".
 *
 * Uso: npm run -w @app/worker probe-sat -- CHU444
 */

const plate = (process.argv[2] ?? 'CHU444').toUpperCase().replace(/[^A-Z0-9]/g, '');
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'sat', '__captured__');
mkdirSync(outDir, { recursive: true });

async function dumpFrame(frame: Frame, label: string, file: string) {
  console.log(`\n===== ${label} =====`);
  console.log('FRAME URL:', frame.url());
  const html = await frame.content().catch(() => '');
  writeFileSync(join(outDir, file), html, 'utf8');

  const anchors = [];
  for (const a of await frame.locator('a').all()) {
    const text = (await a.textContent().catch(() => ''))?.trim() ?? '';
    const href = await a.getAttribute('href').catch(() => null);
    const onclick = await a.getAttribute('onclick').catch(() => null);
    if (text || onclick) anchors.push({ text: text.slice(0, 40), href, onclick: onclick?.slice(0, 80) });
  }
  const clickables = [];
  for (const el of await frame.locator('[onclick]').all()) {
    const text = (await el.textContent().catch(() => ''))?.trim() ?? '';
    const onclick = await el.getAttribute('onclick').catch(() => null);
    clickables.push({ text: text.slice(0, 40), onclick: onclick?.slice(0, 90) });
  }
  const selects = [];
  for (const s of await frame.locator('select').all()) {
    selects.push({
      id: await s.getAttribute('id').catch(() => null),
      name: await s.getAttribute('name').catch(() => null),
      options: await s.locator('option').allTextContents().catch(() => []),
    });
  }
  const inputs = [];
  for (const i of await frame.locator('input:not([type=hidden])').all()) {
    inputs.push({
      id: await i.getAttribute('id').catch(() => null),
      name: await i.getAttribute('name').catch(() => null),
      type: await i.getAttribute('type').catch(() => null),
    });
  }
  console.log('ANCHORS:', JSON.stringify(anchors.slice(0, 25), null, 1));
  console.log('CLICKABLES [onclick]:', JSON.stringify(clickables.slice(0, 25), null, 1));
  console.log('SELECTS:', JSON.stringify(selects, null, 1));
  console.log('INPUTS:', JSON.stringify(inputs.slice(0, 15), null, 1));
}

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ locale: 'es-PE' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  await page.goto('https://www.sat.gob.pe/VirtualSAT/modulos/papeletas.aspx', {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(3000);

  // Entrar al frame del menú.
  const frame =
    page.frames().find((f) => /bienvenida|fraRight/i.test(f.url()) || f.name() === 'fraRightFrame') ??
    page.frames().find((f) => f !== page.mainFrame());

  if (!frame) {
    console.log('No se encontró el frame. Frames:', page.frames().map((f) => f.url()));
  } else {
    await dumpFrame(frame, 'MENÚ (frame bienvenida)', 'menu.html');

    // Intentar abrir "Consulta de papeletas" por texto.
    const link = frame
      .locator('a, [onclick]')
      .filter({ hasText: /papelet/i })
      .first();
    if (await link.count()) {
      console.log('\n>>> Encontrado item de papeletas, haciendo clic...');
      await link.click().catch((e) => console.log('clic falló:', (e as Error).message));
      await page.waitForTimeout(3500);
      // El formulario puede cargar en el mismo frame u otro.
      const fr2 =
        page.frames().find((f) => /papelet/i.test(f.url())) ??
        page.frames().find((f) => f !== page.mainFrame()) ??
        frame;
      await dumpFrame(fr2, 'FORMULARIO DE PAPELETAS', 'form.html');
      await fr2.page().screenshot({ path: join(outDir, 'form.png'), fullPage: true }).catch(() => {});
    } else {
      console.log('\nNo se encontró item con texto "papeleta" en el frame.');
    }
  }

  console.log(`\nPlaca objetivo: ${plate}`);
  console.log(`Salida en: ${outDir}`);
} catch (err) {
  console.error('ERROR:', (err as Error).message);
} finally {
  await browser.close();
  process.exit(0);
}
