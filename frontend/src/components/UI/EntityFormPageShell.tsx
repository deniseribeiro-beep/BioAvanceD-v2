import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from './Button';
import Card from './Card';
import { ArrowLeft } from 'lucide-react';

/**
 * Shared chrome for dense entity create/edit pages (Modal → page pattern).
 * Mirrors NewUserPage header + page-shell / card-surface.
 */
export default function EntityFormPageShell({
  title,
  subtitle,
  backTo,
  testId,
  children,
}: {
  title: string;
  subtitle?: string;
  backTo: string;
  testId?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();

  return (
    <div className="page-shell flex w-full min-w-0 flex-col gap-4" data-testid={testId}>
      <div className="page-header flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          data-testid="entity-form-back"
          onClick={() => navigate(backTo)}
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      <Card className="card-surface">{children}</Card>
    </div>
  );
}
