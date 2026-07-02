import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { execFile } from 'node:child_process';

/**
 * Localiza el binario de Google Chrome de forma cross-platform:
 * Windows (PC del operador) + Linux (VPS Perú: google-chrome-stable vía .deb) + macOS.
 * Se puede forzar con la variable de entorno CHROME_PATH (prioridad máxima).
 */
const CANDIDATES: string[] = [
  // Windows (PC del operador)
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  // Linux (VPS): paquete oficial google-chrome-stable
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** Ruta del primer Chrome encontrado (o CHROME_PATH si está definido), o null. */
export function findChrome(): string | null {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return CANDIDATES.find((p) => p && existsSync(p)) ?? null;
}

/**
 * Flags comunes para lanzar Chrome con depuración remota (CDP).
 * - `--disable-extensions`: quita el target *service-worker* de extensiones que
 *   CUELGA `connectOverCDP` de Playwright con Chrome reciente (validado en el VPS).
 * - en Linux (VPS) añade `--no-sandbox` (corre como root) y `--disable-dev-shm-usage`
 *   (/dev/shm pequeño). En Windows/macOS no se agregan.
 */
export function chromeFlags(): string[] {
  const flags = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
  ];
  if (platform() === 'linux') flags.push('--no-sandbox', '--disable-dev-shm-usage');
  return flags;
}

/**
 * Mata los Chrome lanzados por el motor (los que tienen `--remote-debugging-port`)
 * para liberar RAM tras cada reporte. SOLO en Linux (VPS) — en la PC del operador
 * se reusa Chrome (RAM de sobra y conserva clearance en caliente). Apunta a los
 * puertos de ESTE proceso (env `CDP_*_PORT`) → seguro con workers concurrentes.
 * El clearance no se pierde: vive en el perfil persistente en disco.
 */
export function killEngineChrome(): void {
  if (platform() !== 'linux') return;
  // KEEP_SUNARP_WARM=1: NO mata el Chrome de SUNARP entre reportes → la próxima consulta reusa
  // el clearance CALIENTE y el Turnstile pasa pasivo en ~6s (en vez de relanzar frío y esperar
  // ~30-45s de recargas). Cuesta ~1 Chrome de RAM sostenido; enciéndelo si el VPS lo aguanta.
  const keepSunarpWarm = process.env.KEEP_SUNARP_WARM === '1';
  const ports = [...new Set([
    ...(keepSunarpWarm ? [] : [Number(process.env.CDP_SUNARP_PORT ?? 9222)]),
    Number(process.env.CDP_SPRL_PORT ?? 9224),
    Number(process.env.CDP_SPRL_PORT_2 ?? 9225), // 2ª cuenta SPRL (si no, su Chrome quedaría huérfano)
    Number(process.env.CDP_SUPERBID_PORT ?? 9225),
  ])];
  for (const p of ports) {
    try { execFile('pkill', ['-f', `remote-debugging-port=${p}`], () => {}); } catch { /* noop */ }
  }
}
