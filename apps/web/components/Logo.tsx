/**
 * Logotipo PlacaPe — versión clara (para fondos oscuros, como el header).
 * Tomado del design system oficial (handoff de Claude Design): placa con check
 * teal + wordmark "placape" en Sora. Escala con `className` (alto); el ancho se
 * ajusta solo.
 */
type LogoProps = {
  className?: string;
};

export function Logo({ className = 'h-8 w-auto' }: LogoProps) {
  return (
    <svg
      viewBox="0 0 430 120"
      className={className}
      role="img"
      aria-label="PlacaPe"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="6" y="33" width="92" height="54" rx="13" fill="#FFFFFF" />
      <circle cx="21" cy="44" r="2.4" fill="#14506B" fillOpacity="0.35" />
      <circle cx="83" cy="44" r="2.4" fill="#14506B" fillOpacity="0.35" />
      <rect x="16" y="42" width="72" height="36" rx="7" fill="#0A2E3D" />
      <rect x="16" y="42" width="16" height="36" rx="7" fill="#16B5A3" />
      <rect x="25" y="42" width="7" height="36" fill="#16B5A3" />
      <text
        x="24"
        y="64"
        textAnchor="middle"
        fontFamily="'Plus Jakarta Sans', sans-serif"
        fontSize="9"
        fontWeight="700"
        fill="#06231D"
      >
        PE
      </text>
      <path
        d="M44 62 L51 69 L69 49"
        stroke="#16B5A3"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <text x="116" y="76" fontFamily="'Sora', sans-serif" fontSize="46" fontWeight="800" letterSpacing="-1.6">
        <tspan fill="#FFFFFF">placa</tspan>
        <tspan fill="#3FC9B8">pe</tspan>
      </text>
    </svg>
  );
}
