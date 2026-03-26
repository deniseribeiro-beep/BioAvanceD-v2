import React, { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';

interface ConsentKey {
  key: string;
  label: string;
  checked: boolean;
}

interface InPersonSignaturePadProps {
  consentKeys: { key: string; label: string }[];
  onSignComplete: (base64Image: string, consentStates: Record<string, boolean>) => void;
}

const InPersonSignaturePad: React.FC<InPersonSignaturePadProps> = ({ consentKeys, onSignComplete }) => {
  const sigPadRef = useRef<SignatureCanvas>(null);
  const [consents, setConsents] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(consentKeys.map(({ key }) => [key, false]))
  );
  const [error, setError] = useState<string | null>(null);

  const handleConsentChange = (key: string) => {
    setConsents((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleClear = () => {
    sigPadRef.current?.clear();
    setError(null);
  };

  const handleSign = () => {
    if (sigPadRef.current?.isEmpty()) {
      setError('Por favor, faça sua assinatura.');
      return;
    }
    setError(null);
    const base64 = sigPadRef.current?.toDataURL('image/png') || '';
    onSignComplete(base64, consents);
  };

  return (
    <div style={{ maxWidth: 400, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        {consentKeys.map(({ key, label }) => (
          <label key={key} style={{ display: 'block', marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={consents[key]}
              onChange={() => handleConsentChange(key)}
              style={{ marginRight: 8 }}
            />
            {label}
          </label>
        ))}
      </div>
      <div
        style={{
          background: '#f5f5f5',
          border: '2px solid #ccc',
          borderRadius: 8,
          width: 350,
          height: 180,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SignatureCanvas
          ref={sigPadRef}
          penColor="black"
          canvasProps={{
            width: 340,
            height: 170,
            style: { background: 'transparent', borderRadius: 6 },
          }}
        />
      </div>
      {error && <div style={{ color: 'red', marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button type="button" onClick={handleClear} style={{ padding: '8px 16px' }}>
          Limpar Assinatura
        </button>
        <button type="button" onClick={handleSign} style={{ padding: '8px 16px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4 }}>
          Confirmar e Assinar
        </button>
      </div>
    </div>
  );
};

export default InPersonSignaturePad;
