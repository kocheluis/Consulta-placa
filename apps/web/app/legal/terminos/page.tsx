export const metadata = { title: 'Términos de uso — ConsultaPlaca' };

export default function TerminosPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-8 prose-sm">
      <h1 className="text-2xl font-semibold text-foreground">Términos de uso</h1>
      <div className="mt-4 space-y-3 text-muted">
        <p>
          ConsultaPlaca muestra información referencial sobre vehículos peruanos obtenida de
          portales públicos oficiales (SUNARP, SBS, APESEG). La información no constituye un
          certificado oficial ni reemplaza una consulta directa ante dichas entidades.
        </p>
        <p>
          El servicio se ofrece con fines de verificación y orientación. No garantizamos la
          exactitud, completitud ni vigencia de los datos al momento de su consulta.
        </p>
        <p>
          Está prohibido el uso automatizado o masivo del servicio, así como la reproducción de los
          datos con fines de elaboración de bases de datos de personas.
        </p>
      </div>
    </article>
  );
}
