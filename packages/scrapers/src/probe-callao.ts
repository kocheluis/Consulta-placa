/* eslint-disable no-console */
import { chromium, type Locator } from 'playwright';
import { createCaptchaSolver } from './captcha/index.js';

const plate = (process.argv[2] ?? 'BTF268').toUpperCase().replace(/[^A-Z0-9]/g, '');
const key = process.env.CAPTCHA_API_KEY ?? '';
const solver = createCaptchaSolver({ provider: process.env.CAPTCHA_PROVIDER ?? 'capsolver', apiKey: key });
const OUT = 'd:/Jose/Proyecto_Consulta_placa/validacion-fuentes';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function solveImg(img: Locator): Promise<string> {
  const b64 = (await img.screenshot()).toString('base64');
  const t = (await solver.solveImage(b64)).trim();
  console.log('   CapSolver leyó:', t);
  return t;
}

const b = await chromium.launch({ headless: true });
try {
  const p = await (await b.newContext({ locale: 'es-PE' })).newPage();
  p.setDefaultTimeout(40000);
  let dialog = '';
  p.on('dialog', (d) => { dialog = d.message(); d.accept().catch(() => {}); });
  console.log('Callao · placa', plate);
  await p.goto('https://pagopapeletascallao.pe/', { waitUntil: 'networkidle' });
  await wait(2500);

  const tipo = p.locator('#tipo_busqueda');
  if (await tipo.count()) {
    // elegir la opción de Placa
    const opts = await tipo.locator('option').allTextContents();
    console.log('   tipo_busqueda opciones:', JSON.stringify(opts));
    const placaOpt = opts.find((o) => /placa/i.test(o));
    if (placaOpt) await tipo.selectOption({ label: placaOpt }).catch(() => {});
    await wait(800);
  }
  const valor = p.locator('#valor_busqueda');
  const capInput = p.locator('#captcha');
  // El captcha de Callao es un <img> inline data:image/png (≈170x40).
  const capImg = p.locator('img[src^="data:image"]').first();

  const ERR_RE = /error al ingresar el c[oó]digo de seguridad|c[oó]digo de seguridad incorrect/i;
  const OK_RE = /(no se (encontr|registr)|no (tiene|existe|cuenta)|TOTAL:\s*S\/\.?\s*[0-9]|N[º°]\s*Papeleta|fecha de la infracci|monto)/i;
  for (let i = 1; i <= 4; i++) {
    console.log(`-- intento ${i}/4 --`);
    if (i > 1) { await p.reload({ waitUntil: 'networkidle' }); await wait(2000);
      if (await tipo.count()) { const opts = await tipo.locator('option').allTextContents(); const po = opts.find((o)=>/placa/i.test(o)); if (po) await tipo.selectOption({label:po}).catch(()=>{}); await wait(600); } }
    await valor.fill(plate);
    const sol = await solveImg(capImg);
    await capInput.fill(sol);
    dialog = '';
    await p.locator('button:has-text("Buscar"), input[value*="Buscar" i]').first().click().catch((e)=>console.log('click:',(e as Error).message));
    await wait(5000);
    const body = (await p.locator('body').innerText().catch(() => '')).replace(/[ \t]+/g, ' ');
    await p.screenshot({ path: `${OUT}/callao-rev-${i}.png`, fullPage: true });
    const err = ERR_RE.test(body) ? 'Error código de seguridad' : (dialog && /captcha|seguridad/i.test(dialog) ? dialog : null);
    const ok = body.match(OK_RE)?.[0] ?? null;
    console.log('   err:', err ?? 'ninguno', '| ok:', ok ?? 'NINGUNO');
    if (ok && !err) { console.log('   ✅ Callao respondió por placa (captcha OK).'); break; }
    console.log('   captcha rechazado / sin dato; reintento…');
  }
} finally {
  await b.close();
  process.exit(0);
}
