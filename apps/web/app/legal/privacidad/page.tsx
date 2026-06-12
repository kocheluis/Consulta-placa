export const metadata = { title: 'Política de privacidad — ConsultaPlaca' };

export default function PrivacidadPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-foreground">Política de privacidad</h1>
      <div className="mt-4 space-y-3 text-muted">
        <p>
          Tratamos los datos conforme a la Ley N.° 29733 de Protección de Datos Personales y su
          reglamento (DS 016-2024-JUS). El nombre del titular de un vehículo es un dato registral
          público de SUNARP; lo mostramos con fines referenciales y aplicamos minimización: no se
          conserva más allá del periodo necesario y no se permite la búsqueda inversa por nombre.
        </p>
        <p>
          Registramos información mínima de auditoría (placa consultada, origen y propósito) para
          prevenir abusos del servicio.
        </p>
        <p>
          Si eres titular de un vehículo y deseas ejercer tus derechos (acceso, rectificación,
          cancelación u oposición), puedes{' '}
          <a href="/legal/solicitar-datos" className="text-accent hover:underline">
            presentar una solicitud
          </a>
          .
        </p>
      </div>
    </article>
  );
}
