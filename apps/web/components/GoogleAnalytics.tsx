import Script from 'next/script';

/**
 * Google Analytics 4. Inerte hasta que exista NEXT_PUBLIC_GA_ID (p. ej. "G-ABC123XYZ") en Vercel:
 * sin el ID no carga nada. Las páginas de reporte se miden sin la placa en la URL (page_location
 * recortado) para no enviar a Google qué vehículos consulta cada persona.
 */
export function GoogleAnalytics() {
  const id = process.env.NEXT_PUBLIC_GA_ID;
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
var loc = location.href.replace(/\\/(reporte|guiada)\\/(?!ejemplo)[^/?#]+/, '/$1/[placa]').replace(/[?#].*$/, '');
gtag('config', '${id}', { page_location: loc, anonymize_ip: true });`}
      </Script>
    </>
  );
}
