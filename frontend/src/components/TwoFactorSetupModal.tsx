import { useState, useEffect } from 'react';
import Modal from './UI/Modal';
import Button from './UI/Button';
import Input from './UI/Input';
import { QrCode, AlertCircle, CheckCircle } from 'lucide-react';
import { authService } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';

interface TwoFactorSetupModalProps {
  isOpen: boolean;
  onComplete: () => void;
  onClose?: () => void;
}

export default function TwoFactorSetupModal({ isOpen, onComplete, onClose }: TwoFactorSetupModalProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'qr' | 'verify' | 'complete'>('qr');

  useEffect(() => {
    if (isOpen && step === 'qr') {
      generateQRCode();
    }
  }, [isOpen, step]);

  const generateQRCode = async () => {
    setLoading(true);
    setError('');
    try {
      const username = localStorage.getItem('tempUsername') || '';
      const password = localStorage.getItem('tempPassword') || '';
      
      if (!username || !password) {
        setError('Credenciais não encontradas. Por favor, faça login novamente.');
        setLoading(false);
        return;
      }

      const response = await authService.generateTwoFactorQRFirstLogin(username, password);
      
      // Debug: verifica estrutura da resposta
      console.log('Response completa:', response);
      console.log('Response.data:', response.data);
      
      // Verifica diferentes estruturas possíveis de resposta
      const qrCode = response.data?.qrCode || response.data?.data?.qrCode;
      const secret = response.data?.secret || response.data?.data?.secret || response.data?.manualEntryKey || response.data?.data?.manualEntryKey;
      
      if (qrCode) {
        setQrCode(qrCode);
        if (secret) {
          setSecret(secret);
        }
        setStep('verify');
      } else {
        console.error('Estrutura de resposta inesperada:', response);
        // Tenta extrair mensagem de erro mais específica
        const errorMsg = response.data?.error || 
                        response.data?.message || 
                        'Não foi possível gerar o QR code. Verifique suas credenciais e tente novamente.';
        setError(errorMsg);
      }
    } catch (error: any) {
      console.error('Erro ao gerar QR code:', error);
      console.error('Erro completo:', {
        message: error.message,
        response: error.response,
        data: error.response?.data
      });
      
      // Extrai mensagem de erro mais específica
      let errorMessage = 'Erro ao gerar QR code';
      
      if (error.response) {
        // Erro do servidor
        errorMessage = error.response.data?.error || 
                     error.response.data?.message || 
                     `Erro do servidor: ${error.response.status} ${error.response.statusText}`;
      } else if (error.request) {
        // Requisição foi feita mas não houve resposta
        errorMessage = 'Não foi possível conectar ao servidor. Verifique sua conexão.';
      } else {
        // Erro ao configurar a requisição
        errorMessage = error.message || 'Erro ao configurar requisição';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndEnable = async () => {
    console.log('handleVerifyAndEnable chamado', { verificationCode: verificationCode?.length });
    
    if (!verificationCode || verificationCode.length !== 6) {
      setError('Digite um código de 6 dígitos');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const username = localStorage.getItem('tempUsername') || '';
      const password = localStorage.getItem('tempPassword') || '';
      
      console.log('Credenciais recuperadas:', { username: username ? 'existe' : 'não existe', password: password ? 'existe' : 'não existe' });
      
      if (!username || !password) {
        setError('Credenciais não encontradas. Por favor, faça login novamente.');
        setLoading(false);
        return;
      }

      console.log('Chamando enableTwoFactorFirstLogin...');
      const response = await authService.enableTwoFactorFirstLogin(verificationCode, username, password);
      
      console.log('Resposta recebida:', response);
      console.log('Response.data:', response.data);
      
      // Backend retorna: { success: true, data: { token, user } }
      // Então precisamos acessar response.data.data.token
      const token = response.data?.data?.token || response.data?.token;
      const user = response.data?.data?.user || response.data?.user;
      
      console.log('Token extraído:', token ? 'existe' : 'não existe');
      console.log('User extraído:', user ? 'existe' : 'não existe');
      
      // Se retornou token, salva automaticamente
      if (token && user) {
        console.log('Token recebido, salvando...');
        localStorage.setItem('token', token);
        // Remove credenciais temporárias
        localStorage.removeItem('tempUsername');
        localStorage.removeItem('tempPassword');
        
        // Não há backupCodes no backend, então apenas marca como completo
        setStep('complete');
      } else {
        // Se não retornou token, mostra erro
        console.error('Token não encontrado na resposta:', response);
        setError('Token não foi retornado. Tente novamente.');
      }
    } catch (error: any) {
      console.error('Erro ao habilitar 2FA:', error);
      console.error('Erro completo:', {
        message: error.message,
        response: error.response,
        data: error.response?.data
      });
      
      const errorMessage = error.response?.data?.error || 
                          error.response?.data?.message || 
                          error.message || 
                          'Erro ao habilitar 2FA. Verifique o código.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = () => {
    // Verifica se tem token salvo
    const token = localStorage.getItem('token');
    if (token) {
      // Token está salvo, chama callback para redirecionar
      onComplete();
    } else {
      // Se não tem token, mostra erro
      setError('Token não foi salvo. Por favor, faça login novamente.');
      setStep('qr');
    }
  };

  const handleClose = () => {
    // Se tiver onClose customizado, usa ele
    if (onClose) {
      onClose();
    } else {
      // Limpa credenciais temporárias e permite fechar
      localStorage.removeItem('tempUsername');
      localStorage.removeItem('tempPassword');
      // Reseta estado
      setQrCode(null);
      setSecret(null);
      setVerificationCode('');
      setError('');
      setStep('qr');
      // Chama onComplete para fechar o modal
      onComplete();
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('mfa.requiredSetup')}
    >
      <div className="two-factor-setup-modal">
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {step === 'qr' && (
          <div className="setup-step">
            <div style={{ backgroundColor: '#fff3cd', border: '2px solid #ffc107', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <AlertCircle size={16} style={{ color: '#856404' }} />
                <p style={{ margin: 0, color: '#856404', fontWeight: 'bold' }}>{t('mfa.requiredWarning')}</p>
              </div>
              <p style={{ margin: 0, color: '#856404', lineHeight: 1.6 }}>
                {t('mfa.requiredMessage')}
              </p>
            </div>
            {loading ? (
              <p>{t('mfa.generatingQR')}</p>
            ) : (
              <Button onClick={generateQRCode}>
                <QrCode size={18} />
                {t('mfa.generateQR')}
              </Button>
            )}
          </div>
        )}

        {step === 'verify' && (
          <div className="setup-step">
              <p style={{ marginBottom: '1rem', color: 'var(--text)' }}>
              {t('mfa.scanQR')}
            </p>
            {qrCode && (
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <img src={qrCode} alt="QR Code" style={{ maxWidth: '250px', border: '2px solid #ddd', padding: '10px', borderRadius: '8px' }} />
              </div>
            )}
            {secret && (
              <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}><strong>{t('mfa.manualCode')}</strong></p>
                <code style={{ display: 'block', padding: '0.75rem', backgroundColor: '#fff', borderRadius: '4px', fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: '2px' }}>
                  {secret}
                </code>
              </div>
            )}
            <form onSubmit={(e) => {
              e.preventDefault();
              if (verificationCode.length === 6 && !loading) {
                handleVerifyAndEnable();
              }
            }}>
              <Input
                label={t('mfa.verificationCode')}
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && verificationCode.length === 6 && !loading) {
                    e.preventDefault();
                    handleVerifyAndEnable();
                  }
                }}
                placeholder="000000"
                maxLength={6}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <Button
                  type="submit"
                  onClick={(e) => {
                    e.preventDefault();
                    handleVerifyAndEnable();
                  }}
                  disabled={loading || verificationCode.length !== 6}
                >
                  {loading ? t('mfa.verifying') : t('mfa.verifyAndEnable')}
                </Button>
              </div>
            </form>
          </div>
        )}

        {step === 'complete' && (
          <div className="setup-step">
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <CheckCircle size={48} style={{ color: '#28a745', marginBottom: '1rem' }} />
              <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text)' }}>{t('mfa.setupSuccess')}</h3>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                {t('mfa.setupSuccessMessage')}
              </p>
            </div>

            <div style={{ backgroundColor: '#d4edda', border: '2px solid #28a745', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <CheckCircle size={16} style={{ color: '#155724' }} />
                <p style={{ margin: 0, color: '#155724', fontWeight: 'bold' }}>{t('mfa.setupComplete')}</p>
              </div>
              <p style={{ margin: '0.5rem 0', color: '#155724', lineHeight: 1.6 }}>
                {t('mfa.setupCompleteMessage')}
              </p>
            </div>

            <Button onClick={handleComplete} style={{ width: '100%' }}>
              {t('mfa.continueToSystem')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

