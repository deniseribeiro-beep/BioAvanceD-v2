import { HTMLAttributes } from 'react';
import './Spinner.css';

interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'muted';
  label?: string;
}

export default function Spinner({
  size = 'md',
  variant = 'primary',
  label = 'Loading',
  className = '',
  ...props
}: SpinnerProps) {
  return (
    <span
      className={`spinner spinner-${size} spinner-${variant} ${className}`}
      role="status"
      aria-label={label}
      aria-live="polite"
      {...props}
    />
  );
}
