import { useState, useEffect, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import PatientSearchInput from '../components/UI/PatientSearchInput';
import { ArrowLeft } from 'lucide-react';
import { Sample } from '../types/models';
import { useSamples } from '../hooks/useSamples';
import { useLanguage } from '../contexts/LanguageContext';
import { useLocations } from '../hooks/useLocations';
// Removido useQualityDescriptions - agora usamos escala MIABIS diretamente (0, 1, 2)

export default function NewSamplePage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { createSample, loadSamples } = useSamples();
  const { locations = [], loadLocations, loading: locationsLoading } = useLocations();
  
  // IDs únicos para acessibilidade
  const sampleTypeId = useId();
  const sampleOriginId = useId();
  const extractionProtocolId = useId();
  const unitId = useId();
  const qualityId = useId();
  const locationId = useId();
  const statusId = useId();

  const [formData, setFormData] = useState<Partial<Sample> & { registerDate?: string; quality?: number }>({
    patientID: '',
    sampleType: '',
    sampleOrigin: '',
    extractionProtocol: '',
    barcode: '',
    registerDate: new Date().toISOString().split('T')[0],
    registrationDate: new Date().toISOString(),
    quantity: undefined,
    quality: undefined,
    qualityID: undefined,
    linkedProject: '',
    locationID: undefined,
    currentStatus: 'Available'
  });

  const [selectedUnit, setSelectedUnit] = useState<string>('');
  const [patientIDValid, setPatientIDValid] = useState<boolean | null>(null);
  const [pageLoading, setPageLoading] = useState(false);

  // Carrega localizações ao montar (apenas uma vez)
  useEffect(() => {
    if (loadLocations && locations.length === 0) {
      loadLocations().catch(err => {
        console.error('Erro ao carregar localizações:', err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza patientID quando selecionado na busca
  const handlePatientIDChange = (patientID: string) => {
    setFormData({ ...formData, patientID });
  };

  // Callback de validação do componente de busca
  const handleValidationChange = (isValid: boolean | null) => {
    setPatientIDValid(isValid);
  };

  const formatDate = (date: Date | string | undefined): string => {
    if (!date) return '';
    if (date instanceof Date) {
      return date.toISOString().split('T')[0];
    }
    if (typeof date === 'string') {
      return date.split('T')[0];
    }
    return '';
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validações obrigatórias RF004
    const patientIDStr = String(formData.patientID || '');
    if (!patientIDStr || patientIDStr.length !== 8 || !/^\d{8}$/.test(patientIDStr)) {
      alert(t('samples.patientIDInvalid') || 'ID de paciente inválido');
      return;
    }

    if (!patientIDValid) {
      alert(t('samples.patientIDNotFound') || 'ID de paciente não encontrado');
      return;
    }

    if (!formData.sampleType) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.sampleType') || 'Tipo de Amostra'));
      return;
    }

    if (!formData.sampleOrigin) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.sampleOrigin') || 'Origem da Amostra'));
      return;
    }

    if (!formData.extractionProtocol) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.extractionProtocol') || 'Protocolo de Extração'));
      return;
    }

    // Barcode é opcional - será gerado automaticamente pelo backend se não fornecido

    if (!formData.registerDate && !formData.registrationDate) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.registerDate') || 'Data de Registro'));
      return;
    }

    if (!selectedUnit) {
      alert(t('samples.unitRequired') || 'Selecione uma unidade de medida');
      return;
    }

    if (!formData.quantity || formData.quantity <= 0) {
      alert(t('samples.invalidQuantity') || 'Quantidade deve ser maior que zero');
      return;
    }

    // Valida quality MIABIS (0, 1 ou 2)
    const qualityValue = formData.quality;
    if (qualityValue === undefined || qualityValue === null) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.quality') || 'Qualidade'));
      return;
    }
    if (!Number.isInteger(qualityValue) || (qualityValue !== 0 && qualityValue !== 1 && qualityValue !== 2)) {
      alert(t('samples.invalidQuality') || 'Qualidade deve estar na escala MIABIS: 0 (Não avaliada), 1 (Adequada) ou 2 (Inadequada)');
      return;
    }

    if (!formData.linkedProject || formData.linkedProject.trim() === '') {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.linkedProject') || 'Projeto Vinculado'));
      return;
    }

    // Valida locationID
    if (!formData.locationID) {
      alert((t('samples.requiredField') || 'Campo obrigatório') + ': ' + (t('samples.locationID') || 'Localização'));
      return;
    }

    try {
      // Converte registerDate para formato ISO
      let registerDateISO: string;
      const dateToUse = formData.registerDate || formData.registrationDate;
      if (dateToUse) {
        if (typeof dateToUse === 'string') {
          const date = new Date(dateToUse);
          if (!isNaN(date.getTime())) {
            registerDateISO = date.toISOString();
          } else {
            registerDateISO = new Date().toISOString();
          }
        } else if (dateToUse instanceof Date) {
          registerDateISO = dateToUse.toISOString();
        } else {
          registerDateISO = new Date().toISOString();
        }
      } else {
        registerDateISO = new Date().toISOString();
      }

      // Código de barras será gerado automaticamente pelo backend se não fornecido
      const dataToSave: any = {
        patientID: patientIDStr,
        sampleType: formData.sampleType,
        sampleOrigin: formData.sampleOrigin,
        extractionProtocol: formData.extractionProtocol,
        barcode: formData.barcode ? String(formData.barcode).trim() : undefined, // Opcional - será gerado automaticamente
        registerDate: registerDateISO,
        registrationDate: registerDateISO,
        quantity: formData.quantity,
        unit: selectedUnit, // Unidade de medida selecionada
        quality: formData.quality, // Escala MIABIS (0, 1 ou 2)
        linkedProject: formData.linkedProject,
        locationID: formData.locationID, // Localização da amostra
        currentStatus: formData.currentStatus || 'Available'
      };

      await createSample(dataToSave);
      alert(t('samples.createSuccess') || 'Amostra cadastrada com sucesso');
      
      // Recarrega a lista e volta para a página de amostras
      await loadSamples();
      navigate('/samples');
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || (t('samples.createError') || 'Erro ao cadastrar amostra');
      alert(errorMsg);
    }
  };

  // Opções para selects (com fallbacks para evitar erros)
  const sampleTypeOptions = [
    { value: 'Sangue', label: t('samples.sampleTypeOptions.Sangue') || 'Sangue' },
    { value: 'Urina', label: t('samples.sampleTypeOptions.Urina') || 'Urina' },
    { value: 'Saliva', label: t('samples.sampleTypeOptions.Saliva') || 'Saliva' },
    { value: 'Tecido', label: t('samples.sampleTypeOptions.Tecido') || 'Tecido' },
    { value: 'DNA', label: t('samples.sampleTypeOptions.DNA') || 'DNA' },
    { value: 'RNA', label: t('samples.sampleTypeOptions.RNA') || 'RNA' },
    { value: 'Plasma', label: t('samples.sampleTypeOptions.Plasma') || 'Plasma' },
    { value: 'Soro', label: t('samples.sampleTypeOptions.Soro') || 'Soro' },
    { value: 'Líquido Cefalorraquidiano', label: t('samples.sampleTypeOptions.LiquidoCefalorraquidiano') || 'Líquido Cefalorraquidiano' }
  ];

  const sampleOriginOptions = [
    { value: 'Coleta', label: t('samples.sampleOriginOptions.Coleta') || 'Coleta' },
    { value: 'Transferência', label: t('samples.sampleOriginOptions.Transferencia') || 'Transferência' },
    { value: 'Doação', label: t('samples.sampleOriginOptions.Doacao') || 'Doação' },
    { value: 'Pesquisa', label: t('samples.sampleOriginOptions.Pesquisa') || 'Pesquisa' }
  ];

  const extractionProtocolOptions = [
    { value: 'Protocolo A', label: t('samples.extractionProtocolOptions.ProtocoloA') || 'Protocolo A' },
    { value: 'Protocolo B', label: t('samples.extractionProtocolOptions.ProtocoloB') || 'Protocolo B' },
    { value: 'Protocolo C', label: t('samples.extractionProtocolOptions.ProtocoloC') || 'Protocolo C' },
    { value: 'QIAGEN', label: t('samples.extractionProtocolOptions.QIAGEN') || 'QIAGEN' },
    { value: 'Phenol-Chloroform', label: t('samples.extractionProtocolOptions.PhenolChloroform') || 'Phenol-Chloroform' },
    { value: 'Automated', label: t('samples.extractionProtocolOptions.Automated') || 'Automated' }
  ];

  const statusOptions = [
    { value: 'Available', label: t('samples.statusOptions.Available') || 'Disponível' },
    { value: 'Withdrawn', label: t('samples.statusOptions.Withdrawn') || 'Retirada' },
    { value: 'Expired', label: t('samples.statusOptions.Expired') || 'Expirada' },
    { value: 'Destroyed', label: t('samples.statusOptions.Destroyed') || 'Destruída' }
  ];

  // Mostra loading apenas se estiver carregando localizações e não houver nenhuma ainda
  if (locationsLoading && locations.length === 0) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <p>{t('common.loading') || 'Carregando...'}</p>
      </div>
    );
  }

  return (
    <div style={{ 
      maxWidth: '900px', 
      margin: '0 auto', 
      padding: '2rem',
      minHeight: '100vh'
    }}>
      {/* Header minimalista */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <Button 
          onClick={() => navigate('/samples')} 
          variant="secondary" 
          style={{ minWidth: 'auto', padding: '0.5rem' }}
        >
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 style={{ 
            margin: 0, 
            fontSize: '1.5rem', 
            fontWeight: 600,
            color: 'var(--text)'
          }}>
            {t('samples.newTitle') || 'Nova Amostra'}
          </h1>
          <p style={{ 
            margin: '0.25rem 0 0 0', 
            fontSize: '0.875rem', 
            color: 'var(--text-light)'
          }}>
            {t('samples.newSubtitle') || 'Cadastre uma nova amostra biológica'}
          </p>
        </div>
      </div>

      {/* Formulário */}
      <form onSubmit={handleSave} style={{ 
        backgroundColor: 'var(--surface)',
        borderRadius: '8px',
        padding: '2rem',
        border: '1px solid var(--border)'
      }}>
        {/* Seção 1: Dados Básicos */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {t('common.basicData') || 'Dados Básicos'}
          </h2>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: '1rem' 
          }}>
            <div>
              <PatientSearchInput
                label={t('samples.patientID') || 'ID do Paciente'}
                value={String(formData.patientID || '')}
                onChange={handlePatientIDChange}
                onValidationChange={handleValidationChange}
                required
                placeholder={t('samples.patientIDSearchPlaceholder') || 'Buscar por ID ou prontuário...'}
              />
            </div>

            <div>
              <label 
                htmlFor={sampleTypeId}
                style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem', 
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--text)'
                }}
              >
                {t('samples.sampleType') || 'Tipo de Amostra'} *
              </label>
              <select
                id={sampleTypeId}
                name="sampleType"
                value={formData.sampleType || ''}
                onChange={(e) => setFormData({ ...formData, sampleType: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
              >
                <option value="">{t('samples.selectSampleType') || 'Selecione o tipo de amostra'}</option>
                {sampleTypeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label 
                htmlFor={sampleOriginId}
                style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem', 
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--text)'
                }}
              >
                {t('samples.sampleOrigin') || 'Origem da Amostra'} *
              </label>
              <select
                id={sampleOriginId}
                name="sampleOrigin"
                value={formData.sampleOrigin || ''}
                onChange={(e) => setFormData({ ...formData, sampleOrigin: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
              >
                <option value="">{t('samples.selectOrigin') || 'Selecione a origem'}</option>
                {sampleOriginOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label 
                htmlFor={extractionProtocolId}
                style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem', 
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--text)'
                }}
              >
                {t('samples.extractionProtocol') || 'Protocolo de Extração'} *
              </label>
              <select
                id={extractionProtocolId}
                name="extractionProtocol"
                value={formData.extractionProtocol || ''}
                onChange={(e) => setFormData({ ...formData, extractionProtocol: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
              >
                <option value="">{t('common.select') || 'Selecione'}</option>
                {extractionProtocolOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <Input
              label={t('samples.barcode') || 'Código de Barras'}
              type="text"
              value={formData.barcode ? String(formData.barcode) : ''}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value as any })}
              placeholder="BR-2024-001 (será gerado automaticamente se vazio)"
              helperText={t('samples.barcodeAutoGenerated') || 'Deixe vazio para gerar automaticamente no formato BR-YYYY-NNN'}
            />

            <Input
              label={`${t('samples.registerDate') || 'Data de Registro'} *`}
              type="date"
              value={formData.registerDate ? (typeof formData.registerDate === 'string' ? formData.registerDate.split('T')[0] : formatDate(formData.registerDate as any)) : ''}
              onChange={(e) => setFormData({ ...formData, registerDate: e.target.value, registrationDate: new Date(e.target.value).toISOString() })}
              required
            />
          </div>
        </div>

        {/* Seção 2: Dados de Quantidade e Qualidade */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {t('common.quantity') || 'Quantidade e Qualidade'}
          </h2>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: '1rem' 
          }}>
            <div>
              <label 
                htmlFor={unitId}
                style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem', 
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--text)'
                }}
              >
                {t('samples.unit') || 'Unidade de Medida'} *
              </label>
              <select
                id={unitId}
                name="unit"
                value={selectedUnit}
                onChange={(e) => {
                  setSelectedUnit(e.target.value);
                  // Limpa a quantidade quando muda a unidade
                  if (e.target.value !== selectedUnit) {
                    setFormData({ ...formData, quantity: undefined });
                  }
                }}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
              >
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
              onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || undefined })}
              required
              disabled={!selectedUnit}
              placeholder={selectedUnit ? `Digite a quantidade em ${selectedUnit}` : 'Selecione primeiro a unidade'}
            />

            <div>
              <label 
                htmlFor={qualityId}
                style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem', 
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--text)'
                }}
                title={t('samples.qualityTooltip') || 'Escala MIABIS oficial: 0 = Não avaliada, 1 = Adequada, 2 = Inadequada'}
              >
                {t('samples.quality') || 'Qualidade (MIABIS)'} *
              </label>
              <select
                id={qualityId}
                name="quality"
                value={formData.quality !== undefined && formData.quality !== null ? formData.quality : ''}
                onChange={(e) => {
                  const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  // Valida se é 0, 1 ou 2
                  if (value !== undefined && (value === 0 || value === 1 || value === 2)) {
                    setFormData({ ...formData, quality: value });
                  } else if (value === undefined) {
                    setFormData({ ...formData, quality: undefined });
                  }
                }}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
                title={t('samples.qualityTooltip') || 'Escala MIABIS oficial: 0 = Não avaliada, 1 = Adequada, 2 = Inadequada'}
              >
                <option value="">{t('samples.selectQuality') || 'Selecione a qualidade (MIABIS)'}</option>
                <option value="0">{t('samples.qualityMIABIS.0') || '0 - Não avaliada (Not assessed)'}</option>
                <option value="1">{t('samples.qualityMIABIS.1') || '1 - Adequada (Suitable)'}</option>
                <option value="2">{t('samples.qualityMIABIS.2') || '2 - Inadequada (Not suitable)'}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Seção 3: Localização e Projeto */}
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ 
            fontSize: '1.125rem', 
            fontWeight: 600, 
            marginBottom: '1rem',
            color: 'var(--text)'
          }}>
            {t('common.location') || 'Localização e Projeto'}
          </h2>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: '1rem' 
          }}>
            <div>
              <label 
                htmlFor={locationId}
                style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem', 
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--text)'
                }}
              >
                {t('samples.locationID') || 'Localização'} *
              </label>
              <select
                id={locationId}
                name="locationID"
                value={formData.locationID || ''}
                onChange={(e) => setFormData({ ...formData, locationID: parseInt(e.target.value) || undefined })}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
              >
                <option value="">{t('common.select') || 'Selecione'}</option>
                {locationsLoading ? (
                  <option value="" disabled>Carregando localizações...</option>
                ) : locations && locations.length > 0 ? (
                  locations.map((loc) => {
                    // Formata descrição da localização de forma clara
                    const locationParts: string[] = [];
                    
                    // Localização física: Bloco-Prateleira-Gaveta-Caixa
                    if (loc.block !== undefined && loc.rack !== undefined && loc.drawer !== undefined && loc.box !== undefined) {
                      locationParts.push(`B${loc.block}-P${loc.rack}-G${loc.drawer}-C${loc.box}`);
                    }
                    
                    // Tipo de equipamento (se disponível)
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
                    
                    // Poço Eppendorf (se disponível)
                    const wellInfo = loc.wellPosition || loc.eppendorfWell;
                    if (wellInfo) {
                      locationParts.push(`Poço ${wellInfo}`);
                    }
                    
                    // Se não houver partes, usa formato básico
                    const description = locationParts.length > 0 
                      ? locationParts.join(' • ')
                      : `Localização ${loc.locationID}`;
                    
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
              onChange={(e) => setFormData({ ...formData, linkedProject: e.target.value })}
              required
            />

            <div>
              <label 
                htmlFor={statusId}
                style={{ 
                  display: 'block', 
                  marginBottom: '0.5rem', 
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--text)'
                }}
              >
                {t('samples.currentStatus') || 'Status Atual'} *
              </label>
              <select
                id={statusId}
                name="currentStatus"
                value={formData.currentStatus || 'Available'}
                onChange={(e) => setFormData({ ...formData, currentStatus: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)'
                }}
              >
                {statusOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Botões de ação */}
        <div style={{ 
          display: 'flex', 
          gap: '1rem', 
          justifyContent: 'flex-end',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border)'
        }}>
          <Button 
            type="button" 
            variant="secondary" 
            onClick={() => navigate('/samples')}
          >
            {t('common.cancel') || 'Cancelar'}
          </Button>
          <Button type="submit">
            {t('samples.create') || 'Criar Amostra'}
          </Button>
        </div>
      </form>
    </div>
  );
}
