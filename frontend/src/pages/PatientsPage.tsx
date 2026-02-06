import { useState, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import { Plus, Edit, Trash2, Search, ArrowLeft, Upload, FileSpreadsheet } from 'lucide-react';
import { Patient } from '../types/models';
import { usePatients } from '../hooks/usePatients';
import { useAuth } from '../contexts/AuthContext';
import { importLGPDService } from '../services/api';
import { patientService } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import './PatientsPage.css';

export default function PatientsPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { patients, loading, error, deletePatient, loadPatients } = usePatients();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importProgress, setImportProgress] = useState<string>('');
  const [resendingConsentFor, setResendingConsentFor] = useState<string | null>(null);
  
  // Handler para busca de pacientes
  const handleSearch = async (term: string) => {
    if (!term || term.trim().length === 0) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await patientService.search(term.trim());
      if (response.data) {
        const responseData = response.data as any;
        const data = responseData.data || responseData;
        const results = data.patients || [];
        setSearchResults(results);
        setShowSearchResults(true);
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }
    } catch (err: any) {
      console.error('Erro ao buscar pacientes:', err);
      setSearchResults([]);
      setShowSearchResults(false);
      alert(t('patients.searchError'));
    } finally {
      setIsSearching(false);
    }
  };

  // Handler para limpar busca
  const handleClearSearch = () => {
    setSearchTerm('');
    setSearchResults([]);
    setShowSearchResults(false);
    loadPatients();
  };

  // Usa apenas pacientes reais do banco de dados ou resultados da busca
  const displayPatients = useMemo(() => {
    // Se há busca ativa e resultados, mostra os resultados da busca
    if (showSearchResults && searchResults.length > 0) {
      return searchResults.filter(p => p && (p.patientID || (p as any).id));
    }
    
    // Caso contrário, retorna pacientes normais
    if (patients && Array.isArray(patients) && patients.length > 0) {
      // Verifica se os pacientes têm patientID válido
      return patients.filter(p => p && (p.patientID || (p as any).id));
    }
    // Retorna array vazio se não houver pacientes
    return [];
  }, [patients, searchResults, showSearchResults]);

  const handleAdd = () => {
    navigate('/patients/new');
  };

  const handleEdit = async (patientID: string | number) => {
    try {
      // Converte para string e garante que seja um patientID válido (8 dígitos)
      const patientIDStr = String(patientID);
      
      // Valida formato do ID (deve ser 8 dígitos)
      if (patientIDStr.length !== 8 || !/^\d{8}$/.test(patientIDStr)) {
        alert(t('patients.invalidPatientID'));
        return;
      }
      
      // Busca paciente completo por patientID para edição (requer acesso ao módulo de cadastro)
      const response = await patientService.findForEdit(patientIDStr);
      
      // Verifica se a resposta foi bem-sucedida
      if (response && response.data) {
        // Se response.data tem uma propriedade data, usa ela
        const responseData = response.data as any;
        const patientData = responseData.data || responseData;
        
        // Verifica se não é um erro
        if (patientData && !patientData.error && patientData.patientID) {
          navigate('/patients/new', { state: { patient: patientData } });
        } else {
          throw new Error(patientData?.error || responseData?.error || t('patients.patientNotFound'));
        }
      } else {
        throw new Error(t('patients.invalidServerResponse'));
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || t('patients.editError');
      alert(errorMessage);
    }
  };

  const handleDelete = async (id: number | string) => {
    if (confirm(t('patients.deleteConfirm'))) {
      try {
        // Converte para string e garante que seja um patientID válido
        const patientIDStr = String(id);
        
        // Valida formato do ID (deve ser 8 dígitos)
        if (patientIDStr.length !== 8 || !/^\d{8}$/.test(patientIDStr)) {
          alert(t('patients.invalidPatientID'));
          return;
        }
        
        // Usa patientID como string para deletar
        await deletePatient(patientIDStr);
        // Recarrega a lista após deletar
        await loadPatients();
        alert(t('patients.deleteSuccess'));
      } catch (err: any) {
        const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || t('patients.deleteError');
        alert(errorMessage);
      }
    }
  };

  const handleImportPatients = async (file?: File) => {
    const fileToImport = file || importFile;
    
    if (!fileToImport) {
      alert(t('patients.selectFile'));
      return;
    }

    setImporting(true);
    setImportProgress(`Arquivo: ${fileToImport.name} (${(fileToImport.size / 1024).toFixed(1)} KB)`);
    
    try {
      const formData = new FormData();
      formData.append('file', fileToImport);

      setImportProgress(`Processando: ${fileToImport.name}`);

      const response = await importLGPDService.import('patients', formData);
      
      setImportProgress('');
      
      if (response && response.data) {
        if (response.data.success === false) {
          const errorMsg = response.data.error || response.data.message || 'Erro ao importar pacientes';
          throw new Error(errorMsg);
        }
        
        const importData = response.data.data || response.data;
        const message = response.data.message || 'Importação concluída';
        
        if (importData) {
          const total = importData.total || 0;
          const success = importData.success || 0;
          const errors = importData.errors || 0;
          const errorsDetails = importData.errorsDetails || [];
          
          if (errors > 0) {
            const isPartial = success > 0;
            let errorMessage = message;
            
            const duplicateErrors = errorsDetails.filter((err: any) => {
              const errorList = Array.isArray(err.errors) ? err.errors : [err.errors || ''];
              return errorList.some((e: string) => e.toLowerCase().includes('duplicado') || e.toLowerCase().includes('duplicate'));
            });
            
            const hasDuplicates = duplicateErrors.length > 0;
            
            if (hasDuplicates && !isPartial) {
              errorMessage = `❌ Importação não realizada\n\nForam encontrados ${duplicateErrors.length} paciente(s) duplicado(s) no arquivo.\nNenhum registro foi importado para evitar duplicidades no sistema.\n\n📌 O que significa "duplicado"?\n   Um paciente é considerado duplicado quando já existe no sistema com o mesmo nome completo e data de nascimento.\n`;
            } else if (hasDuplicates && isPartial) {
              errorMessage += `\n\n⚠️ ATENÇÃO: ${duplicateErrors.length} paciente(s) em duplicidade encontrado(s) e não foram importados.\n`;
            }
            
            if (errorsDetails && errorsDetails.length > 0) {
              errorMessage += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
              errorMessage += '\n📋 DETALHAMENTO DOS ERROS:';
              errorMessage += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
              
              const errorsToShow = errorsDetails.slice(0, 15);
              errorsToShow.forEach((err: any) => {
                const errorList = Array.isArray(err.errors) ? err.errors : [err.errors || 'Erro desconhecido'];
                const isDuplicate = errorList.some((e: string) => e.toLowerCase().includes('duplicado') || e.toLowerCase().includes('duplicate'));
                
                errorMessage += `\n\n${isDuplicate ? '🔄' : '📌'} Linha ${err.row || 'N/A'}:`;
                errorList.forEach((errorText: string) => {
                  const prefix = errorText.toLowerCase().includes('duplicado') || errorText.toLowerCase().includes('duplicate') ? '   ⚠️ ' : '   • ';
                  errorMessage += `\n${prefix}${errorText}`;
                });
              });
              
              if (errorsDetails.length > 15) {
                errorMessage += `\n\n... e mais ${errorsDetails.length - 15} erro(s) não exibidos`;
              }
              
              errorMessage += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
              errorMessage += '\n💡 Como corrigir:';
              if (hasDuplicates) {
                errorMessage += '\n   1. Verifique se os pacientes já estão cadastrados no sistema';
                errorMessage += '\n   2. Remova as linhas duplicadas do arquivo Excel';
                errorMessage += '\n   3. Tente importar novamente';
                errorMessage += '\n\n   Lembre-se: Um paciente é duplicado quando tem o mesmo nome e data de nascimento.';
              } else {
                errorMessage += '\n   1. Verifique o template oficial e as instruções de preenchimento';
                errorMessage += '\n   2. Corrija os dados nas linhas indicadas no seu arquivo Excel';
                errorMessage += '\n   3. Tente importar novamente';
              }
            }
            
            setTimeout(() => {
              alert(errorMessage);
            }, 100);
          } else {
            setTimeout(() => {
              alert(`✅ Importação concluída com sucesso!\n\n📊 Resumo:\n   • Total de registros processados: ${total}\n   • Registros importados: ${success}\n   • Erros encontrados: ${errors}\n\n✨ Todos os pacientes foram cadastrados no sistema.`);
            }, 100);
          }
        }
        
        await loadPatients();
        
        setTimeout(() => {
          setImportFile(null);
          setImportProgress('');
          const fileInput = document.getElementById('import-file') as HTMLInputElement;
          if (fileInput) {
            fileInput.value = '';
          }
        }, 3000);
      }
    } catch (err: any) {
        console.error('Erro ao importar pacientes:', err);
        let errorMessage = 'Erro ao importar pacientes';
        
        if (err.response) {
          const errorData = err.response.data;
          if (errorData) {
            errorMessage = errorData.message || errorData.error || errorMessage;
          } else {
            errorMessage = `Erro ${err.response.status}: ${err.response.statusText || 'Erro no servidor'}`;
          }
        } else if (err.request) {
          errorMessage = `🔌 Problema de conexão\n\nNão foi possível conectar ao servidor.\n\n📋 Verifique:\n   • Sua conexão com a internet\n   • Se o servidor está em execução\n   • Se não há firewall bloqueando a conexão\n\n💡 Tente novamente em alguns instantes.`;
        } else {
          errorMessage = err.message || errorMessage;
        }
        
        alert(`❌ Erro ao importar pacientes\n\n${errorMessage}`);
        
        setTimeout(() => {
          setImportFile(null);
          setImportProgress('');
          const fileInput = document.getElementById('import-file') as HTMLInputElement;
          if (fileInput) {
            fileInput.value = '';
          }
        }, 5000);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Button onClick={() => navigate('/dashboard')} variant="secondary" style={{ minWidth: 'auto' }}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="page-title">{t('patients.title')}</h1>
            <p className="page-subtitle">{t('patients.subtitle')}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ 
            position: 'relative', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem',
            minWidth: '300px',
            flex: 1,
            maxWidth: '400px'
          }}>
            <Search size={18} style={{ color: 'var(--text-light)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder={t('patients.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => {
                const value = e.target.value;
                setSearchTerm(value);
                if (value.trim().length >= 2) {
                  const timeoutId = setTimeout(() => {
                    handleSearch(value);
                  }, 500);
                  return () => clearTimeout(timeoutId);
                } else if (value.trim().length === 0) {
                  handleClearSearch();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch(searchTerm);
                } else if (e.key === 'Escape') {
                  handleClearSearch();
                }
              }}
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
                outline: 'none'
              }}
            />
            {searchTerm && (
              <button
                onClick={handleClearSearch}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-light)',
                  fontSize: '1.25rem',
                  lineHeight: 1
                }}
                title={t('patients.clearSearch')}
              >
                ×
              </button>
            )}
            {isSearching && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', whiteSpace: 'nowrap' }}>{t('common.searching')}</span>
            )}
          </div>
          <Button 
            onClick={() => {
              const url = '/import-templates/patients-template.xlsx';
              const link = document.createElement('a');
              link.href = url;
              link.setAttribute('download', 'patients-template.xlsx');
              document.body.appendChild(link);
              link.click();
              link.remove();
            }}
            variant="secondary"
          >
            <FileSpreadsheet size={18} />
            Baixar Template Excel
          </Button>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <input
              type="file"
              id="import-file"
              accept=".csv,.xlsx"
              title="Importar arquivo de pacientes (CSV ou Excel)"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const ext = file.name.toLowerCase().split('.').pop();
                  if (ext !== 'csv' && ext !== 'xlsx') {
                    alert('Apenas arquivos CSV ou Excel (.xlsx) são aceitos');
                    e.target.value = '';
                    return;
                  }
                  setImportFile(file);
                  setImportProgress('');
                  setTimeout(() => {
                    handleImportPatients(file);
                  }, 100);
                }
              }}
              style={{ display: 'none' }}
            />
            <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
            <Button
                onClick={(e) => {
                  e.preventDefault();
                  if (importing) {
                    return;
                  }
                  document.getElementById('import-file')?.click();
              }}
              variant="secondary"
              disabled={importing}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
            >
              <Upload size={18} />
                Importar Pacientes
            </Button>
              {importProgress && (
                <div style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-light)',
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '250px',
                  paddingLeft: '0.25rem'
                }}>
                  {importProgress}
                </div>
              )}
            </div>
          </div>
          <Button onClick={handleAdd}>
            <Plus size={18} />
            {t('patients.new')}
          </Button>
        </div>
      </div>

      {loading && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>{t('patients.loading')}</p>
        </div>
      )}
      
      {error && !error.includes('Servidor backend não está disponível') && (
        <div style={{ 
          padding: '1rem', 
          backgroundColor: '#fee2e2', 
          border: '1px solid #fca5a5', 
          borderRadius: '6px', 
          marginBottom: '1rem',
          color: '#dc2626'
        }}>
          <strong>Erro ao carregar pacientes:</strong> {error}
        </div>
      )}

      {error && (error.includes('Servidor backend não está disponível') || error.includes('ECONNREFUSED') || error.includes('Network Error')) && (
        <div style={{ 
          padding: '1rem', 
          backgroundColor: '#fee2e2', 
          border: '1px solid #fca5a5', 
          borderRadius: '6px', 
          marginBottom: '1rem',
          color: '#dc2626'
        }}>
          <strong>⚠️ Erro de Conexão:</strong> Não foi possível conectar ao servidor. Verifique se o backend está em execução.
        </div>
      )}

      {!loading && !error && patients.length === 0 && (
        <Card>
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p>{t('patients.noPatients')}</p>
            <p style={{ marginTop: '1rem', color: 'var(--text-light)', fontSize: '0.875rem' }}>
              {t('patients.noPatientsHint')}
            </p>
          </div>
        </Card>
      )}

      {!loading && displayPatients && Array.isArray(displayPatients) && displayPatients.length > 0 && (
      <Card>
        <Table
          headers={[
            'ID',
            t('patients.actions'),
          ]}
        >
          {displayPatients.map((patient, index) => {
            const canViewFullData = user?.roleName === 'Administrador' || user?.roleName === 'Coordenador' || user?.accessType === 3 || user?.accessType === 4;
            const patientID = patient.patientID 
              ? String(patient.patientID) 
              : ((patient as any).id ? String((patient as any).id) : `patient-${index}`);
            const consentStatus = (patient as any).status;
            const isConsentPending = consentStatus === 'PENDING_CONSENT';
            
            return (
              <Fragment key={`patient-fragment-${patientID}`}>
                <tr key={`patient-row-${index}-${patientID}`}>
                  <td>{patientID}</td>
                  {canViewFullData ? (
                    <td>
                      <div className="table-actions">
                        <button
                          className="action-button"
                          onClick={() => handleEdit(patientID)}
                          title={t('common.edit')}
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          className="action-button danger"
                          onClick={() => handleDelete(patientID)}
                          title={t('common.delete')}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  ) : (
                    <td>
                      <span style={{ color: 'var(--text-light)', fontSize: '0.875rem' }}>
                        {t('patients.viewOnly')}
                      </span>
                    </td>
                  )}
                </tr>
                {isConsentPending && (
                  <tr key={`patient-consent-${patientID}`}>
                    <td colSpan={2}>
                      <div
                        style={{
                          padding: '0.75rem 1rem',
                          backgroundColor: '#fef3c7',
                          border: '1px solid #f59e0b',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '1rem'
                        }}
                      >
                        <div style={{ color: '#92400e', fontSize: '0.9rem' }}>
                          <strong>Consentimento pendente.</strong> Paciente precisa aceitar o TCLE.
                        </div>
                        {canViewFullData && (
                          <Button
                            variant="secondary"
                            onClick={async () => {
                              setResendingConsentFor(patientID);
                              try {
                                await patientService.resendConsentNotification(patientID);
                                await loadPatients();
                                alert('Notificações de consentimento reenviadas.');
                              } catch (err: any) {
                                const errorMsg = err.response?.data?.message || err.message || 'Erro ao reenviar notificações.';
                                alert(errorMsg);
                              } finally {
                                setResendingConsentFor(null);
                              }
                            }}
                            disabled={resendingConsentFor === patientID}
                          >
                            {resendingConsentFor === patientID ? 'Reenviando...' : 'Reenviar Notificações'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </Table>
      </Card>
      )}

      {showSearchResults && (
        <div style={{ 
          marginBottom: '1rem',
          padding: '0.75rem 1rem', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          backgroundColor: 'transparent',
          borderBottom: '1px solid var(--border)',
          fontSize: '0.875rem',
          color: 'var(--text-secondary)'
        }}>
          <span>
            <span style={{ color: 'var(--text-light)', marginRight: '0.5rem' }}>{t('patients.search')}</span>
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>"{searchTerm}"</span>
            <span style={{ color: 'var(--text-light)', marginLeft: '0.5rem' }}>
              ({searchResults.length} {searchResults.length === 1 ? t('patients.result') : t('patients.results')})
            </span>
          </span>
          <button
            onClick={handleClearSearch}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-light)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text)';
              e.currentTarget.style.backgroundColor = 'var(--surface)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-light)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title={t('patients.clearSearch')}
          >
            {t('patients.clear')}
          </button>
        </div>
      )}

    </div>
  );
}
