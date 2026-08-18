-- PlacaPe · BOT de WhatsApp (n8n): mapeo teléfono ↔ cuenta + estado de conversación.
-- Ejecuta en el SQL Editor de Supabase, después de 0009_cupo_consultas.sql.
--
-- Modelo: el bot atiende por WhatsApp. Un número puede estar VINCULADO a una cuenta Supabase
-- (→ usa su CUPO PRO/ULTRA) o quedar SIN VINCULAR (→ paga por reporte, Yape/IziPay). La vinculación
-- se hace con un código OTP (Fase 1). Esta tabla es la única pieza de identidad nueva: la columna
-- `whatsapp` ya existe en `pedidos`, y cupo/pago/reportes se reusan tal cual.
--
-- Toda la escritura/lectura la hace el service_role (server-side, /api/bot/*). RLS sin policies
-- bloquea al cliente — igual que consulta_hits (0009).

create table if not exists public.bot_users (
  phone       text primary key,                                        -- E.164 sin '+', p. ej. 51987654321
  user_id     uuid references auth.users (id) on delete set null,      -- cuenta vinculada (null = sin vincular)
  email       text,                                                    -- correo declarado (para OTP / entrega)
  verified    boolean     not null default false,                      -- ¿el número confirmó el OTP?
  otp_code    text,                                                    -- OTP de vinculación (hash SHA-256; efímero)
  otp_expires timestamptz,                                             -- caducidad del OTP
  otp_attempts integer    not null default 0,                          -- intentos fallidos de OTP (anti fuerza bruta)
  state       jsonb       not null default '{}'::jsonb,                -- estado de conversación del bot (n8n)
  last_placa  text,                                                    -- última placa consultada (contexto postventa)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists bot_users_user_idx on public.bot_users (user_id);

-- Solo el service_role (server-side) escribe/lee. RLS sin policies bloquea al resto.
alter table public.bot_users enable row level security;

-- ── Vincular un número a una cuenta a mano (para probar la Fase 0) ─────
--   1) La persona ya tiene cuenta en la web y cupo asignado (0009).
--   2) Vinculas su WhatsApp:
--        insert into public.bot_users (phone, user_id, email, verified)
--        select '51987654321', id, email, true from auth.users where email = 'usuario@ejemplo.com'
--        on conflict (phone) do update set user_id = excluded.user_id, verified = true, updated_at = now();
--   3) Para desvincular:  update public.bot_users set user_id = null, verified = false where phone = '51987654321';
