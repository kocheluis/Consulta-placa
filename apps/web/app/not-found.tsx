import { StateScreen } from '@/components/StateScreen';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <section className="bg-background px-4 py-16 sm:py-24">
      <StateScreen
        tone="neutral"
        icon="travel_explore"
        title="Página no encontrada"
        description="La página que buscas no existe o cambió de dirección. Verifica el enlace o vuelve al inicio para consultar una placa."
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="accent" size="lg" href="/" iconRight="arrow_forward">
            Ir al inicio
          </Button>
          <Button variant="secondary" size="lg" href="/planes" icon="sell">
            Ver planes
          </Button>
        </div>
      </StateScreen>
    </section>
  );
}
