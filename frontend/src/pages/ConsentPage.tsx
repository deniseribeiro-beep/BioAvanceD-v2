import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConsentForm from '../components/ConsentForm';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Spinner from '../components/UI/Spinner';
import { consentService, patientService } from '../services/api';
import { ConsentTemplate } from '../types/models';
import { useToast } from '../components/UI/ToastContainer';
import { useLanguage } from '../contexts/LanguageContext';
import './ConsentPage.css';

export default function ConsentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [patientName, setPatientName] = useState(t('consent.page.defaultPatientName'));
  const [template, setTemplate] = useState<ConsentTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patientId = useMemo(() => id || '', [id]);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [patientResponse, templateResponse] = await Promise.all([
          patientService.getById(patientId),
          consentService.getActiveTemplate()
        ]);

        const patientPayload = (patientResponse as any)?.data?.data ?? (patientResponse as any)?.data;
        const name = patientPayload?.patientName || patientPayload?.patientID || patientId;

        if (isMounted) {
          setPatientName(name ? String(name) : t('consent.page.defaultPatientName'));
          setTemplate(templateResponse.data?.data || null);
        }
      } catch (fetchError: any) {
        if (isMounted) {
          const message = fetchError?.message || t('consent.page.loadError');
          setError(message);
          showToast(message, 'error');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    if (patientId) {
      fetchData();
    } else {
      setLoading(false);
      setError(t('consent.page.missingPatient'));
    }

    return () => {
      isMounted = false;
    };
  }, [patientId]);

  const handleSubmit = async (payload: { responses: Record<string, boolean>; signatureName: string }) => {
    if (!template?._id) return;

    try {
      await consentService.createPatientConsent({
        patientId,
        templateId: template._id,
        responses: payload.responses,
        signatureName: payload.signatureName
      } as any);

      showToast(t('consent.page.submitSuccess'), 'success');
      navigate('/patients');
    } catch (submitError: any) {
      showToast(submitError?.message || t('consent.page.submitError'), 'error');
    }
  };

  const handleCancel = () => {
    navigate('/patients');
  };

  if (loading) {
    return (
      <div className="consent-page">
        <Card>
          <div className="consent-page-status">
            <Spinner size="sm" label={t('consent.page.loading')} />
            <span>{t('consent.page.loading')}</span>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="consent-page">
        <Card title={t('consent.page.cardTitle')}>
          <div className="consent-page-error">
            {error || t('consent.page.noActiveTemplate')}
          </div>
          <Button variant="secondary" onClick={handleCancel}>
            {t('common.back')}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="consent-page">
      <ConsentForm
        patientName={patientName}
        templateText={template.content}
        permissions={template.permissions || []}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  );
}
