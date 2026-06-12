/**
 * Selectores de los portales oficiales, centralizados para poder ajustarlos en
 * un solo lugar cuando cambie el DOM (los portales no exponen su estructura
 * públicamente y pueden cambiar sin aviso).
 *
 * ⚠️ Los valores actuales son TENTATIVOS. Ejecuta el script de descubrimiento
 * (`npm run -w @app/worker discover-selectors`) una vez con un navegador real
 * para capturar los selectores verdaderos de cada portal y reemplazarlos aquí.
 * Cada campo acepta una lista de selectores separados por coma (CSS), de modo que
 * el scraper usa el primero que exista.
 */
export interface PortalSelectors {
  url: string;
  plateInput: string;
  submit: string;
  /** CAPTCHA de imagen (SUNARP). */
  captchaImage?: string;
  captchaInput?: string;
  /** reCAPTCHA v2 (SBS): contenedor con data-sitekey. */
  recaptchaSitekeyEl?: string;
  /** Contenedor del resultado, para esperar tras enviar. */
  resultReady?: string;
}

export const PORTAL_SELECTORS: Record<'sunarp' | 'sbs' | 'apeseg', PortalSelectors> = {
  sunarp: {
    url: 'https://www.consultavehicular.sunarp.gob.pe/',
    plateInput: 'input[name="nroPlaca"], #nroPlaca, input[type="text"]',
    captchaImage: 'img.captcha, #imgCaptcha, img[alt*="captcha" i]',
    captchaInput: 'input[name="codigoCaptcha"], #codigoCaptcha',
    submit: 'button[type="submit"], #btnBuscar, button:has-text("Consultar")',
    resultReady: '.resultado-consulta, table.datos-vehiculo',
  },
  sbs: {
    url: 'https://servicios.sbs.gob.pe/reportesoat/',
    plateInput: 'input[name="placa"], #placa, input[type="text"]',
    recaptchaSitekeyEl: '.g-recaptcha, [data-sitekey]',
    submit: 'button[type="submit"], #btnConsultar, button:has-text("Consultar")',
    resultReady: '.reporte-soat, table.poliza',
  },
  apeseg: {
    url: 'https://www.apeseg.org.pe/consultas-soat/',
    plateInput: 'input[name="placa"], #placa, input[type="text"]',
    submit: 'button[type="submit"], #btnBuscar, button:has-text("Buscar")',
    resultReady: '.apeseg-soat, table',
  },
};
