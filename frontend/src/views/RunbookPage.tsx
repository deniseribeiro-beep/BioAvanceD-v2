import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, Shield } from 'lucide-react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { useAuth } from '../contexts/AuthContext';
import { RUNBOOK_TOPICS } from '../content/runbookTopics';
import { productLegalService } from '../services/api';

export default function RunbookPage() {
  const { user, hasRole } = useAuth();
  const [query, setQuery] = useState('');
  const [publishVersion, setPublishVersion] = useState('2.1.1');
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const roleName = user?.roleName;

  const topics = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return RUNBOOK_TOPICS.filter((topic) => {
      if (topic.roles && roleName && !topic.roles.includes(roleName)) return false;
      if (!normalized) return true;
      const haystack = `${topic.title} ${topic.summary} ${topic.steps.join(' ')}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query, roleName]);

  const handlePublishNewVersion = async () => {
    setPublishing(true);
    setPublishMessage(null);
    setPublishError(null);
    try {
      await productLegalService.publish('terms', { docVersion: publishVersion.trim() });
      await productLegalService.publish('privacy', { docVersion: publishVersion.trim() });
      setPublishMessage(`Versão ${publishVersion.trim()} publicada. Usuários precisarão aceitar novamente.`);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as Error)?.message
        || 'Falha ao publicar';
      setPublishError(message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="page-shell" data-testid="runbook-page">
      <div className="page-header">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          <BookOpen size={14} />
          Central de processos
        </div>
        <h1 className="page-title">Runbook</h1>
        <p className="page-subtitle">
          Guias curtos para o dia a dia no laboratório. O dicionário técnico ELM permanece nas APIs <code>/dictionary/*</code> — não confunda com esta central.
        </p>
      </div>

      <div className="mb-4">
        <Input
          label="Buscar processo"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="intake, TCLE, importação…"
        />
      </div>

      <div className="grid gap-4">
        {topics.map((topic) => (
          <Card key={topic.id} className="card-surface">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{topic.title}</h2>
                <p className="text-sm text-muted-foreground">{topic.summary}</p>
              </div>
              {topic.route ? (
                <Link to={topic.route} className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Abrir tela <ChevronRight size={16} />
                </Link>
              ) : null}
            </div>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-foreground">
              {topic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Card>
        ))}
        {topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum processo encontrado para o filtro atual.</p>
        ) : null}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <Shield size={18} /> Termos e privacidade do produto
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Documentos legais da plataforma (tenant), versionados e distintos do TCLE de pesquisa.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/legal/terms">
              <Button variant="secondary" type="button">Termos de uso</Button>
            </Link>
            <Link to="/legal/privacy">
              <Button variant="secondary" type="button">Política de privacidade</Button>
            </Link>
          </div>
        </Card>

        {hasRole('Administrador') ? (
          <Card>
            <h3 className="mb-2 text-base font-semibold">Publicar nova versão legal (admin)</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Incremente a versão para exigir reaceite após o login. Corpo padrão permanece o seed do servidor se não enviar texto customizado.
            </p>
            <Input
              label="Versão (ex. 2.1.1)"
              value={publishVersion}
              onChange={(event) => setPublishVersion(event.target.value)}
            />
            {publishError ? <p className="mt-2 text-sm text-red-600">{publishError}</p> : null}
            {publishMessage ? <p className="mt-2 text-sm text-green-700">{publishMessage}</p> : null}
            <Button className="mt-3" onClick={() => void handlePublishNewVersion()} disabled={publishing || !publishVersion.trim()}>
              {publishing ? 'Publicando…' : 'Publicar Termos + Privacidade'}
            </Button>
          </Card>
        ) : null}
      </div>
    </div>
  );
}