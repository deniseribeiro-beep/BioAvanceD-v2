import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import { usePolicies } from '../hooks/usePolicies';
import { useLanguage } from '../contexts/LanguageContext';
import { Policy } from '../types/models';
import { validateThresholds } from '../utils/validations';
import { policyService } from '../services/api';

export const LIST_PATH = '/facility-management?tab=policies';

export function policyFormEditPath(policy: Policy): string {
  return `/policies/${policy._id}/edit`;
}

export function findPolicyInList(list: Policy[], id: string): Policy | undefined {
  return list.find((p) => p._id && String(p._id) === id);
}

export default function PolicyFormPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { policies, createPolicy, updatePolicy } = usePolicies();
  const isNew = !id;

  const [fetched, setFetched] = useState<Policy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fromState = (location.state as { policy?: Policy } | null)?.policy ?? null;

  const editingPolicy = useMemo(() => {
    if (fromState) return fromState;
    if (!id) return null;
    return findPolicyInList(policies, id) ?? fetched;
  }, [fromState, policies, id, fetched]);

  useEffect(() => {
    if (!id || fromState || findPolicyInList(policies, id)) return;
    let cancelled = false;
    policyService
      .getById(id)
      .then((res: unknown) => {
        if (cancelled) return;
        const data = (res as { data?: Policy })?.data ?? (res as Policy);
        setFetched(data);
      })
      .catch((err: { message?: string }) => {
        if (!cancelled) setLoadError(err?.message || 'Erro ao carregar política');
      });
    return () => {
      cancelled = true;
    };
  }, [id, fromState, policies]);

  const title = editingPolicy
    ? t('facility.policies.editTitle', 'Editar Política')
    : t('facility.policies.newTitle', 'Nova Política');

  return (
    <EntityFormPageShell title={title} backTo={LIST_PATH} testId="policy-form-page">
      {loadError && <p style={{ color: 'var(--danger)' }}>{loadError}</p>}
      {id && !editingPolicy && !loadError ? (
        <p>{t('common.loading')}</p>
      ) : (
        <PolicyFormFields
          policy={isNew ? null : editingPolicy}
          onSave={async (data) => {
            const policyToValidate = { ...(editingPolicy || {}), ...data } as Policy;
            if (!validateThresholds(policyToValidate)) {
              alert('Limites de temperatura inválidos! Verifique se min < target < max.');
              return;
            }
            try {
              if (editingPolicy && !isNew) {
                await updatePolicy(String(editingPolicy._id), data);
              } else {
                await createPolicy(data);
              }
              navigate(LIST_PATH);
            } catch (err: unknown) {
              const e = err as { message?: string };
              alert(e.message || 'Erro ao salvar política');
            }
          }}
          onCancel={() => navigate(LIST_PATH)}
        />
      )}
    </EntityFormPageShell>
  );
}

export function PolicyFormFields({
  policy,
  onSave,
  onCancel,
}: {
  policy: Policy | null;
  onSave: (data: Partial<Policy>) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Partial<Policy>>(
    policy || {
      name: '',
      minTemp: -85,
      maxTemp: -75,
      hysteresis: 2,
      minimumDuration: 30,
      temperatureUnit: '°C',
      effectivePeriod: { start: new Date(), end: new Date() },
    },
  );

  const setPeriodBound = (bound: 'start' | 'end', value: string) =>
    setFormData({
      ...formData,
      effectivePeriod: {
        start: formData.effectivePeriod?.start ?? new Date(),
        end: formData.effectivePeriod?.end ?? null,
        [bound]: new Date(value),
      },
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form" data-testid="policy-form">
      <div className="form-grid">
        <Input
          label="Nome da Política"
          type="text"
          value={formData.name || ''}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          helperText="Identifica a política na listagem e nos alertas. Ex.: Freezer -80."
          required
        />
        <Input
          label="Limite Mínimo"
          type="number"
          step="0.1"
          value={formData.minTemp || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              minTemp: parseFloat(e.target.value),
            })
          }
          helperText="Temperatura mínima permitida. Deve ser menor que a temperatura alvo."
          required
        />
        <Input
          label="Limite Máximo"
          type="number"
          step="0.1"
          value={formData.maxTemp || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              maxTemp: parseFloat(e.target.value),
            })
          }
          helperText="Temperatura máxima permitida. Deve ser maior que a temperatura alvo."
          required
        />
        <Input
          label="Histerese"
          type="number"
          step="0.1"
          value={formData.hysteresis || ''}
          onChange={(e) => setFormData({ ...formData, hysteresis: parseFloat(e.target.value) })}
          helperText="Margem de tolerância para evitar alertas frequentes. Valor recomendado: 1-5 unidades."
        />
        <Input
          label="Duração Mínima da Excursão (minutos)"
          type="number"
          value={formData.minimumDuration || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              minimumDuration: parseInt(e.target.value, 10),
            })
          }
          helperText="Tempo em minutos que a temperatura deve permanecer fora dos limites antes de as amostras serem marcadas como comprometidas."
        />
        <div className="form-grid-full">
          <p className="input-label">Unidade de Temperatura</p>
          <p
            className="form-help-text"
            data-testid="policy-temperature-unit"
            style={{ fontSize: '0.875rem', color: 'var(--text-light)' }}
          >
            Celsius (°C). Todas as temperaturas desta política são em °C.
          </p>
        </div>
        <Input
          label="Válido De"
          type="date"
          value={
            formData.effectivePeriod?.start
              ? new Date(formData.effectivePeriod.start).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) => setPeriodBound('start', e.target.value)}
          helperText="Data de início da vigência desta política. Deve ser anterior à data de término."
          required
        />
        <Input
          label="Válido Até"
          type="date"
          value={
            formData.effectivePeriod?.end
              ? new Date(formData.effectivePeriod.end).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) => setPeriodBound('end', e.target.value)}
          helperText="Data de término da vigência desta política. Deve ser posterior à data de início."
          required
        />
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" data-testid="policy-form-submit">
          Salvar
        </Button>
      </div>
    </form>
  );
}
