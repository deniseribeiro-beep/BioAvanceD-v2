import { useState, useEffect, useRef, useId } from 'react';
import { Search, CheckCircle, XCircle, Loader, ChevronDown } from 'lucide-react';
import { patientService } from '@/services/api';
import './PatientSearchInput.css';

interface Patient {
  patientID: string;
  recordNumber?: string | number | null;
  _id?: string;
}

interface PatientSearchInputProps {
  value: string;
  onChange: (patientID: string) => void;
  onValidationChange?: (isValid: boolean | null) => void;
  label?: string;
  required?: boolean;
  placeholder?: string;
  enableInitialDropdown?: boolean;
  initialLimit?: number;
}

const extractPatients = (payload: any): Patient[] => {
  if (Array.isArray(payload?.data?.patients)) return payload.data.patients;
  if (Array.isArray(payload?.patients)) return payload.patients;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
};

export default function PatientSearchInput({
  value,
  onChange,
  onValidationChange,
  label = 'ID do Paciente',
  required = false,
  placeholder = 'Buscar por ID ou prontuário...',
  enableInitialDropdown = false,
  initialLimit = 20,
}: PatientSearchInputProps) {
  const inputId = useId();
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha resultados ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Valida patientID quando value muda
  useEffect(() => {
    if (value && value.length === 8 && /^\d{8}$/.test(value)) {
      validatePatientID(value);
    } else if (value) {
      setIsValid(false);
      onValidationChange?.(false);
    } else {
      setIsValid(null);
      onValidationChange?.(null);
    }
  }, [value]);

  const validatePatientID = async (patientID: string) => {
    setValidating(true);
    try {
      const response = await patientService.validateID(patientID);
      const valid = response.data.valid;
      setIsValid(valid);
      onValidationChange?.(valid);
    } catch (err) {
      setIsValid(false);
      onValidationChange?.(false);
    } finally {
      setValidating(false);
    }
  };

  const handleSearch = async (term: string) => {
    if (!term || term.trim().length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setLoading(true);
    try {
      const response = await patientService.search(term.trim());
      const patients = extractPatients(response.data);
      setResults(patients);
      setShowResults(true);
    } catch (err: any) {
      console.error('Erro ao buscar pacientes:', err);
      setResults([]);
      setShowResults(true);
    } finally {
      setLoading(false);
    }
  };

  const loadInitialPatients = async () => {
    if (!enableInitialDropdown) return;
    setLoadingInitial(true);
    setShowResults(true);
    try {
      const response = await patientService.getAll({ limit: initialLimit, skip: 0 });
      const patients = extractPatients(response.data);
      setResults(patients);
    } catch (err: any) {
      console.error('Erro ao carregar pacientes iniciais:', err);
      setResults([]);
    } finally {
      setLoadingInitial(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setSearchTerm(term);
    setIsValid(null);
    onValidationChange?.(null);

    // Se for um ID de 8 dígitos, atualiza diretamente
    if (term.length === 8 && /^\d{8}$/.test(term)) {
      onChange(term);
      setShowResults(false);
      return;
    }

    if (term.trim().length === 0) {
      if (enableInitialDropdown) {
        loadInitialPatients();
      } else {
        setShowResults(false);
      }
      return;
    }

    // Limpa timeout anterior
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Busca após 500ms de inatividade
    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(term);
    }, 500);
  };

  const handleToggleDropdown = () => {
    if (!enableInitialDropdown) return;
    if (showResults) {
      setShowResults(false);
      return;
    }
    loadInitialPatients();
  };

  const handleSelectPatient = (patient: Patient) => {
    setSearchTerm(patient.patientID);
    onChange(patient.patientID);
    setShowResults(false);
    setIsValid(true);
    onValidationChange?.(true);
  };

  return (
    <div className="patient-search-input" ref={containerRef}>
      <label 
        htmlFor={inputId}
        style={{ 
          display: 'block', 
          marginBottom: '0.5rem', 
          fontWeight: 500,
          color: 'var(--text)'
        }}
      >
        {label} {required && '*'}
      </label>
      
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <Search 
            size={18} 
            style={{ 
              position: 'absolute', 
              left: '0.75rem', 
              top: '50%', 
              transform: 'translateY(-50%)',
              color: 'var(--text-light)',
              pointerEvents: 'none',
              zIndex: 1
            }} 
          />
          <input
            id={inputId}
            name="patientID"
            type="text"
            value={searchTerm || value || ''}
            onChange={handleInputChange}
            onFocus={() => {
              if (results.length > 0) {
                setShowResults(true);
              } else if (searchTerm && searchTerm.length >= 2) {
                handleSearch(searchTerm);
              } else if (enableInitialDropdown) {
                loadInitialPatients();
              }
            }}
            placeholder={placeholder}
            required={required}
            style={{
              width: '100%',
              padding: '0.625rem 2.5rem 0.625rem 2.5rem',
              border: `1px solid ${isValid === false ? 'var(--danger)' : isValid === true ? 'var(--success)' : 'var(--border)'}`,
              borderRadius: '6px',
              fontSize: '0.875rem',
              backgroundColor: 'var(--background)',
              color: 'var(--text)',
              outline: 'none',
              transition: 'border-color 0.2s ease'
            }}
          />
          {enableInitialDropdown && (
            <button
              type="button"
              className="patient-search-toggle"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleToggleDropdown}
              aria-label="Alternar lista de pacientes"
              title="Mostrar lista de pacientes"
            >
              <ChevronDown size={16} className={showResults ? 'open' : ''} />
            </button>
          )}
          {validating && (
            <Loader 
              size={16} 
              style={{ 
                position: 'absolute', 
                right: enableInitialDropdown ? '2.5rem' : '0.75rem', 
                top: '50%', 
                transform: 'translateY(-50%)',
                color: 'var(--text-light)',
                animation: 'spin 1s linear infinite'
              }} 
            />
          )}
          {!validating && isValid === true && (
            <CheckCircle 
              size={16} 
              style={{ 
                position: 'absolute', 
                right: enableInitialDropdown ? '2.5rem' : '0.75rem', 
                top: '50%', 
                transform: 'translateY(-50%)',
                color: 'var(--success)'
              }} 
            />
          )}
          {!validating && isValid === false && value && value.length === 8 && (
            <XCircle 
              size={16} 
              style={{ 
                position: 'absolute', 
                right: enableInitialDropdown ? '2.5rem' : '0.75rem', 
                top: '50%', 
                transform: 'translateY(-50%)',
                color: 'var(--danger)'
              }} 
            />
          )}
        </div>

        {/* Lista de resultados */}
        {showResults && results.length > 0 && (
          <div className="patient-search-results">
            {results.slice(0, 10).map((patient, idx) => (
              <div
                key={patient.patientID || patient._id || idx}
                className="patient-search-result-item"
                onClick={() => handleSelectPatient(patient)}
              >
                <div className="patient-result-info">
                  <div className="patient-result-id">ID: {patient.patientID}</div>
                  {patient.recordNumber && (
                    <div className="patient-result-record">
                      Prontuário: {patient.recordNumber}
                    </div>
                  )}
                </div>
                <CheckCircle size={16} className="patient-result-icon" />
              </div>
            ))}
            {results.length > 10 && (
              <div className="patient-search-more">
                +{results.length - 10} resultado(s) encontrado(s)
              </div>
            )}
          </div>
        )}

        {showResults && (loading || loadingInitial) && (
          <div className="patient-search-results">
            <div className="patient-search-loading">
              <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Buscando...</span>
            </div>
          </div>
        )}

        {showResults && !loading && !loadingInitial && results.length === 0 && (
          <div className="patient-search-results">
            <div className="patient-search-empty">
              {searchTerm.length >= 2 ? 'Nenhum paciente encontrado' : 'Nenhum paciente disponível'}
            </div>
          </div>
        )}
      </div>

      {/* Mensagens de validação */}
      {validating && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
          Validando...
        </p>
      )}
      {!validating && isValid === true && (
        <p style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: '0.25rem' }}>
          ✓ ID válido
        </p>
      )}
      {!validating && isValid === false && value && value.length === 8 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.25rem' }}>
          ID de paciente não encontrado
        </p>
      )}
      <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
        Busque por ID (8 dígitos) ou prontuário do paciente
      </p>
    </div>
  );
}

