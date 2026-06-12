/**
 * Selectores de los portales oficiales, centralizados para poder ajustarlos en
 * un solo lugar cuando cambie el DOM.
 *
 * Valores REALES capturados con el script de descubrimiento (2026-06). Notas
 * importantes sobre la protección anti-bot real de cada portal:
 *  - SUNARP: Angular + Ant Design, protegido con **Cloudflare Turnstile**
 *    (cf-turnstile-response). NO es CAPTCHA de imagen → el OCR local no aplica;
 *    requiere un solver que soporte Turnstile (p. ej. CapSolver) o un navegador
 *    real que pase el desafío "managed".
 *  - SBS: ASP.NET WebForms (__VIEWSTATE/__EVENTVALIDATION) + **reCAPTCHA v3**
 *    (hdnReCaptchaV3, invisible y por reputación) → solver de pago.
 *  - APESEG: el formulario real vive en un IFRAME (webapp.apeseg.org.pe). Hay
 *    que conducir el contenido del iframe, no la página contenedora.
 */
export interface PortalSelectors {
  url: string;
  plateInput: string;
  submit: string;
  /** CAPTCHA de imagen (no aplica a estos portales actualmente). */
  captchaImage?: string;
  captchaInput?: string;
  /** Cloudflare Turnstile (SUNARP). */
  turnstileResponse?: string;
  /** reCAPTCHA (SBS): hidden + textarea g-recaptcha-response. */
  recaptchaResponse?: string;
  /** Frame del formulario real (APESEG). */
  iframe?: string;
  /** Contenedor del resultado, para esperar tras enviar. */
  resultReady?: string;
}

export const PORTAL_SELECTORS: Record<'sunarp' | 'sbs' | 'apeseg', PortalSelectors> = {
  sunarp: {
    url: 'https://consultavehicular.sunarp.gob.pe/',
    plateInput: '#nroPlaca',
    submit: 'button.btn-sunarp-green, button:has-text("Realizar Busqueda")',
    turnstileResponse: 'input[name="cf-turnstile-response"]',
    resultReady: '.resultado, .ant-card, nz-table',
  },
  sbs: {
    url: 'https://servicios.sbs.gob.pe/reportesoat/',
    plateInput: '#ctl00_MainBodyContent_txtPlaca',
    submit: '#ctl00_MainBodyContent_btnIngresarPla',
    recaptchaResponse: '#ctl00_MainBodyContent_hdnReCaptchaV3',
    resultReady: '#ctl00_MainBodyContent_pnlResultado, table',
  },
  apeseg: {
    url: 'https://www.apeseg.org.pe/consultas-soat/',
    iframe: 'iframe[src*="webapp.apeseg.org.pe"]',
    plateInput: 'input[type="text"], input[name*="placa" i]',
    submit: 'button[type="submit"], button:has-text("Consultar")',
    resultReady: 'table, .resultado',
  },
};
