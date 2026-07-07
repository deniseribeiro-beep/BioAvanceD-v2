import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';

type ImportConsentInfo = {
  batchId?: string;
  recordId?: string;
  patientId?: string;
  patientName?: string;
  patientEmail?: string;
  status?: string;
  consentSigned?: boolean;
};

export default function EConsentImportPage() {
  const { token } = useParams();
  const [data, setData] = useState<ImportConsentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const resp = await axios.get(`/api/e-consent/import/fhir/consent/${token}`);
        setData(resp.data);
      } catch {
        setError('Link inválido ou expirado. Solicite novo acesso.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function acceptConsent() {
    try {
      await axios.post(`/api/e-consent/import/fhir/consent/${token}/accept`);
      setSuccess(true);
    } catch {
      setError('Erro ao aceitar consentimento de importação.');
    }
  }

  if (loading) return <div>Carregando...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (success) return <div>Consentimento de importação assinado com sucesso!</div>;

  return (
    <div style={{ maxWidth: 560, margin: 'auto', padding: 24 }}>
      <h2>Consentimento de importação FHIR</h2>
      <p>Paciente: {data?.patientName || 'Paciente'}</p>
      <p>E-mail: {data?.patientEmail || 'Não informado'}</p>
      <p>Status atual: {data?.status || 'DESCONHECIDO'}</p>
      <button type="button" onClick={acceptConsent}>Aceitar consentimento</button>
    </div>
  );
}
