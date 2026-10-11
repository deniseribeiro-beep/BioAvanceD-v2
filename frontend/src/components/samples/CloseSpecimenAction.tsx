import { useState } from 'react';
import Button from '../UI/Button';
import { sampleService, type SpecimenCloseResult } from '../../services/api';
import { resolveQuantityStatus, resolveSpecimenStatus, type SpecimenStatusLike } from '../../utils/sampleHelpers';

type TranslatorFn = (key: string, fallback?: string) => string;

// RF026 AC7: a specimen is closed after a validated total consumption, so the
// action is offered only when quantityStatus is depleted and the specimen is
// not closed already. The backend re-checks both and answers 409
// SPECIMEN_CLOSE_REFUSED otherwise.
export function canCloseSpecimen(sample: SpecimenStatusLike | null | undefined): boolean {
  if (!sample) return false;
  return resolveQuantityStatus(sample) === 'depleted' && resolveSpecimenStatus(sample) !== 'closed';
}

interface CloseSpecimenActionProps {
  sample: SpecimenStatusLike & { _id?: string; specimenId?: string };
  canEdit: boolean;
  t: TranslatorFn;
  onClosed: (result: SpecimenCloseResult) => void;
}

export default function CloseSpecimenAction({ sample, canEdit, t, onClosed }: CloseSpecimenActionProps) {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit || !canCloseSpecimen(sample)) return null;

  const handleClose = async () => {
    const targetId = sample._id || sample.specimenId;
    if (!targetId) return;
    const confirmed = window.confirm(t(
      'samples.detail.closeConfirm',
      'Encerrar esta amostra? O consumo total será registrado como validado e a amostra não poderá mais ser movimentada. Esta ação não pode ser desfeita.',
    ));
    if (!confirmed) return;

    setClosing(true);
    setError(null);
    try {
      const response = await sampleService.close(String(targetId));
      const result = response?.data?.data;
      if (result) onClosed(result);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || t('samples.detail.closeError', 'Erro ao encerrar amostra'));
    } finally {
      setClosing(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={handleClose}
        disabled={closing}
        data-testid="sample-detail-close-button"
        style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
      >
        {closing ? t('common.loading', 'Encerrando...') : t('samples.detail.close', 'Encerrar amostra')}
      </Button>
      {error && (
        <span data-testid="sample-detail-close-error" role="alert" style={{ color: 'var(--danger)', alignSelf: 'center', fontSize: '0.9rem' }}>
          {error}
        </span>
      )}
    </>
  );
}
