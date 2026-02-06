import { useEffect, useMemo, useState } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Spinner from '../components/UI/Spinner';
import Table from '../components/UI/Table';
import { useToast } from '../components/UI/ToastContainer';
import { consentService } from '../services/api';
import { ConsentPolicy, ConsentPolicyPermission } from '../types/models';
import './ConsentManager.css';

const emptyPermission = (): ConsentPolicyPermission => ({
  key: '',
  label: '',
  required: false
});

export default function ConsentManager() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [version, setVersion] = useState('');
  const [title, setTitle] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [validFrom, setValidFrom] = useState(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  const [permissions, setPermissions] = useState<ConsentPolicyPermission[]>([emptyPermission()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<ConsentPolicy[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const canSubmit = useMemo(() => {
    const hasPermissions = permissions.some(permission => permission.key.trim() && permission.label.trim());
    return version.trim() && title.trim() && htmlContent.trim() && hasPermissions;
  }, [version, title, htmlContent, permissions]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await consentService.getAllPolicies();
      const payload = (response as any)?.data?.data ?? (response as any)?.data ?? [];
      setHistory(Array.isArray(payload) ? payload : []);
    } catch (error: any) {
      showToast(error?.message || 'Erro ao carregar histórico de versões', 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleAddPermission = () => {
    setPermissions((prev) => [...prev, emptyPermission()]);
  };

  const handleRemovePermission = (index: number) => {
    setPermissions((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdatePermission = (index: number, field: keyof ConsentPolicyPermission, value: string | boolean) => {
    setPermissions((prev) =>
      prev.map((permission, idx) =>
        idx === index ? { ...permission, [field]: value } : permission
      )
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      showToast('Preencha todos os campos obrigatórios', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        version: version.trim(),
        title: title.trim(),
        htmlContent: htmlContent.trim(),
        validFrom: new Date(validFrom).toISOString(),
        active: true,
        granularPermissions: permissions
          .filter(permission => permission.key.trim() && permission.label.trim())
          .map(permission => ({
            key: permission.key.trim(),
            label: permission.label.trim(),
            required: Boolean(permission.required)
          }))
      };

      await consentService.createPolicy(payload);
      showToast('Nova versão publicada com sucesso', 'success');

      setVersion('');
      setTitle('');
      setHtmlContent('');
      setPermissions([emptyPermission()]);
      setActiveTab('history');
      await loadHistory();
    } catch (error: any) {
      showToast(error?.message || 'Erro ao publicar nova versão', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page consent-manager">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestão de Consentimento Dinâmico</h1>
          <p className="page-subtitle">Crie versões do TCLE com permissões granulares e acompanhe o histórico.</p>
        </div>
      </div>

      <div className="consent-manager-tabs">
        <Button
          variant={activeTab === 'new' ? 'primary' : 'secondary'}
          className={`btn-small ${activeTab === 'new' ? '' : 'btn-ghost'}`}
          onClick={() => setActiveTab('new')}
        >
          Nova Versão
        </Button>
        <Button
          variant={activeTab === 'history' ? 'primary' : 'secondary'}
          className={`btn-small ${activeTab === 'history' ? '' : 'btn-ghost'}`}
          onClick={() => setActiveTab('history')}
        >
          Histórico
        </Button>
      </div>

      {activeTab === 'new' ? (
        <div className="consent-manager-grid">
          <Card className="consent-manager-form">
            <div className="consent-manager-form-fields">
              <div className="consent-manager-form-row">
                <Input label="Versão" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="Ex: 2.0" />
                <Input label="Título" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex: TCLE Pesquisa Genética" />
                <Input
                  label="Data de Vigência"
                  type="date"
                  value={validFrom}
                  onChange={(event) => setValidFrom(event.target.value)}
                />
              </div>

              <div className="consent-manager-textarea">
                <label htmlFor="consent-html-content" className="input-label">Conteúdo do TCLE</label>
                <textarea
                  id="consent-html-content"
                  value={htmlContent}
                  onChange={(event) => setHtmlContent(event.target.value)}
                  rows={12}
                  className="consent-textarea"
                  placeholder="Cole aqui o texto completo do TCLE (HTML permitido)"
                />
              </div>
            </div>
          </Card>

          <Card className="consent-manager-permissions">
            <div className="consent-manager-permissions-header">
              <h2 className="consent-manager-section-title">Permissões granulares</h2>
              <Button variant="secondary" className="btn-small btn-ghost" onClick={handleAddPermission}>
                + Adicionar
              </Button>
            </div>
            <div className="consent-manager-permissions-list">
              {permissions.map((permission, index) => (
                <div key={`${permission.key}-${index}`} className="consent-permission-card">
                  <Input
                    label="ID da Permissão"
                    value={permission.key}
                    onChange={(event) => handleUpdatePermission(index, 'key', event.target.value)}
                    placeholder="Ex: genetic_usage"
                  />
                  <Input
                    label="Texto para o Paciente"
                    value={permission.label}
                    onChange={(event) => handleUpdatePermission(index, 'label', event.target.value)}
                    placeholder="Ex: Aceito uso genético"
                  />
                  <label className="consent-required-toggle">
                    <input
                      type="checkbox"
                      checked={!!permission.required}
                      onChange={(event) => handleUpdatePermission(index, 'required', event.target.checked)}
                      aria-label={`Permissão obrigatória ${permission.key || index + 1}`}
                    />
                    É obrigatório?
                  </label>
                  {permissions.length > 1 && (
                    <Button
                      variant="secondary"
                      className="btn-small btn-ghost consent-remove-button"
                      onClick={() => handleRemovePermission(index)}
                    >
                      Remover permissão
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div className="consent-manager-actions">
            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Publicando...' : 'Publicar Nova Versão'}
            </Button>
          </div>
        </div>
      ) : (
        <Card className="consent-manager-history">
          <div className="consent-manager-history-header">
            <h2 className="consent-manager-section-title">Histórico de versões</h2>
            <Button variant="secondary" className="btn-small btn-ghost" onClick={loadHistory}>
              Atualizar
            </Button>
          </div>

          {loadingHistory ? (
            <div className="consent-manager-loading">
              <Spinner size="sm" />
              <span>Carregando histórico...</span>
            </div>
          ) : (
            <Table headers={['Versão', 'Título', 'Vigência', 'Status']}>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="consent-manager-empty">
                    Nenhuma versão cadastrada.
                  </td>
                </tr>
              ) : (
                history.map((policy) => (
                  <tr key={policy._id || `${policy.version}-${policy.title}`}>
                    <td className="consent-manager-version">{policy.version}</td>
                    <td>{policy.title}</td>
                    <td>
                      {policy.validFrom ? new Date(policy.validFrom).toLocaleDateString() : '--'}
                    </td>
                    <td>
                      <span className={`consent-status ${policy.active ? 'active' : 'inactive'}`}>
                        {policy.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
