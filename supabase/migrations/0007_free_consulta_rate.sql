-- PlacaPe · rate-limit de la CONSULTA GRATUITA (anti-abuso por IP).
-- Ejecuta en el SQL Editor de Supabase, después de 0006_pedidos_tier.sql.
--
-- El endpoint /api/consulta-gratis registra cada hit y limita por IP/hora. Así, aunque
-- el dedup por placa evita re-correr una misma placa, nadie puede disparar muchas placas
-- nuevas y saturar el motor (cola serial, 1 vCPU).
create table if not exists public.free_consulta_hits (
  id         bigserial primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists free_consulta_hits_ip_time_idx on public.free_consulta_hits (ip, created_at);

-- Solo el service_role (server-side) escribe/lee. RLS sin policies bloquea a todos los demás.
alter table public.free_consulta_hits enable row level security;

-- (opcional) limpieza periódica: borrar hits de más de 7 días.
--   delete from public.free_consulta_hits where created_at < now() - interval '7 days';
