# Seguridad — ConsultaPlaca

Resumen de la revisión de seguridad y medidas aplicadas. Última actualización: 2026-06-14.

## Superficie actual en producción

Lo desplegado hoy en Vercel es **solo la web estática** (consulta guiada + enlaces oficiales):
sin backend, sin base de datos, sin login, sin datos de usuarios. Superficie de ataque mínima.
El backend (API + cuentas + pagos) aún no está en producción.

## Medidas aplicadas (2026-06-14)

| # | Riesgo | Medida |
|---|--------|--------|
| 1 | Falsificación de tokens (JWT_SECRET por defecto) | La API **no arranca en producción** si `JWT_SECRET` falta o es < 16 chars |
| 2 | ReDoS en `fast-jwt` (crítico) | Actualizado `@fastify/jwt` a v10 (corrige la dependencia) |
| 3 | CORS abierto a cualquier origen | En producción solo se permiten los dominios de `WEB_ORIGIN` |
| 4 | Fuerza bruta de contraseñas | Rate-limit estricto (5/min) en `/auth/login` y `/auth/register` |
| 5 | Clickjacking / XSS / sniffing | Cabeceras de seguridad en la web: CSP, X-Frame-Options DENY, HSTS, nosniff, Referrer-Policy, Permissions-Policy |

## Controles ya existentes (verificados)

- Contraseñas con **bcrypt** (nunca en texto plano).
- **Prisma** parametrizado → sin inyección SQL.
- **Zod** valida todas las entradas (placa, email…).
- `isPro` **no es auto-asignable** en el registro → sin escalada de privilegios.
- Sin **SSRF**: los scrapers usan URLs fijas; la clave de CAPTCHA vive solo en el servidor.
- **Privacidad de PII**: nombre del propietario con retención corta + purga + auditoría + sin
  búsqueda inversa por nombre.
- `requirePro` revalida contra la BD en cada request.
- Enlaces externos con `rel="noopener noreferrer"`; sin `dangerouslySetInnerHTML` ni `eval`.
- `helmet` en la API; secretos fuera de git (`.env` ignorado).

## Pendiente (al desplegar el backend / a futuro)

- **Token en `localStorage`** (riesgo si hubiera XSS): migrar a cookie `httpOnly` al montar el
  backend. Mitigado hoy por CSP + ausencia de sinks de XSS.
- **Enumeración de cuentas**: el registro responde 409 si el correo existe (compromiso UX vs.
  privacidad; evaluar).
- **JWT de 7 días sin revocación**: considerar expiración corta + refresh token.
- **Política de contraseñas** más fuerte (longitud/complejidad).

## Vulnerabilidades de dependencias restantes (no afectan producción)

`npm audit` reporta vulnerabilidades en **esbuild/vitest** (runner de tests) y en el **postcss
interno de Next** (build). Son **solo de desarrollo/compilación**, no forman parte del runtime
servido a los usuarios. Su corrección exige cambios mayores (vitest 4 / next 9) sin beneficio de
seguridad en producción, por lo que se difieren hasta que el upstream las resuelva.

## Variables de entorno de seguridad (producción)

```
JWT_SECRET=<aleatorio, mín. 16 chars — p. ej. openssl rand -hex 32>
WEB_ORIGIN=https://tu-dominio-web
RATE_LIMIT_AUTH_PER_MINUTE=5
```
