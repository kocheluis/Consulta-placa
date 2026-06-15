# Data Model: PlacaPe — Historial Vehicular por Placa

**Feature**: `001-consulta-placa-vehicular` | **Date**: 2026-06-12

> ⚠️ Modelo del backend de scraping (Prisma/Postgres). Las **cuentas** ahora viven en
> **Supabase** (`profiles` + `tier` BASIC/PRO/ULTRA, ver `supabase/migrations/0001_init.sql`)
> y el **score** (0–100, por concepto) en `packages/shared/src/score.ts`. Estado vigente:
> [estado-actual.md](./estado-actual.md).

Modelo de datos derivado de los Key Entities de la spec y las decisiones de research. Persistencia en PostgreSQL (Prisma); caché caliente en Redis.

---

## Enums

- **SourceId**: `SUNARP` | `SBS` | `APESEG`
- **SectionKind**: `REGISTRAL` | `SEGUROS` | `SINIESTRALIDAD` | `PAPELETAS` | `GNV` | `DEUDA_BANCARIA` | `PNP`
  - Disponibles en MVP: `REGISTRAL`, `SEGUROS`, `SINIESTRALIDAD`. El resto se renderiza como "Próximamente" (`COMING_SOON`).
- **SectionStatus**: `AVAILABLE` | `UNAVAILABLE` | `COMING_SOON` | `NOT_FOUND`
- **JobStatus**: `PENDING` | `RUNNING` | `PARTIAL` | `COMPLETED` | `FAILED`
- **ReportStatus**: `COMPLETE` | `PARTIAL`
- **DataRequestType**: `ACCESS` | `DELETION` | `RECTIFICATION` | `OPPOSITION`
- **DataRequestStatus**: `RECEIVED` | `IN_REVIEW` | `RESOLVED` | `REJECTED`

---

## Entidades persistidas (PostgreSQL / Prisma)

### Vehicle
Datos registrales no personales del vehículo (cacheables con TTL más largo).
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| plateNormalized | string (unique, index) | placa normalizada (sin guiones/espacios, mayúsculas) |
| plateDisplay | string | placa con formato legible |
| platePrevious | string? | placa anterior si la fuente la expone (FR-012) |
| brand | string? | marca |
| model | string? | modelo |
| year | int? | año |
| color | string? | color |
| serie | string? | número de serie |
| vin | string? | VIN |
| engineNumber | string? | número de motor |
| stolenAlert | boolean | anotación de robo (FR-011) |
| updatedAt | datetime | última actualización registral |

**Reglas**: `plateNormalized` cumple el patrón de placa peruana validado (ver `shared/plate.ts`). No contiene datos personales (el titular va en `OwnerRecord`).

### OwnerRecord
Nombre del titular — **dato personal**, retención minimizada (D7, FR-050).
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| vehicleId | uuid (FK → Vehicle) | |
| ownerName | string | dato personal SUNARP |
| capturedAt | datetime | momento de obtención |
| expiresAt | datetime | retención corta (≤ TTL registral); purgado automático tras vencer |

**Reglas**: No existe índice por `ownerName` (prohibida la búsqueda inversa por nombre, D7/D8). Un job de purga elimina filas con `expiresAt < now()` (SC-007). Relación 1-N histórica permitida pero solo se conserva el registro vigente no expirado.

### Report
Reporte consolidado de una placa en un momento dado.
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| vehicleId | uuid? (FK → Vehicle) | null si no se encontró el vehículo |
| plateNormalized | string (index) | |
| status | ReportStatus | COMPLETE / PARTIAL (FR-034) |
| generatedAt | datetime | |
| sections | SectionResult[] | relación 1-N |

### SectionResult
Bloque de datos atribuido a una fuente, con sello de fuente y fecha (FR-031).
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| reportId | uuid (FK → Report) | |
| kind | SectionKind | |
| source | SourceId? | null para secciones COMING_SOON |
| status | SectionStatus | |
| fetchedAt | datetime? | fecha/hora de obtención (FR-031) |
| payload | jsonb | contenido específico de la sección (ver formas abajo) |
| errorReason | string? | motivo si UNAVAILABLE |

