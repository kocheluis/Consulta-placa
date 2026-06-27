# Inventario de fuentes — qué dato entrega cada una (estado real)

**Actualizado:** 2026-06-27 · Audita el **motor operador vivo** (`packages/scrapers/src/operator/*`)
contra el catálogo de producto (`packages/shared/src/catalog.ts`).

> Propósito: revisar fuente por fuente qué se obtiene HOY, qué se desperdicia y
> qué solo está prometido, como base para optimizar. Donde discrepe con
> `report-architecture.md`, manda este documento (refleja el código al 2026-06-27).

## Leyenda de estado

| Estado | Significado |
|---|---|
| ✅ **VIVO** | El motor lo scrapea y el dato llega al reporte web. |
| 🟡 **VIVO degradado** | Se scrapea, pero el reporte tira la mayor parte del dato. |
| 🔵 **EXPERIMENTAL** | Funciona pero opt-in / cobertura parcial / sin validar en vivo. |
| 🟠 **DUPLICADO** | Dos parsers para la misma fuente: uno *inline* vivo y otro de directorio muerto. |
| 🔴 **HUÉRFANO** | Existe parser (contra fixtures), pero nadie del motor lo importa. Catálogo lo promete = "Próximamente". |

**Hallazgo transversal:** hay **dos universos de parsing que no se tocan**. El motor
vivo parsea *inline* dentro de `operator/sources.ts` (regex). Los parsers "ricos" de
directorio (`<fuente>/parser.ts`) se escribieron contra **fixtures HTML inventados**,
no contra el portal real, y solo los usa `pro-parsers.test.ts` o el `apps/worker`
muerto. Cablear una fuente huérfana = **construir el scraper real**, no solo importar el parser.

---

## A. Núcleo registral (SUNARP)

### 1. SUNARP · Identidad y titular — ✅ VIVO · BASIC
- **Portal:** `consultavehicular.sunarp.gob.pe` (CDP, Chrome real, Turnstile pasivo desde IP residencial).
- **Método:** SUNARP entrega los datos como **IMAGEN PNG** (anti-scrape) → se intercepta el JSON `getDatosVehiculo`, se guarda la imagen y se **OCR** (tesseract) + `parseSunarpOcr`.
- **Campos obtenidos** (`data`): `plateDisplay`, `platePrevious`, `brand`, `model`, `year`, `color`, `serie`, `vin`, `engineNumber`, `registralStatus`, `annotations`, `sede`, `stolenAlert` (derivado: regex robo/captura/requisitoria), `ownerName`.
- **Llega al reporte:** todo (sección REGISTRAL + `vehicle` + `owner`).
- **Se desperdicia / limita:**
  - Multi-propietario / copropiedad → se **concatenan en un único string** `ownerName` (no array, no conteo). El catálogo promete "N° de propietarios" pero no se separa.
  - `placaVigente` / `placa` se leen del OCR pero `VehicleData` no los tiene → descartados.
  - Calidad sujeta a OCR; si Turnstile pasivo no pasa, requiere intervención manual del operador.

### 2. SPRL + Síguelo · Historial registral — 🟡 VIVO degradado · (alimenta GRAVÁMENES, PRO)
- **Portales:** SUNARP (sede) → **SPRL** `sprl.sunarp.gob.pe` (login automático con `SPRL_USER`/`SPRL_PASS`, lista de títulos) → **Síguelo Plus** `sigueloplus.sunarp.gob.pe` (PDF de cada asiento, descifrado **AES-256-CBC**, passphrase hardcodeada).
- **Campos obtenidos** (muy ricos): `sede`, `vehiculo`, `titulos[]` (formato `AAAA-NNNNNN`), `timeline[]` de asientos, y `flags` agregadas `{aseguradora, remate, financiera, gravamen, embargo}`. Cada asiento (`AsientoRecord`): `tipo, anio, numero, titulo, partida, placa, acto, precio, montoPagado, formaPago, fechaPresentacion, fechaAsiento, participantes, documentos[] (documento/funcionario/fecha), flags`.
- **Llega al reporte:** ⚠ **solo** `flags.gravamen || flags.embargo` → un booleano `hasLiens` en GRAVÁMENES.
- **Se desperdicia (LA MAYOR PÉRDIDA DE VALOR):** `timeline` completa (historial de transferencias), `titulos[]`, **precios históricos** (vía Síguelo), `participantes` (compradores/vendedores), `documentos`/notarios, y las flags `aseguradora / remate / financiera`. Es la fuente más cara de operar (login + descifrado) y se conserva ~el 5% del dato. **No existe sección de catálogo para timeline/precios.**

