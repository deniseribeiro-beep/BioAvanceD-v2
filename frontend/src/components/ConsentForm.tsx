import { useEffect, useMemo, useState } from 'react';
import Card from './UI/Card';
import Button from './UI/Button';
import Input from './UI/Input';
import AssinaturaDigitalTCLE from './AssinaturaDigitalTCLE';
import { ConsentPermission } from '../types/models';
import { useLanguage } from '../contexts/LanguageContext';
import './ConsentForm.css';

interface ConsentFormProps {
  patientName: string;
  patientId: string;
  templateText: string;
  permissions: ConsentPermission[];
  onSubmit: (payload: {
    responses: Record<string, boolean>;
    signatureName: string;
    signatureImageBase64?: string;
    signatureMimeType?: string;
  }) => void;
  onCancel: () => void;
}

export default function ConsentForm({
  patientName,
  patientId,
  templateText,
  permissions,
  onSubmit,
  onCancel
}: ConsentFormProps) {
  const { t } = useLanguage();
  const [responses, setResponses] = useState<Record<string, boolean>>({});
  const [signatureName, setSignatureName] = useState('');
  const [signatureImageBase64, setSignatureImageBase64] = useState('');

  useEffect(() => {
    const initialResponses: Record<string, boolean> = {};
    (permissions || []).forEach((permission) => {
      initialResponses[permission.key] = false;
    });
    setResponses(initialResponses);
  }, [permissions]);

  const handleToggle = (key: string) => {
    setResponses((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const requiredPermissionKeys = useMemo(() => {
    const explicitRequired = (permissions || [])
      .filter((permission) => permission.required)
      .map((permission) => permission.key);

    if (explicitRequired.length > 0) {
      return explicitRequired;
    }

    const normalized = (permissions || []).find((permission) =>
      permission.key?.toLowerCase().includes('terms') ||
      permission.key?.toLowerCase().includes('termos') ||
      permission.label?.toLowerCase().includes('termos gerais')
    );
    return normalized?.key ? [normalized.key] : permissions?.[0]?.key ? [permissions[0].key] : [];
  }, [permissions]);

  const isHtmlContent = useMemo(() => {
    if (!templateText) return false;
    return /<\/?[a-z][\s\S]*>/i.test(templateText);
  }, [templateText]);

  const hasRequiredConsent = requiredPermissionKeys.length === 0
    ? false
    : requiredPermissionKeys.every((key) => responses[key] === true);
  const hasSignature = signatureName.trim().length > 3;
  const hasDigitalSignature = signatureImageBase64.trim().length > 0;
  const canSubmit = hasRequiredConsent && hasSignature && hasDigitalSignature;

  return (
    <div className="consent-form">
      <div className="consent-form-header">
        <h2>{t('consent.form.header')}</h2>
        <p>{t('consent.form.patientLabel')} <strong>{patientName}</strong></p>
      </div>

      <div className="consent-form-grid">
        <Card className="consent-document">
          <div className="consent-content" role="region" aria-label={t('consent.form.contentLabel')}>
            {isHtmlContent ? (
              <div dangerouslySetInnerHTML={{ __html: templateText }} />
            ) : (
              <pre>{templateText}</pre>
            )}
          </div>
        </Card>

        <div className="consent-panel">
          <Card title={t('consent.form.panelTitle')}>
            <div className="consent-permissions">
              {(permissions || []).map((permission) => {
                const isRequired = requiredPermissionKeys.includes(permission.key);
                return (
                  <label key={permission.key} className="consent-switch">
                    <input
                      type="checkbox"
                      checked={!!responses[permission.key]}
                      onChange={() => handleToggle(permission.key)}
                    />
                    <span>
                      {permission.label}
                      {isRequired && <strong className="consent-required"> ({t('consent.form.required')})</strong>}
                    </span>
                  </label>
                );
              })}
            </div>

            <Input
              label={t('consent.form.signatureLabel')}
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
              placeholder={t('consent.form.signaturePlaceholder')}
            />

            <div className="consent-signature-canvas">
              <AssinaturaDigitalTCLE
                doadorId={patientId}
                persistirNoBackend={false}
                onAssinaturaConfirmada={({ assinaturaBase64 }) => {
                  setSignatureImageBase64(assinaturaBase64);
                  if (signatureName.trim().length === 0) {
                    setSignatureName(patientName);
                  }
                }}
              />
            </div>

            <div className="consent-actions">
              <Button variant="secondary" onClick={onCancel}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  onSubmit({
                    responses,
                    signatureName,
                    signatureImageBase64,
                    signatureMimeType: 'image/png'
                  })
                }
                disabled={!canSubmit}
              >
                {t('common.confirm')}
              </Button>
            </div>
            {!hasRequiredConsent && (
              <span className="consent-hint">{t('consent.form.hint')}</span>
            )}
            {!hasDigitalSignature && (
              <span className="consent-hint">Confirme a assinatura digital antes de finalizar.</span>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
