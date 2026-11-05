import { useEffect, useState } from 'react';
import Modal from '../UI/Modal';
import Button from '../UI/Button';
import SignaturePad from './SignaturePad';
import { consentService } from '../../services/api';
import type { ConsentTemplate } from '../../types/models';

interface InPersonConsentModalProps {
  isOpen: boolean;
  participantId: string | null;
  title: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function readTemplate(payload: unknown): ConsentTemplate | null {
  const body = payload as { data?: ConsentTemplate | null };
  const template = body?.data && (body.data as ConsentTemplate)._id ? body.data : (payload as ConsentTemplate);
  if (!template || !template._id) return null;
  return template;
}

export default function InPersonConsentModal({ isOpen, participantId, title, onClose, onSaved }: InPersonConsentModalProps) {
  const [template, setTemplate] = useState<ConsentTemplate | null>(null);
  const [loadError, setLoadError] = useState('');
  const [place, setPlace] = useState('');
  const [responses, setResponses] = useState<Record<string, boolean>>({});
  const [signature, setSignature] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPlace('');
    setSignature('');
    setTemplate(null);
    setLoadError('');
    let cancelled = false;
    consentService.getActiveTemplate()
      .then((response) => {
        if (cancelled) return;
        const next = readTemplate(response.data);
        if (!next) {
          setLoadError('Nenhum TCLE ativo para coletar a assinatura.');
          return;
        }
        const initial: Record<string, boolean> = {};
        (next.permissions || []).forEach((permission) => {
          initial[permission.key] = false;
        });
        setResponses(initial);
        setTemplate(next);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Não foi possível carregar o TCLE ativo.');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, participantId]);

  const permissions = template?.permissions || [];
  const missingRequired = permissions.some((permission) => permission.required && responses[permission.key] !== true);

  const handleSave = async () => {
    if (!participantId || !template?._id) return;
    const collectionPlace = place.trim();
    if (!collectionPlace) {
      alert('Informe o local da coleta da assinatura.');
      return;
    }
    if (!signature) {
      alert('Confirme a assinatura no quadro antes de salvar.');
      return;
    }
    if (missingRequired) {
      alert('Aceite as permissões obrigatórias do TCLE.');
      return;
    }
    setSaving(true);
    try {
      await consentService.createPatientConsent({
        participantId,
        templateId: String(template._id),
        consentTemplateId: String(template._id),
        responses,
        signatureName: participantId,
        signatureImageBase64: signature,
        signatureMimeType: 'image/png',
        collectionPlace,
      });
      await onSaved();
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.message || err?.message || 'Não foi possível registrar a assinatura.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {loadError && <p data-testid="in-person-consent-error">{loadError}</p>}
      {template && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{template.title}</p>
          <div
            data-testid="in-person-consent-term"
            style={{ maxHeight: '10rem', overflow: 'auto', fontSize: '0.875rem' }}
            dangerouslySetInnerHTML={{ __html: template.htmlContent || template.content || '' }}
          />
          {permissions.map((permission) => (
            <label key={permission.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                data-testid={`in-person-permission-${permission.key}`}
                type="checkbox"
                checked={!!responses[permission.key]}
                onChange={() => setResponses((current) => ({ ...current, [permission.key]: !current[permission.key] }))}
              />
              <span>{permission.label}{permission.required ? ' (obrigatória)' : ''}</span>
            </label>
          ))}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.875rem' }}>
            Local da coleta
            <input
              data-testid="collection-place-input"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.4rem 0.6rem' }}
            />
          </label>
          <SignaturePad onConfirm={setSignature} onCancel={onClose} />
          <Button data-testid="confirm-in-person-consent" variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar assinatura'}
          </Button>
        </div>
      )}
    </Modal>
  );
}
