import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';

const consentLayers = [
  { key: 'project', label: 'Aceito participar deste projeto' },
  { key: 'storage', label: 'Aceito armazenamento futuro dos meus dados/amostras' },
  { key: 'sharing', label: 'Aceito compartilhamento anonimizado dos meus dados' },
];

export default function EConsentPage() {
  const { token } = useParams();
  const [patient, setPatient] = useState(null);
  const [consents, setConsents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const resp = await axios.get(`/api/e-consent/validate/${token}`);
        setPatient(resp.data.patient);
        setConsents(resp.data.consents.reduce((acc, c) => ({ ...acc, [c.key]: c.status === 'ACCEPTED' }), {}));
      } catch (err) {
        setError('Link inválido ou expirado. Solicite novo acesso.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [token]);

  async function handleConsentChange(key, value) {
    setConsents(c => ({ ...c, [key]: value }));
  }

  async function handleSubmit() {
    try {
      await axios.post('/api/e-consent/update', { token, consents: consentLayers.map(l => ({ key: l.key, status: consents[l.key] ? 'ACCEPTED' : 'REVOKED' })) });
      setSuccess(true);
    } catch {
      setError('Erro ao atualizar consentimento.');
    }
  }

  if (loading) return <div>Carregando...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (success) return <div>Consentimento atualizado com sucesso!</div>;

  return (
    <div style={{ maxWidth: 500, margin: 'auto', padding: 24 }}>
      <h2>Consentimento Eletrônico</h2>
      <p>Bem-vindo, {patient?.patientName || 'Paciente'}!</p>
      <h4>Política de Privacidade e TCLE</h4>
      <p>Leia atentamente a política de privacidade e o Termo de Consentimento Livre e Esclarecido (TCLE) abaixo.</p>
      <div style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, marginBottom: 16 }}>
        {/* Aqui pode-se renderizar o texto do TCLE/política */}
        <p>Seus dados serão tratados conforme a LGPD. Você pode aceitar ou revogar cada camada de consentimento abaixo a qualquer momento.</p>
      </div>
      <form onSubmit={e => { e.preventDefault(); handleSubmit(); }}>
        {consentLayers.map(layer => (
          <div key={layer.key} style={{ marginBottom: 12 }}>
            <label>
              <input
                type="checkbox"
                checked={!!consents[layer.key]}
                onChange={e => handleConsentChange(layer.key, e.target.checked)}
              />
              {layer.label}
            </label>
          </div>
        ))}
        <button type="submit">Salvar Consentimento</button>
      </form>
      <div style={{ marginTop: 24 }}>
        <button style={{ color: 'red' }} onClick={() => {
          setConsents(Object.fromEntries(consentLayers.map(l => [l.key, false])));
          handleSubmit();
        }}>Revogar Todos</button>
      </div>
    </div>
  );
}
