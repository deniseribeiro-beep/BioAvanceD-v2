import { useId } from 'react';
import { ArrowLeft } from 'lucide-react';
import Card from '../UI/Card';
import { Location, Patient, Sample } from '@/types/models';
import Button from '../UI/Button';
import Input from '../UI/Input';
import PatientSearchInput from '../UI/PatientSearchInput';
import {
  SPECIMEN_TYPES,
  SAMPLE_ORIGINS,
  EXTRACTION_PROTOCOLS,
  MIABIS_QUALITY,
} from '@/config/constants/specimen.constants';

type TranslatorFn = (key: string) => string;
type NewSampleFormData = Partial<Sample> & { registerDate?: string; quality?: number };
type XaiAlert = {
  ruleVersion: string;
  severity: 'medium' | 'high';
  justification: string;
} | null;

interface NewSamplePageViewProps {
  t: TranslatorFn;
  formData: NewSampleFormData;
  selectedUnit: string;
  selectedPatient: Patient | null;
  xaiAlert: XaiAlert;
  patientFetchLoading: boolean;
  resendingConsent: boolean;
  strictModeActivated: boolean;
  locations: Location[];
  locationsLoading: boolean;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onFormDataChange: (updater: (prev: NewSampleFormData) => NewSampleFormData) => void;
  onUnitChange: (unit: string) => void;
  onPatientIDChange: (patientID: string) => void;
  onValidationChange: (isValid: boolean | null) => void;
  onResendConsent: () => Promise<void>;
}

function formatDate(date: Date | string | undefined): string {
  if (!date) return '';
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  if (typeof date === 'string') {
    return date.split('T')[0];
  }
  return '';
}

