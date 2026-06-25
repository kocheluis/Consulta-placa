/* eslint-disable no-console */
import { eq } from 'drizzle-orm';
import { getDb, schema, dbPath } from './db/index.js';
import {
  superbidUpsert, superbidLookup, superbidCount,
  boletaSave, boletaGet, metaSet, metaGet,
} from './db/repo.js';

/**
 * Inicializa la DB (crea tablas) y corre un smoke-test.
 * Uso:  [PLACAPE_DB=/root/data/placape.db] npx tsx packages/scrapers/src/db-cli.ts
 */
getDb(); // crea archivo + tablas
console.log('✓ DB lista en:', dbPath());

// smoke test: insertar, leer, y limpiar
superbidUpsert({ placa: 'TEST123', subasta: '23º SUBASTA RIMAC', loteUrl: 'https://x/lote', boletaUrl: 'https://x/TEST123.pdf', flags: { aseguradora: true, remate: false }, datos: { marca: 'TOYOTA' }, estado: 'abierta' });
boletaSave({ placa: 'TEST123', fuente: 'superbid', pdfPath: '/data/boletas/TEST123.pdf', propietario: 'ORILLAS STUDIO', fechaProp: '2025-12-23', afectaciones: 'NO REGISTRA', vigente: true, fechaBoleta: '2026-06-01' });
metaSet('ultimo_scan_at', new Date().toISOString());
metaSet('lotes_vistos', ['lote1', 'lote2']);

console.log('\n— smoke test —');
console.log('superbid TEST123 :', JSON.stringify(superbidLookup('TEST123')));
console.log('boleta   TEST123 :', JSON.stringify(boletaGet('TEST123')));
console.log('meta ultimo_scan :', metaGet('ultimo_scan_at'));
console.log('meta lotes_vistos:', JSON.stringify(metaGet('lotes_vistos')));
console.log('superbid count   :', superbidCount());

// limpiar datos de prueba
getDb().delete(schema.superbidIndex).where(eq(schema.superbidIndex.placa, 'TEST123')).run();
getDb().delete(schema.boletas).where(eq(schema.boletas.placa, 'TEST123')).run();
console.log('\n✓ tablas: superbid_index, boletas, pedidos, meta — operativas. Datos de prueba limpiados.');
process.exit(0);
