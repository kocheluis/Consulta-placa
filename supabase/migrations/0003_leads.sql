-- PlacaPe · leads (captura de contacto en la pantalla intermedia del reporte)
-- Ejecuta en el SQL Editor de Supabase, después de 0002_purchases.sql.
--
-- Cada fila es un contacto que pidió ver un reporte. La escribe el route handler
-- /api/lead con service_role; NADIE la lee desde el cliente (sin policy de select →
-- RLS la bloquea por defecto). Datos de marketing, privados.

create table if not exists public.leads (
  id         uuid primary key default gen_random_uuid(),
  plate      text not null,
  email      text not null,
  whatsapp   text,                                          -- opcional (E.164 o local)
  source     text not null default 'report_gate',
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists leads_plate_idx on public.leads (plate);
create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_created_idx on public.leads (created_at desc);

-- RLS habilitado SIN policies → solo service_role (que la salta) puede leer/escribir.
alter table public.leads enable row level security;
