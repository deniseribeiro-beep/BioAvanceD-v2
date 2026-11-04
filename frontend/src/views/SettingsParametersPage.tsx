import { useEffect, useMemo, useState } from 'react';
import Card from '../components/UI/Card';
import Input from '../components/UI/Input';
import Button from '../components/UI/Button';
import Table from '../components/UI/Table';
import { AnalysisType } from '../types/models';
import { analysisTypeService } from '../services/api';
import { useAnalysisTypes } from '../hooks/useAnalysisTypes';

const slugify = (value: string) => {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
};

export default function SettingsParametersPage() {
  const { types, loading, error } = useAnalysisTypes();
  const [items, setItems] = useState<AnalysisType[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setItems(types);
  }, [types]);

  const generatedCode = useMemo(() => (name ? slugify(name) : ''), [name]);

  const handleCreate = async () => {
    if (!name.trim()) {
      setSaveError('Informe o nome do tipo');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const payload = {
        name: name.trim(),
        code: code.trim() || generatedCode
      };

      const response = await analysisTypeService.create(payload);
      const created = response.data?.data || response.data;

      if (created) {
        setItems((prev) => [created, ...prev]);
      }

      setName('');
      setCode('');
      setSuccessMessage('Tipo criado com sucesso');
    } catch (err: any) {
      setSaveError(err?.message || 'Erro ao criar tipo');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Parâmetros</h1>
          <p className="page-subtitle">Gerencie tipos de análise</p>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        <Card>
          <h3 style={{ marginBottom: '1rem' }}>Adicionar Tipo de Análise</h3>
          {saveError && (
            <div style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>
              {saveError}
            </div>
          )}
          {successMessage && (
            <div style={{ color: 'var(--success)', marginBottom: '0.75rem' }}>
              {successMessage}
            </div>
          )}
          <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '520px' }}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do tipo (ex: PCR Real Time)"
            />
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={generatedCode ? `Código sugerido: ${generatedCode}` : 'Código (opcional)'}
            />
            <div>
              <Button variant="primary" onClick={handleCreate} disabled={saving}>
                {saving ? 'Salvando...' : 'Adicionar'}
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <h3 style={{ marginBottom: '1rem' }}>Tipos de Análise</h3>
          {loading && <p>Carregando...</p>}
          {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}
          {!loading && items.length === 0 && <p>Nenhum tipo encontrado.</p>}
          {!loading && items.length > 0 && (
            <Table headers={['Nome', 'Código', 'Ativo']}>
              {items.map((item) => (
                <tr key={item._id || item.code}>
                  <td>{item.name}</td>
                  <td>{item.code}</td>
                  <td>{item.active === false ? 'Não' : 'Sim'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
