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
  placa TEXT NOT NULL, fuente TEXT NOT NULL DEFAULT 'superbid',
  subasta TEXT, lote_url TEXT, boleta_url TEXT,
  flags TEXT, datos TEXT, estado TEXT DEFAULT 'abierta', visto_at TEXT, cerrado_at TEXT,
  PRIMARY KEY (placa, fuente)
);
CREATE TABLE IF NOT EXISTS boletas (
  placa TEXT PRIMARY KEY, fuente TEXT, pdf_path TEXT, propietario TEXT, fecha_prop TEXT,
  afectaciones TEXT, json TEXT, vigente INTEGER, fecha_boleta TEXT, obtenida_at TEXT
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, placa TEXT NOT NULL, whatsapp TEXT, email TEXT,
  estado TEXT DEFAULT 'pendiente', report_path TEXT, error TEXT, created_at TEXT,
  started_at TEXT, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS meta ( k TEXT PRIMARY KEY, v TEXT );
`;

let _db: BetterSQLite3Database<typeof schema> | null = null;

/**
 * Migra `superbid_index` del esquema viejo (placa PRIMARY KEY, una fuente) al nuevo
 * (clave compuesta placa+fuente, multi-fuente). Reconstruye la tabla preservando los
 * datos existentes y marcándolos como fuente 'superbid'. Idempotente y atómico: no hace
 * nada si la tabla ya tiene la columna `fuente` o si aún no existe (DB nueva).
 */
function migrateSuperbidIndex(sqlite: Database.Database): void {
  const cols = sqlite.prepare(`PRAGMA table_info(superbid_index)`).all() as Array<{ name: string }>;
  if (cols.length === 0) return; // DB nueva: el DDL ya creó el esquema nuevo
  if (cols.some((c) => c.name === 'fuente')) return; // ya migrada
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE superbid_index_mig (
        placa TEXT NOT NULL, fuente TEXT NOT NULL DEFAULT 'superbid',
        subasta TEXT, lote_url TEXT, boleta_url TEXT,
        flags TEXT, datos TEXT, estado TEXT DEFAULT 'abierta', visto_at TEXT, cerrado_at TEXT,
        PRIMARY KEY (placa, fuente)
      );
      INSERT INTO superbid_index_mig
        (placa, fuente, subasta, lote_url, boleta_url, flags, datos, estado, visto_at, cerrado_at)
        SELECT placa, 'superbid', subasta, lote_url, boleta_url, flags, datos, estado, visto_at, cerrado_at
        FROM superbid_index;
      DROP TABLE superbid_index;
      ALTER TABLE superbid_index_mig RENAME TO superbid_index;
    `);
  })();
}

/** Agrega una columna a una tabla si falta (ALTER aditivo, barato y no destructivo). */
function addColumnIfMissing(sqlite: Database.Database, table: string, col: string, decl: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.length && !cols.some((c) => c.name === col)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

/** Devuelve la DB (singleton); crea el archivo + tablas la primera vez. */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(DDL);
  migrateSuperbidIndex(sqlite);
  // columnas nuevas de la cola de pedidos (DBs creadas antes de la cola)
  for (const [c, d] of [['error', 'TEXT'], ['started_at', 'TEXT'], ['finished_at', 'TEXT']] as const) {
    addColumnIfMissing(sqlite, 'pedidos', c, d);
  }
  _db = drizzle(sqlite, { schema });
  return _db;
}

export { schema };
export const dbPath = (): string => DB_PATH;
