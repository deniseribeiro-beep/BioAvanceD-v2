import { TextareaHTMLAttributes, useId } from 'react';
import './Textarea.css';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export default function Textarea({ label, error, className = '', id, name, ...props }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id || generatedId;
  const textareaName = name || textareaId;

  return (
    <div className="textarea-group">
      {label && (
        <label htmlFor={textareaId} className="textarea-label">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        name={textareaName}
        className={`textarea ${error ? 'textarea-error' : ''} ${className}`}
        aria-label={label || props.placeholder || 'Campo de texto'}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${textareaId}-error` : undefined}
        {...props}
      />
      {error && (
        <span id={`${textareaId}-error`} className="textarea-error-message" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

