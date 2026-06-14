/**
 * Logotipo "PlacaPe" con forma de placa vehicular peruana.
 * El chip "PE" es el guiño a Perú / al dominio .pe. Paleta institucional
 * (navy + blanco) coherente con el design system; sin rojo (reservado a la
 * alerta de robo). Escala con `className` (alto); el ancho se ajusta solo.
 */
type LogoProps = {
  className?: string;
};

export function Logo({ className = 'h-8 w-auto' }: LogoProps) {
  return (
    <svg
      viewBox="0 0 240 64"
      className={className}
      role="img"
      aria-label="PlacaPe"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>PlacaPe</title>
      {/* Cuerpo de la placa */}
      <rect
        x="2"
        y="12"
        width="236"
        height="40"
        rx="8"
        fill="#FFFFFF"
        stroke="#1E3A8A"
        strokeWidth="3"
      />
      {/* Tornillos (realismo sutil) */}
      <circle cx="15" cy="22" r="2" fill="#CBD5E1" />
      <circle cx="225" cy="42" r="2" fill="#CBD5E1" />
      {/* Wordmark */}
      <text
        x="24"
        y="40"
        fontFamily="Lexend, ui-sans-serif, system-ui, sans-serif"
        fontSize="26"
        fontWeight="700"
        letterSpacing="0.5"
        fill="#1E3A8A"
      >
        Placa
      </text>
      {/* Chip "PE" (banda de país / .pe) */}
      <rect x="176" y="20" width="48" height="24" rx="5" fill="#1E3A8A" />
      <text
        x="200"
        y="38"
        textAnchor="middle"
        fontFamily="Lexend, ui-sans-serif, system-ui, sans-serif"
        fontSize="17"
        fontWeight="700"
        letterSpacing="1"
        fill="#FFFFFF"
      >
        PE
      </text>
    </svg>
  );
}
