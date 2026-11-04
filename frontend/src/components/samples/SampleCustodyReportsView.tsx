import React from 'react';
import { SampleCustodyRow, SampleMovementState, resolveParticipantId, resolveSampleId } from '@/hooks/samples/useSampleCustodyReports';
import Button from '../UI/Button';
import Card from '../UI/Card';
import { mapMovementTypeLabel, TranslatorFn } from './movementTypeLabel';

interface SampleCustodyReportsViewProps {
  t: TranslatorFn;
  loading: boolean;
  rows: SampleCustodyRow[];
  movementBySampleId: Record<string, SampleMovementState>;
  onToggleMovements: (sample: SampleCustodyRow) => Promise<void>;
}

export default function SampleCustodyReportsView({
  t,
  loading,
  rows,
  movementBySampleId,
  onToggleMovements,
}: SampleCustodyReportsViewProps) {
  const headers = [
    t('samples.id', 'ID'),
    t('samples.participantId', 'ID do Participante'),
    t('samples.type', 'Tipo'),
    t('samples.barcode', 'Código de Barras'),
    t('common.actions', 'Ações'),
  ];

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="page-title">{t('navigation.custodyReports', 'Relatórios de Custódia')}</h1>
        <p className="page-subtitle">
          {t('samples.custodyReportsDescription', 'Acesse as movimentações de qualquer amostra.')}
        </p>
      </div>

      <Card>
        {loading && <p>{t('common.loading', 'Carregando...')}</p>}

        {!loading && (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {rows.map((sample) => {
                  const rowId = resolveSampleId(sample);
                  const movementState = movementBySampleId[rowId];

                  return (
                    <React.Fragment key={rowId}>
                      <tr>
                        <td>{rowId}</td>
                        <td>{resolveParticipantId(sample)}</td>
                        <td>{sample.sampleType || '—'}</td>
                        <td>{sample.barcode || sample.code || '—'}</td>
                        <td>
                          <Button variant="secondary" onClick={() => onToggleMovements(sample)}>
                            {movementState?.isOpen
                              ? t('samples.hideMovements', 'Ocultar movimentos')
                              : t('samples.viewSampleMovements', 'Ver movimentos da amostra')}
                          </Button>
                        </td>
                      </tr>

                      {movementState?.isOpen && (
                        <tr>
                          <td colSpan={5}>
                            {movementState.isLoading && (
                              <p style={{ margin: '0.5rem 0' }}>{t('common.loading', 'Carregando...')}</p>
                            )}

                            {!movementState.isLoading && movementState.error && (
                              <div style={{ margin: '0.5rem 0' }}>
                                <p style={{ color: 'var(--danger)' }}>{movementState.error}</p>
                                {movementState.errorCode && (
                                  <p style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                                    Código de auditoria: {movementState.errorCode}
                                  </p>
                                )}
                              </div>
                            )}

                            {!movementState.isLoading && !movementState.error && (
                              <div style={{ overflowX: 'auto' }}>
                                <table className="table" style={{ marginTop: '0.25rem' }}>
                                  <thead>
                                    <tr>
                                      <th>{t('common.date', 'Data')}</th>
                                      <th>{t('samples.type', 'Tipo')}</th>
                                      <th>{t('samples.responsible', 'Responsável')}</th>
                                      <th>{t('common.details', 'Detalhes')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {movementState.items.length === 0 ? (
                                      <tr>
                                        <td colSpan={4}>{t('samples.noMovements', 'Nenhuma movimentação registrada')}</td>
                                      </tr>
                                    ) : (
                                      movementState.items.map((item) => (
                                        <tr key={item.id}>
                                          <td>{item.timestamp}</td>
                                          <td>{mapMovementTypeLabel(item.type, t)}</td>
                                          <td>{item.responsible}</td>
                                          <td>{item.details}</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {rows.length === 0 && (
              <p style={{ color: 'var(--text-light)', marginTop: '0.5rem' }}>
                {t('samples.noSamples', 'Nenhuma amostra encontrada')}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

