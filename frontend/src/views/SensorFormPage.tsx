import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import { useSensors } from '../hooks/useSensors';
import { usePolicies } from '../hooks/usePolicies';
import { useOrganizations } from '../hooks/useOrganizations';
import { useLanguage } from '../contexts/LanguageContext';
import { Sensor } from '../types/models';
import { sensorService } from '../services/api';
import { storageApi } from '../services/storageApi';
import { MAINTENANCE_STATUS_OPTIONS } from '../config/constants/sensor.constants';

export const LIST_PATH = '/facility-management?tab=sensors';

export function resolveSensorId(sensor: Sensor): string | undefined {
  return sensor.sensorID || (sensor as { sensorId?: string }).sensorId || sensor._id;
}

export function sensorFormEditPath(sensor: Sensor): string {
  const sensorId = resolveSensorId(sensor) ?? 'undefined';
  return `/sensors/${sensorId}/edit`;
}

export function findSensorInList(list: Sensor[], id: string): Sensor | undefined {
  return list.find((s) => {
    const sid = resolveSensorId(s);
    return sid != null && String(sid) === id;
  });
}

export default function SensorFormPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { sensors, createSensor, updateSensor } = useSensors();
  const isNew = !id;

  const [fetched, setFetched] = useState<Sensor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fromState = (location.state as { sensor?: Sensor } | null)?.sensor ?? null;

  const editingSensor = useMemo(() => {
    if (fromState) return fromState;
    if (!id) return null;
    return findSensorInList(sensors, id) ?? fetched;
  }, [fromState, sensors, id, fetched]);

  useEffect(() => {
    if (!id || fromState || findSensorInList(sensors, id)) return;
    let cancelled = false;
    sensorService
      .getById(id)
      .then((res: unknown) => {
        if (cancelled) return;
        const data = (res as { data?: Sensor })?.data ?? (res as Sensor);
        setFetched(data);
      })
      .catch((err: { message?: string }) => {
        if (!cancelled) setLoadError(err?.message || 'Erro ao carregar sensor');
      });
    return () => {
      cancelled = true;
    };
  }, [id, fromState, sensors]);

  const title = editingSensor
    ? t('facility.sensors.editTitle', 'Editar Sensor')
    : t('facility.sensors.newTitle', 'Novo Sensor');

  return (
    <EntityFormPageShell title={title} backTo={LIST_PATH} testId="sensor-form-page">
      {loadError && <p style={{ color: 'var(--danger)' }}>{loadError}</p>}
      {id && !editingSensor && !loadError ? (
        <p>{t('common.loading')}</p>
      ) : (
        <SensorFormFields
          sensor={isNew ? null : editingSensor}
          onSave={async (data) => {
            try {
              if (editingSensor && !isNew) {
                const sensorId = resolveSensorId(editingSensor);
                if (!sensorId) {
                  throw new Error('ID do sensor não encontrado');
                }
                await updateSensor(String(sensorId), data);
              } else {
                await createSensor(data);
              }
              navigate(LIST_PATH);
            } catch (err: unknown) {
              const e = err as { message?: string };
              alert(e.message || 'Erro ao salvar sensor');
            }
          }}
          onCancel={() => navigate(LIST_PATH)}
        />
      )}
    </EntityFormPageShell>
  );
}

