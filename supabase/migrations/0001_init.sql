-- PlacaPe · esquema inicial de cuentas en Supabase
-- Ejecuta este script en el SQL Editor de tu proyecto Supabase (una sola vez).

-- ── Tipos ────────────────────────────────────────────────────────────
do $$ begin
  create type public.tier as enum ('BASIC', 'PRO', 'ULTRA');
exception when duplicate_object then null;
end $$;

-- ── Tabla de perfiles (1:1 con auth.users) ───────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  tier        public.tier not null default 'BASIC',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- El usuario solo puede leer y actualizar su propio perfil.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- Nota: los INSERT los hace el trigger (security definer); el cliente no inserta.

-- ── El tier solo lo cambia el backend (service_role), nunca el cliente ─
-- Evita que un usuario se auto-otorgue PRO/ULTRA sin pagar.
create or replace function public.prevent_tier_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tier is distinct from old.tier and auth.role() <> 'service_role' then
    new.tier := old.tier;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_tier on public.profiles;
create trigger profiles_guard_tier
  before update on public.profiles
  for each row execute function public.prevent_tier_change();

-- ── Crea el perfil automáticamente al registrarse ────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Mantiene updated_at ──────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_touch_updated on public.profiles;
create trigger profiles_touch_updated
  before update on public.profiles
  for each row execute function public.touch_updated_at();
