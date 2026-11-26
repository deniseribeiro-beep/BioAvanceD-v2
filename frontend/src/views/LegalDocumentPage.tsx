import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Spinner from '../components/UI/Spinner';
import { productLegalService, type ProductLegalDocument } from '../services/api';

const TITLES: Record<string, string> = {
  terms: 'Termos de uso',
  privacy: 'Política de privacidade',
};

export default function LegalDocumentPage() {
  const location = useLocation();
  const docType = location.pathname.includes('/legal/privacy') ? 'privacy' : 'terms';
  const navigate = useNavigate();
  const [doc, setDoc] = useState<ProductLegalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    productLegalService
      .getDocument(docType)
      .then((response) => {
        if (!active) return;
        setDoc(response.data?.data || null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Não foi possível carregar o documento.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [docType]);

  const accept = async () => {
    if (!doc) return;
    setAccepting(true);
    try {
      await productLegalService.accept(doc.docType, doc.docVersion);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Falha ao registrar aceite.');
    } finally {
      setAccepting(false);
    }
  };

  const title = TITLES[docType] || 'Documento legal';

  return (
    <div className="page-shell" data-testid={`legal-page-${docType}`}>
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">
          Aceite de uso da plataforma (tenant). <strong>Não</strong> é o TCLE de participante de pesquisa.
        </p>
      </div>

      <Card>
        {loading ? (
          <DocumentLoading />
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : doc ? (
          <DocumentBody doc={doc} />
        ) : (
          <p className="text-sm text-muted-foreground">Documento indisponível.</p>
        )}
      </Card>

      {doc ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void accept()} disabled={accepting}>
            {accepting ? 'Registrando aceite…' : `Aceito a versão ${doc.docVersion}`}
          </Button>
          <Link to="/runbook" className="text-sm text-primary">
            Voltar ao Runbook
          </Link>
          {docType === 'terms' ? (
            <Link to="/legal/privacy" className="text-sm text-muted-foreground">
              Ler política de privacidade
            </Link>
          ) : (
            <Link to="/legal/terms" className="text-sm text-muted-foreground">
              Ler termos de uso
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DocumentLoading() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="legal-document-loading">
      <Spinner size="sm" /> Carregando documento…
    </div>
  );
}

function DocumentBody({ doc }: { doc: ProductLegalDocument }) {
  return (
    <article data-testid="legal-document-body">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Versão {doc.docVersion}
        {doc.publishedAt ? ` · publicada em ${new Date(doc.publishedAt).toLocaleDateString('pt-BR')}` : ''}
      </p>
      <h2 className="mb-3 text-lg font-semibold">{doc.title}</h2>
      {doc.body.split('\n\n').map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`} className="mb-3 text-sm leading-relaxed text-foreground">
          {paragraph}
        </p>
      ))}
    </article>
  );
}