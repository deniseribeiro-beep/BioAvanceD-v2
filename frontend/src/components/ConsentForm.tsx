import { useEffect, useMemo, useState } from 'react';
import Card from './UI/Card';
import Button from './UI/Button';
import Input from './UI/Input';
import AssinaturaDigitalTCLE from './AssinaturaDigitalTCLE';
import { ConsentPermission } from '../types/models';
import { useLanguage } from '../contexts/LanguageContext';

function sanitizeTemplateHtml(rawHtml: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(rawHtml || ''), 'text/html');

  doc.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());

  doc.querySelectorAll('*').forEach((element) => {
    const attrs = Array.from(element.attributes);
    attrs.forEach((attr) => {
      const attrName = String(attr.name || '').toLowerCase();
      const attrValue = String(attr.value || '');

      if (attrName.startsWith('on')) {
        element.removeAttribute(attr.name);
        return;
      }

      if ((attrName === 'href' || attrName === 'src') && /^\s*javascript:/i.test(attrValue)) {
        element.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
}

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
  // CAAE state
  const [caae, setCaae] = useState('');
  const [caaeError, setCaaeError] = useState('');
  // Regex para CAAE: 8 algarismos . 1 algarismo . 4 algarismos . 4 algarismos
  const caaeRegex = /^\d{8}\.\d\.\d{4}\.\d{4}$/;

  // Máscara visual simples (opcional, só formata se possível)
  function maskCaae(value: string) {
    // Remove tudo que não for dígito
    const digits = value.replace(/\D/g, '');
    let masked = '';
    if (digits.length > 0) masked += digits.slice(0, 8);
    if (digits.length > 8) masked += '.' + digits.slice(8, 9);
    if (digits.length > 9) masked += '.' + digits.slice(9, 13);
    if (digits.length > 13) masked += '.' + digits.slice(13, 17);
    return masked;
  }

  function handleCaaeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const masked = maskCaae(raw);
    setCaae(masked);
    if (masked.length === 0) {
      setCaaeError('');
    } else if (!caaeRegex.test(masked)) {
      setCaaeError('Formato de CAAE inválido. Use XXXXXXXX.X.XXXX.XXXX');
    } else {
      setCaaeError('');
    }
  }

  function handleCaaeBlur() {
    if (caae.length > 0 && !caaeRegex.test(caae)) {
      setCaaeError('Formato de CAAE inválido. Use XXXXXXXX.X.XXXX.XXXX');
    }
  }

  useEffect(() => {
    const initialResponses: Record<string, boolean> = {};
    (permissions || []).forEach((permission) => {
      initialResponses[permission.key] = false;
    });
    setResponses(initialResponses);
  }, [permissions]);

  useEffect(() => {
    const normalizedPatientId = String(patientId || '').trim();
    if (!normalizedPatientId) return;
    setSignatureName((prev) => (prev.trim().length > 0 ? prev : normalizedPatientId));
  }, [patientId]);

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

  const safeTemplateHtml = useMemo(() => {
    if (!isHtmlContent) return '';
    return sanitizeTemplateHtml(templateText);
  }, [isHtmlContent, templateText]);

  const hasRequiredConsent = requiredPermissionKeys.length === 0
    ? false
    : requiredPermissionKeys.every((key) => responses[key] === true);
  const hasSignature = signatureName.trim().length > 3;
  const hasDigitalSignature = signatureImageBase64.trim().length > 0;
  const canSubmit = hasRequiredConsent && hasSignature && hasDigitalSignature && !caaeError && caae.length > 0;

  const getPermissionTestId = (permissionKey: string) =>
    `consent-permission-${String(permissionKey || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  return (
    <div className="consent-form" data-testid="consent-form">
      <div className="consent-form-header" data-testid="consent-form-header">
        <h2>{t('consent.form.header')}</h2>
        <p data-testid="consent-form-patient-name">{t('consent.form.patientLabel')} <strong>{patientName}</strong></p>
        <p data-testid="consent-form-patient-id">{t('patients.tableId')} <strong>{patientId}</strong></p>
      </div>

      <div className="consent-form-grid" data-testid="consent-form-grid">
        <Card className="consent-document">
          <div className="consent-content" role="region" aria-label={t('consent.form.contentLabel')} data-testid="consent-form-content">
            {isHtmlContent ? (
              <div dangerouslySetInnerHTML={{ __html: safeTemplateHtml }} />
            ) : (
              <pre>{templateText}</pre>
            )}
          </div>
        </Card>

        <div className="consent-panel">
          <Card title={t('consent.form.panelTitle')}>
            {/* Campo CAAE */}
            <Input
              label="Número do CAAE"
              data-testid="consent-caae-input"
              value={caae}
              onChange={handleCaaeChange}
              onBlur={handleCaaeBlur}
              placeholder="83746219.8.0000.5432"
              error={caaeError}
              maxLength={21}
              required
            />
            {/* Fim campo CAAE */}

            <div className="consent-permissions">
              {(permissions || []).map((permission) => {
                const isRequired = requiredPermissionKeys.includes(permission.key);
                return (
                  <label key={permission.key} className="consent-switch">
                    <input
                      data-testid={getPermissionTestId(permission.key)}
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
              data-testid="consent-signature-name-input"
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
              placeholder={t('consent.form.signaturePlaceholder')}
            />

            <div className="consent-signature-canvas" data-testid="consent-signature-wrapper">
              <AssinaturaDigitalTCLE
                doadorId={patientId}
                persistirNoBackend={false}
                testIdPrefix="consent-signature"
                onAssinaturaConfirmada={({ assinaturaBase64 }: { assinaturaBase64: string }) => {
                  setSignatureImageBase64(assinaturaBase64);
                  if (signatureName.trim().length === 0) {
                    setSignatureName(patientId);
                  }
                }}
              />
            </div>

            <div className="consent-actions">
              <Button variant="secondary" onClick={onCancel} data-testid="consent-cancel-button">
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                data-testid="consent-submit-button"
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
              <span className="consent-hint" data-testid="consent-required-hint">{t('consent.form.hint')}</span>
            )}
            {!hasDigitalSignature && (
              <span className="consent-hint" data-testid="consent-signature-hint">Confirme a assinatura digital antes de finalizar.</span>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
