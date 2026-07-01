/**
 * Marca de tiempo en hora de Perú (America/Lima = UTC-5, sin horario de verano).
 *
 * Solo para LOGS legibles del operador/keep-alive: antes salían en UTC
 * (`toISOString()`) aunque el VPS corre en UTC-5, lo que confundía al leerlos.
 * OJO: NO usar para campos de DATOS (`generatedAt`/`fetchedAt` del reporte) — esos
 * deben quedar en ISO/UTC para que `new Date(...)` los interprete bien.
 */
export function peruStamp(d: Date = new Date()): string {
  // 'sv-SE' rinde el formato ISO-like "YYYY-MM-DD HH:mm:ss" (24h) que ya usábamos.
  return d.toLocaleString('sv-SE', { timeZone: 'America/Lima' });
}
