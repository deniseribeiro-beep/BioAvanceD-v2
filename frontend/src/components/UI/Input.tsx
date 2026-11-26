import { InputHTMLAttributes, useId } from 'react';
import { Input as ShadcnInput } from '@/components/shadcn/input';
import { Label } from '@/components/shadcn/label';
import { cn } from '@/lib/utils';
import {
  getMaxLengthFor,
  getMinLengthFor,
  getPatternFor,
} from '../../config/constants/validation.constants';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  constraintKey?:
    | 'name'
    | 'username'
    | 'password'
    | 'patientId'
    | 'cpf'
    | 'mfaCode'
    | 'phone'
    | 'birthDate'
    | 'email'
    | 'genericText';
}

export default function Input({
  label,
  error,
  helperText,
  className = '',
  id,
  name,
  constraintKey,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const inputName = name || inputId;
  const maxLength = props.maxLength ?? (constraintKey ? getMaxLengthFor(constraintKey) : undefined);
  const minLength = props.minLength ?? (constraintKey ? getMinLengthFor(constraintKey) : undefined);
  const pattern = props.pattern ?? (constraintKey ? getPatternFor(constraintKey) : undefined);

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
        </Label>
      ) : null}
      <ShadcnInput
        id={inputId}
        name={inputName}
        className={cn(error && 'border-destructive focus-visible:ring-destructive', className)}
        aria-label={label || props.placeholder || 'Campo de entrada'}
        aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
        maxLength={maxLength}
        minLength={minLength}
        pattern={pattern instanceof RegExp ? pattern.source : pattern}
        {...(props as any)}
      />
      {error ? (
        <span id={`${inputId}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
      {helperText && !error ? (
        <span id={`${inputId}-helper`} className="text-xs text-muted-foreground">
          {helperText}
        </span>
      ) : null}
    </div>
  );
}
