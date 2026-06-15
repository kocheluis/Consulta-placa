# API Contract: PlacaPe — Historial Vehicular

**Feature**: `001-consulta-placa-vehicular` | **Base path**: `/api/v1` | **Format**: JSON

> ⚠️ Contrato del backend de scraping (Fastify). **Auth ya no usa estos endpoints**: las
> cuentas son **Supabase Auth** (la web consume `apps/web/lib/account.ts`, no `/api/v1/auth/*`).
> Faltan endpoints de pago (IziPay) y de tier. Ver [estado-actual.md](../estado-actual.md).

API REST consumida por la web (Next.js) y, en fase posterior, por la app Expo (FR-061). Esquemas validados con Zod (compartidos en `packages/shared`). Versión OpenAPI completa en [openapi.yaml](./openapi.yaml).

---

## Modelo de interacción

1. Cliente envía la placa → `POST /consultas`.
2. Si hay **caché vigente**, la respuesta incluye el `report` directamente (`status: COMPLETED`, `cached: true`).
3. Si no, la respuesta trae `jobId` y `status: PENDING`; el cliente **hace polling** a `GET /consultas/{jobId}` hasta `COMPLETED` / `PARTIAL` / `FAILED`.

---

## Endpoints

### POST /api/v1/consultas
Crea una consulta (o devuelve el reporte cacheado).

**Request body**
```json
{ "placa": "ABC123", "forceRefresh": false }
```
- `placa` (string, requerido): se normaliza/valida server-side (FR-002). 400 si formato inválido.
- `forceRefresh` (boolean, opcional, default false): ignora caché (FR-043).

**Responses**
- `200 OK` (cache hit):
```json
{ "jobId": null, "status": "COMPLETED", "cached": true, "report": { /* Report */ } }
```
- `202 Accepted` (encolado):
```json
{ "jobId": "uuid", "status": "PENDING", "cached": false, "report": null }
```
- `400 Bad Request`: `{ "error": "INVALID_PLATE", "message": "..." }`
- `429 Too Many Requests`: rate-limit excedido (FR-003) → `{ "error": "RATE_LIMITED", "retryAfter": 60 }`

### GET /api/v1/consultas/{jobId}
Consulta el estado/resultado de un job.

**Responses**
- `200 OK`:
```json
{ "jobId": "uuid", "status": "RUNNING", "report": null }
```
```json
{ "jobId": "uuid", "status": "PARTIAL", "report": { /* Report */ } }
```
- `404 Not Found`: job inexistente o expirado.

### GET /api/v1/reportes/{placa}
Devuelve el último reporte cacheado/persistido para una placa (sin disparar scraping). Útil para enlaces compartibles.
- `200 OK`: `{ "report": { /* Report */ }, "ageSeconds": 3600 }`
- `404 Not Found`: sin reporte previo.

### POST /api/v1/solicitudes-datos
Registra una solicitud de datos personales del titular (FR-052).
```json
{ "type": "DELETION", "contactEmail": "x@y.pe", "plateOrSubject": "ABC123", "details": "..." }
```
- `201 Created`: `{ "id": "uuid", "status": "RECEIVED" }`

### GET /api/v1/legal/{doc}
Devuelve Términos (`terms`) o Política de Privacidad (`privacy`) (FR-051). `200 OK` con contenido; `404` si `doc` inválido.

### GET /api/v1/health
Health check del servicio y, opcionalmente, estado de cada scraper (para detectar portales caídos). `200 OK`.

---

## Esquema de respuesta `Report`

```json
{
  "id": "uuid",
  "placa": "ABC-123",
  "status": "PARTIAL",
  "generatedAt": "2026-06-12T10:00:00Z",
  "disclaimer": "Información referencial obtenida de portales públicos oficiales...",
  "vehicle": {
    "brand": "Toyota", "model": "Yaris", "year": 2019, "color": "Plomo",
    "serie": "...", "vin": "...", "engineNumber": "...",
    "plateDisplay": "ABC-123", "platePrevious": null,
    "stolenAlert": false,
    "owner": { "name": "JUAN PEREZ", "note": "Dato registral público — uso referencial" }
  },
  "sections": [
    {
      "kind": "REGISTRAL", "source": "SUNARP", "status": "AVAILABLE",
      "fetchedAt": "2026-06-12T09:59:00Z", "payload": { /* campos registrales */ }
    },
    {
      "kind": "SEGUROS", "source": "SBS", "status": "AVAILABLE",
      "fetchedAt": "2026-06-12T09:59:30Z",
      "payload": { "hasActiveSoat": true, "insurer": "...", "policyNumber": "...", "validFrom": "...", "validTo": "..." }
    },
    {
      "kind": "SINIESTRALIDAD", "source": "SBS", "status": "UNAVAILABLE",
      "fetchedAt": null, "errorReason": "SOURCE_TIMEOUT"
    },
    { "kind": "PAPELETAS", "source": null, "status": "COMING_SOON" },
    { "kind": "GNV", "source": null, "status": "COMING_SOON" },
    { "kind": "DEUDA_BANCARIA", "source": null, "status": "COMING_SOON" },
    { "kind": "PNP", "source": null, "status": "COMING_SOON" }
  ]
}
```

**Invariantes del contrato**
- Toda sección `AVAILABLE` incluye `source` y `fetchedAt` no nulos (FR-031, SC-004).
- El reporte siempre incluye `disclaimer` (FR-033, SC-005) y las secciones `COMING_SOON` (FR-032).
- `status: PARTIAL` cuando ≥1 sección MVP quedó `UNAVAILABLE`, pero el resto se entrega (FR-034).
- `owner.name` puede omitirse según política de minimización; el cliente nunca debe asumir que existe.
