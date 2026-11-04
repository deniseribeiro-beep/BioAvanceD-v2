import { Children, SelectHTMLAttributes, useId } from 'react';
import { Label } from '@/components/shadcn/label';
import { cn } from '@/lib/utils';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options?: Array<{ value: string | number; label: string }>;
}

export default function Select({
  label,
  error,
  className = '',
  id,
  name,
  options = [],
  children,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const selectName = name || selectId;
  const hasChildrenOptions = Children.count(children) > 0;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <Label htmlFor={selectId} className="text-sm font-medium text-foreground">
          {label}
        </Label>
      ) : null}
      <select
        id={selectId}
        name={selectName}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive focus-visible:ring-destructive',
          className
        )}
        aria-label={label || 'Campo de seleção'}
        aria-describedby={error ? `${selectId}-error` : undefined}
        {...props}
      >
        {hasChildrenOptions
          ? children
          : (options || []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
      </select>
      {error ? (
        <span id={`${selectId}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
