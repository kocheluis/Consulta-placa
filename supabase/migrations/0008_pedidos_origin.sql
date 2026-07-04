-- PlacaPe · 'origin' en pedidos → distingue quién originó la consulta.
-- Ejecuta en el SQL Editor de Supabase, después de 0006_pedidos_tier.sql.
--
-- 'operador' → el operador lo creó desde la consola del VPS (pruebas/QA o atención manual).
-- 'servicio' → llegó desde la web pública (cliente).
--
-- Default 'servicio': los pedidos que crea la web NO envían este campo, así que caen en el
-- default; solo la consola del operador marca 'operador' explícitamente. Correr esta migración
-- ANTES de desplegar el motor nuevo (el enqueue de la consola ya manda `origin`).
alter table public.pedidos add column if not exists origin text not null default 'servicio';
