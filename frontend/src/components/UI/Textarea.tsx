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
        <label htmlFor={textareaId} className="textarea-label mb-1.5 text-sm font-semibold text-gray-700">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        name={textareaName}
        className={`textarea w-full rounded-lg border border-gray-300 px-3 py-2 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${error ? 'textarea-error' : ''} ${className}`}
        aria-label={label || props.placeholder || 'Campo de texto'}
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

