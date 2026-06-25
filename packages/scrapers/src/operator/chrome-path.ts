import { existsSync } from 'node:fs';
import { platform } from 'node:os';

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
