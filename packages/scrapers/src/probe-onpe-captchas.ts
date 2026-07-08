/* eslint-disable no-console */
/**
 * COSECHADOR de captchas del JNE (multas.jne.gob.pe) para armar el set de entrenamiento del OCR
 * local. Abre el formulario UNA vez (pasa Imperva) y captura N imágenes del captcha refrescándolo
 * — SIN llenar DNI ni enviar nada (poco tráfico, bajo riesgo). Guarda cap-01.png … cap-NN.png.
 *
 *   VPS:  set -a; . /root/placape.env; set +a; DISPLAY=:99 \
 *         npx tsx packages/scrapers/src/probe-onpe-captchas.ts 25
 *
 * Luego baja la carpeta onpe/__captured__/ (WinSCP), LEE cada cap-NN.png y renómbralo a su código
 * (p. ej. cap-03.png → 448210.png). Con ~20 etiquetados monto y afino el OCR.
 */
import { chromium } from 'patchright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const N = Math.min(60, Math.max(1, Number(process.argv[2] ?? 25)));
const URL = 'https://multas.jne.gob.pe/';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'onpe', '__captured__');
const profile = join(here, '..', '.cdp-onpe-profile');
mkdirSync(outDir, { recursive: true });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));
const pad = (n: number) => String(n).padStart(2, '0');

(async () => {
  const ctx = await chromium.launchPersistentContext(profile, { headless: false, channel: 'chrome', viewport: null });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', (e as Error).message));
    for (let i = 0; i < 35; i++) { await wait(1000); if (await page.locator('input:visible').first().isVisible().catch(() => false)) break; }
    await wait(1500);
    const bodyTxt = (await page.locator('body').innerText().catch(() => '')).slice(0, 200);
    if (/access denied|error 17|blocked by our security/i.test(bodyTxt)) { console.log('❌ BLOQUEADO por Imperva. No reintentar seguido.'); return; }

    const capImg = page.locator('img').nth(1); // idx 1 = imagen del captcha (confirmado en el dump)
    if (!(await capImg.isVisible().catch(() => false))) { console.log('⚠️ no veo la imagen del captcha (revisa el formulario)'); return; }

    console.log(`Cosechando ${N} captchas → ${outDir}`);
    for (let i = 1; i <= N; i++) {
      const p = join(outDir, `cap-${pad(i)}.png`);
      await capImg.screenshot({ path: p }).catch(() => {});
      console.log(`  · cap-${pad(i)}.png`);
      // Refrescar: el ícono ↻ está a la derecha de la imagen del captcha.
      const box = await capImg.boundingBox().catch(() => null);
      if (box) await page.mouse.click(box.x + box.width + 22, box.y + box.height / 2).catch(() => {});
      await wait(rnd(1200, 2400));
    }
    console.log(`\n✓ ${N} imágenes en ${outDir}`);
    console.log('   Baja la carpeta, LEE cada cap-NN.png y renómbralo a su código (ej: cap-03.png → 448210.png).');
  } catch (e) { console.log('ERR', (e as Error).message); }
  finally { await ctx.close().catch(() => {}); process.exit(0); }
})();
