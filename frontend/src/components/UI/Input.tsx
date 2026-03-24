import { InputHTMLAttributes, useId } from 'react';
import './Input.css';
import { getMaxLengthFor, getMinLengthFor, getPatternFor } from '../../config/constants/validation.constants';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  constraintKey?: 'name' | 'username' | 'password' | 'patientId' | 'cpf' | 'mfaCode' | 'phone' | 'birthDate' | 'email' | 'genericText';
}

export default function Input({ label, error, helperText, className = '', id, name, constraintKey, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const inputName = name || inputId;
  const maxLength = props.maxLength ?? (constraintKey ? getMaxLengthFor(constraintKey) : undefined);
  const minLength = props.minLength ?? (constraintKey ? getMinLengthFor(constraintKey) : undefined);
  const pattern = props.pattern ?? (constraintKey ? getPatternFor(constraintKey) : undefined);

  return (
    <div className="input-group">
      {label && (
        <label htmlFor={inputId} className="input-label">
          {label}
        </label>
      )}
      <input
        id={inputId}
        name={inputName}
        className={`input ${error ? 'input-error' : ''} ${className}`}
        aria-label={label || props.placeholder || 'Campo de entrada'}
        aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
        maxLength={maxLength}
        minLength={minLength}
        pattern={pattern instanceof RegExp ? pattern.source : pattern}
        {...(props as any)}
      />
      {error && (
        <span id={`${inputId}-error`} className="input-error-message" role="alert">
          {error}
        </span>
      )}
      {helperText && !error && (
        <span id={`${inputId}-helper`} className="input-helper-text">
          {helperText}
        </span>
      )}
    </div>
  );
}


