import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as schema from './schema.js';

/**
 * Conexión a la DB SQLite (WAL). Ruta vía env `PLACAPE_DB` o `<cwd>/data/placape.db`.
 * Las tablas se crean idempotentemente al primer uso (CREATE TABLE IF NOT EXISTS),
 * así no hace falta tooling de migraciones en el VPS. El esquema Drizzle (schema.ts)
 * da las queries con tipos; este DDL crea las tablas (alineado a mano con el esquema).
 */
const DB_PATH = process.env.PLACAPE_DB ?? join(process.cwd(), 'data', 'placape.db');

const DDL = `
CREATE TABLE IF NOT EXISTS superbid_index (
  placa TEXT PRIMARY KEY, subasta TEXT, lote_url TEXT, boleta_url TEXT,
  flags TEXT, datos TEXT, estado TEXT DEFAULT 'abierta', visto_at TEXT, cerrado_at TEXT
);
CREATE TABLE IF NOT EXISTS boletas (
  placa TEXT PRIMARY KEY, fuente TEXT, pdf_path TEXT, propietario TEXT, fecha_prop TEXT,
  afectaciones TEXT, json TEXT, vigente INTEGER, fecha_boleta TEXT, obtenida_at TEXT
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, placa TEXT NOT NULL, whatsapp TEXT, email TEXT,
  estado TEXT DEFAULT 'pendiente', report_path TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS meta ( k TEXT PRIMARY KEY, v TEXT );
`;

let _db: BetterSQLite3Database<typeof schema> | null = null;

/** Devuelve la DB (singleton); crea el archivo + tablas la primera vez. */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(DDL);
  _db = drizzle(sqlite, { schema });
  return _db;
}

export { schema };
export const dbPath = (): string => DB_PATH;
