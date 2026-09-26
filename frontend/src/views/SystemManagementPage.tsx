import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Table from '../components/UI/Table';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import Input from '../components/UI/Input';
import { Plus, Edit, Trash2, UserCog, Shield, Shield as ShieldIcon, RotateCcw, XCircle, Building2, FlaskConical, KeyRound } from 'lucide-react';
import { useUsers } from '../hooks/useUsers';
import { useOrganizations } from '../hooks/useOrganizations';
import { useCollections } from '../hooks/useCollections';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { userService } from '../services/api';
import { Organization, Collection } from '../types/models';
import SecurityPage from './SecurityPage';
import './SystemManagementPage.css';

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
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabType | null;
  const isAdmin = currentUser?.roleName === 'Administrador' || currentUser?.accessType === 4;
  // #1228: Coordenador may only use the users tab (mint Técnico / manage users).
  const validTabs: TabType[] = isAdmin
    ? ['users', 'organizations', 'collections', 'security']
    : ['users'];
  const initialTab = (tabParam && validTabs.includes(tabParam)) ? tabParam : 'users';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      setActiveTab(tabParam);
    } else if (tabParam && !validTabs.includes(tabParam)) {
      setActiveTab('users');
      setSearchParams({ tab: 'users' }, { replace: true });
    }
  }, [tabParam, isAdmin]);

  const allTabs = [
    { id: 'users' as TabType, label: t('system.tabs.users', 'Usuários'), icon: UserCog },
    { id: 'organizations' as TabType, label: t('system.tabs.organizations', 'Organizações'), icon: Building2 },
    { id: 'collections' as TabType, label: t('system.tabs.collections', 'Coleções'), icon: FlaskConical },
    { id: 'security' as TabType, label: t('system.tabs.security', 'Segurança'), icon: ShieldIcon },
  ];
  const tabs = allTabs.filter((tab) => validTabs.includes(tab.id));

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
        {isAdmin && activeTab === 'organizations' && <OrganizationsSection />}
        {isAdmin && activeTab === 'collections' && <CollectionsSection />}
        {isAdmin && activeTab === 'security' && <SecuritySection />}
      </div>
    </div>
  );
}

