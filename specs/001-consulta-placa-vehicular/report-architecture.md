# Arquitectura de información del reporte — PlacaPe

**Feature:** `001-consulta-placa-vehicular` · **Actualizado:** junio 2026

Define qué muestra cada **nivel** (tier) y, por **sección**, de qué **fuente** sale,
a qué **concepto de score** aporta y dónde vive su dato. Es el contrato que alinea
**scrapers ↔ score ↔ UI**. Codificado en
[`packages/shared/src/catalog.ts`](../../packages/shared/src/catalog.ts) (`SECTION_CATALOG`).

> Modelo de niveles confirmado por el dueño del producto (jun-2026), validado con la
> salida real de los portales.

## Niveles

| Nivel | Precio | Qué entrega |
|------|--------|-------------|
| **BASIC** | Gratis | **SUNARP Consulta Vehicular** + **APESEG SOAT** (solo estas 2 fuentes). |
| **PRO** | S/ 15.90 | Todo lo demás: SBS, SAT, MTC, SUTRAN, ATU, ONPE, gravámenes — **+ score 0–100**. |
| **ULTRA** | S/ 19.90 | PRO **+ valorización de mercado + análisis con IA + análisis de odómetro**. |

## Secciones (SECTION_CATALOG)

| Sección | Tier | Fuente(s) | Concepto score | Estado del dato |
|---|---|---|---|---|
| Identidad del vehículo | BASIC | SUNARP | LEGAL | conectable (scraper SUNARP) |
| Propietario(s) | BASIC | SUNARP | LEGAL | conectable (SUNARP) |
| SOAT | BASIC | APESEG | INSURANCE | conectable (scraper APESEG) |
| Siniestralidad | PRO | SBS | INSURANCE | conectable (scraper SBS) |
| Papeletas e infracciones | PRO | SAT + SUTRAN | DEBTS | por conectar |
| Revisión técnica | PRO | MTC | USAGE | por conectar |
| Orden de captura | PRO | SAT | LEGAL | por conectar |
| Uso como taxi/transporte | PRO | ATU | USAGE | por conectar |
| Gravámenes / prendas | PRO | SUNARP | LEGAL | por conectar |
| Multas electorales | PRO | ONPE (por DNI, consentido) | DEBTS | por conectar |
| Análisis de odómetro | ULTRA | MTC (RT histórica) | USAGE | por conectar |
| Valorización de mercado | ULTRA | Neoauto, MercadoLibre, Autocosmos, Facebook | — | por conectar |
| Análisis con IA | ULTRA | (deriva de todo) | — | por conectar |

## Campos por fuente (los "inputs")

**SUNARP Consulta Vehicular** → `VehicleData` (+ `OwnerInfo`):
`nº placa, nº serie, nº VIN, nº motor, color, marca, modelo, placa vigente,
placa anterior, estado (EN CIRCULACION), anotaciones (NINGUNA), sede (LIMA),
año de modelo, propietario(s), alerta de robo`.

**APESEG SOAT** → `InsurancePolicy`:
`compañía, estado (VIGENTE), inicio, fin, certificado, uso (PARTICULAR),
clase (CAMIONETA SUV/RURAL), tipo (DIGITAL), nº póliza`.

> Los tipos en `packages/shared/src/report.ts` ya incluyen estos campos (los nuevos como
> opcionales). Los **parsers** (`packages/scrapers`) se completan al verificar en vivo
> cada portal (SUNARP/SBS necesitan CapSolver para el CAPTCHA).

## Comportamiento de la UI (`/reporte/[placa]`)

La página **itera `SECTION_CATALOG`** y por cada sección:
- **dato disponible** → lo muestra (con su fuente y fecha);
- **fuente aún no conectada** (mismo tier) → "Próximamente";
- **tier superior al del usuario** → candado **"Mejora a Pro/Ultra"** (→ `/planes`).

Hoy, sin pago, el reporte opera en **BASIC**: muestra identidad/propietarios/SOAT con
datos y bloquea PRO/ULTRA. El **score** se calcula con lo disponible (robo + SOAT en
BASIC) y **no penaliza** lo que falta (queda `UNKNOWN`). Cuando el pago suba el `tier`
en Supabase (`profiles.tier`), se desbloquean las secciones correspondientes.

## Pendiente para datos reales
1. **CapSolver** → SUNARP (Turnstile) y SBS (reCAPTCHA v2): habilita BASIC real + siniestralidad.
2. Conectar parsers de SAT/MTC/SUTRAN/ATU/ONPE (PRO) y marketplaces (ULTRA).
3. Enforcement del `tier` en el backend (no devolver datos PRO/ULTRA a BASIC).
