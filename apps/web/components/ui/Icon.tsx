/** Ícono de Material Symbols Rounded (sistema de íconos del design system). */
export function Icon({
  name,
  className = '',
  fill = false,
}: {
  name: string;
  className?: string;
  fill?: boolean;
}) {
  return (
    <span
      className={`material-symbols-rounded select-none ${className}`}
      aria-hidden="true"
      style={fill ? { fontVariationSettings: "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24" } : undefined}
    >
      {name}
    </span>
  );
}
