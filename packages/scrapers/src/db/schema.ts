import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de la DB de PlacaPe (SQLite vía Drizzle). Portable a Postgres/Supabase
 * después (cambiar el dialecto + driver, el esquema se mantiene). Fechas como texto
 * ISO-8601 (legible y portable).
 */

/** Índice de Superbid: mapa placa → subasta/lote/boleta, poblado por el job diario. */
export const superbidIndex = sqliteTable('superbid_index', {
  placa: text('placa').primaryKey(),
  subasta: text('subasta'),
  loteUrl: text('lote_url'),
  boletaUrl: text('boleta_url'),
  flags: text('flags', { mode: 'json' }).$type<Record<string, boolean>>(),
  datos: text('datos', { mode: 'json' }).$type<Record<string, unknown>>(),
  estado: text('estado').default('abierta'), // abierta | cerrada
  vistoAt: text('visto_at'), // ISO: última vez visto/actualizado
  cerradoAt: text('cerrado_at'), // ISO: cuando la subasta cerró
});

/** Boletas informativas almacenadas (gratis de Superbid o de pago de SUNARP). */
export const boletas = sqliteTable('boletas', {
  placa: text('placa').primaryKey(),
  fuente: text('fuente'), // superbid | sunarp_pago
  pdfPath: text('pdf_path'),
  propietario: text('propietario'),
  fechaProp: text('fecha_prop'), // cuándo el dueño actual adquirió (contenido de la boleta)
  afectaciones: text('afectaciones'),
  json: text('json', { mode: 'json' }).$type<Record<string, unknown>>(), // datos extraídos
  vigente: integer('vigente', { mode: 'boolean' }), // dueño boleta == dueño SUNARP actual
  fechaBoleta: text('fecha_boleta'), // emisión impresa en el documento → antigüedad REAL
  obtenidaAt: text('obtenida_at'), // cuándo nuestro sistema la capturó
});

/** Pedidos de reporte (para la web pública / consola). */
export const pedidos = sqliteTable('pedidos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  placa: text('placa').notNull(),
  whatsapp: text('whatsapp'),
  email: text('email'),
  estado: text('estado').default('pendiente'), // pendiente | listo | entregado
  reportPath: text('report_path'),
  createdAt: text('created_at'),
});

/** Pares clave/valor para control interno (ej. último scan de Superbid, set de lotes vistos). */
export const meta = sqliteTable('meta', {
  k: text('k').primaryKey(),
  v: text('v', { mode: 'json' }),
});
