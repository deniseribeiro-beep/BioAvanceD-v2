import { useEffect } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertCircle,
};

const styleMap = {
  success: 'border-success/30 bg-success/5 text-success',
  error: 'border-destructive/30 bg-destructive/5 text-destructive',
  info: 'border-info/30 bg-info/5 text-info',
  warning: 'border-warning/30 bg-warning/5 text-warning',
};

export default function Toast({ message, type = 'info', duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const Icon = iconMap[type];

  // success/error/warning are assertive so e2e and AT can find getByRole('alert');
  // plain info stays polite status.
  const role = type === 'info' ? 'status' : 'alert';

  return (
    <div
      className={cn(
        'flex min-w-[280px] max-w-md items-start gap-3 rounded-md border px-3 py-2.5 text-sm shadow-card',
        styleMap[type]
      )}
      role={role}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 text-foreground">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-sm opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
