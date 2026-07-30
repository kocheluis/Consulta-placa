/* eslint-disable no-console */
// PROBE GNV: corre FISE + Infogas EN VIVO para una placa a gas, con la CADENA de egresos
// (directo → túnel ENGINE_PROXY → proxy auth nativa) — correr EN EL VPS. Salta el gate de
// combustible a propósito (se prueban placas gas CONOCIDAS, sin esperar al SPRL).
//
// Uso:  npx tsx packages/scrapers/src/probe-gnv.ts BRA514            (ambas fuentes)
//       npx tsx packages/scrapers/src/probe-gnv.ts M5U034 fise       (solo FISE)
//       npx tsx packages/scrapers/src/probe-gnv.ts BRA514 infogas    (solo Infogas)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Carga secretos del VPS desde /root/placape.env (CAPTCHA_API_KEY, ENGINE_PROXY…) ANTES del
// import dinámico del motor (así PLACAPE_DB/env ya están puestos cuando el módulo se evalúa).
(function loadEnvFile() {
  const f = process.env.OPERATOR_ENV_FILE ?? '/root/placape.env';
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !m[1]) continue;
      let v = m[2] ?? '';
      if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
      process.env[m[1]] = v.trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* sin archivo (dev/Windows) → no-op */ }
})();

(async () => {
  const { runSingleSource } = await import('./operator/index.js');
  const plate = (process.argv[2] ?? 'BRA514').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const only = (process.argv[3] ?? '').toLowerCase();
  const KEY = process.env.CAPTCHA_API_KEY ?? '';
  if (!KEY) { console.error('Falta CAPTCHA_API_KEY en el entorno (¿está en /root/placape.env?).'); process.exit(1); }
  console.log(`— PROBE GNV · placa ${plate} · ENGINE_PROXY ${process.env.ENGINE_PROXY ? 'configurado' : 'NO configurado (solo egreso directo)'} —`);

  const outDir = join(process.cwd(), '.gnv-probe', plate);
  const ids = ['fise-gnv', 'infogas-gnv'].filter((id) => !only || id.includes(only));
  let fails = 0;
  for (const id of ids) {
    console.log(`\n═══ ${id} · ${plate} ═══  (cadena acotada: ~90s por egreso, ~5 min máx)`);
    // TAIL EN VIVO del log de la fuente: sin esto, la cadena parece "colgada" (todo salía al final).
    const logFile = join(outDir, `${id}.log`);
    let printed = 0;
    const tail = (): void => {
      try {
        const txt = readFileSync(logFile, 'utf8');
        if (txt.length > printed) { process.stdout.write(txt.slice(printed)); printed = txt.length; }
      } catch { /* el log aún no existe */ }
    };
    const tailTimer = setInterval(tail, 1000);
    const t0 = Date.now();
    try {
      const r = await runSingleSource(plate, id, {
        outDir, captchaApiKey: KEY, captchaProvider: process.env.CAPTCHA_PROVIDER, headless: true,
      });
      clearInterval(tailTimer);
      tail(); // vuelca lo que faltaba del log
      console.log(`\nRESULTADO (${Math.round((Date.now() - t0) / 1000)}s): ${r.status} · ${r.summary}`);
      if (r.data && Object.keys(r.data).length) console.log(JSON.stringify(r.data, null, 2));
      if (r.status === 'ERROR') fails++;
    } catch (e) {
      clearInterval(tailTimer);
      tail();
      console.error(`ERROR: ${(e as Error).message}`);
      fails++;
    }
  }
  console.log(`\ncapturas/logs en ${outDir}`);
  process.exit(fails ? 1 : 0);
})();
