import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const API_BASE = process.env.REACT_APP_API_BASE || '';

const ConsentPage = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(null);
  const [granular, setGranular] = useState({});
  const [tcleVisible, setTcleVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fetchConsent = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/api/patient/consent-by-token/${token}`);
        if (!res.ok) throw new Error('Token inválido ou expirado.');
        const data = await res.json();
        setConsent(data.data);
        setGranular(data.data.granularPermissions || {});
      } catch (err) {
        setError(err.message || 'Erro ao buscar consentimento.');
      } finally {
        setLoading(false);
      }
    };
    if (token) fetchConsent();
  }, [token]);

  const handleToggle = (key) => {
    setGranular((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const res = await fetch(`${API_BASE}/api/patient/consent-by-token/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ granularPermissions: granular }),
      });
      if (!res.ok) throw new Error('Erro ao salvar preferências.');
      setSuccess(true);
      // Optionally, refetch consent status
    } catch (err) {
      setError(err.message || 'Erro ao salvar preferências.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="consent-page__loading">Carregando...</div>;
  if (error) return <div className="consent-page__error">{error}</div>;
  if (!consent) return null;

  const isPending = consent.status === 'PENDING';
  const granularKeys = consent.permissions || [];

  return (
    <div className="consent-page__container">
      <div className="consent-page__header">
        <h1>Portal de Privacidade</h1>
        <p>Gerencie seu consentimento de forma segura e transparente.</p>
      </div>
      {isPending ? (
        <div className="consent-page__tcle">
          <h2>Termo de Consentimento Livre e Esclarecido</h2>
          <div className="consent-page__tcle-content">{consent.tcleText}</div>
        </div>
      ) : (
        <div className="consent-page__tcle-collapsed">
          <button className="consent-page__tcle-toggle" onClick={() => setTcleVisible((v) => !v)}>
            {tcleVisible ? 'Ocultar texto do documento' : 'Ver texto do documento'}
          </button>
          {tcleVisible && (
            <div className="consent-page__tcle-content">{consent.tcleText}</div>
          )}
        </div>
      )}
      <div className="consent-page__granular">
        <h3>Preferências de Privacidade</h3>
        <div className="consent-page__granular-list">
          {granularKeys.map((perm) => (
            <label key={perm.key} className="consent-page__granular-item">
              <input
                type="checkbox"
                checked={!!granular[perm.key]}
                disabled={!isPending && perm.locked}
                onChange={() => handleToggle(perm.key)}
              />
              {perm.label}
            </label>
          ))}
        </div>
      </div>
      <button
        className="consent-page__save-btn"
        onClick={handleSave}
        disabled={saving}
        style={{ background: '#1976d2', color: '#fff', borderRadius: 6, padding: '12px 24px', marginTop: 24 }}
      >
        {isPending ? 'Confirmar e Assinar' : 'Salvar Novas Preferências'}
      </button>
      {success && <div className="consent-page__success">Preferências salvas com sucesso!</div>}
      {saving && <div className="consent-page__saving">Salvando...</div>}
    </div>
  );
};

export default ConsentPage;