---

## B. Seguros

### 3. APESEG · SOAT — 🟠 DUPLICADO (inline vivo) · BASIC
- **Portal:** `apeseg.org.pe/consultas-soat` (iframe, **captcha imagen** vía CapSolver). Marcada "flaky/redundante con SBS".
- **Campos obtenidos** (inline `parseApesegSoat`): `compania, estado, inicio, fin, certificado, uso, clase, tipo`.
- **Llega al reporte:** SEGUROS (fuente **preferida** sobre SBS) → `hasActiveSoat, insurer, validFrom, validTo, certificate, use, vehicleClass, policyType`. `policyNumber` siempre null.
- **Duplicación:** `apeseg/parser.ts` (directorio, 9 campos, con test propio) está **muerto** — solo lo usa `apps/worker`. El inline vivo cubre lo mismo por regex.

### 4. SBS · SOAT + siniestralidad — 🟠 DUPLICADO (inline vivo) · PRO
- **Portal:** `servicios.sbs.gob.pe/reportesoat` (**reCAPTCHA v3** vía CapSolver).
- **Campos obtenidos** (inline): `accidentes` (n° últimos 5 años), `compania`, `detalle` (600 chars).
- **Llega al reporte:** SINIESTRALIDAD (`hasSiniestro = accidentes>0`) + SEGUROS **solo como fallback** si APESEG falló (solo `insurer`; vigencia/póliza quedan null).
- **Se desperdicia:** `detalle`. **Duplicación:** `sbs/parser.ts` (directorio, con test) solo lo usa `apps/worker` muerto.

---

## C. Papeletas e infracciones

### 5. SAT Lima · Papeletas — 🟡 VIVO degradado · PRO
- **Portal:** `sat.gob.pe/VirtualSAT` papeletas (**reCAPTCHA v2**, frames anidados).
- **Campos obtenidos:** solo flag `ENCONTRADO/SIN_REGISTRO` + `texto` (600 chars con el detalle/montos reales).
- **Llega al reporte:** un `PapeletaItem` genérico `{type:'Infracciones Lima', amount:0, status:'PENDIENTE'}`.
- **Se desperdicia:** ⚠ el `texto` con **los montos reales** → el importe Lima siempre queda en **0**; `pendingAmount` del reporte solo refleja Callao.

### 6. Callao · Papeletas — ✅ VIVO · PRO
- **Portal:** `pagopapeletascallao.pe` (**captcha imagen** inline).
- **Campos obtenidos:** `total` (S/.).
- **Llega al reporte:** PAPELETAS `pendingAmount` + item (si > 0). Nota: no está como fuente en el catálogo, pero alimenta PAPELETAS.

### 7. SUTRAN · Papeletas de carretera (cinemómetro) — 🔴 HUÉRFANO · PRO (prometido)
- **Parser dir** (`sutran/parser.ts`, contra fixture): `total`, `pendingAmount`, `items[]{type:'Exceso de velocidad', entity:'SUTRAN', date, amount, status}`.
- **Estado:** sin scraper real; nadie del motor lo importa. El reporte **nunca** emite SUTRAN.

---

## D. Legal (captura / gravámenes)

### 8. SAT Lima · Orden de captura — ✅ VIVO · PRO
- **Portal:** `sat.gob.pe/VirtualSAT/modulos/Capturas.aspx` (**captcha imagen**).
- **Campos obtenidos:** `ordenDeCaptura` (bool), `detalle` (frase oficial).
- **Llega al reporte:** CAPTURA (`hasCapture`, `detail`). Señal legal de alta jerarquía.

### 9. SIGM · Gravámenes / prendas — 🔴 HUÉRFANO · PRO (parcial)
- **Parser dir** (`sigm/parser.ts`, contra fixture): `hasLiens, total, items[]{type:'Garantía mobiliaria', creditor, amount, date, status}`.
- **Estado:** sin scraper real. La sección GRAVÁMENES del reporte **sí sale**, pero derivada de las **flags de HISTORIAL** (booleano `hasLiens`), **sin acreedor, sin monto, sin detalle**. El parser rico SIGM queda sin usar.

---

## E. Revisión técnica / uso

