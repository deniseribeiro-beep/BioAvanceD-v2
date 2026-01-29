import { useEffect, useMemo, useState } from 'react';
import Card from './UI/Card';
import Button from './UI/Button';
import Input from './UI/Input';
import { ConsentPermission } from '../types/models';
import './ConsentForm.css';

interface ConsentFormProps {
  patientName: string;
  templateText: string;
  permissions: ConsentPermission[];
  onSubmit: (payload: { responses: Record<string, boolean>; signatureName: string }) => void;
  onCancel: () => void;
}

export default function ConsentForm({
  patientName,
  templateText,
  permissions,
  onSubmit,
  onCancel
}: ConsentFormProps) {
  const [responses, setResponses] = useState<Record<string, boolean>>({});
  const [signatureName, setSignatureName] = useState('');

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

  const requiredPermissionKey = useMemo(() => {
    const normalized = (permissions || []).find((permission) =>
      permission.key?.toLowerCase().includes('terms') ||
      permission.key?.toLowerCase().includes('termos') ||
      permission.label?.toLowerCase().includes('termos gerais')
    );
    return normalized?.key || permissions?.[0]?.key || '';
  }, [permissions]);

  const isHtmlContent = useMemo(() => {
    if (!templateText) return false;
    return /<\/?[a-z][\s\S]*>/i.test(templateText);
  }, [templateText]);

  const hasRequiredConsent = requiredPermissionKey ? responses[requiredPermissionKey] === true : false;
  const hasSignature = signatureName.trim().length > 3;
  const canSubmit = hasRequiredConsent && hasSignature;

  return (
    <div className="consent-form">
      <div className="consent-form-header">
        <h2>Consentimento Livre e Esclarecido</h2>
        <p>Paciente: <strong>{patientName}</strong></p>
      </div>

      <div className="consent-form-grid">
        <Card className="consent-document">
          <div className="consent-content" role="region" aria-label="Texto do consentimento">
            {isHtmlContent ? (
              <div dangerouslySetInnerHTML={{ __html: templateText }} />
            ) : (
              <pre>{templateText}</pre>
            )}
          </div>
        </Card>

        <div className="consent-panel">
          <Card title="Painel de Controle">
            <div className="consent-permissions">
              {(permissions || []).map((permission) => {
                const isRequired = permission.key === requiredPermissionKey;
                return (
                  <label key={permission.key} className="consent-switch">
                    <input
                      type="checkbox"
                      checked={!!responses[permission.key]}
                      onChange={() => handleToggle(permission.key)}
                    />
                    <span>
                      {permission.label}
                      {isRequired && <strong className="consent-required"> (Obrigatório)</strong>}
                    </span>
                  </label>
                );
              })}
            </div>

            <Input
              label="Digite seu nome completo para assinar"
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
              placeholder="Nome completo"
            />

            <div className="consent-actions">
              <Button variant="secondary" onClick={onCancel}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={() => onSubmit({ responses, signatureName })} disabled={!canSubmit}>
                Confirmar
              </Button>
            </div>
            {!hasRequiredConsent && (
              <span className="consent-hint">Marque os Termos Gerais para continuar.</span>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