export default function NewSamplePageView({
  t,
  formData,
  selectedUnit,
  selectedPatient,
  xaiAlert,
  patientFetchLoading,
  resendingConsent,
  strictModeActivated,
  locations,
  locationsLoading,
  onBack,
  onSubmit,
  onFormDataChange,
  onUnitChange,
  onPatientIDChange,
  onValidationChange,
  onResendConsent,
}: NewSamplePageViewProps) {
  const sampleTypeId = useId();
  const sampleOriginId = useId();
  const extractionProtocolId = useId();
  const unitId = useId();
  const qualityId = useId();
  const locationId = useId();
  const statusId = useId();
  const rareDiseaseId = useId();

  const sampleTypeOptions = SPECIMEN_TYPES.map(({ id, label }) => ({
    value: id,
    label: t(`samples.sampleTypeOptions.${id}`) || label,
  }));

  const sampleOriginOptions = SAMPLE_ORIGINS.map(({ id, label }) => ({
    value: id,
    label: t(`samples.sampleOriginOptions.${id}`) || label,
  }));

  const extractionProtocolOptions = EXTRACTION_PROTOCOLS.map(({ id, label }) => ({
    value: id,
    label: t(`samples.extractionProtocolOptions.${id}`) || label,
  }));

  const miabisQualityOptions = MIABIS_QUALITY.map(({ id, label }) => ({
    value: id,
    label: t(`samples.qualityMIABIS.${id}`) || label,
  }));

  const statusOptions = [
    { value: 'Available', label: t('samples.statusOptions.Available') || 'Disponível' },
    { value: 'Withdrawn', label: t('samples.statusOptions.Withdrawn') || 'Retirada' },
    { value: 'Expired', label: t('samples.statusOptions.Expired') || 'Expirada' },
    { value: 'Destroyed', label: t('samples.statusOptions.Destroyed') || 'Destruída' },
  ];

  if (locationsLoading && locations.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <p>{t('common.loading') || 'Carregando...'}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Button onClick={onBack} variant="secondary" style={{ minWidth: 'auto', padding: '0.5rem' }}>
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: 'var(--text)' }}>
            {t('samples.newTitle') || 'Nova Amostra'}
          </h1>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: 'var(--text-light)' }}>
            {t('samples.newSubtitle') || 'Cadastre uma nova amostra biológica'}
          </p>
        </div>
      </div>

      {xaiAlert && (
        <Card
          className="xai-alert-card"
          style={{
            marginBottom: '1.5rem',
            border: '1px solid rgba(220, 38, 38, 0.18)',
            background: 'linear-gradient(135deg, rgba(255, 251, 251, 1) 0%, rgba(254, 242, 242, 0.92) 100%)',
            boxShadow: '0 14px 36px rgba(220, 38, 38, 0.08)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#b91c1c' }}>
                  Alerta XAI
                </div>
                <h3 style={{ margin: '0.35rem 0 0', fontSize: '1rem', fontWeight: 700, color: '#7f1d1d' }}>
                  Regra clínica violada
                </h3>
              </div>

              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '999px',
                  backgroundColor: xaiAlert.severity === 'high' ? 'rgba(185, 28, 28, 0.12)' : 'rgba(217, 119, 6, 0.12)',
                  color: xaiAlert.severity === 'high' ? '#991b1b' : '#b45309',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {xaiAlert.severity}
              </span>
            </div>

            <div
              style={{
                padding: '0.9rem 1rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(255, 255, 255, 0.78)',
                border: '1px solid rgba(220, 38, 38, 0.12)',
                color: '#7f1d1d',
                fontSize: '0.92rem',
                lineHeight: 1.55,
              }}
            >
              {xaiAlert.justification}
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                paddingTop: '0.25rem',
                borderTop: '1px solid rgba(220, 38, 38, 0.1)',
                fontSize: '0.85rem',
                color: '#991b1b',
              }}
            >
              <span>
                Versão da regra: <strong>{xaiAlert.ruleVersion}</strong>
              </span>
              <span>
                Severidade: <strong>{xaiAlert.severity}</strong>
              </span>
            </div>
          </div>
        </Card>
      )}

      <form
        onSubmit={onSubmit}
        style={{ backgroundColor: 'var(--surface)', borderRadius: '8px', padding: '2rem', border: '1px solid var(--border)' }}
      >
        {selectedPatient?.status === 'PENDING_CONSENT' && (
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div style={{ color: '#92400e', fontSize: '0.9rem' }}>
              <strong>Consentimento pendente.</strong> O paciente ainda não confirmou o TCLE.
              {selectedPatient.consentTokenExpiresAt && (
                <span style={{ marginLeft: '0.5rem' }}>
                  Token válido até {new Date(selectedPatient.consentTokenExpiresAt).toLocaleDateString()}.
                </span>
              )}
            </div>
            <Button type="button" variant="secondary" onClick={onResendConsent} disabled={resendingConsent}>
              {resendingConsent ? 'Reenviando...' : 'Reenviar Notificações'}
            </Button>
          </div>
        )}

        {strictModeActivated && (
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#dcfce7',
              border: '1px solid #16a34a',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              color: '#166534',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            Modo Estrito Ativado
          </div>
        )}

        {patientFetchLoading && (
          <div style={{ marginBottom: '1rem', color: 'var(--text-light)', fontSize: '0.85rem' }}>
            Verificando status de consentimento...
          </div>
        )}

        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text)' }}>
            {t('common.basicData') || 'Dados Básicos'}
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <PatientSearchInput
              label={t('samples.patientID') || 'ID do Paciente'}
              value={String(formData.patientID || '')}
              onChange={onPatientIDChange}
              onValidationChange={onValidationChange}
              enableInitialDropdown
              initialLimit={20}
              required
              placeholder={t('samples.patientIDSearchPlaceholder') || 'Buscar por ID ou prontuário...'}
            />

            <Input
              label={`${t('samples.registerDate') || 'Data de Registro'} *`}
              type="date"
              value={formData.registerDate ? (typeof formData.registerDate === 'string' ? formData.registerDate.split('T')[0] : formatDate(formData.registerDate as any)) : ''}
              onChange={(e) =>
                onFormDataChange((prev) => ({
                  ...prev,
                  registerDate: e.target.value,
                  registrationDate: new Date(e.target.value).toISOString(),
                }))
              }
              required
            />

            <div>
              <label htmlFor={sampleTypeId} style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                {t('samples.sampleType') || 'Tipo de Amostra'} *
              </label>
              <select id={sampleTypeId} value={formData.sampleType || ''} onChange={(e) => onFormDataChange((prev) => ({ ...prev, sampleType: e.target.value }))} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">{t('samples.selectSampleType') || 'Selecione o tipo de amostra'}</option>
                {sampleTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={sampleOriginId} style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                {t('samples.sampleOrigin') || 'Origem da Amostra'} *
              </label>
              <select id={sampleOriginId} value={formData.sampleOrigin || ''} onChange={(e) => onFormDataChange((prev) => ({ ...prev, sampleOrigin: e.target.value }))} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">{t('samples.selectOrigin') || 'Selecione a origem'}</option>
                {sampleOriginOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={extractionProtocolId} style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                {t('samples.extractionProtocol') || 'Protocolo de Extração'} *
              </label>
              <select id={extractionProtocolId} value={formData.extractionProtocol || ''} onChange={(e) => onFormDataChange((prev) => ({ ...prev, extractionProtocol: e.target.value }))} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">{t('common.select') || 'Selecione'}</option>
                {extractionProtocolOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <Input
              label={t('samples.barcode') || 'Código de Barras'}
              type="text"
              value={formData.barcode ? String(formData.barcode) : ''}
              onChange={(e) => onFormDataChange((prev) => ({ ...prev, barcode: e.target.value as any }))}
              placeholder="BR-2024-001 (será gerado automaticamente se vazio)"
              helperText={t('samples.barcodeAutoGenerated') || 'Deixe vazio para gerar automaticamente no formato BR-YYYY-NNN'}
            />

            <div>
              <label htmlFor={rareDiseaseId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.75rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                <input
                  id={rareDiseaseId}
                  type="checkbox"
                  checked={formData.isRareDisease === true}
                  onChange={(e) => onFormDataChange((prev) => ({ ...prev, isRareDisease: e.target.checked }))}
                />
                Doença Rara
              </label>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text)' }}>
            {t('common.quantity') || 'Quantidade e Qualidade'}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <div>
              <label htmlFor={unitId} style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                {t('samples.unit') || 'Unidade de Medida'} *
              </label>
              <select id={unitId} value={selectedUnit} onChange={(e) => onUnitChange(e.target.value)} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">{t('samples.selectUnit') || 'Selecione a unidade'}</option>
                <option value="µL">µL (Microlitros)</option>
                <option value="mL">mL (Mililitros)</option>
                <option value="L">L (Litros)</option>
                <option value="mg">mg (Miligramas)</option>
                <option value="g">g (Gramas)</option>
                <option value="kg">kg (Quilogramas)</option>
                <option value="unidades">Unidades</option>
                <option value="amostras">Amostras</option>
                <option value="tubos">Tubos</option>
                <option value="frascos">Frascos</option>
              </select>
            </div>

            <Input
              label={`${t('samples.quantity') || 'Quantidade'} ${selectedUnit ? `(${selectedUnit})` : ''} *`}
              type="number"
              step="0.01"
              min="0.01"
              value={formData.quantity || ''}
              onChange={(e) => onFormDataChange((prev) => ({ ...prev, quantity: parseFloat(e.target.value) || undefined }))}
              required
              disabled={!selectedUnit}
              placeholder={selectedUnit ? `Digite a quantidade em ${selectedUnit}` : 'Selecione primeiro a unidade'}
            />

            <div>
              <label htmlFor={qualityId} style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                {t('samples.quality') || 'Qualidade (MIABIS)'} *
              </label>
              <select id={qualityId} value={formData.quality !== undefined && formData.quality !== null ? String(formData.quality) : ''} onChange={(e) => {
                const value = e.target.value === '' ? undefined : e.target.value;
                if (value !== undefined && MIABIS_QUALITY.some((item) => item.id === value)) {
                  onFormDataChange((prev) => ({ ...prev, quality: value }));
                } else if (value === undefined) {
                  onFormDataChange((prev) => ({ ...prev, quality: undefined }));
                }
              }} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">{t('samples.selectQuality') || 'Selecione a qualidade (MIABIS)'}</option>
                {miabisQualityOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text)' }}>
            {t('common.location') || 'Armazenagem e Projeto'}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <div>
              <label htmlFor={locationId} style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                {t('samples.locationID') || 'Localização'}
              </label>
              <select id={locationId} value={formData.locationID || ''} onChange={(e) => onFormDataChange((prev) => ({ ...prev, locationID: e.target.value ? parseInt(e.target.value, 10) : undefined }))} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">Aguardando Armazenagem</option>
                {locationsLoading ? (
                  <option value="" disabled>Carregando localizações...</option>
                ) : locations.length > 0 ? (
                  locations.map((loc) => {
                    const locationParts: string[] = [];
                    if (loc.block !== undefined && loc.rack !== undefined && loc.drawer !== undefined && loc.box !== undefined) {
                      locationParts.push(`B${loc.block}-P${loc.rack}-G${loc.drawer}-C${loc.box}`);
                    }
                    if (loc.equipmentType) {
                      const equipmentTypes: Record<number, string> = {
                        1: 'Freezer -80°C #1',
                        2: 'Freezer -80°C #2',
                        3: 'Freezer -20°C',
                        4: 'Refrigerador 4°C',
                        5: 'Nitrogênio Líquido',
                      };
                      const typeDesc = equipmentTypes[loc.equipmentType] || `Tipo ${loc.equipmentType}`;
                      locationParts.push(typeDesc);
                    }
                    const wellInfo = loc.wellPosition || loc.eppendorfWell;
                    if (wellInfo) {
                      locationParts.push(`Poço ${wellInfo}`);
                    }
                    const description = locationParts.length > 0 ? locationParts.join(' • ') : `Localização ${loc.locationID}`;
                    return (
                      <option key={loc._id || `location-${loc.locationID}`} value={loc.locationID}>
                        {description}
                      </option>
                    );
                  })
                ) : (
                  <option value="" disabled>Nenhuma localização disponível. A amostra pode ser salva sem armazenagem inicial.</option>
                )}
              </select>
              <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--text-light)' }}>
                Opcional. A localização física pode ser definida depois da recepção.
              </div>
            </div>

            <Input
              label={`${t('samples.linkedProject') || 'Projeto Vinculado'} *`}
              type="text"
              value={formData.linkedProject || ''}
              onChange={(e) => onFormDataChange((prev) => ({ ...prev, linkedProject: e.target.value }))}
              required
            />

            <div>
              <label htmlFor={statusId} style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                {t('samples.currentStatus') || 'Status Atual'} *
              </label>
              <select id={statusId} value={formData.currentStatus || 'Available'} onChange={(e) => onFormDataChange((prev) => ({ ...prev, currentStatus: e.target.value as Sample['currentStatus'] }))} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <Button type="button" variant="secondary" onClick={onBack}>
            {t('common.cancel') || 'Cancelar'}
          </Button>
          <Button type="submit" disabled={selectedPatient?.status === 'PENDING_CONSENT' || patientFetchLoading}>
            {t('samples.create') || 'Criar Amostra'}
          </Button>
        </div>
      </form>
    </div>
  );
}
