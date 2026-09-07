# Runbook — Reconstruir el VPS del operador DESDE CERO

Para cuando el VPS se pierde (crédito vencido, proveedor caído, migración). Escrito tras la
pérdida del VPS de LightNode (sep-2026). **La arquitectura Modelo B hace al VPS descartable:**
los reportes publicados, la cola, las cuentas y la web viven en Supabase/Vercel/GitHub y NO se
pierden. Lo único que muere con el VPS: evidencias/capturas viejas (`/root/out`), perfiles de
Chrome (se re-siembran solos), métricas históricas de la consola y los toggles persistidos
(motor/memoria → se re-activan en 2 clics).

> Deploy normal sobre un VPS vivo → [vps-operador.md](vps-operador.md).

---

## 0 · ANTES de reconstruir: intenta recuperar la instancia

1. **Recarga el crédito** del proveedor y revisa si la instancia reaparece (algunos solo la
   SUSPENDEN un tiempo antes de destruirla).
2. Abre un **ticket de soporte** preguntando si pueden restaurarla (o si hay snapshot/backup).
3. Si vuelve → solo haz el deploy normal (`git pull` + build shared + `pm2 restart operador`)
   y salta el resto de este documento.

Si la instancia ya no existe, sigue.

## 1 · Aprovisionar el VPS nuevo

- **Specs mínimas**: 4 GB RAM (corren varios Chrome) · 2 vCPU · 40 GB disco · **Ubuntu 22.04+**.
- **Proveedor/región**: idealmente el MISMO de antes (comportamiento de red ya validado contra
  SUNARP). Ojo: FISE/MINEM bloquean IPs datacenter igual — para eso ya existe el relay del
  celular ([fise-relay-celular.md](fise-relay-celular.md)).
- Lado bueno del IP nuevo: los límites POR IP del SPRL (lockouts) arrancan de cero.

```bash
# Como root, primera conexión:
apt update && apt upgrade -y
apt install -y git curl wget unzip xvfb fonts-liberation
# Node 22 (NodeSource):
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm i -g pm2 tsx
# Chrome estable:
wget -qO /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt install -y /tmp/chrome.deb
# Swap de 2G (Chrome + OCR aprietan la RAM):
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Firewall: SSH + SOLO el puerto del relay FISE (la consola :3010 queda en loopback, via túnel SSH)
ufw allow OpenSSH && ufw allow 3011/tcp && ufw enable
```

## 2 · Código

```bash
cd /root
git clone https://github.com/kocheluis/Consulta-placa.git app
cd app
npm install
npm run build -w @app/shared     # CRÍTICO: el motor importa @app/shared desde dist/
mkdir -p /root/out /root/data
```

## 3 · Secretos: `/root/placape.env`

Copia la plantilla y llénala — **cada valor dice de dónde sale**:

```bash
cp /root/app/docs/placape.env.template /root/placape.env
nano /root/placape.env
chmod 600 /root/placape.env
```

Checklist de dónde recuperar cada secreto:

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (el service_role, NO el anon) |
| `CAPTCHA_API_KEY` | panel de CapSolver |
| `SPRL_USER/PASS` (y `_2`, `_3`) | tus cuentas SPRL (saintagain1, laurabravo, 3ª) |
| `OPERATOR_PREVIEW_TOKEN` | **cópialo de Vercel** (Settings → Env Vars) — debe COINCIDIR con la web; no lo regeneres |
| `WEB_REPORT_URL` | la URL base de la web (https://placape.pe) |
| `OPENAI_API_KEY/BASE_URL/MODEL` | los de la IA ULTRA que tenías |
| `SATT_DNI/CELULAR/CORREO` | identidad de respaldo del registro SATT (empresa) |
| `FISE_RELAY_TOKEN` | **genera uno nuevo**: `openssl rand -hex 16` → y actualízalo en el celular (paso 6) |

## 4 · Procesos pm2

`operator-server` y `sprl-keepalive` cargan `/root/placape.env` solos — pm2 no necesita env
(salvo `DISPLAY`, que va dentro del mismo archivo como `DISPLAY=:99`).

```bash
pm2 start "Xvfb :99 -screen 0 1366x900x24 -ac" --name xvfb
pm2 start "npx tsx packages/scrapers/src/operator-server.ts" --name operador --cwd /root/app --time
pm2 start "npx tsx packages/scrapers/src/sprl-keepalive.ts" --name sprl-keepalive --cwd /root/app --time
pm2 save
pm2 startup   # pega el comando que imprime (arranque tras reboot)
pm2 logs operador --lines 30   # debe decir "Cola: supabase · motor automático: APAGADO"
```

(Opcional: `superbid-delta` para el escaneo incremental de subastas — ver vps-operador.md.)

## 5 · Sesiones y toggles (primera corrida)

1. **Consola** por túnel SSH: `ssh -L 3010:127.0.0.1:3010 root@IP_NUEVA` → `http://127.0.0.1:3010`.
2. **Enciende el motor** y **🧠 Memoria [24h]** (los toggles persistidos murieron con el sqlite).
   El override de fuentes también murió → aplica el DEFAULT (todas las fuentes) — normalmente OK.
3. **Corre una placa de prueba** (una conocida, p. ej. CVC313). La primera corrida hace el
   login SPRL frío (1 por cuenta — NO reintentes seguido si falla: lockout POR IP) y siembra
   los perfiles de Chrome. Las siguientes reusarán sesión caliente.
4. Verifica en `pm2 logs operador`: `[historial-cont] heartbeat slot1 sesión=VIVA` (modo continuo).

## 6 · Re-apuntar el relay FISE (celular Termux)

El worker del celular apunta a la IP vieja. En el celular actualiza **IP nueva + token nuevo**
(`FISE_RELAY_TOKEN` del paso 3) siguiendo [fise-relay-celular.md](fise-relay-celular.md).
Verifica: `curl -s http://localhost:3010/api/fise-relay/status` y que el log diga
`[fise-relay] listener público en 0.0.0.0:3011`.

## 7 · Post-checks

- [ ] `curl -s localhost:3010 | head -c 60` → `<!doctype html>` (consola viva)
- [ ] Pedido de prueba desde la web (BASIC gratis) llega a `listo` y el reporte se ve en placape.pe
- [ ] Historial entrega títulos (SPRL) en una placa conocida
- [ ] `pm2 logs sprl-keepalive` → `VIVA` en los slots sembrados
- [ ] Correo/WhatsApp de entrega llegan (WEB_REPORT_URL + OPERATOR_PREVIEW_TOKEN correctos)
- [ ] FISE responde vía relay (placa GNV conocida, p. ej. M5U034)
- [ ] `pm2 save` corrido DESPUÉS de que todo esté online

## Qué se perdió y qué no (referencia)

| Qué | ¿Sobrevive? | Notas |
|---|---|---|
| Reportes publicados (clientes) | ✅ Supabase `reportes` | la web los sigue sirviendo aunque el VPS no exista |
| Cola/pedidos/compras/cuentas/cupo | ✅ Supabase | |
| Web + bot API | ✅ Vercel | |
| Código | ✅ GitHub | el VPS nunca fue fuente de verdad |
| Secretos (`placape.env`) | ❌ | se reconstruyen con el checklist de arriba |
| Evidencias/capturas (`/root/out`) | ❌ | los reportes siguen; la evidencia interna vieja se pierde |
| Perfiles Chrome (sesiones SPRL/clearance) | ❌ | se re-siembran solos en la 1ª corrida |
| Toggles consola (motor/memoria/override) | ❌ | re-activar en la consola (paso 5) |
| Métricas históricas de la consola | ❌ | derivaban de /root/out |
