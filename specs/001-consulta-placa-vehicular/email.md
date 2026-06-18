# Correo / comunicaciones — PlacaPe

Arquitectura de correo del proyecto. Dos servicios distintos sobre el mismo
dominio `placape.pe` (DNS en **Cloudflare**):

| Necesidad | Proveedor | Estado |
|---|---|---|
| **Buzón humano** (`admin@`, `soporte@placape.pe`) — leer/escribir | **Zoho Mail** (free) | ⏳ pendiente de montar |
| **Transaccional** (la app envía: confirmación, reset, reportes, recibos) | **Resend** | ✅ dominio verificado |

> Por qué separados: enviar lo automático por el SMTP de un buzón limita a
> ~50-100/día y arruina la entregabilidad. El buzón es para humanos; Resend para
> la app. Conviven en el mismo dominio sin chocar.

## DNS (en Cloudflare)

Registros que habilitan el correo (además de los A/CNAME de Vercel para la web):

| Tipo | Name | Content | Prioridad | Servicio |
|---|---|---|---|---|
| TXT | `resend._domainkey` | `p=…` (DKIM, valor de Resend) | — | Resend |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 | Resend |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — | Resend |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | — | Resend |
| MX | `@` | `mx.zoho.com` (+ mx2, mx3) | 10/20/50 | Zoho *(futuro)* |
| TXT | `@` | `v=spf1 include:zoho.com ~all` | — | Zoho *(futuro)* |

Resend aísla su SPF/MX en el subdominio `send.placape.pe`, por eso **no** choca
con el MX de Zoho en la raíz.

## Resend (transaccional)

- **Región:** us-east-1 (North Virginia). Plan free: 100/día · 3.000/mes;
  Pro $20/mes = 50.000/mes sin tope diario. Estrategia: crecer dentro de Resend
  subiendo de plan, **no** migrar de proveedor.
- **Remitente:** `no-reply@placape.pe` · **Reply-To:** `soporte@placape.pe`.
- **Código:** [`apps/web/lib/email.ts`](../../apps/web/lib/email.ts) (envío vía REST,
  sin SDK) + [`apps/web/lib/email-templates.ts`](../../apps/web/lib/email-templates.ts)
  (plantillas HTML con la marca).

### Variables de entorno (server-only)

```
RESEND_API_KEY=re_xxxxxxxx        # Resend → API Keys (permiso Sending)
EMAIL_FROM=PlacaPe <no-reply@placape.pe>   # opcional, ya es el default
EMAIL_REPLY_TO=soporte@placape.pe          # opcional, ya es el default
```

`RESEND_API_KEY` es secreta: va en Vercel (Production + Preview) y en el worker,
**nunca** con prefijo `NEXT_PUBLIC_`. Si falta, `sendEmail()` devuelve
`{skipped:true}` y no rompe el flujo.

## Supabase Auth → Custom SMTP (confirmación / reset)

Los correos de cuenta los envía **Supabase**, no el código. Configurar una vez:

**Project Settings → Auth → SMTP Settings → Enable Custom SMTP**

| Campo | Valor |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) — alternativa `587` (TLS) |
| Username | `resend` |
| Password | la `RESEND_API_KEY` |
| Sender email | `no-reply@placape.pe` |
| Sender name | `PlacaPe` |

Esto resuelve el límite del SMTP de prueba de Supabase (que antes bloqueaba el
registro). También en **Auth → URL Configuration**: Site URL `https://placape.pe`
y Redirect URL `https://placape.pe/auth/confirmado`.

### Plantilla "Confirm signup" (pegar en Auth → Email Templates)

Usa la sintaxis Go de Supabase (`{{ .ConfirmationURL }}`). HTML email-safe con la
marca PlacaPe:

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8FA;padding:32px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #D7DFE4;border-radius:16px;overflow:hidden">
      <tr><td style="padding:24px 32px 0">
        <span style="font-weight:800;font-size:22px;letter-spacing:-.3px;color:#14506B">Placa<span style="color:#16B5A3">Pe</span></span>
      </td></tr>
      <tr><td style="padding:18px 32px 4px">
        <h1 style="margin:0;font-size:21px;line-height:1.3;color:#0E1B22">Confirma tu cuenta</h1>
      </td></tr>
      <tr><td style="padding:8px 32px 28px;font-size:15px;line-height:1.6;color:#647884">
        <p style="margin:0 0 4px">Gracias por crear tu cuenta en PlacaPe. Confirma tu correo para empezar a consultar el historial de cualquier vehículo del Perú.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr>
          <td style="border-radius:12px;background:#16B5A3">
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:12px">Confirmar mi cuenta</a>
          </td></tr></table>
        <p style="margin:0;font-size:13px;color:#647884">Si el botón no funciona, copia este enlace:<br><a href="{{ .ConfirmationURL }}" style="color:#14506B">{{ .ConfirmationURL }}</a></p>
        <p style="margin:16px 0 0;font-size:13px;color:#647884">Si no creaste esta cuenta, ignora este correo.</p>
      </td></tr>
      <tr><td style="background:#07222E;padding:22px 32px">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#9FC0CC">Información referencial de portales públicos oficiales del Perú. No constituye un certificado oficial.</p>
        <p style="margin:8px 0 0;font-size:12px;color:#6E94A1">PlacaPe · Hecho en Perú · <a href="https://placape.pe" style="color:#9FC0CC;text-decoration:none">placape.pe</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

## Zoho Mail (buzón humano) — pendiente

Plan **Forever Free** (1 usuario, 5 GB). Verificar dominio + MX/SPF/DKIM (tabla
DNS arriba) + crear `admin@placape.pe` / `soporte@placape.pe`. Sirve como
Reply-To de los correos de Resend para que un humano lea las respuestas.

## Checklist de puesta en marcha

- [x] Dominio `placape.pe` en Cloudflare, web en Vercel (Valid).
- [x] Resend: dominio verificado (DKIM/SPF).
- [ ] Resend: crear `RESEND_API_KEY` y ponerla en Vercel (Production + Preview).
- [ ] Supabase: Custom SMTP con Resend + URL Configuration a `placape.pe`.
- [ ] Supabase: pegar la plantilla "Confirm signup".
- [ ] Probar registro real → llega correo desde `@placape.pe`.
- [ ] Zoho: montar buzón `admin@` / `soporte@`.
- [ ] (Futuro) Cablear `reportReadyEmail()` cuando el pipeline de reportes esté desplegado.
