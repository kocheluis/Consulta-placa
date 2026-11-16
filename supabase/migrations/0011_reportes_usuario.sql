-- PlacaPe · reportes_usuario (historial de reportes de cada usuario, CONGELADO y por 30 días)
-- Ejecuta en el SQL Editor de Supabase, después de 0010_bot_users.sql.
--
-- `reportes` guarda UNA fila por placa y se sobrescribe en cada regeneración (es "el reporte vivo"
-- del vehículo). El historial del usuario, en cambio, debe mostrar EXACTAMENTE el reporte que obtuvo
-- cuando hizo la consulta, aunque después la placa se vuelva a consultar. Por eso, al entregar cada
-- pedido con usuario, el motor del VPS guarda aquí una COPIA inmutable (snapshot) con el nivel de ese
-- pedido. Vence a los 30 días: la web deja de mostrarla y el motor la borra.
--
-- Acceso: RLS sin policies (como `reportes`) → solo service_role. La web lo lee por route handlers
-- que validan la sesión y que el snapshot sea del usuario, y recortan por el `tier` guardado.

create table if not exists public.reportes_usuario (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  pedido_id   uuid unique,                                  -- 1 snapshot por pedido (idempotente)
  placa       text not null,
  tier        text not null check (tier in ('BASIC', 'PRO', 'ULTRA')),
  report      jsonb not null,                               -- el Report tal como se entregó
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days')
);

create index if not exists reportes_usuario_user_idx on public.reportes_usuario (user_id, created_at desc);
create index if not exists reportes_usuario_expires_idx on public.reportes_usuario (expires_at);

alter table public.reportes_usuario enable row level security;
-- sin policies → solo service_role.

-- Un snapshot es inmutable: nadie (ni service_role por error) cambia su contenido.
create or replace function public.reportes_usuario_inmutable() returns trigger
language plpgsql as $$
begin
  raise exception 'reportes_usuario es inmutable (solo insertar o borrar)';
end $$;

drop trigger if exists reportes_usuario_no_update on public.reportes_usuario;
create trigger reportes_usuario_no_update before update on public.reportes_usuario
  for each row execute function public.reportes_usuario_inmutable();
