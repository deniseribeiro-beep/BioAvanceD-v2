import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Button from './UI/Button';
import Spinner from './UI/Spinner';
import { productLegalService, type ProductLegalPendingItem } from '../services/api';

// Authenticated product surfaces must gate. Exempt only public auth/e-consent
// flows and the legal pages themselves (so the user can read + accept).
const EXEMPT_PREFIXES = [
  '/login',
  '/reset-password',
  '/invite/accept',
  '/mfa-setup',
  '/security/mfa-setup',
  '/legal/',
  '/patient/',
];

function isExempt(pathname: string) {
  return EXEMPT_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix));
}

export default function LegalAcceptanceGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ProductLegalPendingItem[]>([]);

  const refresh = useCallback(async () => {
    if (isExempt(location.pathname)) {
      setPending([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await productLegalService.getStatus();
      setPending(response.data?.data?.pending || []);
    } catch {
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading || pending.length === 0 || isExempt(location.pathname)) {
    return <>{children}</>;
  }

  const next = pending[0];
  const legalPath = next.docType === 'privacy' ? '/legal/privacy' : '/legal/terms';

  return (
    <>
      {children}
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-gate-title"
        data-testid="legal-acceptance-gate"
      >
        <div className="max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
          <h2 id="legal-gate-title" className="text-lg font-semibold">
            Aceite pendente — {next.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Versão <strong>{next.docVersion}</strong> dos documentos legais do produto. Isso é distinto do TCLE de pesquisa com participantes.
          </p>
          <p className="mt-3 text-sm">
            Leia e aceite para continuar usando o sistema neste tenant.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={legalPath}>
              <Button type="button">Ler e aceitar agora</Button>
            </Link>
            {pending.length > 1 ? (
              <span className="self-center text-xs text-muted-foreground">
                +{pending.length - 1} documento(s) após este
              </span>
            ) : null}
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner size="sm" /> Verificando conformidade do tenant…
          </div>
        </div>
      </div>
    </>
  );
}