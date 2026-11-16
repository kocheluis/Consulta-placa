/**
 * Planes comerciales (nov-2026) — FUENTE ÚNICA de nombres, precios y textos de los planes en la web.
 *   · Básico: gratis.
 *   · Completo (antes Pro + Ultra): todas las fuentes + análisis IA + valorización. En la base = nivel 'ULTRA'.
 *   · Consulta individual S/ 9.90 · Paquetes mensuales de 20 (S/ 29.90) y 50 (S/ 49.90) consultas Completo.
 *   · 1 reporte Completo gratis por cuenta (prueba, limitada por dispositivo).
 * Los paquetes se piden por WhatsApp y el admin los activa; vencen a los 30 días y no se acumulan.
 */
export const PRECIO_INDIVIDUAL = 9.9;

export interface Paquete {
  id: 'pack20' | 'pack50';
  consultas: number;
  precio: number;
}

export const PAQUETES: Paquete[] = [
  { id: 'pack20', consultas: 20, precio: 29.9 },
  { id: 'pack50', consultas: 50, precio: 49.9 },
];

export const PACK_DIAS = 30;

export const soles = (n: number): string => `S/ ${n.toFixed(2)}`;

/** Por consulta dentro del paquete (para mostrar el ahorro). */
export const solesPorConsulta = (p: Paquete): string => soles(p.precio / p.consultas);

/**
 * Enlace de WhatsApp para pedir un paquete. Número en NEXT_PUBLIC_WHATSAPP_NUMBER (solo dígitos, con
 * código de país, p. ej. 51987654321). Sin número configurado → correo de soporte como respaldo.
 */
export function pedirPorWhatsApp(mensaje: string): string {
  const num = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');
  if (num) return `https://wa.me/${num}?text=${encodeURIComponent(mensaje)}`;
  return `mailto:soporte@placape.pe?subject=${encodeURIComponent('Quiero un paquete de consultas')}&body=${encodeURIComponent(mensaje)}`;
}

export const mensajePaquete = (p: Paquete, email?: string | null): string =>
  `Hola PlacaPe, quiero el paquete de ${p.consultas} consultas (${soles(p.precio)} al mes).${email ? ` Mi cuenta: ${email}` : ''}`;
