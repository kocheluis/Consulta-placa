import { existsSync } from 'node:fs';

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