// Seção de Usuários
function UsersSection() {
  const { users, loading, error, validateUserStatus, deleteUser, loadUsers } = useUsers();
  const { organizations } = useOrganizations();
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
                    >
                      <KeyRound size={16} />
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

/**
 * Monta o payload de criação/edição de uma Organization a partir do
 * estado do formulário — remove campos gerenciados pelo servidor
 * (organizationId, normalizedName, _id) e normaliza campos opcionais
 * vazios para null (o backend distingue "não informado" de string vazia).
 */
export function buildOrganizationSubmissionPayload(
  formData: Partial<Organization>
): Partial<Organization> {
  const { organizationId, normalizedName, _id, ...rest } = formData;
  return {
    ...rest,
    acronym: rest.acronym ? rest.acronym : null,
    organizationType: rest.organizationType ? rest.organizationType : null,
    website: rest.website ? rest.website : null,
  };
}

// Seção de Organizações
function OrganizationsSection() {
  const { organizations, loading, error, createOrganization, updateOrganization, deleteOrganization } = useOrganizations();
  const { t } = useLanguage();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrganization, setEditingOrganization] = useState<Organization | null>(null);

  return (
    <>
      <div className="section-header">
        <Button
          data-testid="new-organization-button"
          onClick={() => {
            setEditingOrganization(null);
            setIsModalOpen(true);
          }}
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
          {Array.isArray(organizations) && organizations.length > 0 ? (
            organizations.map((org) => (
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
                      onClick={() => {
                        setEditingOrganization(org);
                        setIsModalOpen(true);
                      }}
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
                {loading ? t('common.loading') : t('system.organizations.empty', 'Nenhuma organização cadastrada')}
              </td>
            </tr>
          )}
        </Table>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingOrganization(null);
        }}
        title={editingOrganization
          ? t('system.organizations.editTitle', 'Editar Organização')
          : t('system.organizations.newTitle', 'Nova Organização')}
      >
        <OrganizationForm
          organization={editingOrganization}
          onSave={async (data) => {
            try {
              const payload = buildOrganizationSubmissionPayload(data);
              if (editingOrganization) {
                await updateOrganization(editingOrganization.organizationId, payload);
              } else {
                await createOrganization(payload);
              }
              setIsModalOpen(false);
              setEditingOrganization(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingOrganization(null);
          }}
        />
      </Modal>
    </>
  );
}

function OrganizationForm({
  organization,
  onSave,
  onCancel,
}: {
  organization: Organization | null;
  onSave: (data: Partial<Organization>) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [formData, setFormData] = useState<Partial<Organization>>(
    organization || {
      officialName: '',
      acronym: '',
      organizationType: '',
      countryCode: '',
      website: '',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="form" data-testid="organization-form">
      <div className="form-grid">
        <Input
          label={t('system.organizations.officialName', 'Nome Oficial')}
          data-testid="organization-official-name-input"
          value={formData.officialName || ''}
          onChange={(e) => setFormData({ ...formData, officialName: e.target.value })}
          required
        />
        <Input
          label={t('system.organizations.acronym', 'Sigla')}
          data-testid="organization-acronym-input"
          value={formData.acronym || ''}
          onChange={(e) => setFormData({ ...formData, acronym: e.target.value })}
        />
        <Input
          label={t('system.organizations.organizationType', 'Tipo')}
          data-testid="organization-type-input"
          value={formData.organizationType || ''}
          onChange={(e) => setFormData({ ...formData, organizationType: e.target.value })}
        />
        <Input
          label={t('system.organizations.countryCode', 'País (código ISO)')}
          data-testid="organization-country-code-input"
          value={formData.countryCode || ''}
          onChange={(e) => setFormData({ ...formData, countryCode: e.target.value.toUpperCase() })}
          maxLength={2}
          required
        />
        <Input
          label={t('system.organizations.website', 'Website')}
          data-testid="organization-website-input"
          value={formData.website || ''}
          onChange={(e) => setFormData({ ...formData, website: e.target.value })}
        />
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" data-testid="organization-form-submit">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

// Campos CodeableConcept[] da Collection (ELM-0043..0046, 0048..0049,
// dict-02_DICIONARIO.md) — sem terminologia codificada ainda (Fase 1), então
// cada um é editado como uma lista de texto livre separada por ";" (mesmo
// separador usado nos valores de exemplo do próprio dicionário, ex.:
// "plasma; serum; tissue") e persistido como Array<{ text: string }>.
const COLLECTION_CODEABLE_CONCEPT_FIELDS = [
  'sampleTypes',
  'datasetTypes',
  'diseaseScope',
  'inclusionCriteriaCategories',
  'miabisUseAccessConditions',
  'storageTemperatureCategories',
] as const;

type CollectionCodeableConceptField = typeof COLLECTION_CODEABLE_CONCEPT_FIELDS[number];

export function parseSemicolonTags(text: string): string[] {
  return text.split(';').map((s) => s.trim()).filter(Boolean);
}

export function formatSemicolonTags(items: Array<Record<string, unknown>> | undefined, key: string): string {
  if (!Array.isArray(items)) {
    return '';
  }
  return items.map((item) => String(item?.[key] ?? '')).filter(Boolean).join('; ');
}

export interface CollectionFormState {
  collectionId: string;
  collectionName: string;
  collectionStatus: string;
  exclusionCriteria: string;
  participantCount: string;
  sampleCount: string;
  relatedPublicationsText: string;
  sampleTypesText: string;
  datasetTypesText: string;
  diseaseScopeText: string;
  inclusionCriteriaCategoriesText: string;
  miabisUseAccessConditionsText: string;
  storageTemperatureCategoriesText: string;
}

/**
 * Converte uma Collection existente no estado (texto) do formulário de
 * edição — inverso de buildCollectionSubmissionPayload.
 */
export function buildCollectionFormState(collection: Collection | null): CollectionFormState {
  return {
    collectionId: collection?.collectionId || '',
    collectionName: collection?.collectionName || '',
    collectionStatus: collection?.collectionStatus || 'active',
    exclusionCriteria: collection?.exclusionCriteria || '',
    participantCount: collection?.participantCount != null ? String(collection.participantCount) : '',
    sampleCount: collection?.sampleCount != null ? String(collection.sampleCount) : '',
    relatedPublicationsText: formatSemicolonTags(collection?.relatedPublications, 'value'),
    sampleTypesText: formatSemicolonTags(collection?.sampleTypes, 'text'),
    datasetTypesText: formatSemicolonTags(collection?.datasetTypes, 'text'),
    diseaseScopeText: formatSemicolonTags(collection?.diseaseScope, 'text'),
    inclusionCriteriaCategoriesText: formatSemicolonTags(collection?.inclusionCriteriaCategories, 'text'),
    miabisUseAccessConditionsText: formatSemicolonTags(collection?.miabisUseAccessConditions, 'text'),
    storageTemperatureCategoriesText: formatSemicolonTags(collection?.storageTemperatureCategories, 'text'),
  };
}

const CODEABLE_CONCEPT_TEXT_KEY: Record<CollectionCodeableConceptField, keyof CollectionFormState> = {
  sampleTypes: 'sampleTypesText',
  datasetTypes: 'datasetTypesText',
  diseaseScope: 'diseaseScopeText',
  inclusionCriteriaCategories: 'inclusionCriteriaCategoriesText',
  miabisUseAccessConditions: 'miabisUseAccessConditionsText',
  storageTemperatureCategories: 'storageTemperatureCategoriesText',
};

/**
 * Monta o payload de criação/edição de uma Collection a partir do estado
 * (texto) do formulário — implementa as regras de dict-02_DICIONARIO.md
 * ELM-0043..0052: campos CodeableConcept[]/Identifier[] parseados de listas
 * separadas por ";", contagens normalizadas para inteiro ou null.
 */
export function buildCollectionSubmissionPayload(formData: CollectionFormState): Partial<Collection> {
  const payload: Partial<Collection> = {
    collectionId: formData.collectionId.trim(),
    collectionName: formData.collectionName.trim(),
    collectionStatus: formData.collectionStatus || 'active',
    exclusionCriteria: formData.exclusionCriteria.trim() || null,
    participantCount: formData.participantCount.trim() === '' ? null : Number(formData.participantCount),
    sampleCount: formData.sampleCount.trim() === '' ? null : Number(formData.sampleCount),
    relatedPublications: parseSemicolonTags(formData.relatedPublicationsText).map((value) => ({ value })),
  };

  for (const field of COLLECTION_CODEABLE_CONCEPT_FIELDS) {
    const textValue = formData[CODEABLE_CONCEPT_TEXT_KEY[field]] as string;
    payload[field] = parseSemicolonTags(textValue).map((text) => ({ text }));
  }

  return payload;
}

// Seção de Coleções
function CollectionsSection() {
  const { collections, loading, error, createCollection, updateCollection, deleteCollection } = useCollections();
  const { t } = useLanguage();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);

  return (
    <>
      <div className="section-header">
        <Button
          data-testid="new-collection-button"
          onClick={() => {
            setEditingCollection(null);
            setIsModalOpen(true);
          }}
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
          {Array.isArray(collections) && collections.length > 0 ? (
            collections.map((collection) => (
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
                      onClick={() => {
                        setEditingCollection(collection);
                        setIsModalOpen(true);
                      }}
                      title={t('common.edit')}
                    >
                      <Edit size={16} />
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
                {loading ? t('common.loading') : t('system.collections.empty', 'Nenhuma coleção cadastrada')}
              </td>
            </tr>
          )}
        </Table>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingCollection(null);
        }}
        title={editingCollection
          ? t('system.collections.editTitle', 'Editar Coleção')
          : t('system.collections.newTitle', 'Nova Coleção')}
      >
        <CollectionForm
          collection={editingCollection}
          onSave={async (data) => {
            try {
              if (editingCollection) {
                await updateCollection(editingCollection.collectionId, data);
              } else {
                await createCollection(data);
              }
              setIsModalOpen(false);
              setEditingCollection(null);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setEditingCollection(null);
          }}
        />
      </Modal>
    </>
  );
}

function CollectionForm({
  collection,
  onSave,
  onCancel,
}: {
  collection: Collection | null;
  onSave: (data: Partial<Collection>) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [formData, setFormData] = useState<CollectionFormState>(() => buildCollectionFormState(collection));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(buildCollectionSubmissionPayload(formData));
  };

  const tagFieldHelp = t('system.collections.tagFieldHelp', 'Separe múltiplos valores por ";"');

  return (
    <form onSubmit={handleSubmit} className="form" data-testid="collection-form">
      <div className="form-grid">
        {!collection && (
          <Input
            label={t('system.collections.collectionId', 'ID')}
            data-testid="collection-id-input"
            value={formData.collectionId}
            onChange={(e) => setFormData({ ...formData, collectionId: e.target.value })}
            required
          />
        )}
        <Input
          label={t('system.collections.collectionName', 'Nome')}
          data-testid="collection-name-input"
          value={formData.collectionName}
          onChange={(e) => setFormData({ ...formData, collectionName: e.target.value })}
          required
        />
        <div className="form-grid-full">
          <label className="input-label" htmlFor="collectionStatusSelect">
            {t('system.collections.collectionStatus', 'Status')}
          </label>
          <select
            id="collectionStatusSelect"
            className="input"
            value={formData.collectionStatus}
            onChange={(e) => setFormData({ ...formData, collectionStatus: e.target.value })}
          >
            <option value="active">{t('system.collections.statusActive', 'Ativa')}</option>
            <option value="inactive">{t('system.collections.statusInactive', 'Inativa')}</option>
          </select>
        </div>
        <Input
          label={t('system.collections.sampleTypes', 'Tipos de Amostra')}
          data-testid="collection-sample-types-input"
          value={formData.sampleTypesText}
          onChange={(e) => setFormData({ ...formData, sampleTypesText: e.target.value })}
          helperText={tagFieldHelp}
          placeholder="plasma; serum; tissue"
        />
        <Input
          label={t('system.collections.datasetTypes', 'Tipos de Dados')}
          data-testid="collection-dataset-types-input"
          value={formData.datasetTypesText}
          onChange={(e) => setFormData({ ...formData, datasetTypesText: e.target.value })}
          helperText={tagFieldHelp}
          placeholder="clinical; genomic; imaging"
        />
        <Input
          label={t('system.collections.diseaseScope', 'Escopo de Doenças')}
          data-testid="collection-disease-scope-input"
          value={formData.diseaseScopeText}
          onChange={(e) => setFormData({ ...formData, diseaseScopeText: e.target.value })}
          helperText={tagFieldHelp}
          placeholder="ORPHA:...; ICD-11:..."
        />
        <Input
          label={t('system.collections.inclusionCriteriaCategories', 'Critérios de Inclusão')}
          data-testid="collection-inclusion-criteria-input"
          value={formData.inclusionCriteriaCategoriesText}
          onChange={(e) => setFormData({ ...formData, inclusionCriteriaCategoriesText: e.target.value })}
          helperText={tagFieldHelp}
        />
        <Input
          label={t('system.collections.exclusionCriteria', 'Critérios de Exclusão')}
          data-testid="collection-exclusion-criteria-input"
          value={formData.exclusionCriteria}
          onChange={(e) => setFormData({ ...formData, exclusionCriteria: e.target.value })}
        />
        <Input
          label={t('system.collections.miabisUseAccessConditions', 'Condições de Uso e Acesso')}
          data-testid="collection-use-access-input"
          value={formData.miabisUseAccessConditionsText}
          onChange={(e) => setFormData({ ...formData, miabisUseAccessConditionsText: e.target.value })}
          helperText={tagFieldHelp}
          placeholder="DUO:0000042"
        />
        <Input
          label={t('system.collections.storageTemperatureCategories', 'Categorias de Temperatura')}
          data-testid="collection-storage-temperature-input"
          value={formData.storageTemperatureCategoriesText}
          onChange={(e) => setFormData({ ...formData, storageTemperatureCategoriesText: e.target.value })}
          helperText={tagFieldHelp}
          placeholder="-80 °C"
        />
        <Input
          label={t('system.collections.participantCount', 'Número de Participantes')}
          data-testid="collection-participant-count-input"
          type="number"
          min={0}
          value={formData.participantCount}
          onChange={(e) => setFormData({ ...formData, participantCount: e.target.value })}
        />
        <Input
          label={t('system.collections.sampleCount', 'Número de Amostras')}
          data-testid="collection-sample-count-input"
          type="number"
          min={0}
          value={formData.sampleCount}
          onChange={(e) => setFormData({ ...formData, sampleCount: e.target.value })}
        />
        <Input
          label={t('system.collections.relatedPublications', 'Publicações Relacionadas (DOI/PMID)')}
          data-testid="collection-related-publications-input"
          value={formData.relatedPublicationsText}
          onChange={(e) => setFormData({ ...formData, relatedPublicationsText: e.target.value })}
          helperText={tagFieldHelp}
          placeholder="doi:...; pmid:..."
        />
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" data-testid="collection-form-submit">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

// Seção de Segurança (importa o componente completo)
function SecuritySection() {
  return <SecurityPage />;
}

