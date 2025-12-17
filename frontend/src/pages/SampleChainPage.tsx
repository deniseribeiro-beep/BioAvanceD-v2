import { useState } from 'react';
import { useParams } from 'react-router-dom';
import Button from '../components/UI/Button';
import { useLanguage } from '../contexts/LanguageContext';
import { sampleService } from '../services/api';

export default function SampleChainPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const [form, setForm] = useState({
    withdrawalType: '',
    withdrawalResponsible: '',
    linkedProject: '',
    sampleDestination: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await sampleService.withdraw(id as any, form);
      setMessage(t('samples.withdrawSuccess') || 'Retirada registrada com sucesso');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Erro ao registrar retirada');
    } finally {
      setLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!id) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      await sampleService.return(id as any, form);
      setMessage(t('samples.returnSuccess') || 'Devolução registrada com sucesso');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Erro ao registrar devolução');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <h1>{t('samples.chain') || 'Fluxo da Amostra'}</h1>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem', maxWidth: 600 }}>
        <input name="withdrawalType" placeholder={t('samples.withdrawalType') || 'Tipo de retirada'} value={form.withdrawalType} onChange={handleChange} />
        <input name="withdrawalResponsible" placeholder={t('samples.withdrawalResponsible') || 'Responsável'} value={form.withdrawalResponsible} onChange={handleChange} />
        <input name="linkedProject" placeholder={t('samples.linkedProject') || 'Projeto vinculado'} value={form.linkedProject} onChange={handleChange} />
        <input name="sampleDestination" placeholder={t('samples.sampleDestination') || 'Destino da amostra'} value={form.sampleDestination} onChange={handleChange} />

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button type="submit" variant="primary" disabled={loading}>{t('samples.withdraw') || 'Registrar Retirada'}</Button>
          <Button type="button" variant="secondary" onClick={handleReturn} disabled={loading}>{t('samples.return') || 'Registrar Devolução'}</Button>
        </div>

        {message && <p style={{ color: 'var(--success)' }}>{message}</p>}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </form>
    </div>
  );
}
