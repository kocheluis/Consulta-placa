/**
 * Identificación de administradores. Un admin es un correo presente en la env
 * `ADMIN_EMAILS` (lista separada por comas). **Server-only**: `ADMIN_EMAILS` NO
 * lleva prefijo `NEXT_PUBLIC_`, por lo que nunca llega al cliente. Importar solo
 * desde server components / route handlers.
 *
 * Cutover a producción = solo definir `ADMIN_EMAILS` en el entorno (sin tocar
 * código). Ver [[consulta-placa-dev-prod-cutover]].
 */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** ¿Hay al menos un administrador configurado? */
export const hasAdmins = ADMIN_EMAILS.length > 0;

/** ¿Este correo pertenece a un administrador? */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
