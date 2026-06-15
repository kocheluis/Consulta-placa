-- PlacaPe · compras de reportes (pago por reporte)
-- Ejecuta en el SQL Editor de Supabase, después de 0001_init.sql.
--
-- Modelo: cada compra desbloquea UN reporte (placa) a un nivel PRO/ULTRA para
-- un usuario. El webhook de IziPay (service_role) marca la compra como pagada;
-- el cliente solo puede LEER sus propias compras (RLS), nunca insertarlas/cambiarlas.

create table if not exists public.purchases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  plate        text not null,
  tier         public.tier not null,                       -- PRO | ULTRA
  amount       numeric(8, 2) not null,
  currency     text not null default 'PEN',
  status       text not null default 'pending'             -- pending | paid | failed
                 check (status in ('pending', 'paid', 'failed')),
  provider     text not null default 'izipay',
  provider_ref text,                                        -- id de transacción del proveedor
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);

create index if not exists purchases_user_plate_idx on public.purchases (user_id, plate);
create index if not exists purchases_status_idx on public.purchases (status);

alter table public.purchases enable row level security;

-- El usuario solo ve sus propias compras. INSERT/UPDATE pasan por service_role
-- (el checkout y el webhook lo usan server-side); el cliente no escribe aquí.
drop policy if exists "purchases_select_own" on public.purchases;
create policy "purchases_select_own" on public.purchases
  for select using (auth.uid() = user_id);
