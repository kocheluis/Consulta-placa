# Supabase (cuentas de usuario)

PlacaPe usa **Supabase** para autenticación y la base de datos de cuentas.
La web detecta Supabase por sus variables de entorno: si están presentes usa
Supabase Auth; si faltan, cae al backend de prueba (API Fastify).

## Puesta en marcha (3 pasos)

1. **Crea el proyecto** en https://supabase.com (región más cercana: South America / São Paulo).

2. **Carga el esquema**: abre *SQL Editor* y ejecuta el contenido de
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   Crea la tabla `profiles` (1:1 con `auth.users`), RLS, y triggers:
   - perfil automático al registrarse,
   - `tier` (BASIC/PRO/ULTRA) que **solo** puede cambiar el backend (`service_role`),
     nunca el cliente.

3. **Configura las llaves** (Project Settings → API):
   - En local: pégalas en [`apps/web/.env.local`](apps/web/.env.local)
     ```
     NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
     NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
     ```
   - En Vercel: Project → Settings → Environment Variables (Production + Preview).

   Reinicia `npm run dev` (o redeploy en Vercel) y el acceso pasará a Supabase.

## Recomendado para producción
- **Auth → Providers → Email**: deja activada la *confirmación por correo*
  (la UI ya maneja el estado "revisa tu correo"). Para pruebas rápidas en
  marcha blanca puedes desactivarla temporalmente.
- **Auth → URL Configuration**: agrega `https://consultavehicular.vercel.app`
  (y el dominio final `placape.pe`) a *Site URL* y *Redirect URLs*.
- **OAuth (Google/Apple)**: cuando los configures, los botones de la pantalla
  de acceso se cablean con `signInWithOAuth`.

## Cómo está integrado en el código
- [`apps/web/lib/supabase/config.ts`](apps/web/lib/supabase/config.ts) — lee envs, `isSupabaseConfigured`.
- [`apps/web/lib/supabase/client.ts`](apps/web/lib/supabase/client.ts) — cliente de navegador.
- [`apps/web/lib/supabase/server.ts`](apps/web/lib/supabase/server.ts) — cliente de servidor (cookies).
- [`apps/web/middleware.ts`](apps/web/middleware.ts) — refresca la sesión en cada request.
- [`apps/web/lib/account.ts`](apps/web/lib/account.ts) — **fachada** de cuentas (Supabase ↔ backend legado).
  Toda la UI (`/cuenta`) consume esta capa, no Supabase directamente.
