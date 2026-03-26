import { useMemo, useRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';

interface SignaturePadProps {
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}

export default function SignaturePad({ onConfirm, onCancel }: SignaturePadProps) {
  const sigRef = useRef<SignatureCanvas>(null);

  const handleClear = () => sigRef.current?.clear();
  const handleConfirm = () => {
    if (sigRef.current && !sigRef.current.isEmpty()) {
      onConfirm(sigRef.current.toDataURL('image/png'));
    }
  };

  const hasSignature = sigRef.current ? !sigRef.current.isEmpty() : false;
  const isConfirmDisabled = !hasSignature;

  return (
    <div style={{ textAlign: 'center' }}>
      <SignatureCanvas
        ref={sigRef}
        penColor="black"
        canvasProps={{
          width: 350,
          height: 120,
          style: { border: '2px solid #ccc', borderRadius: 8, background: '#fff' }
        }}
      />
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 12 }}>
        <button type="button" onClick={handleClear}>
          Limpar
        </button>
        <button type="button" onClick={handleConfirm} style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 18px' }}>
          Confirmar
        </button>
        <button type="button" onClick={onCancel} style={{ marginLeft: 8 }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
