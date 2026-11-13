import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, UserCog, Shield, Shield as ShieldIcon, RotateCcw, XCircle, Building2, FlaskConical, KeyRound, LogOut, Landmark, Search } from 'lucide-react';
import { useUsers } from '../hooks/useUsers';
import { useOrganizations } from '../hooks/useOrganizations';
import { useCollections } from '../hooks/useCollections';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { userService } from '../services/api';
import { Organization } from '../types/models';
import SecurityPage from './SecurityPage';
import { formatSemicolonTags } from './collectionForm';

export {
  buildOrganizationSubmissionPayload,
} from './organizationForm';
export {
  parseSemicolonTags,
  formatSemicolonTags,
  buildCollectionFormState,
  buildCollectionSubmissionPayload,
} from './collectionForm';
export type { CollectionFormState } from './collectionForm';

type TabType = 'users' | 'organizations' | 'collections' | 'security';

/**
 * Resolve o organizationId de um User para o officialName da Organization
 * correspondente, para exibição na tabela de usuários.
 * Implementa: leitura de User.organizationId (Reference -> Organization, #347).
 */
export function resolveOrganizationLabel(
  organizations: Organization[],
  organizationId: string | null | undefined
): string {
  if (!organizationId) {
    return '-';
  }
  const match = organizations.find((org) => org.organizationId === organizationId);
  return match?.officialName || '-';
}

