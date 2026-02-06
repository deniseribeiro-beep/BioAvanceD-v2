import { CSSProperties, useMemo, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import Button from '../UI/Button';

type SignaturePadProps = {
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  confirmLabel?: string;
};

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  canvasWrapper: {
    border: '2px dashed #c7d2fe',
    borderRadius: '12px',
    backgroundColor: '#ffffff',
    padding: '0.5rem',
    minHeight: '220px'
  },
  canvas: {
    width: '100%',
    height: '220px'
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'flex-end',
    flexWrap: 'wrap'
  },
  helperText: {
    fontSize: '0.85rem',
    color: '#b00020'
  },
  hint: {
    fontSize: '0.85rem',
    color: '#6b7280'
  }
};

export default function SignaturePad({
  onConfirm,
  onCancel,
  confirmDisabled,
  confirmLabel
}: SignaturePadProps) {
  const signatureRef = useRef<SignatureCanvas | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleEnd = () => {
    const isEmpty = signatureRef.current?.isEmpty() ?? true;
    setHasSignature(!isEmpty);
    if (!isEmpty) {
      setErrorMessage('');
    }
  };

  const handleClear = () => {
    signatureRef.current?.clear();
    setHasSignature(false);
    setErrorMessage('');
  };

  const handleConfirm = () => {
    const isEmpty = signatureRef.current?.isEmpty() ?? true;
    if (isEmpty) {
      setErrorMessage('Por favor, assine antes de confirmar.');
      return;
    }
    const dataUrl = signatureRef.current?.toDataURL('image/png');
    if (dataUrl) {
      onConfirm(dataUrl);
      handleClear();
    }
  };

  const isConfirmDisabled = useMemo(() => (confirmDisabled ?? false) || !hasSignature, [confirmDisabled, hasSignature]);

  return (
    <div style={styles.container}>
      <div style={styles.canvasWrapper} aria-label="Area de assinatura">
        <SignatureCanvas
          ref={signatureRef}
          penColor="#1f2937"
          onEnd={handleEnd}
          canvasProps={{ style: styles.canvas }}
        />
      </div>

      <span style={styles.hint}>Use o dedo ou caneta para assinar.</span>
      {errorMessage && <span style={styles.helperText}>{errorMessage}</span>}

      <div style={styles.actions}>
        <Button variant="danger" onClick={handleClear} type="button">
          Limpar
        </Button>
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleConfirm} disabled={isConfirmDisabled} type="button">
          {confirmLabel || 'Confirmar Assinatura'}
        </Button>
      </div>
    </div>
  );
}
