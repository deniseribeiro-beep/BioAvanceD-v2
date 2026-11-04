import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import { Plus, Trash2 } from 'lucide-react';
import { biomarkerAssociationService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import type { BiomarkerAssociation, BiomarkerEvidenceReference } from '../types/models';
import {
  BIOMARKER_ROLES,
  BiomarkerAssociationFormState,
  CONDITION_SYSTEMS,
  EVIDENCE_SYSTEMS,
  biomarkerAssociationErrorMessages,
  biomarkerAssociationFormOf,
  emptyBiomarkerAssociationForm,
  emptyCoding,
  emptyEvidence,
  requiredBiomarkerAssociationFieldsOf,
} from './biomarkerAssociationForm';

const LIST_PATH = '/biomarker-associations';

export default function BiomarkerAssociationFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  const fromState = (location.state as { association?: BiomarkerAssociation } | null)?.association ?? null;
  const [fetched, setFetched] = useState<BiomarkerAssociation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const editing = useMemo(() => {
    if (fromState) return fromState;
    if (!id) return null;
    return fetched;
  }, [fromState, id, fetched]);

  useEffect(() => {
    if (!id || fromState) return;
    let cancelled = false;
    biomarkerAssociationService
      .getAll()
      .then((response) => {
        if (cancelled) return;
        const match = extractResponseItems<BiomarkerAssociation>(response).find(
          (row) => row.biomarkerId === id
        );
        if (match) {
          setFetched(match);
        } else {
          setLoadError('Associação não encontrada');
        }
      })
      .catch((err: any) => {
        if (!cancelled) setLoadError(err?.message || 'Erro ao carregar associação');
      });
    return () => {
      cancelled = true;
    };
  }, [id, fromState]);

  const title = editing || id ? 'Editar Associação' : 'Nova Associação';

  const save = async (form: BiomarkerAssociationFormState) => {
    const fields = requiredBiomarkerAssociationFieldsOf(form);
    const biomarkerId = editing ? editing.biomarkerId : form.biomarkerId.trim();
    setSaving(true);
    setSaveErrors(null);
    try {
      if (editing) {
        await biomarkerAssociationService.update(editing.biomarkerId, fields);
      } else {
        await biomarkerAssociationService.create(biomarkerId ? { biomarkerId, ...fields } : fields);
      }
      navigate(LIST_PATH);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setSaveErrors([`Já existe uma associação com o biomarkerId ${biomarkerId}.`]);
      } else {
        setSaveErrors(biomarkerAssociationErrorMessages(err, 'Erro ao salvar a associação'));
      }
    } finally {
      setSaving(false);
    }
  };

  const initial = editing
    ? biomarkerAssociationFormOf(editing)
    : isNew
      ? emptyBiomarkerAssociationForm()
      : emptyBiomarkerAssociationForm();

  return (
    <EntityFormPageShell title={title} backTo={LIST_PATH} testId="biomarker-association-form-page">
      {loadError && <p style={{ color: 'var(--danger)' }}>{loadError}</p>}
      {!isNew && !editing && !loadError ? (
        <p>Carregando...</p>
      ) : (
        <BiomarkerAssociationFormFields
          key={editing?.biomarkerId ?? 'new'}
          initial={initial}
          editing={Boolean(editing || id)}
          errors={saveErrors}
          saving={saving}
          onSave={save}
          onCancel={() => navigate(LIST_PATH)}
        />
      )}
    </EntityFormPageShell>
  );
}