### 10. MTC · Revisión técnica (CITV) — 🟠 DUPLICADO (inline vivo) · PRO
- **Portal:** `portal.mtc.gob.pe/reportedgtt` CITV (**captcha imagen**, responde por alert).
- **Campos obtenidos** (inline `parseMtcCerts`): `certificados[]{nroCertificado, vigenteDesde, vigenteHasta, resultado, estado(VIGENTE/VENCIDO)}`, `observaciones`, `lunasPolarizadas`.
- **Llega al reporte:** REVISION_TECNICA con **solo `certificados[0]`** → `lastInspection, validUntil, result, status`.
- **Se desperdicia:** `observaciones`, `lunasPolarizadas` (señal útil), `nroCertificado`, y todos los certificados salvo el primero. **Odómetro (ULTRA) no se extrae** aunque el CITV podría tener kilometraje.
- **Duplicación:** `mtc/parser.ts` (directorio) muerto.

### 11. ATU · Uso como taxi / transporte — 🔴 HUÉRFANO · PRO (prometido)
- **Parser dir** (`atu/parser.ts`, contra fixture): `isPublicTransport`, `modality`, `detail`.
- **Estado:** sin scraper real; el reporte nunca emite TRANSPORTE.

---

## F. Multas electorales

### 12. ONPE · Multas electorales — 🔴 HUÉRFANO · PRO (por DNI, prometido)
- **Parser dir** (`onpe/parser.ts`, contra fixture): `hasFine`, `amount`, `detail`.
- **Estado:** sin scraper real. Es **por DNI** (no por placa), requiere consentimiento del titular. Nunca conectado.

---

## G. Subastas / siniestro (señal *leading*)

### 13. Superbid + VMC · ¿en subasta? — 🔵 EXPERIMENTAL · (alimenta SINIESTRALIDAD)
- **Cómo se puebla:** scans **HTTP/API puros (sin navegador)** — `superbid-scan.ts` (API `offer-query.superbid.net`, solo categoría Autos y Motos, **no pesados**) y `vmc-scan.ts` (canal Pacífico siniestrados/recuperados). Cadencia **diaria documentada pero el cron NO está versionado** (manual en VPS).
- **Índice `superbid_index` (SQLite)** por `(placa, fuente)`: `subasta, loteUrl, boletaUrl, flags{aseguradora,remate,siniestro,recuperado}, datos{marca,modelo,anio,color,basePrice,fechas…}, estado(abierta/cerrada), vistoAt, cerradoAt`.
- **Consulta en vivo:** `superbidLookup(plate)` = lookup **instantáneo en DB** (no toca red), devuelve la mejor fila (abierta > cerrada, más reciente).
- **Llega al reporte:** ⚠ solo `flags.siniestro || flags.aseguradora` → contribuye al booleano SINIESTRALIDAD.
- **Se desperdicia:** `subasta` (nombre/lote), `estado`, `fuente`, `boletaUrl` (la boleta SUNARP gratis), `flags.remate/financiera`. El usuario nunca ve "está en subasta X".
- **Limitaciones:** cobertura parcial (solo lotes con placa indexable; Superbid sin camiones); señal **direccional, no probatoria**; `SIN_REGISTRO` ≠ "sin siniestro".
- **Anexos:** `buscarSuperbid` (live, Chrome, ~30 min) está **fuera del camino de producción**. Tabla `boletas` (propietario/`fechaProp`/`vigente`/`fechaBoleta`) para cruce dueño-boleta vs dueño-actual: **no implementado en el reporte**.

---

## H. ULTRA — no construido

| Sección | Fuente prevista | Estado |
|---|---|---|
| Odómetro | MTC (kilometraje) | 🔴 Vacío (no se extrae del CITV) |
| Valorización de mercado | Neoauto, Mercado Libre, Autocosmos, Facebook | 🔴 Vacío (sin integración; irónicamente los precios de Síguelo se tiran) |
| Análisis con IA | (todo el reporte) | 🔴 Vacío |

---

## Resumen: catálogo (13 secciones) vs realidad