export default function SystemManagementPage() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabType | null;
  const validTabs: TabType[] = ['users', 'organizations', 'collections', 'security'];
  const initialTab = (tabParam && validTabs.includes(tabParam)) ? tabParam : 'users';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const tabs = [
    { id: 'users' as TabType, label: t('system.tabs.users', 'Usuários'), icon: UserCog },
    { id: 'organizations' as TabType, label: t('system.tabs.organizations', 'Organizações'), icon: Building2 },
    { id: 'collections' as TabType, label: t('system.tabs.collections', 'Coleções'), icon: FlaskConical },
    { id: 'security' as TabType, label: t('system.tabs.security', 'Segurança'), icon: ShieldIcon },
  ];

  return (
    <div className="page-shell flex w-full min-w-0 flex-col gap-4" data-testid="system-management-page">
      <div className="card-surface">
        <h1 className="page-title">{t('system.title', 'Gerenciamento do Sistema')}</h1>
        <p className="page-subtitle">
          {t('system.subtitle', 'Usuários, organizações, coleções e políticas de segurança')}
        </p>
      </div>

      <div
        className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
        role="tablist"
        aria-label={t('system.tabsLabel', 'Seções do gerenciamento do sistema')}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`system-tab-${tab.id}`}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-primary-soft hover:text-primary'
              }`}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchParams({ tab: tab.id });
              }}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="min-w-0 space-y-4">
        {activeTab === 'users' && <UsersSection />}
        {activeTab === 'organizations' && <OrganizationsSection />}
        {activeTab === 'collections' && <CollectionsSection />}
        {activeTab === 'security' && <SecuritySection />}
      </div>
    </div>
  );
}

// Seção de Usuários
function UsersSection() {
  const { users, loading, error, deleteUser, loadUsers } = useUsers();
  const { organizations } = useOrganizations();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [userQuery, setUserQuery] = useState('');

  const isAdmin = currentUser?.roleName === 'Administrador' || currentUser?.accessType === 4;

  const filteredUsers = useMemo(() => {
    const list = Array.isArray(users) ? users : [];
    const q = userQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) =>
      [u.name, u.email, u.username].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [users, userQuery]);

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
        <div className="relative min-w-[16rem] flex-1 max-w-md">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            data-testid="users-search-input"
            type="search"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder={t('users.searchPlaceholder', 'Buscar por nome, email ou usuário')}
            className="pl-9"
            aria-label={t('users.searchPlaceholder', 'Buscar por nome, email ou usuário')}
          />
        </div>
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
          {filteredUsers.length === 0 && userQuery.trim() ? (
            <tr>
              <td colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                <span data-testid="users-search-empty">
                  {t('users.searchEmpty', 'Nenhum usuário encontrado')}
                </span>
              </td>
            </tr>
          ) : (
            filteredUsers.map((user) => {
              const userIsAdmin = user.roleName === 'Administrador' || user.accessType === 4;
              const userId = (user as any)._id || user.id;
              const showResetButton = !userIsAdmin;

              return (
                <tr key={userId || user.id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{resolveOrganizationLabel(organizations, user.organizationId)}</td>
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
                      {/* #1240: the additive auditor role, beside the main one. */}
                      {user.auditorRole && (
                        <span className="role-badge role-auditor" data-testid={`auditor-badge-${userId || user.id}`}>
                          {t('users.auditorBadge')}
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
                    <span className={`status-badge ${userIsAdmin ? 'status-inativo' : (user.mfaEnabled ? 'status-ativo' : 'status-inativo')}`}>
                      {userIsAdmin ? t('users.mfaNotApplicable') : (user.mfaEnabled ? t('users.mfaEnabled') : t('users.mfaDisabled'))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="table-actions">
                      <button
                        type="button"
                        data-testid={`edit-user-button-${userId || user.id}`}
                        className="action-button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigate('/users/new', { state: { user } });
                        }}
                        title={t('common.edit')}
                        aria-label={t('common.edit')}
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        type="button"
                        data-testid={`force-password-reset-button-${userId || user.id}`}
                        className="action-button"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!userId) {
                            alert(t('users.userIdNotFound'));
                            return;
                          }
                          const confirmMessage = t('users.forcePasswordResetConfirm').replace('{name}', user.name);
                          if (confirm(confirmMessage)) {
                            try {
                              await userService.forcePasswordReset(userId);
                              alert(t('users.forcePasswordResetSuccess'));
                              await loadUsers();
                            } catch (err: any) {
                              alert(err.response?.data?.error || err.response?.data?.message || err.message || t('users.forcePasswordResetError'));
                            }
                          }
                        }}
                        title={t('users.forcePasswordResetTitle')}
                        aria-label={t('users.forcePasswordResetTitle')}
                      >
                        <KeyRound size={16} />
                      </button>
                      {/* #1020 / RF003 AC#5: revoke every active session, recording
                          whether the account is judged at risk (P1X-0267 'risk'). */}
                      <button
                        type="button"
                        data-testid={`revoke-sessions-button-${userId || user.id}`}
                        className="action-button"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!userId) {
                            alert(t('users.userIdNotFound'));
                            return;
                          }
                          if (!confirm(`Revogar todas as sessões ativas de ${user.name}?`)) return;
                          const reason = confirm(
                            'A conta pode estar comprometida?\n\nOK: registrar o motivo como "risco".\nCancelar: registrar como ação administrativa.'
                          ) ? 'risk' : 'admin_action';
                          try {
                            const response = await userService.revokeSessions(userId, reason);
                            alert(`${response.data.data.revoked} sessão(ões) revogada(s).`);
                          } catch (err: any) {
                            alert(err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao revogar sessões');
                          }
                        }}
                        title="Revogar sessões"
                        aria-label="Revogar sessões"
                      >
                        <LogOut size={16} />
                      </button>
                      {showResetButton && (
                        <button
                          type="button"
                          data-testid={`reset-mfa-button-${userId || user.id}`}
                          className="action-button"
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
                          aria-label={user.mfaEnabled ? t('users.mfaResetTitle') : t('users.mfaResetTitleInactive')}
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                      {isAdmin && userIsAdmin && user.mfaEnabled && (
                        <button
                          type="button"
                          data-testid={`disable-mfa-button-${userId || user.id}`}
                          className="action-button"
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
                          aria-label={t('users.mfaDisableTitle')}
                        >
                          <XCircle size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid={`delete-user-button-${userId || user.id}`}
                        className="action-button danger"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (confirm(t('users.deleteConfirm'))) {
                            try {
                              const id = (user as any)._id || user.id;
                              await deleteUser(id);
                              await loadUsers();
                            } catch (err: any) {
                              alert(err.response?.data?.error || err.response?.data?.message || err.message || t('users.deleteError'));
                            }
                          }
                        }}
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </Table>
      </Card>
    </>
  );
}

// Seção de Organizações
function OrganizationsSection() {
  const navigate = useNavigate();
  const { organizations, loading, error, deleteOrganization } = useOrganizations();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = Array.isArray(organizations) ? organizations : [];
    if (!q) return rows;
    return rows.filter((org) =>
      [org.officialName, org.acronym, org.organizationType, org.countryCode, org.website]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [organizations, search]);

  return (
    <>
      <div className="section-header flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="search"
            className="input w-full pl-9"
            data-testid="organizations-search-input"
            placeholder={t('system.organizations.search', 'Buscar organizações…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          data-testid="new-organization-button"
          onClick={() => navigate('/organizations/new')}
        >
          <Plus size={18} />
          {t('system.organizations.new', 'Nova Organização')}
        </Button>
      </div>

      {loading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{t('common.error')}: {error}</p>}

      <Card>
        <Table
          data-testid="organizations-table"
          headers={[
            t('system.organizations.officialName', 'Nome Oficial'),
            t('system.organizations.acronym', 'Sigla'),
            t('system.organizations.organizationType', 'Tipo'),
            t('system.organizations.countryCode', 'País'),
            t('system.organizations.website', 'Website'),
            t('common.actions'),
          ]}
        >
          {filtered.length > 0 ? (
            filtered.map((org) => (
              <tr key={org.organizationId || org._id}>
                <td>{org.officialName}</td>
                <td>{org.acronym || '-'}</td>
                <td>{org.organizationType || '-'}</td>
                <td>{org.countryCode}</td>
                <td>{org.website || '-'}</td>
                <td>
                  <div className="table-actions">
                    <button
                      data-testid={`edit-organization-button-${org.organizationId}`}
                      className="action-button"
                      onClick={() =>
                        navigate(`/organizations/${org.organizationId}/edit`, {
                          state: { organization: org },
                        })
                      }
                      title={t('common.edit')}
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      data-testid={`delete-organization-button-${org.organizationId}`}
                      className="action-button danger"
                      onClick={async () => {
                        if (confirm(t('system.organizations.deleteConfirm', 'Tem certeza que deseja excluir esta organização?'))) {
                          try {
                            await deleteOrganization(org.organizationId);
                          } catch (err: any) {
                            alert(err.message);
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
            ))
          ) : (
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                {loading
                  ? t('common.loading')
                  : search.trim()
                    ? t('system.organizations.searchEmpty', 'Nenhuma organização encontrada')
                    : t('system.organizations.empty', 'Nenhuma organização cadastrada')}
              </td>
            </tr>
          )}
        </Table>
      </Card>
    </>
  );
}

// Seção de Coleções
function CollectionsSection() {
  const navigate = useNavigate();
  const { collections, loading, error, deleteCollection } = useCollections();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = Array.isArray(collections) ? collections : [];
    if (!q) return rows;
    return rows.filter((c) =>
      [c.collectionId, c.collectionName, c.collectionStatus, formatSemicolonTags(c.sampleTypes, 'text')]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [collections, search]);

  return (
    <>
      <div className="section-header flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="search"
            className="input w-full pl-9"
            data-testid="collections-search-input"
            placeholder={t('system.collections.search', 'Buscar coleções…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          data-testid="new-collection-button"
          onClick={() => navigate('/collections/new')}
        >
          <Plus size={18} />
          {t('system.collections.new', 'Nova Coleção')}
        </Button>
      </div>

      {loading && <p>{t('common.loading')}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{t('common.error')}: {error}</p>}

      <Card>
        <Table
          data-testid="collections-table"
          headers={[
            t('system.collections.collectionId', 'ID'),
            t('system.collections.collectionName', 'Nome'),
            t('system.collections.collectionStatus', 'Status'),
            t('system.collections.sampleTypes', 'Tipos de Amostra'),
            t('common.actions'),
          ]}
        >
          {filtered.length > 0 ? (
            filtered.map((collection) => (
              <tr key={collection.collectionId || collection._id}>
                <td>{collection.collectionId}</td>
                <td>{collection.collectionName}</td>
                <td>
                  <span className={`status-badge status-${(collection.collectionStatus || 'active').toLowerCase()}`}>
                    {collection.collectionStatus || 'active'}
                  </span>
                </td>
                <td>{formatSemicolonTags(collection.sampleTypes, 'text') || '-'}</td>
                <td>
                  <div className="table-actions">
                    <button
                      data-testid={`edit-collection-button-${collection.collectionId}`}
                      className="action-button"
                      onClick={() =>
                        navigate(`/collections/${collection.collectionId}/edit`, {
                          state: { collection },
                        })
                      }
                      title={t('common.edit')}
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      data-testid={`governance-collection-button-${collection.collectionId}`}
                      className="action-button"
                      onClick={() =>
                        navigate(`/collections/${collection.collectionId}/governance`, {
                          state: { collection },
                        })
                      }
                      title={t('system.collections.governance.title', 'Governança')}
                    >
                      <Landmark size={16} />
                    </button>
                    <button
                      data-testid={`delete-collection-button-${collection.collectionId}`}
                      className="action-button danger"
                      onClick={async () => {
                        if (confirm(t('system.collections.deleteConfirm', 'Tem certeza que deseja excluir esta coleção?'))) {
                          try {
                            await deleteCollection(collection.collectionId);
                          } catch (err: any) {
                            alert(err.message);
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
            ))
          ) : (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                {loading
                  ? t('common.loading')
                  : search.trim()
                    ? t('system.collections.searchEmpty', 'Nenhuma coleção encontrada')
                    : t('system.collections.empty', 'Nenhuma coleção cadastrada')}
              </td>
            </tr>
          )}
        </Table>
      </Card>
    </>
  );
}

function SecuritySection() {
  return <SecurityPage embedded />;
}
