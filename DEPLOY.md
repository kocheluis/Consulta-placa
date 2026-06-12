# Despliegue gratuito

La **versión gratuita (consulta guiada)** no necesita backend ni base de datos: son
páginas + enlaces a portales oficiales. Por eso se puede publicar **gratis** en Vercel.

## Opción recomendada: Vercel (gratis) — solo la web

### 1. Sube el repositorio a GitHub
```bash
git remote add origin https://github.com/TU_USUARIO/consulta-placa.git
git push -u origin master
```

### 2. Importa el proyecto en Vercel
1. Entra a https://vercel.com y crea una cuenta (gratis, con tu GitHub).
2. **Add New → Project →** importa el repositorio.
3. En la configuración del proyecto:
   - **Root Directory**: `apps/web`  ← importante (es un monorepo)
   - **Framework Preset**: Next.js (se autodetecta)
   - **Build Command**: `npm run build` (ya compila el paquete compartido primero)
   - **Environment Variables**: deja `NEXT_PUBLIC_PRO_ENABLED` **vacío** para el lanzamiento
     gratis (el reporte PRO aparecerá como "próximamente").
4. **Deploy**. En ~1 minuto tendrás la web en línea.

### 3. URL simple (enmascarar la de Vercel)
Vercel te da `https://<nombre-del-proyecto>.vercel.app`. Para una URL sencilla:

- **Más fácil (gratis):** en *Project → Settings → Domains*, cambia el subdominio a algo
  limpio, p. ej. **`consultaplaca.vercel.app`** o **`placaperu.vercel.app`**.
- **Subdominio propio gratis:** servicios como [is-a.dev](https://is-a.dev) o
  [js.org](https://js.org) dan subdominios gratis que apuntas a Vercel
  (p. ej. `consultaplaca.is-a.dev`).
- **Dominio propio (de pago, barato):** compra un `.com` (~US$ 10/año) o `.pe`
  (~US$ 12–40/año) en Namecheap/GoDaddy, y en Vercel *Domains* agrégalo. Vercel te da el
  DNS a configurar y el HTTPS es automático y gratis.

> Nota: "enmascarar" de verdad (mostrar una URL mientras se sirve otra) se hace con un
> **dominio propio apuntando a Vercel** (las opciones de arriba), no con un simple redirect.

## Más adelante: habilitar el reporte PRO (backend)

Cuando quieras el reporte automático, despliega también (todos con plan gratis):

| Componente | Servicio gratis |
|------------|-----------------|
| PostgreSQL | [Neon](https://neon.tech) o [Supabase](https://supabase.com) |
| Redis | [Upstash](https://upstash.com) |
| API (`apps/api`) | [Render](https://render.com) / [Railway](https://railway.app) / [Fly.io](https://fly.io) |
| Worker (`apps/worker`) | Render/Fly (necesita Chromium; usa el Dockerfile incluido) |

Luego en Vercel pon `NEXT_PUBLIC_API_URL=https://tu-api...` y `NEXT_PUBLIC_PRO_ENABLED=true`.
