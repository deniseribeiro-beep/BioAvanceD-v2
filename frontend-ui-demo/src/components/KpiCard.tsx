import type { LucideIcon } from 'lucide-react';

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'indigo',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: 'indigo' | 'cyan' | 'success' | 'warning';
}) {
  const tones = {
    indigo: 'bg-primary-soft text-primary',
    cyan: 'bg-cyan-50 text-brand-cyan',
    success: 'bg-green-50 text-success',
    warning: 'bg-amber-50 text-warning',
  };

  return (
    <div className="card-surface flex items-start gap-3">
      <div className={`rounded-lg p-2.5 ${tones[tone]}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold text-foreground">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}
