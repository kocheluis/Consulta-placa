import type { Metadata } from 'next';
import { StateScreen } from '@/components/StateScreen';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Cuenta confirmada — PlacaPe',
  robots: { index: false, follow: false },
};

export default function ConfirmadoPage() {
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
