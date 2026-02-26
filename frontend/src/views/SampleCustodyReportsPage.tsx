import React, { useMemo, useState } from 'react';
import Button from '../components/UI/Button';
import Card from '../components/UI/Card';
import { useLanguage } from '../contexts/LanguageContext';
import { useSamples } from '../hooks/useSamples';
import { sampleChainApi } from '../services/sampleChainApi';

export default function SampleCustodyReportsPage() {
  const { samples, loading } = useSamples();
  const { t } = useLanguage();
  const [movements, setMovements] = useState<Record<string, { loading: boolean; error?: string | null; items: any[]; open: boolean }>>({});

  const headers = [
    t('samples.id', 'ID'),
    t('samples.patientId', 'ID do Paciente'),
    t('samples.type', 'Tipo'),
    t('samples.barcode', 'Código de Barras'),
    t('common.actions', 'Ações'),
  ];

  const resolveSampleId = (sample: any) => sample?.sampleID || sample?.id || sample?._id || '—';
  const resolvePatientId = (sample: any) => sample?.patientId || sample?.patientID || sample?.patient?.id || '—';

  const handleToggleMovements = async (sample: any) => {
    const id = String(resolveSampleId(sample));
    const current = movements[id];

    // Toggle off if already open and not loading
    if (current?.open && !current.loading) {
      setMovements(prev => ({ ...prev, [id]: { ...current, open: false } }));
      return;
    }

    setMovements(prev => ({
      ...prev,
      [id]: { loading: true, error: null, items: prev[id]?.items || [], open: true },
    }));

    try {
      const res = await sampleChainApi.getMovements(id);
      const data = Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data) ? res.data : []);
      setMovements(prev => ({
        ...prev,
        [id]: { loading: false, error: null, items: data, open: true },
      }));
    } catch (err: any) {
      setMovements(prev => ({
        ...prev,
        [id]: { loading: false, error: err?.message || 'Erro ao carregar movimentos', items: [], open: true },
      }));
    }
  };

  const renderMovements = (sampleId: string | number) => {
    const entry = movements[sampleId];
    if (!entry || entry.loading) {
      return (
        <tr>
          <td colSpan={5}>{t('common.loading')}</td>
        </tr>
      );
    }
    if (entry.error) {
      return (
        <tr>
          <td colSpan={5} style={{ color: 'var(--danger)' }}>
            {entry.error}
          </td>
        </tr>
      );
    }
    if (!entry.data?.length) {
      return (
        <tr>
          <td colSpan={5}>{t('messages.noData', 'Nenhum dado disponível')}</td>
        </tr>
      );
    }

    const typeLabel = (type?: string) => {
      if (!type) return '—';
      const map: Record<string, string> = {
        withdraw: t('samples.withdraw', 'Retirada'),
        return: t('samples.return', 'Devolução'),
        transfer: t('samples.transfer', 'Transferência'),
      };
      return map[type] || type;
    };

    const formatResp = (m: any) =>
      m?.responsibleName ||
      m?.responsible ||
      m?.operatorName ||
      m?.user ||
      '—';

    const formatDetails = (m: any) =>
      m?.details ||
      m?.description ||
      m?.observations ||
      m?.note ||
      '—';

    return entry.data.map((m: any, idx: number) => (
      <tr key={m.id || idx}>
        <td>{m.date || m.createdAt || '—'}</td>
        <td>{typeLabel(m.type)}</td>
        <td>{formatResp(m)}</td>
        <td>{formatDetails(m)}</td>
      </tr>
    ));
  };

  const rows = useMemo(() => samples || [], [samples]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">
          {t('navigation.custodyReports', 'Relatórios de Custódia')}
        </h1>
        <p className="page-subtitle">
          {t('samples.custodyReportsDescription', 'Acesse as movimentações de qualquer amostra.')}
        </p>
      </div>

      <Card>
        {loading && <p>{t('common.loading') || 'Carregando...'}</p>}
        {!loading && (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((sample) => {
                  const rowId = resolveSampleId(sample);
                  const movementState = movements[rowId];
                  return (
                    <React.Fragment key={rowId}>
                      <tr>
                        <td>{rowId}</td>
                        <td>{resolvePatientId(sample)}</td>
                        <td>{sample.sampleType || '—'}</td>
                        <td>{sample.barcode || sample.code || '—'}</td>
                        <td>
                          <Button
                            variant="secondary"
                            onClick={() => handleToggleMovements(sample)}
                          >
                            {movementState?.open ? (t('samples.hideMovements') || 'Ocultar movimentos') : (t('samples.viewSampleMovements', 'Ver movimentos da amostra'))}
                          </Button>
                        </td>
                      </tr>
                      {movementState?.open && (
                        <tr>
                          <td colSpan={5}>
                            {movementState.loading && (
                              <p style={{ margin: '0.5rem 0' }}>{t('common.loading') || 'Carregando...'}</p>
                            )}
                            {movementState.error && (
                              <p style={{ margin: '0.5rem 0', color: 'var(--danger)' }}>{movementState.error}</p>
                            )}
                            {!movementState.loading && !movementState.error && (
                              <div style={{ overflowX: 'auto' }}>
                                <table className="table" style={{ marginTop: '0.25rem' }}>
                                  <thead>
                                    <tr>
                                      <th>{t('common.date') || 'Data'}</th>
                                      <th>{t('samples.type') || 'Tipo'}</th>
                                      <th>{t('samples.responsible') || 'Responsável'}</th>
                                      <th>{t('common.details') || 'Detalhes'}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {renderMovements(rowId)}
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
            {rows.length === 0 && <p style={{ color: 'var(--text-light)', marginTop: '0.5rem' }}>{t('samples.noSamples') || 'Nenhuma amostra encontrada'}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
