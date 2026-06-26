-- PlacaPe · pedidos (la COLA que conecta la web pública con el motor del VPS)
-- Ejecuta en el SQL Editor de Supabase, después de 0003_leads.sql.
--
-- Modelo B (broker): el cliente NUNCA toca el VPS. La web (server-side, service_role)
-- inserta el pedido cuando el pago se confirma; el motor del VPS lo jala por PostgREST
-- (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en el entorno del VPS) y actualiza su estado.
-- Contrato de estados: pendiente → procesando → listo|error → entregado.

create table if not exists public.pedidos (
  id          uuid primary key default gen_random_uuid(),
  placa       text not null,
  whatsapp    text,
  email       text,
  estado      text not null default 'pendiente',            -- pendiente|procesando|listo|error|entregado
  report_path text,                                          -- ruta/URL del reporte cuando está listo
  error       text,
  user_id     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,                                   -- cuando el motor empezó
  finished_at timestamptz                                    -- cuando terminó (listo/error)
);

-- El runner del VPS busca por estado + orden de llegada (FIFO).
create index if not exists pedidos_estado_creado_idx on public.pedidos (estado, created_at);
create index if not exists pedidos_user_idx on public.pedidos (user_id);

-- RLS: el motor usa service_role (salta RLS). El cliente logueado puede VER sus propios
-- pedidos (para seguir el estado en placape.pe), pero no crearlos ni modificarlos
-- (eso lo hace el server-side del checkout con service_role).
alter table public.pedidos enable row level security;

drop policy if exists "pedidos_select_own" on public.pedidos;
create policy "pedidos_select_own" on public.pedidos
  for select using (auth.uid() = user_id);
