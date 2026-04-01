import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, UserCog, Key, Shield, Shield as ShieldIcon, RotateCcw, XCircle } from 'lucide-react';
import { Access } from '../types/models';
import { useUsers } from '../hooks/useUsers';
import { useAccess } from '../hooks/useAccess';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { userService } from '../services/api';
import SecurityPage from './SecurityPage';
import './SystemManagementPage.css';

type TabType = 'users' | 'access' | 'security';

export default function SystemManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabType | null;
  const validTabs: TabType[] = ['users', 'access', 'security'];
  const initialTab = (tabParam && validTabs.includes(tabParam)) ? tabParam : 'users';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const tabs = [
    { id: 'users' as TabType, label: 'Usuários', icon: UserCog },
    { id: 'access' as TabType, label: 'Acessos', icon: Key },
    { id: 'security' as TabType, label: 'Segurança', icon: ShieldIcon },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gerenciamento do Sistema</h1>
          <p className="page-subtitle">Gerenciamento integrado de usuários, acessos e configurações de segurança</p>
        </div>
      </div>

      <div className="system-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`system-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchParams({ tab: tab.id });
              }}
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="system-tab-content">
        {activeTab === 'users' && <UsersSection />}
        {activeTab === 'access' && <AccessSection />}
        {activeTab === 'security' && <SecuritySection />}
      </div>
    </div>
  );
}

