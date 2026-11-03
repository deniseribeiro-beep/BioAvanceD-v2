import { useEffect, useId, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/shadcn/input';
import { Label } from '@/components/shadcn/label';
import { cn } from '@/lib/utils';

interface PatientSearchInputProps {
  label?: string;
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

export default function PatientSearchInput({
  label,
  value = '',
  placeholder,
  onChange,
  onSearch,
  className = '',
  disabled,
}: PatientSearchInputProps) {
  const id = useId();
  const [internal, setInternal] = useState(value);

  useEffect(() => {
    setInternal(value);
  }, [value]);

  const handleChange = (next: string) => {
    setInternal(next);
    onChange?.(next);
  };

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={internal}
          disabled={disabled}
          placeholder={placeholder}
          className="pl-9"
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch?.(internal);
          }}
        />
      </div>
    </div>
  );
}
