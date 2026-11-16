-- PlacaPe · Planes nuevos (nov-2026): Básico gratis + reporte COMPLETO.
-- Ejecuta en el SQL Editor de Supabase, después de 0011_reportes_usuario.sql.
--
-- Modelo comercial:
--   · Básico: gratis (sin cambios).
--   · Completo = lo que antes eran Pro + Ultra juntos (todas las fuentes + IA + valorización). En la base
--     sigue siendo el nivel 'ULTRA' (así las compras, pedidos y el motor no cambian).
--   · Consulta individual: S/ 9.90 (compra por placa en `purchases`, como siempre).
--   · Paquetes MENSUALES: 20 consultas S/ 29.90 · 50 consultas S/ 49.90. Se piden por WhatsApp y el admin
--     los activa. Vencen a los 30 días y NO se acumulan: activar uno nuevo reemplaza al anterior.
--   · 1 reporte Completo GRATIS por cuenta (prueba), limitado por DISPOSITIVO para que crear muchas
--     cuentas no sirva para repetirla.

-- ── Paquete mensual en el perfil (se monta sobre el cupo de 0009) ─────
alter table public.profiles
  add column if not exists pack_name       text,
  add column if not exists pack_total      integer     not null default 0,   -- 0 = sin paquete (cupo clásico)
  add column if not exists pack_starts_at  timestamptz,
  add column if not exists pack_expires_at timestamptz;

-- El cliente NO puede auto-asignarse paquete (solo service_role). Extiende el guard de 0009.
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
    new.pack_name        := old.pack_name;
    new.pack_total       := old.pack_total;
    new.pack_starts_at   := old.pack_starts_at;
    new.pack_expires_at  := old.pack_expires_at;
  end if;
  return new;
end $$;

-- ── Prueba gratis del reporte Completo (1 por cuenta y por dispositivo) ─
-- Se registra quién la usó con TRES señales del dispositivo; si cualquiera ya aparece, no hay otra prueba:
--   device_id → cookie httpOnly de larga duración puesta por el servidor.
--   local_id  → id guardado en localStorage del navegador (sobrevive si borran solo las cookies).
--   fp_hash   → huella del navegador (pantalla, zona horaria, idioma, GPU, render de canvas…), hasheada.
-- La IP se guarda solo como referencia (redes compartidas → no se bloquea solo por IP).
create table if not exists public.trial_uses (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  placa      text not null,
  device_id  text,
  local_id   text,
  fp_hash    text,
  ip         text,
  created_at timestamptz not null default now()
);
create index if not exists trial_uses_device_idx on public.trial_uses (device_id);
create index if not exists trial_uses_local_idx  on public.trial_uses (local_id);
create index if not exists trial_uses_fp_idx     on public.trial_uses (fp_hash);
create index if not exists trial_uses_ip_idx     on public.trial_uses (ip, created_at);

alter table public.trial_uses enable row level security;
-- sin policies → solo service_role.

-- ── Activar un paquete a mano (si no usas el panel /admin/usuarios) ───
--   update public.profiles
--     set consulta_enabled = true, consulta_tier = 'ULTRA',
--         pack_name = '20 consultas', pack_total = 20,
--         pack_starts_at = now(), pack_expires_at = now() + interval '30 days',
--         quota_hour = 10, quota_day = 20, quota_week = 20
--     where email = 'cliente@ejemplo.com';
