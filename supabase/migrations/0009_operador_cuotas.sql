-- PlacaPe · Cuentas internas de OPERADOR con cupo de consultas (hora/día/semana).
-- Ejecuta en el SQL Editor de Supabase, después de 0008_pedidos_origin.sql.
--
-- Modelo: cuentas que el ADMIN habilita a mano (consulta_enabled=true) para consultar placas
-- con un tope por ventana de tiempo. CONVIVE con el pago por reporte (no lo toca). El nivel del
-- reporte que generan (PRO/ULTRA) y los cupos son POR CUENTA (editables). Nada de esto es público:
-- consulta_enabled=false por defecto → una cuenta nueva NO tiene este acceso hasta que la habilites.

-- ── Columnas de operador en profiles ─────────────────────────────────
alter table public.profiles
  add column if not exists consulta_enabled boolean     not null default false,
  add column if not exists quota_hour       integer     not null default 5,
  add column if not exists quota_day        integer     not null default 20,
  add column if not exists quota_week       integer     not null default 100,
  add column if not exists consulta_tier    public.tier not null default 'PRO';

-- ── El cliente NO puede auto-otorgarse acceso/cupos (solo service_role) ─
-- Extiende el guard existente (0001): revierte cambios a tier Y a los campos de operador.
create or replace function public.prevent_tier_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then
    new.tier             := old.tier;
    new.consulta_enabled := old.consulta_enabled;
    new.quota_hour       := old.quota_hour;
    new.quota_day        := old.quota_day;
    new.quota_week       := old.quota_week;
    new.consulta_tier    := old.consulta_tier;
  end if;
  return new;
end $$;

-- ── Registro de consultas (para contar el cupo) ──────────────────────
create table if not exists public.consulta_hits (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  placa      text,
  created_at timestamptz not null default now()
);
create index if not exists consulta_hits_user_time_idx on public.consulta_hits (user_id, created_at);

-- Solo el service_role (server-side) escribe/lee. RLS sin policies bloquea al resto.
alter table public.consulta_hits enable row level security;

-- ── Alta/edición de una cuenta operador (ejecútalo tú como admin) ─────
--   1) La persona crea su cuenta normal en la web (o la creas en Supabase Auth).
--   2) Habilítala y fija sus cupos:
--        update public.profiles
--          set consulta_enabled = true, consulta_tier = 'PRO',
--              quota_hour = 5, quota_day = 20, quota_week = 100
--          where email = 'operador@ejemplo.com';
--      (para reportes ULTRA: consulta_tier = 'ULTRA'. Ajusta los cupos por cuenta.)
--   3) Para quitarle el acceso:  set consulta_enabled = false  where email = '...';

-- (opcional) limpieza: delete from public.consulta_hits where created_at < now() - interval '8 days';
