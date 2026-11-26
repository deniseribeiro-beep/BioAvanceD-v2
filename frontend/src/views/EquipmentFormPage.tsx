import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import { useEquipment } from '../hooks/useEquipment';
import { useOrganizations } from '../hooks/useOrganizations';
import { useLanguage } from '../contexts/LanguageContext';
import { Equipment } from '../types/models';
import { equipmentService } from '../services/api';

export const LIST_PATH = '/facility-management?tab=equipment';

export function equipmentFormEditPath(item: Equipment): string {
  const id = (item as { _id?: string })._id
    ? String((item as { _id?: string })._id)
    : String(item.equipmentID);
  return `/equipment/${id}/edit`;
}

export function findEquipmentInList(list: Equipment[], id: string): Equipment | undefined {
  return list.find((e) => {
    const eqId = (e as { _id?: string })._id || e.equipmentID;
    return String(eqId) === id || String(e.equipmentID) === id;
  });
}

export function resolveEquipmentUpdateId(equipment: Equipment): string {
  return (equipment as { _id?: string })._id
    ? String((equipment as { _id?: string })._id)
    : String(equipment.equipmentID);
}

export default function EquipmentFormPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { equipment, createEquipment, updateEquipment, loadEquipment } = useEquipment();
  const isNew = !id;

  const [fetched, setFetched] = useState<Equipment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fromState = (location.state as { equipment?: Equipment } | null)?.equipment ?? null;

  const editingEquipment = useMemo(() => {
    if (fromState) return fromState;
    if (!id) return null;
    return findEquipmentInList(equipment, id) ?? fetched;
  }, [fromState, equipment, id, fetched]);

  useEffect(() => {
    if (!id || fromState || findEquipmentInList(equipment, id)) return;
    const numericId = /^\d+$/.test(id) ? Number(id) : null;
    if (numericId === null) return;
    let cancelled = false;
    equipmentService
      .getById(numericId)
      .then((res: unknown) => {
        if (cancelled) return;
        const data = (res as { data?: Equipment })?.data ?? (res as Equipment);
        setFetched(data);
      })
      .catch((err: { message?: string }) => {
        if (!cancelled) setLoadError(err?.message || 'Erro ao carregar equipamento');
      });
    return () => {
      cancelled = true;
    };
  }, [id, fromState, equipment]);

  const title = editingEquipment
    ? t('facility.equipment.editTitle', 'Editar Equipamento')
    : t('facility.equipment.newTitle', 'Novo Equipamento');

  return (
    <EntityFormPageShell title={title} backTo={LIST_PATH} testId="equipment-form-page">
      {loadError && <p style={{ color: 'var(--danger)' }}>{loadError}</p>}
      {id && !editingEquipment && !loadError ? (
        <p>{t('common.loading')}</p>
      ) : (
        <EquipmentFormFields
          equipment={isNew ? null : editingEquipment}
          onSave={async (data) => {
            try {
              if (editingEquipment && !isNew) {
                await updateEquipment(resolveEquipmentUpdateId(editingEquipment), data);
              } else {
                await createEquipment(data);
              }
              await loadEquipment();
              navigate(LIST_PATH);
            } catch (err: unknown) {
              const e = err as {
                response?: { data?: { message?: string; error?: string } };
                message?: string;
              };
              const errorMessage =
                e.response?.data?.message ||
                e.response?.data?.error ||
                e.message ||
                'Erro ao salvar equipamento';
              alert(errorMessage);
            }
          }}
          onCancel={() => navigate(LIST_PATH)}
        />
      )}
    </EntityFormPageShell>
  );
}

export function EquipmentFormFields({
  equipment,
  onSave,
  onCancel,
}: {
  equipment: Equipment | null;
  onSave: (data: Partial<Equipment>) => void;
  onCancel: () => void;
}) {
  const { organizations } = useOrganizations();

  const [formData, setFormData] = useState<Partial<Equipment>>(() => {
    if (equipment) {
      return {
        equipmentDescription: equipment.equipmentDescription || '',
        model: equipment.model || '',
        serialNumber: equipment.serialNumber || '',
        purchaseDate: equipment.purchaseDate ? new Date(equipment.purchaseDate) : undefined,
        organizationId: equipment.organizationId || null,
      };
    }
    return {
      equipmentDescription: '',
      model: '',
      serialNumber: '',
      purchaseDate: undefined,
      organizationId: null,
    };
  });

  useEffect(() => {
    if (equipment) {
      setFormData({
        equipmentDescription: equipment.equipmentDescription || '',
        model: equipment.model || '',
        serialNumber: equipment.serialNumber || '',
        purchaseDate: equipment.purchaseDate ? new Date(equipment.purchaseDate) : undefined,
        organizationId: equipment.organizationId || null,
      });
    } else {
      setFormData({
        equipmentDescription: '',
        model: '',
        serialNumber: '',
        purchaseDate: undefined,
        organizationId: null,
      });
    }
  }, [equipment]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form" data-testid="equipment-form">
      <div className="form-grid">
        <Input
          data-testid="equipment-description-input"
          label="Descrição do Equipamento"
          value={formData.equipmentDescription || ''}
          onChange={(e) =>
            setFormData({ ...formData, equipmentDescription: e.target.value })
          }
          required
        />
        <Input
          data-testid="equipment-model-input"
          label="Modelo"
          value={formData.model || ''}
          onChange={(e) => setFormData({ ...formData, model: e.target.value })}
          placeholder="Ex: Freezer -80°C, Refrigerador 4°C"
        />
        <Input
          data-testid="equipment-serial-input"
          label="Número de Série"
          value={formData.serialNumber || ''}
          onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
          placeholder="Ex: SN123456789"
        />
        <Input
          data-testid="equipment-purchase-date-input"
          label="Data da Compra"
          type="date"
          value={
            formData.purchaseDate
              ? new Date(formData.purchaseDate).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              purchaseDate: e.target.value ? new Date(e.target.value) : undefined,
            })
          }
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="equipmentOrganizationSelect">
            Organização
          </label>
          <select
            id="equipmentOrganizationSelect"
            data-testid="equipment-organization-select"
            className="input"
            value={formData.organizationId || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                organizationId: e.target.value || null,
              })
            }
          >
            <option value="">Selecione uma organização</option>
            {organizations.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.officialName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-actions">
        <Button data-testid="equipment-cancel-button" type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button data-testid="equipment-save-button" type="submit">
          Salvar
        </Button>
      </div>
    </form>
  );
}
