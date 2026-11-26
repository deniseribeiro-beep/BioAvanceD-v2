import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import { useOrganizations } from '../hooks/useOrganizations';
import { useLanguage } from '../contexts/LanguageContext';
import { Organization } from '../types/models';
import { buildOrganizationSubmissionPayload } from './organizationForm';

const LIST_PATH = '/system-management?tab=organizations';

export default function OrganizationFormPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { organizations, createOrganization, updateOrganization } = useOrganizations();
  const isNew = !id;

  const editingOrganization = useMemo(() => {
    const fromState = (location.state as { organization?: Organization } | null)?.organization;
    if (fromState) return fromState;
    if (!id) return null;
    return organizations.find((org) => org.organizationId === id) ?? null;
  }, [location.state, organizations, id]);

  const title = editingOrganization
    ? t('system.organizations.editTitle', 'Editar Organização')
    : t('system.organizations.newTitle', 'Nova Organização');

  return (
    <EntityFormPageShell title={title} backTo={LIST_PATH} testId="organization-form-page">
      {id && !editingOrganization ? (
        <p>{t('common.loading')}</p>
      ) : (
        <OrganizationFormFields
          organization={isNew ? null : editingOrganization}
          onSave={async (data) => {
            try {
              const payload = buildOrganizationSubmissionPayload(data);
              if (editingOrganization && !isNew) {
                await updateOrganization(editingOrganization.organizationId, payload);
              } else {
                await createOrganization(payload);
              }
              navigate(LIST_PATH);
            } catch (err: any) {
              alert(err.message);
            }
          }}
          onCancel={() => navigate(LIST_PATH)}
        />
      )}
    </EntityFormPageShell>
  );
}

export function OrganizationFormFields({
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