| Sección catálogo | Tier | Fuente | Estado real |
|---|---|---|---|
| Identidad | BASIC | SUNARP | ✅ VIVO |
| Propietario(s) | BASIC | SUNARP | 🟡 1 string, sin separar/contar |
| SOAT | BASIC | APESEG | ✅ VIVO (🟠 parser dir duplicado) |
| Siniestralidad | PRO | SBS (+Superbid) | ✅ booleano |
| Papeletas | PRO | SAT, SUTRAN | 🟡 Callao con monto; Lima sin monto; SUTRAN 🔴 |
| Revisión técnica | PRO | MTC | ✅ (🟡 tira observaciones/lunas) |
| Orden de captura | PRO | SAT | ✅ VIVO |
| Transporte (taxi) | PRO | ATU | ✅ VIVO (scraper `runAtu`, selectores por validar en vivo) |
| Gravámenes | PRO | SIGM, SUNARP | ✅ con detalle (acreedor/monto/fecha) desde asientos del HISTORIAL |
| Multas electorales | PRO | ONPE | ❌ BLOQUEADO (es por DNI, no por placa) |
| Odómetro | ULTRA | MTC | 🔴 no construido |
| Valorización | ULTRA | portales precio | 🔴 no construido |
| Análisis IA | ULTRA | — | 🔴 no construido |

## Oportunidades de optimización (prioridad sugerida)

### ✅ Hecho (2026-06-27)

1. **HISTORIAL rescatado**: nueva sección `HISTORIAL` (PRO) con timeline de asientos
   (fecha, acto, precio, partes, título), conteo de transferencias y flags
   aseguradora/remate/financiera. Tipos en `report.ts`, mapeo en `report-transform.ts`,
   `HistorialBody` en la web. Además las flags aseguradora/remate del historial ahora
   alimentan SINIESTRALIDAD (señal dura).
2. **SAT papeletas con monto**: `runSatPapeletas` parsea importes (`montoTotal`/`count`);
   el reporte suma Lima + Callao en `pendingAmount`.
3. **MTC**: `RevisionTecnica` ahora expone `certificate`, `observaciones` y
   `lunasPolarizadas` (con alerta visual de lunas en la web).
4. **Superbid visible**: `SiniestroIndicator.auction` lleva `subasta/estado/fuente/tipo/boletaUrl`;
   la web muestra la subasta y enlaza la boleta del lote.
5. **Catálogo honesto**: campo `comingSoon` en `SECTION_CATALOG`. Las fuentes no
   conectadas (transporte/ATU, multas_electorales/ONPE, odómetro, valorización, IA)
   se muestran como "Próximamente" y **ya NO se ofrecen como upsell de pago**.

### Scrapers huérfanos — resultado (2026-06-27)

De las 4 "huérfanas", solo **2 son consultables por placa**; las otras 2 exigen el
**DNI del propietario**, que no obtenemos por placa.

| Fuente | Resultado | Detalle |
|---|---|---|
| **ATU** (taxi) | ✅ **Construido** | `runAtu` en `operator/sources.ts`, cableado en `index.ts` (default), mapeado a TRANSPORTE + `TransporteBody`. Portal real: `soluciones.atu.gob.pe/ConsultaVehiculo` (placa + captcha imagen). **Selectores por validar en vivo** (operador). |
| **SIGM** (gravámenes) | ✅ **Resuelto sin scraper aparte** | No existe portal libre por placa; el detalle (acreedor/monto/fecha) se extrae de los **asientos del HISTORIAL** que ya bajamos (SPRL+Síguelo) → `GravamenItem[]` poblado. |
| **SUTRAN** (cinemómetro) | ❌ **Bloqueado por placa** | El portal exige **placa + DNI del propietario** (el "código de verificación" es el CUI del DNI). Sin el DNI no se puede. Opción: feature opt-in "verificación del vendedor" pidiendo DNI + consentimiento. |
| **ONPE/JNE** (multas electorales) | ❌ **Imposible por placa** | Es `multas.jne.gob.pe`, **por DNI**, multa personal que NO se hereda con el vehículo. Solo como verificación opt-in del vendedor (DNI + consentimiento). |

### ⏳ Pendiente

- **Validar ATU en vivo**: correr una placa de taxi conocida y ajustar selectores
  (`runAtu` está escrito a ciegas contra el DOM real; el captcha podría ser reCAPTCHA
  en vez de imagen).
- **SUTRAN/ONPE como opt-in del vendedor**: construir un flujo que capture el DNI del
  titular con consentimiento (ambas multas son por DNI, no por placa).
- **Consolidar duplicados** (SAT/MTC/SBS/APESEG inline vs directorio): el parser de
  directorio es más rico en varios casos — cablearlo al motor o borrarlo.
- **Versionar el cron** de los scans Superbid/VMC (hoy manual → el índice envejece).
- **SUNARP multi-propietario**: separar/contar titulares (hoy se juntan en un string).
- **SAT papeletas**: el `montoTotal` es best-effort (suma de importes del texto);
  validar con una placa con papeletas reales.