// Seção de Usuários
function UsersSection() {
  const { users, loading, error, validateUserStatus, deleteUser, loadUsers } = useUsers();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  
  const isAdmin = currentUser?.roleName === 'Administrador' || currentUser?.accessType === 4;

  const getRoleIcon = (roleName?: string) => {
    switch (roleName) {
      case 'Administrador':
        return <Shield size={14} />;
      case 'Coordenador':
        return <UserCog size={14} />;
      case 'Técnico':
        return null;
      case 'Usuário Externo':
        return null;
      default:
        return null;
    }
  };

  const getAccessTypeLabel = (accessType?: number) => {
    switch (accessType) {
      case 4:
        return 'Administrador';
      case 3:
        return 'Coordenador';
      case 2:
        return 'Técnico';
      case 1:
        return 'Usuário Externo';
      default:
        return 'Técnico';
    }
  };

  return (
    <>
      <div className="section-header">
        <Button onClick={() => navigate('/users/new')}>
          <Plus size={18} />
          {t('users.new')}
        </Button>
      </div>

      {loading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{t('common.error')}: {error}</p>}

      <Card>
        <Table
          headers={[
            t('users.name'),
            t('users.email'),
            t('users.institution'),
            t('users.username'),
            t('users.role'),
            t('users.status'),
            t('users.mfa'),
            t('common.actions'),
          ]}
        >
          {Array.isArray(users) && users.map((user) => {
            const userIsAdmin = user.roleName === 'Administrador' || user.accessType === 4;
            const userId = (user as any)._id || user.id;
            const showResetButton = !userIsAdmin;
            
            return (
              <tr key={userId || user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.institution || '-'}</td>
                <td>{user.username}</td>
                <td>
                  <div className="role-badge-container">
                    {user.roleName ? (
                      <span className={`role-badge role-${user.roleName.toLowerCase().replace(' ', '-')}`}>
                        {getRoleIcon(user.roleName)}
                        {user.roleName}
                      </span>
                    ) : (
                      <span className="role-badge role-tecnico">
                        {getAccessTypeLabel(user.accessType)}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`status-badge status-${user.status?.toLowerCase() || 'ativo'}`}>
                    {user.status || t('users.statusActive')}
                  </span>
                </td>
                <td>
                  <div className="mfa-cell">
                    <span className={`status-badge ${userIsAdmin ? 'status-inativo' : (user.mfaEnabled ? 'status-ativo' : 'status-inativo')}`}>
                      {userIsAdmin ? t('users.mfaNotApplicable') : (user.mfaEnabled ? t('users.mfaEnabled') : t('users.mfaDisabled'))}
                    </span>
                    {showResetButton && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!userId) {
                            alert(t('users.userIdNotFound'));
                            return;
                          }
                          const confirmMessage = user.mfaEnabled 
                            ? t('users.mfaResetConfirm').replace('{name}', user.name)
                            : t('users.mfaResetConfirmInactive').replace('{name}', user.name);
                          if (confirm(confirmMessage)) {
                            try {
                              await userService.resetMFA(userId);
                              alert(t('users.mfaResetSuccess'));
                              await loadUsers();
                            } catch (err: any) {
                              alert(err.response?.data?.error || err.response?.data?.message || err.message || t('users.mfaResetError'));
                            }
                          }
                        }}
                        title={user.mfaEnabled ? t('users.mfaResetTitle') : t('users.mfaResetTitleInactive')}
                        className="mfa-reset-button"
                      >
                        <RotateCcw size={14} />
                        <span>{t('users.mfaReset')}</span>
                      </button>
                    )}
                    {isAdmin && userIsAdmin && user.mfaEnabled && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!userId) {
                            alert(t('users.userIdNotFound'));
                            return;
                          }
                          const confirmMessage = t('users.mfaDisableConfirm').replace('{name}', user.name);
                          if (confirm(confirmMessage)) {
                            try {
                              await userService.disableMFA(userId);
                              alert(t('users.mfaDisableSuccess'));
                              await loadUsers();
                            } catch (err: any) {
                              alert(err.response?.data?.error || err.response?.data?.message || err.message || t('users.mfaDisableError'));
                            }
                          }
                        }}
                        title={t('users.mfaDisableTitle')}
                        className="mfa-disable-button"
                      >
                        <XCircle size={14} />
                        <span>{t('users.mfaDisable')}</span>
                      </button>
                    )}
                  </div>
                </td>
                <td>
                  <div className="table-actions">
                    <button
                      className="action-button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate('/users/new', { state: { user } });
                      }}
                      title={t('common.edit')}
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      className="action-button danger"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirm(t('users.deleteConfirm'))) {
                          try {
                            const userId = (user as any)._id || user.id;
                            await deleteUser(userId);
                            await loadUsers();
                          } catch (err: any) {
                            alert(err.response?.data?.error || err.response?.data?.message || err.message || t('users.deleteError'));
                          }
                        }
                      }}
                      title={t('common.delete')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

// Seção de Acessos
function AccessSection() {
  const { accesses, loading, error } = useAccess();
  return (
    <>
      <div className="section-header">
        <p className="form-help-text">
          A gestão dos tipos de acesso (RBAC) agora é feita exclusivamente pelo admin via dicionário de dados. Para alterar, acesse o menu "Dicionário de Dados".
        </p>
      </div>
      {loading && <p>Carregando...</p>}
      {error && <p style={{ color: 'var(--danger)' }}>Erro: {error}</p>}
      <Card>
        <Table headers={['ID', 'Tipo de Relatório']}>
          {accesses.map((access) => (
            <tr key={access.reportID}>
              <td>{access.reportID}</td>
              <td>{access.reportType}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

function AccessForm({
  access,
  onSave,
  onCancel,
}: {
  access: Access | null;
  onSave: (data: Partial<Access>) => void;
  onCancel: () => void;
}) {
  const editingAccess = access !== null;
  
  const [formData, setFormData] = useState<Partial<Access>>(
    access || {
      reportType: '',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.reportType || formData.reportType.trim() === '') {
      alert('Por favor, selecione um tipo de relatório');
      return;
    }
    
    if (!validateAccessType(formData.reportType)) {
      alert('Tipo de acesso inválido');
      return;
    }
    
    const dataToSave = editingAccess 
      ? formData 
      : { reportType: formData.reportType.trim() };
    
    onSave(dataToSave);
  };

  const validateAccessType = (description: string): boolean => {
    const validTypes = [
      'Relatório de Pacientes',
      'Relatório de Amostras',
      'Relatório de Temperatura',
      'Relatório de Sensores',
      'Acesso Completo',
    ];
    return validTypes.includes(description) || description.length > 0;
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="form-grid">
        <div className="form-grid-full">
          <label className="form-label">Tipo de Relatório *</label>
          <select
            value={formData.reportType || ''}
            onChange={(e) =>
              setFormData({ ...formData, reportType: e.target.value })
            }
            required
            className="form-select"
          >
            <option value="">Selecione um tipo...</option>
            <option value="Relatório de Pacientes">Relatório de Pacientes</option>
            <option value="Relatório de Amostras">Relatório de Amostras</option>
            <option value="Relatório de Temperatura">Relatório de Temperatura</option>
            <option value="Relatório de Sensores">Relatório de Sensores</option>
            <option value="Acesso Completo">Acesso Completo</option>
          </select>
        </div>
        {!editingAccess && (
          <div className="form-grid-full">
            <p className="form-help-text">
              ℹ️ O ID será gerado automaticamente pelo sistema
            </p>
          </div>
        )}
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Salvar</Button>
      </div>
    </form>
  );
}

// Seção de Segurança (importa o componente completo)
function SecuritySection() {
  return <SecurityPage />;
}

