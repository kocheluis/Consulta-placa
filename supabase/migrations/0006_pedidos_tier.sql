-- PlacaPe · 'tier' en pedidos → distingue el reporte GRATUITO del de PAGO.
-- Ejecuta en el SQL Editor de Supabase, después de 0005_reportes.sql.
--
-- BASIC  → consulta gratuita: el motor corre SOLO sunarp + sbs-soat + mtc-citv
--          (identidad + SOAT + revisión técnica). Sin SPRL/Síguelo ni el resto.
-- PRO/ULTRA → reporte de pago: el motor corre todas las fuentes (AUTO_SOURCES).
--
-- Default 'PRO' para no cambiar el comportamiento de los pedidos existentes/de pago.
alter table public.pedidos add column if not exists tier text not null default 'PRO';
