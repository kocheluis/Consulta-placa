-- PlacaPe · reportes (el reporte generado, para que la web lo muestre)
-- Ejecuta en el SQL Editor de Supabase, después de 0004_pedidos.sql.
--
-- El motor del VPS, al terminar un pedido, publica aquí el `Report` normalizado (JSON
-- en la forma que renderiza la web). La web NO lee esta tabla directamente: lo hace por
-- el route handler /api/reporte/[placa] con service_role, que recorta las secciones por
-- encima del nivel pagado (paywall server-side). Por eso RLS queda habilitado SIN policies
-- (solo service_role accede). Una fila por placa (el reporte es del vehículo, no del usuario).

create table if not exists public.reportes (
  placa       text primary key,
  report      jsonb not null,                              -- el Report (vehículo + secciones)
  status      text not null default 'listo',               -- listo | generando | error
  user_id     uuid references auth.users (id) on delete set null,
  pedido_id   uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists reportes_user_idx on public.reportes (user_id);

alter table public.reportes enable row level security;
-- sin policies → solo service_role (la web accede vía route handler con control por compra).