export function BiomarkerAssociationFormFields({
  initial,
  editing,
  errors,
  saving,
  onSave,
  onCancel,
}: {
  initial: BiomarkerAssociationFormState;
  editing: boolean;
  errors: string[] | null;
  saving: boolean;
  onSave: (form: BiomarkerAssociationFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BiomarkerAssociationFormState>(initial);

  const setAnalyte = (key: keyof BiomarkerAssociationFormState['analyte'], value: string) =>
    setForm((prev) => ({ ...prev, analyte: { ...prev.analyte, [key]: value } }));
  const setCondition = (index: number, key: keyof BiomarkerAssociationFormState['analyte'], value: string) =>
    setForm((prev) => ({
      ...prev,
      associatedCondition: prev.associatedCondition.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  const setEvidence = (index: number, key: 'system' | 'value', value: string) =>
    setForm((prev) => ({
      ...prev,
      evidenceReferences: prev.evidenceReferences.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="form" data-testid="biomarker-association-form">
      {errors && (
        <div role="alert" style={{ color: 'var(--danger)' }}>
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
      <div className="form-grid">
        <Input
          label="biomarkerId"
          value={form.biomarkerId}
          onChange={(e) => setForm({ ...form, biomarkerId: e.target.value })}
          disabled={editing}
          helperText={editing ? undefined : 'Em branco, o servidor gera o identificador.'}
        />
        <Input
          label="Sistema do analito"
          value={form.analyte.systemUri}
          onChange={(e) => setAnalyte('systemUri', e.target.value)}
          required
        />
        <Input
          label="Código do analito"
          value={form.analyte.code}
          onChange={(e) => setAnalyte('code', e.target.value)}
          required
        />
        <Input
          label="Nome do analito"
          value={form.analyte.display}
          onChange={(e) => setAnalyte('display', e.target.value)}
        />
      </div>

      <fieldset>
        <legend>Condições associadas</legend>
        {form.associatedCondition.map((row, index) => {
          const n = index + 1;
          const systems = CONDITION_SYSTEMS.some((item) => item.uri === row.systemUri)
            ? CONDITION_SYSTEMS
            : [...CONDITION_SYSTEMS, { uri: row.systemUri, label: row.systemUri }];
          return (
            <div className="form-grid" key={index}>
              <div className="input-group">
                <label htmlFor={`condition-system-${index}`} className="input-label">
                  Sistema da condição {n}
                </label>
                <select
                  id={`condition-system-${index}`}
                  className="input"
                  value={row.systemUri}
                  onChange={(e) => setCondition(index, 'systemUri', e.target.value)}
                  required
                >
                  {systems.map((item) => (
                    <option key={item.uri} value={item.uri}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label={`Código da condição ${n}`}
                value={row.code}
                onChange={(e) => setCondition(index, 'code', e.target.value)}
                required
              />
              <Input
                label={`Nome da condição ${n}`}
                value={row.display}
                onChange={(e) => setCondition(index, 'display', e.target.value)}
              />
              <button
                type="button"
                className="action-button danger"
                aria-label={`Remover condição ${n}`}
                title={`Remover condição ${n}`}
                disabled={form.associatedCondition.length === 1}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    associatedCondition: prev.associatedCondition.filter((_, i) => i !== index),
                  }))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setForm((prev) => ({
              ...prev,
              associatedCondition: [...prev.associatedCondition, emptyCoding(CONDITION_SYSTEMS[0].uri)],
            }))
          }
        >
          <Plus size={16} />
          Adicionar condição
        </Button>
      </fieldset>

      <div className="form-grid">
        <div className="input-group">
          <label htmlFor="biomarker-role" className="input-label">
            Papel do biomarcador
          </label>
          <select
            id="biomarker-role"
            className="input"
            value={form.biomarkerRole}
            onChange={(e) => setForm({ ...form, biomarkerRole: e.target.value })}
            required
          >
            <option value="">Selecione</option>
            {BIOMARKER_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="input-group">
          <label htmlFor="context-of-use" className="input-label">
            Contexto de uso
          </label>
          <textarea
            id="context-of-use"
            className="input"
            value={form.contextOfUse}
            onChange={(e) => setForm({ ...form, contextOfUse: e.target.value })}
            required
          />
        </div>
      </div>

      <fieldset>
        <legend>Evidências</legend>
        {form.evidenceReferences.map((row, index) => {
          const n = index + 1;
          const systems: string[] = EVIDENCE_SYSTEMS.includes(row.system as BiomarkerEvidenceReference['system'])
            ? EVIDENCE_SYSTEMS
            : [...EVIDENCE_SYSTEMS, row.system];
          return (
            <div className="form-grid" key={index}>
              <div className="input-group">
                <label htmlFor={`evidence-system-${index}`} className="input-label">
                  Sistema da evidência {n}
                </label>
                <select
                  id={`evidence-system-${index}`}
                  className="input"
                  value={row.system}
                  onChange={(e) => setEvidence(index, 'system', e.target.value)}
                  required
                >
                  {systems.map((system) => (
                    <option key={system} value={system}>
                      {system}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label={`Valor da evidência ${n}`}
                value={row.value}
                onChange={(e) => setEvidence(index, 'value', e.target.value)}
                required
              />
              <button
                type="button"
                className="action-button danger"
                aria-label={`Remover evidência ${n}`}
                title={`Remover evidência ${n}`}
                disabled={form.evidenceReferences.length === 1}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    evidenceReferences: prev.evidenceReferences.filter((_, i) => i !== index),
                  }))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setForm((prev) => ({ ...prev, evidenceReferences: [...prev.evidenceReferences, emptyEvidence()] }))
          }
        >
          <Plus size={16} />
          Adicionar evidência
        </Button>
      </fieldset>

      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
