import { ReactNode, CSSProperties } from 'react';
import {
  Card as ShadcnCard,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/shadcn/card';
import { cn } from '@/lib/utils';

interface CardProps {
  children: ReactNode;
  title?: string;
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
  'data-testid'?: string;
}

export default function Card({
  children,
  title,
  className = '',
  onClick,
  style,
  'data-testid': testId,
}: CardProps) {
  return (
    <ShadcnCard
      className={cn(onClick && 'cursor-pointer transition-colors hover:bg-accent/40', className)}
      onClick={onClick}
      style={style}
      data-testid={testId}
    >
      {title ? (
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent className={cn(!title && 'p-5', title && 'pt-0')}>{children}</CardContent>
    </ShadcnCard>
  );
}
