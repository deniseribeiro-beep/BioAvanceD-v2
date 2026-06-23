import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import { Plus, Edit, Trash2, UserCog, Shield, Shield as ShieldIcon, RotateCcw, XCircle } from 'lucide-react';
import { useUsers } from '../hooks/useUsers';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { userService } from '../services/api';
import SecurityPage from './SecurityPage';
import './SystemManagementPage.css';

type TabType = 'users' | 'security';

export default function SystemManagementPage() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabType | null;
  const validTabs: TabType[] = ['users', 'security'];
  const initialTab = (tabParam && validTabs.includes(tabParam)) ? tabParam : 'users';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const tabs = [
    { id: 'users' as TabType, label: t('system.tabs.users', 'Usuários'), icon: UserCog },
    { id: 'security' as TabType, label: t('system.tabs.security', 'Segurança'), icon: ShieldIcon },
  ];

  return (
    <div className="page" data-testid="system-management-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('system.title', 'Gerenciamento do Sistema')}</h1>
          <p className="page-subtitle">{t('system.subtitle', 'Gerenciamento integrado de usuários e configurações de segurança')}</p>
        </div>
      </div>

      <div className="system-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              data-testid={`system-tab-${tab.id}`}
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
        return t('roles.administrator', 'Administrador');
      case 3:
        return t('roles.coordinator', 'Coordenador');
      case 2:
        return t('roles.technician', 'Técnico');
      case 1:
        return t('roles.externalUser', 'Usuário Externo');
      default:
        return t('roles.technician', 'Técnico');
    }
  };

  return (
    <>
      <div className="section-header">
        <Button data-testid="new-user-button" onClick={() => navigate('/users/new')}>
          <Plus size={18} />
          {t('users.new')}
        </Button>
      </div>

      {loading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{t('common.error')}: {error}</p>}

      <Card>
        <Table
          data-testid="users-table"
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
                        data-testid={`reset-mfa-button-${userId || user.id}`}
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
                        data-testid={`disable-mfa-button-${userId || user.id}`}
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
                      data-testid={`edit-user-button-${userId || user.id}`}
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
                      data-testid={`delete-user-button-${userId || user.id}`}
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

// Seção de Segurança (importa o componente completo)
function SecuritySection() {
  return <SecurityPage />;
}

