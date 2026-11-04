import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import EntityFormPageShell from '../components/UI/EntityFormPageShell';
import CollectionGovernancePanel from './CollectionGovernancePanel';
import { useCollections } from '../hooks/useCollections';
import { useOrganizations } from '../hooks/useOrganizations';
import { useLanguage } from '../contexts/LanguageContext';
import { Collection } from '../types/models';
import { collectionsService } from '../services/api';

const LIST_PATH = '/system-management?tab=collections';

export default function CollectionGovernancePage() {
  const { t } = useLanguage();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { collections, loadCollections } = useCollections();
  const { organizations } = useOrganizations();
  const [fetched, setFetched] = useState<Collection | null>(null);

  const fromState = (location.state as { collection?: Collection } | null)?.collection ?? null;

  const collection = useMemo(() => {
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
        setFetched(res?.data?.data ?? res?.data ?? res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, fromState, collections]);

  useEffect(() => {
    return () => {
      loadCollections();
    };
  }, [loadCollections]);

  return (
    <EntityFormPageShell
      title={`${t('system.collections.governance.title', 'Governança')}: ${collection?.collectionName ?? id ?? ''}`}
      backTo={LIST_PATH}
      testId="collection-governance-page"
    >
      {!collection ? (
        <p>{t('common.loading')}</p>
      ) : (
        <CollectionGovernancePanel collection={collection} organizations={organizations} />
      )}
    </EntityFormPageShell>
  );
}
