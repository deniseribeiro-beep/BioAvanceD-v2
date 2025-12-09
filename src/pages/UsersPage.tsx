import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import { Plus, Edit, Trash2, Shield, UserCog, FlaskConical, UserCheck, RotateCcw, XCircle } from 'lucide-react';
import { User, SpecificUser } from '../types/models';
import { useUsers } from '../hooks/useUsers';
import { useAuth } from '../contexts/AuthContext';
import { userService } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import './UsersPage.css';

// Função auxiliar para obter ícone da role
function getRoleIcon(roleName?: string) {
  switch (roleName) {
    case 'Administrador':
      return <Shield size={14} />;
    case 'Coordenador':
      return <UserCog size={14} />;
    case 'Técnico':
      return <FlaskConical size={14} />;
    case 'Usuário Externo':
      return <UserCheck size={14} />;
    default:
      return null;
  }
}

// Função auxiliar para obter label do accessType (compatibilidade)
function getAccessTypeLabel(accessType?: number) {
  switch (accessType) {
    case 3:
      return 'Administrador';
    case 2:
      return 'Coordenador';
    case 1:
      return 'Técnico';
    default:
      return 'Técnico';
  }
}

export default function UsersPage() {
  const { users, loading, error, validateUserStatus, deleteUser, loadUsers } = useUsers();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  
  // Verifica se o usuário atual é admin
  const isAdmin = currentUser?.roleName === 'Administrador' || currentUser?.accessType === 4;

  // Função auxiliar para obter ícone da role (definida dentro do componente)
  const getRoleIconLocal = (roleName?: string) => {
    switch (roleName) {
      case 'Administrador':
        return <Shield size={14} />;
      case 'Coordenador':
        return <UserCog size={14} />;
      case 'Técnico':
        return <FlaskConical size={14} />;
      case 'Usuário Externo':
        return <UserCheck size={14} />;
      default:
        return null;
    }
  };

  // Função auxiliar para obter label do accessType (compatibilidade)
  const getAccessTypeLabelLocal = (accessType?: number) => {
    switch (accessType) {
      case 3:
        return 'Administrador';
      case 2:
        return 'Coordenador';
      case 1:
        return 'Técnico';
      default:
        return 'Técnico';
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('users.title')}</h1>
          <p className="page-subtitle">{t('users.subtitleManagement')}</p>
        </div>
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
            const isAdmin = currentUser?.roleName === 'Administrador' || currentUser?.accessType === 4;
            const userIsAdmin = user.roleName === 'Administrador' || user.accessType === 4;
            const userId = (user as any)._id || user.id;
            // Botão de reset MFA visível para todas as roles (exceto para o próprio usuário admin)
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
                        {getRoleIconLocal(user.roleName)}
                        {user.roleName}
                      </span>
                    ) : (
                      <span className="role-badge role-tecnico">
                        {getAccessTypeLabelLocal(user.accessType)}
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
                            await loadUsers(); // Recarrega a lista após exclusão
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
    </div>
  );
}
