import { SelectHTMLAttributes, useId } from 'react';
import './Select.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: Array<{ value: string | number; label: string }>;
}

export default function Select({ label, error, className = '', id, name, options, ...props }: SelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const selectName = name || selectId;

  return (
    <div className="select-group">
      {label && (
        <label htmlFor={selectId} className="select-label">
          {label}
        </label>
      )}
      <select
        id={selectId}
        name={selectName}
        className={`select ${error ? 'select-error' : ''} ${className}`}
        aria-label={label || 'Campo de seleção'}
        aria-describedby={error ? `${selectId}-error` : undefined}
        {...props}
      >
        {options.map((option) => (
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

