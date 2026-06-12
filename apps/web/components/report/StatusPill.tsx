import { CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react';

type Tone = 'success' | 'danger' | 'warning' | 'neutral';

const styles: Record<Tone, string> = {
  success: 'bg-success-bg text-success-fg',
  danger: 'bg-danger-bg text-danger-fg',
  warning: 'bg-warning-bg text-warning-fg',
  neutral: 'bg-slate-100 text-slate-600',
};

const icons: Record<Tone, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  danger: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
  neutral: <MinusCircle className="h-4 w-4" aria-hidden="true" />,
};

/** Píldora de estado con icono + texto (el color nunca es el único indicador). */
export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${styles[tone]}`}
    >
      {icons[tone]}
      {children}
    </span>
  );
}
