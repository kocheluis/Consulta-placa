import { createWorker, type Worker } from 'tesseract.js';

/**
 * OCR de imágenes con Tesseract.js. Algunos portales (SUNARP) devuelven los datos
 * del vehículo como IMAGEN (anti-scraping), así que hay que leerlos por OCR.
 *
 * Reusa un único worker (la primera llamada descarga los datos del idioma y se
 * cachean). Las llamadas concurrentes se serializan en el worker — suficiente
 * para la concurrencia del worker de la cola.
 */
let workerPromise: Promise<Worker> | null = null;

function getWorker(lang: string): Promise<Worker> {
  if (!workerPromise) workerPromise = createWorker(lang);
  return workerPromise;
}

/** Convierte una imagen (Buffer PNG/JPG) en texto por OCR. */
export async function ocrImage(image: Buffer, lang = 'spa'): Promise<string> {
  const worker = await getWorker(lang);
  const { data } = await worker.recognize(image);
  return data.text;
}

/** Libera el worker de OCR (llamar al apagar el proceso). */
export async function closeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}