### InsurancePolicy *(payload tipado de la sección SEGUROS)*
| Campo | Tipo | Notas |
|-------|------|-------|
| insurer | string? | aseguradora / AFOCAT (FR-021) |
| policyNumber | string? | número de póliza/certificado |
| validFrom | date? | |
| validTo | date? | |
| hasActiveSoat | boolean | SOAT/CAT vigente (FR-020) |

### SiniestroIndicator *(payload de la sección SINIESTRALIDAD)*
| Campo | Tipo | Notas |
|-------|------|-------|
| hasSiniestro | boolean | registra o no accidentes (FR-022) |
| periodYears | int | ventana disponible (ej. 5) |

### QueryJob
Unidad de trabajo de la cola (productor API ↔ worker).
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | == jobId expuesto al cliente |
| plateNormalized | string (index) | |
| status | JobStatus | |
| attempts | int | reintentos (FR-041) |
| createdAt | datetime | |
| completedAt | datetime? | |
| reportId | uuid? (FK → Report) | resultado cuando COMPLETED/PARTIAL |
| forceRefresh | boolean | ignora caché (FR-043) |
| origin | string | IP/hash de origen para rate-limit y auditoría |

### AuditLog
Registro de tratamiento de datos personales (FR-053).
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| plateNormalized | string (index) | |
| origin | string | IP/hash del solicitante |
| purpose | string | propósito declarado (consulta de verificación) |
| accessedOwnerData | boolean | si el reporte expuso nombre del titular |
| createdAt | datetime | |

### DataSubjectRequest
Solicitud relacionada con datos personales (FR-052).
| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid (PK) | |
| type | DataRequestType | |
| status | DataRequestStatus | |
| contactEmail | string | |
| plateOrSubject | string? | placa o referencia del titular |
| details | text? | |
| createdAt | datetime | |
| resolvedAt | datetime? | |

---

## Caché Redis (efímera)

| Clave | Valor | TTL |
|-------|-------|-----|
| `report:{plateNormalized}` | Report serializado (JSON) | min(TTL de sus secciones) |
| `section:{plateNormalized}:REGISTRAL` | SectionResult | ~7 días |
| `section:{plateNormalized}:SEGUROS` | SectionResult | ~24 h |
| `section:{plateNormalized}:SINIESTRALIDAD` | SectionResult | ~24 h |
| `ratelimit:{origin}` | contador | ventana de rate-limit |

`forceRefresh=true` invalida las claves de la placa antes de encolar (FR-043).

---

## Relaciones (resumen)

```text
Vehicle 1───N OwnerRecord        (dato personal, retención corta)
Vehicle 1───N Report
Report  1───N SectionResult
Report  1───1 QueryJob (opcional, vía reportId)
Vehicle / Report ──> AuditLog    (por placa, no FK estricta)
DataSubjectRequest                (independiente)
```

## Validación clave

- **Placa**: normalización y validación de formatos peruanos vigentes e históricos en `packages/shared/src/plate.ts` (FR-002). Rechazo previo a encolar.
- **Secciones MVP**: solo `REGISTRAL`, `SEGUROS`, `SINIESTRALIDAD` pueden tener `status=AVAILABLE`; las demás se fuerzan a `COMING_SOON` (FR-032).
- **Reporte parcial**: si alguna sección MVP queda `UNAVAILABLE`, `Report.status=PARTIAL` pero se entrega igual (FR-034, SC-006).
- **Sello obligatorio**: toda `SectionResult` con `status=AVAILABLE` debe tener `source` y `fetchedAt` no nulos (FR-031, SC-004).
- **Retención**: `OwnerRecord.expiresAt` siempre seteado; purga programada (SC-007).
