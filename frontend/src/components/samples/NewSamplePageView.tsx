import { useId } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Location, Patient, Sample } from '@/types/models';
import Button from '../UI/Button';
import Input from '../UI/Input';
import PatientSearchInput from '../UI/PatientSearchInput';

type TranslatorFn = (key: string) => string;
type NewSampleFormData = Partial<Sample> & { registerDate?: string; quality?: number };

interface NewSamplePageViewProps {
  t: TranslatorFn;
  formData: NewSampleFormData;
  selectedUnit: string;
  selectedPatient: Patient | null;
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

  const sampleTypeOptions = [
    { value: 'Sangue', label: t('samples.sampleTypeOptions.Sangue') || 'Sangue' },
    { value: 'Urina', label: t('samples.sampleTypeOptions.Urina') || 'Urina' },
    { value: 'Saliva', label: t('samples.sampleTypeOptions.Saliva') || 'Saliva' },
    { value: 'Tecido', label: t('samples.sampleTypeOptions.Tecido') || 'Tecido' },
    { value: 'DNA', label: t('samples.sampleTypeOptions.DNA') || 'DNA' },
    { value: 'RNA', label: t('samples.sampleTypeOptions.RNA') || 'RNA' },
    { value: 'Plasma', label: t('samples.sampleTypeOptions.Plasma') || 'Plasma' },
    { value: 'Soro', label: t('samples.sampleTypeOptions.Soro') || 'Soro' },
    { value: 'Líquido Cefalorraquidiano', label: t('samples.sampleTypeOptions.LiquidoCefalorraquidiano') || 'Líquido Cefalorraquidiano' },
  ];

  const sampleOriginOptions = [
    { value: 'Coleta', label: t('samples.sampleOriginOptions.Coleta') || 'Coleta' },
    { value: 'Transferência', label: t('samples.sampleOriginOptions.Transferencia') || 'Transferência' },
    { value: 'Doação', label: t('samples.sampleOriginOptions.Doacao') || 'Doação' },
    { value: 'Pesquisa', label: t('samples.sampleOriginOptions.Pesquisa') || 'Pesquisa' },
  ];

  const extractionProtocolOptions = [
    { value: 'Protocolo A', label: t('samples.extractionProtocolOptions.ProtocoloA') || 'Protocolo A' },
    { value: 'Protocolo B', label: t('samples.extractionProtocolOptions.ProtocoloB') || 'Protocolo B' },
    { value: 'Protocolo C', label: t('samples.extractionProtocolOptions.ProtocoloC') || 'Protocolo C' },
    { value: 'QIAGEN', label: t('samples.extractionProtocolOptions.QIAGEN') || 'QIAGEN' },
    { value: 'Phenol-Chloroform', label: t('samples.extractionProtocolOptions.PhenolChloroform') || 'Phenol-Chloroform' },
    { value: 'Automated', label: t('samples.extractionProtocolOptions.Automated') || 'Automated' },
  ];

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
              <select id={qualityId} value={formData.quality !== undefined && formData.quality !== null ? formData.quality : ''} onChange={(e) => {
                const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                if (value !== undefined && (value === 0 || value === 1 || value === 2)) {
                  onFormDataChange((prev) => ({ ...prev, quality: value }));
                } else if (value === undefined) {
                  onFormDataChange((prev) => ({ ...prev, quality: undefined }));
                }
              }} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">{t('samples.selectQuality') || 'Selecione a qualidade (MIABIS)'}</option>
                <option value="0">{t('samples.qualityMIABIS.0') || '0 - Não avaliada (Not assessed)'}</option>
                <option value="1">{t('samples.qualityMIABIS.1') || '1 - Adequada (Suitable)'}</option>
                <option value="2">{t('samples.qualityMIABIS.2') || '2 - Inadequada (Not suitable)'}</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text)' }}>
            {t('common.location') || 'Localização e Projeto'}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
            <div>
              <label htmlFor={locationId} style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)' }}>
                {t('samples.locationID') || 'Localização'} *
              </label>
              <select id={locationId} value={formData.locationID || ''} onChange={(e) => onFormDataChange((prev) => ({ ...prev, locationID: parseInt(e.target.value) || undefined }))} required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                <option value="">{t('common.select') || 'Selecione'}</option>
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
                  <option value="" disabled>Nenhuma localização disponível. Cadastre localizações em Gerenciamento de Instalações.</option>
                )}
              </select>
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
