import { Children, SelectHTMLAttributes, useId } from 'react';
import './Select.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options?: Array<{ value: string | number; label: string }>;
}

export default function Select({ label, error, className = '', id, name, options = [], children, ...props }: SelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const selectName = name || selectId;
  const hasChildrenOptions = Children.count(children) > 0;

  return (
    <div className="select-group">
      {label && (
        <label htmlFor={selectId} className="select-label mb-1.5 text-sm font-semibold text-gray-700">
          {label}
        </label>
      )}
      <select
        id={selectId}
        name={selectName}
        className={`select w-full rounded-lg border border-gray-300 px-3 py-2 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${error ? 'select-error' : ''} ${className}`}
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
      {error && (
        <span id={`${selectId}-error`} className="select-error-message" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

