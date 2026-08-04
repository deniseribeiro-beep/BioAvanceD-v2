import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';

type ConsentState = Record<string, boolean>;
type ConsentPatient = { patientName?: string };
type TemplatePermission = { key: string; label: string; required?: boolean };
type ConsentTemplateSummary = { id: string; title?: string; permissions: TemplatePermission[] };

export default function EConsentPage() {
  const { token } = useParams();
  const [patient, setPatient] = useState<ConsentPatient | null>(null);
  const [template, setTemplate] = useState<ConsentTemplateSummary | null>(null);
  const [consents, setConsents] = useState<ConsentState>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const resp = await axios.get(`/api/e-consent/validate/${token}`);
        setPatient(resp.data.patient);
        const activeTemplate: ConsentTemplateSummary | null = resp.data.template || null;
        setTemplate(activeTemplate);
        const responses: ConsentState = resp.data.responses || {};
        setConsents(responses);
      } catch (err) {
        setError('Link inválido ou expirado. Solicite novo acesso.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [token]);

  async function handleConsentChange(key: string, value: boolean) {
    setConsents(c => ({ ...c, [key]: value }));
  }

  async function submitConsents(nextConsents: ConsentState) {
    if (!template) return;
    try {
      await axios.post('/api/e-consent/update', {
        token,
        consents: template.permissions.map(p => ({ key: p.key, status: nextConsents[p.key] ? 'ACCEPTED' : 'REVOKED' })),
      });
      setSuccess(true);
    } catch {
      setError('Erro ao atualizar consentimento.');
    }
  }

  if (loading) return <div>Carregando...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (success) return <div>Consentimento atualizado com sucesso!</div>;
  if (!template) return <div>Nenhum termo de consentimento ativo no momento.</div>;

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
      <form onSubmit={e => { e.preventDefault(); submitConsents(consents); }}>
        {template.permissions.map(permission => (
          <div key={permission.key} style={{ marginBottom: 12 }}>
            <label>
              <input
                type="checkbox"
                checked={!!consents[permission.key]}
                onChange={e => handleConsentChange(permission.key, e.target.checked)}
              />
              {permission.label}
            </label>
          </div>
        ))}
        <button type="submit">Salvar Consentimento</button>
      </form>
      <div style={{ marginTop: 24 }}>
        <button style={{ color: 'red' }} onClick={() => {
          const revoked = Object.fromEntries(template.permissions.map(p => [p.key, false]));
          setConsents(revoked);
          submitConsents(revoked);
        }}>Revogar Todos</button>
      </div>
    </div>
  );
}
