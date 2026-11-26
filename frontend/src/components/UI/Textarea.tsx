import { TextareaHTMLAttributes, useId } from 'react';
import { Textarea as ShadcnTextarea } from '@/components/shadcn/textarea';
import { Label } from '@/components/shadcn/label';
import { cn } from '@/lib/utils';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export default function Textarea({
  label,
  error,
  className = '',
  id,
  name,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id || generatedId;
  const textareaName = name || textareaId;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label ? (
        <Label htmlFor={textareaId} className="text-sm font-medium text-foreground">
          {label}
        </Label>
      ) : null}
      <ShadcnTextarea
        id={textareaId}
        name={textareaName}
        className={cn(error && 'border-destructive focus-visible:ring-destructive', className)}
        {...props}
      />
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
