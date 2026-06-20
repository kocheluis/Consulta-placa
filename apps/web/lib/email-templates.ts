/**
 * Plantillas HTML de correo con la marca PlacaPe. HTML "email-safe": tablas,
 * estilos inline y fuentes de sistema (Gmail ignora <style> y bloquea SVG, por
 * eso el logo va como wordmark de texto). Colores = tokens del design system
 * (tailwind.config.ts). Puro: sin imports, devuelve strings.
 */

const C = {
  azul: '#14506B',
  azulDark: '#07222E',
  azulSoft: '#9FC0CC',
  teal: '#16B5A3',
  bg: '#F5F8FA',
  surface: '#FFFFFF',
  fg: '#0E1B22',
  muted: '#647884',
  border: '#D7DFE4',
  success: '#18994F', successBg: '#EFFBF3', successFg: '#137A45',
  warning: '#DA9211', warningBg: '#FEF8E9', warningFg: '#B8770A',
  danger: '#DD3B3B', dangerBg: '#FEF0F0', dangerFg: '#B82B2B',
} as const;

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

function wordmark(): string {
  return `<span style="font-family:${FONT};font-weight:800;font-size:22px;letter-spacing:-0.3px;color:${C.azul}">Placa<span style="color:${C.teal}">Pe</span></span>`;
}

/** Botón CTA (teal) email-safe. */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr>
    <td style="border-radius:12px;background:${C.teal}">
      <a href="${href}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${label}</a>
    </td></tr></table>`;
}

export interface EmailLayoutInput {
  preheader?: string;
  heading: string;
  bodyHtml: string;
}

/** Envoltura de marca: header con wordmark, contenido, footer azul-950. */
export function emailLayout({ preheader = '', heading, bodyHtml }: EmailLayoutInput): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:${C.bg}">
  <span style="display:none;font-size:1px;color:${C.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${C.surface};border:1px solid ${C.border};border-radius:16px;overflow:hidden">
        <tr><td style="padding:24px 32px 0 32px">${wordmark()}</td></tr>
        <tr><td style="padding:18px 32px 4px 32px">
          <h1 style="margin:0;font-family:${FONT};font-size:21px;line-height:1.3;font-weight:700;color:${C.fg}">${heading}</h1>
        </td></tr>
        <tr><td style="padding:8px 32px 28px 32px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.muted}">${bodyHtml}</td></tr>
        <tr><td style="background:${C.azulDark};padding:22px 32px">
          <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.azulSoft}">Información referencial de portales públicos oficiales del Perú. No constituye un certificado oficial.</p>
          <p style="margin:8px 0 0 0;font-family:${FONT};font-size:12px;color:#6E94A1">PlacaPe · Hecho en Perú · <a href="https://placape.pe" style="color:${C.azulSoft};text-decoration:none">placape.pe</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export type ScoreLevel = 'verde' | 'ambar' | 'rojo';

export interface ReportReadyInput {
  plate: string;
  reportUrl: string;
  tier?: 'BASIC' | 'PRO' | 'ULTRA';
  scoreOverall?: number; // 0-100
  scoreLevel?: ScoreLevel;
  scoreLabel?: string; // ej. "Riesgo bajo"
}

/** Correo "tu reporte está listo" (lo dispara la app al terminar la consulta). */
export function reportReadyEmail(input: ReportReadyInput): { subject: string; html: string } {
  const { plate, reportUrl, tier = 'BASIC', scoreOverall, scoreLevel, scoreLabel } = input;

  const p =
    scoreLevel === 'rojo'
      ? { bg: C.dangerBg, fg: C.dangerFg, dot: C.danger }
      : scoreLevel === 'ambar'
        ? { bg: C.warningBg, fg: C.warningFg, dot: C.warning }
        : { bg: C.successBg, fg: C.successFg, dot: C.success };

  const scoreBlock =
    typeof scoreOverall === 'number'
      ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 2px 0;background:${p.bg};border-radius:12px">
           <tr><td style="padding:14px 18px">
             <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.dot};vertical-align:middle"></span>
             <span style="font-family:${FONT};font-size:14px;font-weight:700;color:${p.fg};margin-left:8px;vertical-align:middle">${scoreLabel ?? 'Resultado'} · ${scoreOverall}/100</span>
           </td></tr></table>`
      : '';

  const html = emailLayout({
    preheader: `Tu reporte ${tier} de la placa ${plate} ya está listo.`,
    heading: `Tu reporte de la placa ${plate} está listo`,
    bodyHtml: `
      <p style="margin:0 0 6px 0">Ya procesamos tu consulta <strong style="color:${C.fg}">${tier}</strong> del vehículo con placa <strong style="color:${C.fg}">${plate}</strong>.</p>
      ${scoreBlock}
      <p style="margin:10px 0 0 0">Abre el reporte completo para ver identidad registral, SOAT, papeletas y más.</p>
      ${button(reportUrl, 'Ver mi reporte')}
      <p style="margin:0;font-size:13px;color:${C.muted}">Si el botón no funciona, copia este enlace:<br><a href="${reportUrl}" style="color:${C.azul}">${reportUrl}</a></p>`,
  });

  return { subject: `Tu reporte PlacaPe de la placa ${plate} está listo`, html };
}

/* ── Compras / pagos ─────────────────────────────────────────────── */

