type Size = 'sm' | 'md' | 'lg';

const SIZE: Record<Size, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Avatar con iniciales (sin imagen). Color de marca determinista. */
export function Avatar({ name, size = 'md' }: { name: string; size?: Size }) {
  return (
    <div
      className={`grid flex-none place-items-center rounded-full bg-primary font-heading font-bold text-white ${SIZE[size]}`}
      aria-hidden="true"
      title={name}
    >
      {initials(name)}
    </div>
  );
}
