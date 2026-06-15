import { redirect } from 'next/navigation';

/**
 * La consulta guiada (lista de portales oficiales) quedó deprecada: el producto
 * pasó a un reporte automático. Se conserva la ruta para no romper enlaces
 * antiguos y se redirige al reporte. Los enlaces oficiales viven server-side
 * (packages/shared/links.ts) para uso de los scrapers, no en la UI.
 */
export default async function GuiadaPage({ params }: { params: Promise<{ placa: string }> }) {
  const { placa } = await params;
  redirect(`/reporte/${placa}`);
}
