import { z } from 'zod';
import { isValidPlate } from './plate.js';

/** Request de POST /consultas */
export const ConsultaRequestSchema = z.object({
  placa: z
    .string()
    .min(1, 'La placa es obligatoria')
    .refine(isValidPlate, { message: 'Formato de placa inválido' }),
  forceRefresh: z.boolean().optional().default(false),
});
export type ConsultaRequest = z.infer<typeof ConsultaRequestSchema>;

const SectionResultSchema = z.object({
  kind: z.enum([
    'REGISTRAL',
    'SEGUROS',
    'SINIESTRALIDAD',
    'PAPELETAS',
    'CAPTURA',
    'REVISION_TECNICA',
    'TRANSPORTE',
    'MULTAS_ELECTORALES',
    'GRAVAMENES',
    'GNV',
    'DEUDA_BANCARIA',
    'PNP',
  ]),
  source: z.enum(['SUNARP', 'SBS', 'APESEG', 'SAT', 'SUTRAN', 'MTC', 'ATU', 'ONPE', 'SIGM']).nullable(),
  status: z.enum(['AVAILABLE', 'UNAVAILABLE', 'COMING_SOON', 'NOT_FOUND']),
  fetchedAt: z.string().nullable(),
  errorReason: z.string().nullable().optional(),
  payload: z.unknown().optional(),
});

const OwnerSchema = z.object({ name: z.string(), note: z.string() }).nullable();

const VehicleSchema = z
  .object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
    year: z.number().nullable(),
    color: z.string().nullable(),
    serie: z.string().nullable(),
    vin: z.string().nullable(),
    engineNumber: z.string().nullable(),
    plateDisplay: z.string(),
    platePrevious: z.string().nullable(),
    stolenAlert: z.boolean(),
    registralStatus: z.string().nullable().optional(),
    annotations: z.string().nullable().optional(),
    sede: z.string().nullable().optional(),
    owner: OwnerSchema,
  })
  .nullable();

export const ReportSchema = z.object({
  id: z.string(),
  placa: z.string(),
  status: z.enum(['COMPLETE', 'PARTIAL']),
  generatedAt: z.string(),
  disclaimer: z.string(),
  vehicle: VehicleSchema,
  sections: z.array(SectionResultSchema),
});
export type ReportDTO = z.infer<typeof ReportSchema>;

/** Respuesta de POST /consultas y GET /consultas/{jobId} */
export const ConsultaResponseSchema = z.object({
  jobId: z.string().nullable(),
  status: z.enum(['PENDING', 'RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED']),
  cached: z.boolean(),
  report: ReportSchema.nullable(),
});
export type ConsultaResponse = z.infer<typeof ConsultaResponseSchema>;

/** Request de POST /solicitudes-datos */
export const DataSubjectRequestSchema = z.object({
  type: z.enum(['ACCESS', 'DELETION', 'RECTIFICATION', 'OPPOSITION']),
  contactEmail: z.string().email('Correo inválido'),
  plateOrSubject: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
});
export type DataSubjectRequestInput = z.infer<typeof DataSubjectRequestSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  retryAfter: z.number().nullable().optional(),
});
