import { Icon } from './ui/Icon';

type Level = 'limpio' | 'revisar' | 'alerta';

const LEVELS: Record<Level, { color: string; label: string; icon: string; desc: string }> = {
  limpio: { color: '#18994F', label: 'Limpio', icon: 'verified', desc: 'Sin alertas. Vehículo apto para comprar.' },
  revisar: { color: '#DA9211', label: 'Revisar', icon: 'warning', desc: 'Pendientes leves. Negocia antes de cerrar.' },
  alerta: { color: '#DD3B3B', label: 'Alerta', icon: 'gpp_bad', desc: 'Riesgos graves detectados. No recomendamos comprar.' },
};

/**
 * Medidor de riesgo (0–100) del design system. Consume el resultado del motor
 * de score (overall + nivel). `level` se deriva del score si no se pasa.
 */
export function RiskGauge({
  score = 80,
  level,
  title,
  description,
  size = 96,
}: {
  score?: number;
  level?: Level;
  title?: string;
  description?: string;
  size?: number;
}) {
  const lvl: Level = level ?? (score >= 75 ? 'limpio' : score >= 45 ? 'revisar' : 'alerta');
  const cfg = LEVELS[lvl];
  const r = (size - 12) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-5 py-[18px] shadow-sm">
      <div className="relative grid flex-none place-items-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E9EEF1" strokeWidth="10" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={cfg.color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (pct / 100) * circumference}
          />
        </svg>
        <div className="absolute flex flex-col items-center leading-none">
          <b className="font-heading font-extrabold" style={{ fontSize: size * 0.3, color: cfg.color }}>
            {Math.round(pct)}
          </b>
          <small className="mt-0.5 text-[10px] tracking-wide text-muted">/ 100</small>
        </div>
      </div>
      <div className="min-w-0">
        <span className="inline-flex items-center gap-1.5 font-heading font-bold" style={{ color: cfg.color }}>
          <Icon name={cfg.icon} fill className="text-[1.15em]" />
          {title ?? cfg.label}
        </span>
        <p className="mt-1 text-[13px] text-muted">{description ?? cfg.desc}</p>
      </div>
    </div>
  );
}