export function SensorFormFields({
  sensor,
  onSave,
  onCancel,
}: {
  sensor: Sensor | null;
  onSave: (data: Partial<Sensor>) => void;
  onCancel: () => void;
}) {
  const { policies } = usePolicies();
  const { organizations } = useOrganizations();
  const [freezers, setFreezers] = useState<{ _id: string; name: string; containerID?: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    storageApi.listFreezers().then((response) => {
      if (!cancelled && response.success && Array.isArray(response.data)) {
        setFreezers(response.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [formData, setFormData] = useState<Partial<Sensor>>(
    sensor || {
      sensorType: '',
      sensorModel: '',
      maintenanceStatus: 'operational',
      lastCalibration: null,
      nextCalibration: null,
      calibrationCertificate: '',
      locationID: undefined,
      temperaturePolicy: undefined,
      macAddress: '',
      storageContainer: undefined,
      organizationId: null,
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form" data-testid="sensor-form">
      <div className="form-grid">
        {!sensor && (
          <Input
            label="ID do Sensor"
            data-testid="sensor-id-input"
            value={formData.sensorID || ''}
            onChange={(e) => setFormData({ ...formData, sensorID: e.target.value })}
            required
          />
        )}
        <Input
          label="Tipo de Sensor"
          data-testid="sensor-type-input"
          value={formData.sensorType || ''}
          onChange={(e) => setFormData({ ...formData, sensorType: e.target.value })}
          required
        />
        <Input
          label="Modelo"
          value={formData.sensorModel || ''}
          onChange={(e) => setFormData({ ...formData, sensorModel: e.target.value })}
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="maintenanceStatusSelect">
            Status de Manutenção
          </label>
          <select
            id="maintenanceStatusSelect"
            className="input"
            value={formData.maintenanceStatus || 'operational'}
            onChange={(e) => setFormData({ ...formData, maintenanceStatus: e.target.value })}
          >
            {MAINTENANCE_STATUS_OPTIONS.map((option, index) => (
              <option key={`${option.value}-${index}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Última Calibração"
          type="date"
          value={
            formData.lastCalibration
              ? new Date(formData.lastCalibration).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              lastCalibration: e.target.value ? new Date(e.target.value) : null,
            })
          }
        />
        <Input
          label="Próxima Calibração"
          type="date"
          value={
            formData.nextCalibration
              ? new Date(formData.nextCalibration).toISOString().split('T')[0]
              : ''
          }
          onChange={(e) =>
            setFormData({
              ...formData,
              nextCalibration: e.target.value ? new Date(e.target.value) : null,
            })
          }
        />
        <Input
          label="Certificado de Calibração"
          value={formData.calibrationCertificate || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              calibrationCertificate: e.target.value,
            })
          }
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="sensorLocationSelect">
            Localização
          </label>
          <select
            id="sensorLocationSelect"
            className="input"
            value={formData.locationID || ''}
            onChange={(e) =>
              setFormData({
                ...formData,
                locationID: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })
            }
          >
            <option value="">Selecione um freezer</option>
            {freezers
              .filter((freezer) => freezer.containerID !== undefined && freezer.containerID !== null)
              .map((freezer) => (
                <option key={freezer._id} value={String(freezer.containerID)}>
                  {freezer.name}
                </option>
              ))}
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label" htmlFor="sensorPolicySelect">
            Política de Temperatura
          </label>
          <select
            id="sensorPolicySelect"
            data-testid="sensor-policy-select"
            className="input"
            value={formData.temperaturePolicy || ''}
            disabled={!formData.macAddress}
            onChange={(e) =>
              setFormData({
                ...formData,
                temperaturePolicy: e.target.value || undefined,
              })
            }
          >
            <option value="">
              {formData.macAddress
                ? 'Selecione uma política'
                : 'Informe o MAC Address para vincular uma política'}
            </option>
            {policies
              .filter((policy) => policy && policy._id)
              .map((policy) => (
                <option key={policy._id} value={policy._id}>
                  {policy.name || 'Política'} (Limites: {policy.minTemp} - {policy.maxTemp}
                  {policy.temperatureUnit})
                </option>
              ))}
          </select>
        </div>
        <Input
          label="MAC Address"
          data-testid="sensor-mac-address-input"
          placeholder="AA:BB:CC:DD:EE:FF"
          value={formData.macAddress || ''}
          onChange={(e) =>
            setFormData({
              ...formData,
              macAddress: e.target.value,
              ...(e.target.value ? {} : { temperaturePolicy: undefined, storageContainer: undefined }),
            })
          }
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="sensorStorageContainerSelect">
            Contêiner de Armazenamento (Freezer)
          </label>
          <select
            id="sensorStorageContainerSelect"
            data-testid="sensor-storage-container-select"
            className="input"
            value={formData.storageContainer || ''}
            disabled={!formData.macAddress}
            onChange={(e) =>
              setFormData({
                ...formData,
                storageContainer: e.target.value || undefined,
              })
            }
          >
            <option value="">
              {formData.macAddress
                ? 'Selecione um freezer'
                : 'Informe o MAC Address para vincular um freezer'}
            </option>
            {freezers.map((freezer) => (
              <option key={freezer._id} value={freezer._id}>
                {freezer.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grid-full">
          <label className="input-label" htmlFor="sensorOrganizationSelect">
            Organização
          </label>
          <select
            id="sensorOrganizationSelect"
            data-testid="sensor-organization-select"
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
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" data-testid="sensor-form-submit">
          Salvar
        </Button>
      </div>
    </form>
  );
}
