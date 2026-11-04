import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import { useCollections } from '../hooks/useCollections';
import { useLanguage } from '../contexts/LanguageContext';
import { Collection } from '../types/models';
import {
  buildCollectionFormState,
  buildCollectionSubmissionPayload,
  CollectionFormState,
} from './collectionForm';
import { collectionsService } from '../services/api';
import { useEffect } from 'react';

const LIST_PATH = '/system-management?tab=collections';

export default function CollectionFormPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { collections, createCollection, updateCollection } = useCollections();
  const isNew = !id;
  const [fetched, setFetched] = useState<Collection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fromState = (location.state as { collection?: Collection } | null)?.collection ?? null;

  const editingCollection = useMemo(() => {
    if (fromState) return fromState;
    if (!id) return null;
    return collections.find((c) => c.collectionId === id) ?? fetched;
  }, [fromState, collections, id, fetched]);

  useEffect(() => {
    if (!id || fromState || collections.find((c) => c.collectionId === id)) return;
    let cancelled = false;
    collectionsService
      .getById(id)
      .then((res: any) => {
        if (cancelled) return;
        const data = res?.data?.data ?? res?.data ?? res;
        setFetched(data);
      })
      .catch((err: any) => {
        if (!cancelled) setLoadError(err?.message || 'Erro ao carregar coleção');
      });
    return () => {
      cancelled = true;
    };
  }, [id, fromState, collections]);

  const title = editingCollection
    ? t('system.collections.editTitle', 'Editar Coleção')
    : t('system.collections.newTitle', 'Nova Coleção');

  return (
    <EntityFormPageShell title={title} backTo={LIST_PATH} testId="collection-form-page">
      {loadError && <p style={{ color: 'var(--danger)' }}>{loadError}</p>}
      {id && !editingCollection && !loadError ? (
        <p>{t('common.loading')}</p>
      ) : (
        <CollectionFormFields
          collection={isNew ? null : editingCollection}
          onSave={async (data) => {
            try {
              if (editingCollection && !isNew) {
                await updateCollection(editingCollection.collectionId, data);
              } else {
                await createCollection(data);
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

export function CollectionFormFields({
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
        <div className="form-grid-full">
          <label className="input-label" htmlFor="collectionGovernanceRegimeSelect">
            {t('system.collections.governanceRegime', 'Regime de governança')}
          </label>
          <select
            id="collectionGovernanceRegimeSelect"
            data-testid="collection-governance-regime-select"
            className="input"
            value={formData.governanceRegime}
            onChange={(e) => setFormData({ ...formData, governanceRegime: e.target.value })}
            disabled={!!collection?.governanceRegime}
            required
          >
            <option value="">{t('system.collections.governanceRegimePlaceholder', 'Selecione o regime')}</option>
            <option value="biobank">{t('system.collections.regimeBiobank', 'Biobanco')}</option>
            <option value="biorepository">{t('system.collections.regimeBiorepository', 'Biorrepositório')}</option>
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
