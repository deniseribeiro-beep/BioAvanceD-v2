
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ConsentForm from '../components/ConsentForm';
import { ConsentTemplate, ConsentPermission } from '../types/models';
import { useLanguage } from '../contexts/LanguageContext';

const API_BASE = process.env.REACT_APP_API_BASE || '';

const ConsentPage = () => {
  const { t } = useLanguage();
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [template, setTemplate] = useState<ConsentTemplate | null>(null);
  const [patientName, setPatientName] = useState('');
  const [patientId, setPatientId] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fetchConsent = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/api/patient/consent-by-token/${token}`);
        if (!res.ok) throw new Error(t('consent.page.loadError'));
        const data = await res.json();
        setTemplate(data.data.template || null);
        setPatientName(data.data.patientName || t('consent.page.defaultPatientName'));
        setPatientId(data.data.patientId || '');
      } catch (err: any) {
        setError(err.message || t('consent.page.loadError'));
      } finally {
        setLoading(false);
      }
    };
    if (token) fetchConsent();
  }, [token, t]);

  const handleSubmit = async (payload: {
    responses: Record<string, boolean>;
    signatureName: string;
    signatureImageBase64?: string;
    signatureMimeType?: string;
  }) => {
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      const res = await fetch(`${API_BASE}/api/patient/consent-by-token/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(t('consent.page.submitError'));
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || t('consent.page.submitError'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="consent-page__loading">{t('common.loading')}</div>;
  if (error) return <div className="consent-page__error">{error}</div>;
  if (!template) return <div className="consent-page__error">{t('consent.page.noActiveTemplate')}</div>;

  return (
    <div className="consent-page__container">
      <div className="consent-page__header">
        <h1>Portal de Privacidade</h1>
        <p>{t('consent.form.header')}</p>
      </div>
      <ConsentForm
        patientName={patientName}
        patientId={patientId}
        templateText={template.htmlContent || template.content}
        permissions={template.permissions as ConsentPermission[]}
        onSubmit={handleSubmit}
        onCancel={() => window.history.back()}
      />
      {success && <div className="consent-page__success">{t('consent.page.submitSuccess')}</div>}
    </div>
  );
};

export default ConsentPage;
