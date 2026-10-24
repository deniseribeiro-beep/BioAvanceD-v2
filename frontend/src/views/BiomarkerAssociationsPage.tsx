import { FormEvent, useCallback, useEffect, useState } from 'react';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { biomarkerAssociationService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import type { BiomarkerAssociation, BiomarkerEvidenceReference, BiomarkerRole, Coding } from '../types/models';

/**
 * ELM-0275..0285 (#1402): the entry screen for BiomarkerAssociation rows,
 * which the /suggest fallback reads. It enters the five required fields, plus
 * biomarkerId on create; the 0..1 fields are left to the API, and an edit
 * sends only the five, so the PUT keeps whatever else the row holds. The
 * rules stay on the backend; this page only sends what the operator typed.
 */

// The backend model's CONDITION_SYSTEMS (ENUM-0096..0098).
const CONDITION_SYSTEMS = [
  { uri: 'http://www.orpha.net', label: 'ORPHA' },
  { uri: 'http://id.who.int/icd/release/11/mms', label: 'ICD-11' },
  { uri: 'http://purl.obolibrary.org/obo/mondo.owl', label: 'MONDO' },
];

// The backend model's BIOMARKER_ROLES (ELM-0279).
const BIOMARKER_ROLES: BiomarkerRole[] = ['diagnostic', 'prognostic', 'risk', 'safety', 'monitoring', 'response'];

// ENUM-0099/0100.
const EVIDENCE_SYSTEMS: BiomarkerEvidenceReference['system'][] = ['DOI', 'PMID'];

type CodingRow = { systemUri: string; code: string; version: string; display: string };
type EvidenceRow = { system: string; value: string };
type FormState = {
  biomarkerId: string;
  analyte: CodingRow;
  associatedCondition: CodingRow[];
  biomarkerRole: string;
  contextOfUse: string;
  evidenceReferences: EvidenceRow[];
};

const emptyCoding = (systemUri = ''): CodingRow => ({ systemUri, code: '', version: '', display: '' });
const emptyEvidence = (): EvidenceRow => ({ system: 'DOI', value: '' });

function emptyForm(): FormState {
  return {
    biomarkerId: '',
    analyte: emptyCoding(),
    associatedCondition: [emptyCoding(CONDITION_SYSTEMS[0].uri)],
    biomarkerRole: '',
    contextOfUse: '',
    evidenceReferences: [emptyEvidence()],
  };
}

function codingRow(coding: Partial<Coding> | null | undefined): CodingRow {
  return {
    systemUri: coding?.systemUri ?? '',
    code: coding?.code ?? '',
    version: coding?.version ?? '',
    display: coding?.display ?? '',
  };
}

function formOf(row: BiomarkerAssociation): FormState {
  const conditions = Array.isArray(row.associatedCondition) ? row.associatedCondition : [];
  const evidence = Array.isArray(row.evidenceReferences) ? row.evidenceReferences : [];
  return {
    biomarkerId: row.biomarkerId,
    analyte: codingRow(row.analyte),
    associatedCondition: conditions.length > 0 ? conditions.map(codingRow) : [emptyCoding(CONDITION_SYSTEMS[0].uri)],
    biomarkerRole: row.biomarkerRole ?? '',
    contextOfUse: row.contextOfUse ?? '',
    evidenceReferences: evidence.length > 0
      ? evidence.map((item) => ({ system: item?.system ?? 'DOI', value: item?.value ?? '' }))
      : [emptyEvidence()],
  };
}

// A blank display or version is left out of the Coding.
function toCoding(row: CodingRow): Coding {
  const coding: Coding = { systemUri: row.systemUri.trim(), code: row.code.trim() };
  const version = row.version.trim();
  if (version) coding.version = version;
  const display = row.display.trim();
  if (display) coding.display = display;
  return coding;
}

// The five required fields, which are all an edit sends.
function requiredFieldsOf(form: FormState) {
  return {
    analyte: toCoding(form.analyte),
    associatedCondition: form.associatedCondition.map(toCoding),
    biomarkerRole: form.biomarkerRole.trim() as BiomarkerRole,
    contextOfUse: form.contextOfUse.trim(),
    evidenceReferences: form.evidenceReferences.map((item) => ({
      system: item.system.trim() as BiomarkerEvidenceReference['system'],
      value: item.value.trim(),
    })),
  };
}

function errorMessages(err: any, fallback: string): string[] {
  const data = err?.response?.data;
  const message = data?.message || data?.error || err?.message || fallback;
  const details = Array.isArray(data?.details)
    ? data.details.map((item: any) => (typeof item === 'string' ? item : item?.message)).filter(Boolean)
    : [];
  return [message, ...details];
}

function codingLabel(coding: Partial<Coding> | null | undefined): string {
  return coding?.display || coding?.code || '-';
}

export default function BiomarkerAssociationsPage() {
  const [rows, setRows] = useState<BiomarkerAssociation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string[] | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<BiomarkerAssociation | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await biomarkerAssociationService.getAll();
      setRows(extractResponseItems<BiomarkerAssociation>(response));
    } catch (err: any) {
      setLoadError(errorMessages(err, 'Erro ao carregar as associações de biomarcadores'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openModal = (row: BiomarkerAssociation | null) => {
    setEditing(row);
    setSaveErrors(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditing(null);
    setSaveErrors(null);
  };

  const save = async (form: FormState) => {
    const fields = requiredFieldsOf(form);
    const biomarkerId = editing ? editing.biomarkerId : form.biomarkerId.trim();
    setSaving(true);
    setSaveErrors(null);
    try {
      if (editing) {
        await biomarkerAssociationService.update(editing.biomarkerId, fields);
      } else {
        // A blank biomarkerId is left out, so the backend generates it.
        await biomarkerAssociationService.create(biomarkerId ? { biomarkerId, ...fields } : fields);
      }
      closeModal();
      await load();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setSaveErrors([`Já existe uma associação com o biomarkerId ${biomarkerId}.`]);
      } else {
        setSaveErrors(errorMessages(err, 'Erro ao salvar a associação'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Associações de Biomarcadores</h1>
          <p className="page-subtitle">Biomarcadores, as condições a que se associam e as evidências que os sustentam</p>
        </div>
        <Button onClick={() => openModal(null)}>
          <Plus size={18} />
          Nova Associação
        </Button>
      </div>

      {loading && <p>Carregando...</p>}
      {loadError && (
        <div style={{ color: 'var(--danger)' }}>
          {loadError.map((message) => <p key={message}>Erro: {message}</p>)}
        </div>
      )}

      <Card>
        <Table headers={['biomarkerId', 'Analito', 'Condições', 'Papel', 'Contexto de uso', 'Evidências', 'Ações']}>
          {rows.map((row) => (
            <tr key={row.biomarkerId}>
              <td>{row.biomarkerId}</td>
              <td>{codingLabel(row.analyte)}</td>
              <td>{(row.associatedCondition || []).map((item) => item?.code).join(', ')}</td>
              <td>{row.biomarkerRole}</td>
              <td>{row.contextOfUse}</td>
              <td>{(row.evidenceReferences || []).map((item) => `${item?.system}:${item?.value}`).join(', ')}</td>
              <td>
                <div className="table-actions">
                  <button className="action-button" onClick={() => openModal(row)} title="Editar">
                    <Edit size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editing ? 'Editar Associação' : 'Nova Associação'}
      >
        <BiomarkerAssociationForm
          initial={editing ? formOf(editing) : emptyForm()}
          editing={Boolean(editing)}
          errors={saveErrors}
          saving={saving}
          onSave={save}
          onCancel={closeModal}
        />
      </Modal>
    </div>
  );
}

function BiomarkerAssociationForm({
  initial,
  editing,
  errors,
  saving,
  onSave,
  onCancel,
}: {
  initial: FormState;
  editing: boolean;
  errors: string[] | null;
  saving: boolean;
  onSave: (form: FormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);

  const setAnalyte = (key: keyof CodingRow, value: string) =>
    setForm((prev) => ({ ...prev, analyte: { ...prev.analyte, [key]: value } }));
  const setCondition = (index: number, key: keyof CodingRow, value: string) =>
    setForm((prev) => ({
      ...prev,
      associatedCondition: prev.associatedCondition.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  const setEvidence = (index: number, key: keyof EvidenceRow, value: string) =>
    setForm((prev) => ({
      ...prev,
      evidenceReferences: prev.evidenceReferences.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      {errors && (
        <div role="alert" style={{ color: 'var(--danger)' }}>
          {errors.map((message) => <p key={message}>{message}</p>)}
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
                <label htmlFor={`condition-system-${index}`} className="input-label">Sistema da condição {n}</label>
                <select
                  id={`condition-system-${index}`}
                  className="input"
                  value={row.systemUri}
                  onChange={(e) => setCondition(index, 'systemUri', e.target.value)}
                  required
                >
                  {systems.map((item) => <option key={item.uri} value={item.uri}>{item.label}</option>)}
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
                onClick={() => setForm((prev) => ({
                  ...prev,
                  associatedCondition: prev.associatedCondition.filter((_, i) => i !== index),
                }))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setForm((prev) => ({
            ...prev,
            associatedCondition: [...prev.associatedCondition, emptyCoding(CONDITION_SYSTEMS[0].uri)],
          }))}
        >
          <Plus size={16} />
          Adicionar condição
        </Button>
      </fieldset>

      <div className="form-grid">
        <div className="input-group">
          <label htmlFor="biomarker-role" className="input-label">Papel do biomarcador</label>
          <select
            id="biomarker-role"
            className="input"
            value={form.biomarkerRole}
            onChange={(e) => setForm({ ...form, biomarkerRole: e.target.value })}
            required
          >
            <option value="">Selecione</option>
            {BIOMARKER_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label htmlFor="context-of-use" className="input-label">Contexto de uso</label>
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
                <label htmlFor={`evidence-system-${index}`} className="input-label">Sistema da evidência {n}</label>
                <select
                  id={`evidence-system-${index}`}
                  className="input"
                  value={row.system}
                  onChange={(e) => setEvidence(index, 'system', e.target.value)}
                  required
                >
                  {systems.map((system) => <option key={system} value={system}>{system}</option>)}
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
                onClick={() => setForm((prev) => ({
                  ...prev,
                  evidenceReferences: prev.evidenceReferences.filter((_, i) => i !== index),
                }))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setForm((prev) => ({ ...prev, evidenceReferences: [...prev.evidenceReferences, emptyEvidence()] }))}
        >
          <Plus size={16} />
          Adicionar evidência
        </Button>
      </fieldset>

      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>Salvar</Button>
      </div>
    </form>
  );
}
