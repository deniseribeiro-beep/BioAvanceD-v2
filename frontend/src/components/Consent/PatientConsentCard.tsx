import { CSSProperties, useMemo, useState } from 'react';
import Card from '../UI/Card';
import Button from '../UI/Button';
import Modal from '../UI/Modal';
import StatusBadge, { ConsentStatus } from './StatusBadge';
import SignaturePad from './SignaturePad';

const styles: Record<string, CSSProperties> = {
  card: {
    maxWidth: '720px',
    margin: '0 auto'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  title: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: 700
  },
  subtitle: {
    margin: '0.35rem 0 0',
    color: '#6b7280'
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'flex-end'
  },
  signaturePreview: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '0.75rem',
    borderRadius: '12px',
    backgroundColor: '#f9fafb'
  },
  signatureImage: {
    maxWidth: '280px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb'
  }
};

export default function PatientConsentCard() {
  const [status, setStatus] = useState<ConsentStatus>('PENDING');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);

  const isGranted = useMemo(() => status === 'GRANTED', [status]);

  const handleOpenModal = () => setIsModalOpen(true);
  const handleCloseModal = () => setIsModalOpen(false);

  const handleConfirmSignature = (dataUrl: string) => {
    setSignatureImage(dataUrl);
    setStatus('GRANTED');
    setIsModalOpen(false);
  };

  return (
    <Card style={styles.card}>
      <div style={styles.content}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>Consentimento do Paciente</h3>
            <p style={styles.subtitle}>Status atual do TCLE</p>
          </div>
          <StatusBadge status={status} />
        </div>

        {signatureImage && isGranted && (
          <div style={styles.signaturePreview}>
            <strong>Assinatura registrada</strong>
            <img src={signatureImage} alt="Assinatura do paciente" style={styles.signatureImage} />
          </div>
        )}

        {!isGranted && (
          <div style={styles.buttonRow}>
            <Button variant="primary" onClick={handleOpenModal}>
              Coletar Assinatura
            </Button>
          </div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={handleCloseModal} title="Assinatura Digital">
        <SignaturePad onConfirm={handleConfirmSignature} onCancel={handleCloseModal} />
      </Modal>
    </Card>
  );
}