/** Formatea un monto: PEN → "S/ 15.90"; otra moneda → "USD 15.90". */
function money(amount: number, currency = 'PEN'): string {
  return currency === 'PEN' ? `S/ ${amount.toFixed(2)}` : `${currency} ${amount.toFixed(2)}`;
}

/** Tabla email-safe de pares clave/valor (recibo). */
function dataRows(rows: ReadonlyArray<readonly [string, string]>): string {
  const cell = (i: number) => (i ? `border-top:1px solid ${C.border};` : '');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px 0;border:1px solid ${C.border};border-radius:12px;border-collapse:separate">
    ${rows
      .map(
        ([k, v], i) => `<tr>
      <td style="padding:11px 16px;${cell(i)}font-family:${FONT};font-size:13px;color:${C.muted};width:40%">${k}</td>
      <td style="padding:11px 16px;${cell(i)}font-family:${FONT};font-size:14px;font-weight:600;color:${C.fg};text-align:right">${v}</td>
    </tr>`,
      )
      .join('')}
  </table>`;
}

export interface PurchasePaidInput {
  plate: string;
  tier: 'PRO' | 'ULTRA';
  amount: number;
  currency?: string;
  orderId: string;
  reportUrl: string;
}

/** Correo "pago confirmado · tu reporte está desbloqueado" (recibo + acceso). */
export function purchasePaidEmail(input: PurchasePaidInput): { subject: string; html: string } {
  const { plate, tier, amount, currency = 'PEN', orderId, reportUrl } = input;

  const badge = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:2px 0 12px 0;background:${C.successBg};border-radius:999px"><tr>
      <td style="padding:6px 14px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${C.success};vertical-align:middle"></span>
        <span style="font-family:${FONT};font-size:13px;font-weight:700;color:${C.successFg};margin-left:7px;vertical-align:middle">Pago confirmado</span>
      </td></tr></table>`;

  const html = emailLayout({
    preheader: `Recibimos tu pago. Tu reporte ${tier} de la placa ${plate} ya está desbloqueado.`,
    heading: `¡Listo! Tu reporte ${tier} está desbloqueado`,
    bodyHtml: `
      ${badge}
      <p style="margin:0 0 4px 0">Recibimos tu pago correctamente. Tu reporte <strong style="color:${C.fg}">${tier}</strong> de la placa <strong style="color:${C.fg}">${plate}</strong> ya está disponible con toda la información ampliada.</p>
      ${dataRows([
        ['Plan', tier],
        ['Placa', plate],
        ['Monto', money(amount, currency)],
        ['Referencia', orderId],
      ])}
      ${button(reportUrl, 'Ver mi reporte')}
      <p style="margin:0;font-size:13px;color:${C.muted}">Si el botón no funciona, copia este enlace:<br><a href="${reportUrl}" style="color:${C.azul}">${reportUrl}</a></p>`,
  });

  return { subject: `Pago confirmado · tu reporte PlacaPe de la placa ${plate}`, html };
}

export interface YapeReceivedInput {
  plate: string;
  tier: 'PRO' | 'ULTRA';
  amount: number;
  currency?: string;
  orderId: string;
  yapeNumber: string;
  yapeName?: string;
  reportUrl?: string;
}

/** Correo "recibimos tu pedido · completa tu pago con Yape" (instrucciones). */
export function yapeReceivedEmail(input: YapeReceivedInput): { subject: string; html: string } {
  const { plate, tier, amount, currency = 'PEN', orderId, yapeNumber, yapeName = 'PlacaPe', reportUrl } = input;

  const payBox = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 2px 0;background:${C.warningBg};border-radius:12px"><tr>
      <td style="padding:16px 18px;font-family:${FONT}">
        <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;color:${C.warningFg};text-transform:uppercase;letter-spacing:.5px">Termina tu pago con Yape</p>
        <p style="margin:0;font-size:15px;line-height:1.5;color:${C.fg}">Yapea <strong>${money(amount, currency)}</strong> al número<br><strong style="font-size:21px;letter-spacing:1px">${yapeNumber || '—'}</strong> <span style="color:${C.muted}">(${yapeName})</span></p>
      </td></tr></table>`;

  const html = emailLayout({
    preheader: `Recibimos tu pedido del reporte ${tier} de la placa ${plate}. Completa el pago con Yape.`,
    heading: `Recibimos tu pedido de la placa ${plate}`,
    bodyHtml: `
      <p style="margin:0 0 6px 0">Estás a un paso de desbloquear tu reporte <strong style="color:${C.fg}">${tier}</strong> de la placa <strong style="color:${C.fg}">${plate}</strong>.</p>
      ${payBox}
      <p style="margin:14px 0 4px 0">Importante: escribe esta <strong style="color:${C.fg}">referencia</strong> en el mensaje del Yape para identificar tu pago:</p>
      ${dataRows([
        ['Referencia', orderId],
        ['Plan', tier],
        ['Monto', money(amount, currency)],
      ])}
      <p style="margin:12px 0 0 0">Apenas confirmemos tu pago (normalmente en minutos, en horario de oficina) te avisaremos por correo y tu reporte quedará desbloqueado.</p>
      ${reportUrl ? button(reportUrl, 'Volver a mi reporte') : ''}`,
  });

  return { subject: `Tu pedido PlacaPe de la placa ${plate} · completa tu pago con Yape`, html };
}
