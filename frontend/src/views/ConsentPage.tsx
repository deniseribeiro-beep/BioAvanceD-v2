import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ConsentForm from '../components/ConsentForm';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Spinner from '../components/UI/Spinner';
import { consentService, patientService } from '../services/api';
import { ConsentPolicy, ConsentTemplate } from '../types/models';
import { useToast } from '../components/UI/ToastContainer';
import { useLanguage } from '../contexts/LanguageContext';
import './ConsentPage.css';

export default function ConsentPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const routeState = (location.state || {}) as {
    patientName?: string;
    selectedConsentTemplateId?: string;
    linkedProject?: string;
    fromPatientCreation?: boolean;
  };

  const [patientName, setPatientName] = useState(routeState.patientName || t('consent.page.defaultPatientName'));
  const [template, setTemplate] = useState<ConsentTemplate | null>(null);
  const [resendingConsent, setResendingConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patientId = useMemo(() => id || '', [id]);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const selectedTemplateId = String(routeState.selectedConsentTemplateId || '').trim();

        const [patientResponse, templateResponse] = await Promise.all([
          patientService.getById(patientId),
          selectedTemplateId
            ? consentService.getAllPolicies()
            : consentService.getActiveTemplate()
        ]);

        const patientPayload = (patientResponse as any)?.data?.data ?? (patientResponse as any)?.data;
        const name = patientPayload?.patientName || patientPayload?.patientID || patientId;

        let resolvedTemplate: ConsentTemplate | null = null;
        if (selectedTemplateId) {
          const policies = (templateResponse as any)?.data?.data;
          const selectedPolicy = (Array.isArray(policies) ? policies : []).find(
            (policy: ConsentPolicy) => String(policy?._id || '') === selectedTemplateId
          );

          if (selectedPolicy) {
            resolvedTemplate = {
              _id: selectedPolicy._id,
              title: selectedPolicy.title,
              content: selectedPolicy.htmlContent,
              htmlContent: selectedPolicy.htmlContent,
              version: selectedPolicy.version,
              caae: selectedPolicy.caae,
              active: selectedPolicy.active,
              permissions: Array.isArray(selectedPolicy.granularPermissions) && selectedPolicy.granularPermissions.length > 0
                ? selectedPolicy.granularPermissions.map((permission: any) => ({
                    key: permission.key,
                    label: permission.label,
                    required: Boolean(permission.required)
                  }))
                : []
            } as ConsentTemplate;
          }
        } else {
          resolvedTemplate = (templateResponse as any)?.data?.data || null;
        }

        if (resolvedTemplate && (!Array.isArray(resolvedTemplate.permissions) || resolvedTemplate.permissions.length === 0)) {
          const granularPermissions = Array.isArray((resolvedTemplate as ConsentPolicy).granularPermissions)
            ? (resolvedTemplate as ConsentPolicy).granularPermissions
            : [];

          resolvedTemplate = {
            ...resolvedTemplate,
            permissions: granularPermissions.map((permission: any) => ({
              key: permission.key,
              label: permission.label,
              required: Boolean(permission.required)
            }))
          };
        }

        if (isMounted) {
          setPatientName(routeState.patientName || (name ? String(name) : t('consent.page.defaultPatientName')));
          setTemplate(resolvedTemplate);
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
  }, [patientId, routeState.patientName, routeState.selectedConsentTemplateId]);

  const handleResendByEmail = async () => {
    if (!patientId || resendingConsent) return;
    setResendingConsent(true);
    try {
      await patientService.resendConsentNotification(patientId);
      showToast(t('patients.consentSentSuccess'), 'success');
    } catch (resendError: any) {
      showToast(resendError?.message || t('patients.consentSendError'), 'error');
    } finally {
      setResendingConsent(false);
    }
  };

  const handleSubmit = async (payload: {
    responses: Record<string, boolean>;
    signatureName: string;
    signatureImageBase64?: string;
    signatureMimeType?: string;
  }) => {
    if (!template?._id) return;

    try {
      await consentService.createPatientConsent({
        patientId,
        templateId: template._id,
        responses: payload.responses,
        signatureName: payload.signatureName,
        signatureImageBase64: payload.signatureImageBase64,
        signatureMimeType: payload.signatureMimeType
      });

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
      <div className="page consent-page" data-testid="consent-page-loading">
        <Card>
          <div className="consent-page-status" data-testid="consent-page-status">
            <Spinner size="sm" label={t('consent.page.loading')} />
            <span>{t('consent.page.loading')}</span>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="page consent-page" data-testid="consent-page-error-state">
        <Card title={t('consent.page.cardTitle')}>
          <div className="consent-page-error" data-testid="consent-page-error-message">
            {error || t('consent.page.noActiveTemplate')}
          </div>
          <Button variant="secondary" onClick={handleCancel} data-testid="consent-page-back-button">
            {t('common.back')}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="page consent-page" data-testid="consent-page">
      <Card>
        <div data-testid="consent-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div data-testid="consent-page-patient-summary">
            <strong>{t('patients.consentReadyTitle')}</strong>
            <p data-testid="consent-page-patient-id" style={{ margin: '0.35rem 0 0 0', color: 'var(--text-light)' }}>
              {t('patients.tableId')}: {patientId}
            </p>
            {routeState.linkedProject && (
              <p data-testid="consent-page-linked-project" style={{ margin: '0.35rem 0 0 0', color: 'var(--text-light)' }}>
                {t('patients.selectedProjectLabel')}: {routeState.linkedProject}
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={handleResendByEmail} disabled={resendingConsent} data-testid="consent-page-resend-button">
            {resendingConsent ? t('patients.sendingConsent') : t('patients.resendConsent')}
          </Button>
        </div>
      </Card>
      <ConsentForm
        patientName={patientName}
        patientId={patientId}
        templateText={template.htmlContent || template.content}
        permissions={template.permissions || []}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  );
}
