import { Link } from 'react-router-dom';
import Card from '../UI/Card';

type TranslatorFn = (key: string, fallback?: string) => string;

interface SampleLineageCardProps {
  parentSpecimenIds?: unknown;
  t: TranslatorFn;
}

// #1559: a derivative names the specimens it was derived from; each one links
// to its own sample page. A sample with no parents shows no card.
export default function SampleLineageCard({ parentSpecimenIds, t }: SampleLineageCardProps) {
  const parents = Array.isArray(parentSpecimenIds)
    ? parentSpecimenIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  if (parents.length === 0) return null;

  return (
    <Card data-testid="sample-lineage-card">
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text)' }}>
        {t('samples.detail.lineageTitle', 'Linhagem')}
      </h3>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.5rem', backgroundColor: 'var(--surface)', borderRadius: '4px' }}>
        <span style={{ fontWeight: 500, color: 'var(--text-light)' }}>{t('samples.detail.lineageParents', 'Amostras de origem')}:</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {parents.map((parentId) => (
            <Link
              key={parentId}
              to={`/samples/${encodeURIComponent(parentId)}`}
              data-testid={`sample-lineage-parent-link-${parentId}`}
              style={{ color: 'var(--primary)', textDecoration: 'underline' }}
            >
              {parentId}
            </Link>
          ))}
        </span>
      </div>
    </Card>
  );
}
