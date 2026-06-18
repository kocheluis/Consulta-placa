import type { Metadata } from 'next';
import { StateScreen } from '@/components/StateScreen';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Cuenta confirmada — PlacaPe',
  robots: { index: false, follow: false },
};

export default async function ConfirmadoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (error) {
    return (
      <section className="bg-background px-4 py-16 sm:py-24">
        <StateScreen
          tone="danger"
          icon="error"
          title="No pudimos confirmar tu cuenta"
          description="El enlace de confirmación expiró o ya fue usado. Inicia sesión; si tu correo aún no está verificado, podrás pedir un nuevo enlace."
        >
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="accent" size="lg" href="/cuenta" iconRight="arrow_forward">
              Ir a iniciar sesión
            </Button>
          </div>
        </StateScreen>
      </section>
    );
  }

  return (
    <section className="bg-background px-4 py-16 sm:py-24">
      <StateScreen
        tone="success"
        icon="verified"
        title="¡Cuenta confirmada!"
        description="Tu correo quedó verificado y tu cuenta de PlacaPe está activa. Ya puedes consultar el historial de cualquier placa del Perú."
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="accent" size="lg" href="/" iconRight="arrow_forward">
            Consultar una placa
          </Button>
          <Button variant="secondary" size="lg" href="/cuenta" icon="person">
            Ir a mi cuenta
          </Button>
        </div>
      </StateScreen>
    </section>
  );
}
