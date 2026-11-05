import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { ArrowLeft, QrCode, CheckCircle, AlertCircle, Shield, Key } from 'lucide-react';
import { authService } from '../services/api';
import { LIMITS } from '../config/constants/limits.constants';

export default function MFASetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Verifica se é configuração do primeiro acesso (vem do login)
  const isFirstLogin = location.state?.isFirstLogin || false;
  const username = location.state?.username || localStorage.getItem('tempUsername') || '';
  const password = location.state?.password || localStorage.getItem('tempPassword') || '';
  // Verifica se veio da página de segurança do usuário
  const fromUserSecurity = location.state?.from === '/user/security' || 
                          (typeof window !== 'undefined' && document.referrer.includes('/user/security'));
  
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'qr' | 'verify' | 'complete'>('qr');
  const [qrGenerated, setQrGenerated] = useState(false);

  // Gera QR code automaticamente ao carregar a página
  useEffect(() => {
    if (step === 'qr' && !qrGenerated) {
      generateQRCode();
    }
  }, [step, qrGenerated]);

  const generateQRCode = async () => {
    setLoading(true);
    setError('');
    try {
      let response;
      
      if (isFirstLogin && username && password) {
        // Primeiro acesso - usa endpoint especial
        response = await authService.generateTwoFactorQRFirstLogin(username, password);
      } else {
        // Configuração normal - usa endpoint autenticado
        response = await authService.generateTwoFactorQR();
      }
      
      const qrCodeData = response.data?.qrCode || response.data?.data?.qrCode;
      const secretData = response.data?.secret || response.data?.data?.secret || response.data?.manualEntryKey || response.data?.data?.manualEntryKey;
      
      if (qrCodeData) {
        setQrCode(qrCodeData);
        if (secretData) {
          setSecret(secretData);
        }
        setQrGenerated(true);
        setStep('verify');
      } else {
        setError('Não foi possível gerar o QR code. Tente novamente.');
      }
    } catch (error: any) {
      console.error('Erro ao gerar QR code:', error);
      const errorMessage = error.response?.data?.error || 
                          error.response?.data?.message || 
                          error.message || 
                          'Erro ao gerar QR code. Tente novamente.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndEnable = async () => {
    setLoading(true);
    setError('');
    
    try {
      let response;
      
      if (isFirstLogin && username && password) {
        // Primeiro acesso
        response = await authService.enableTwoFactorFirstLogin(verificationCode, username, password);

        // #1250: an administrator set or forced this password. The enrolment
        // is done, but no session is issued until the user replaces it, so
        // back to the login form, which handles MFA and the forced change.
        if (response.data?.data?.requiresPasswordChange) {
          localStorage.removeItem('tempUsername');
          localStorage.removeItem('tempPassword');
          navigate('/login', { replace: true, state: { username, notice: 'mfaEnrolledPasswordChange' } });
          return;
        }

        // Extrai token e salva
        const token = response.data?.data?.token || response.data?.token;
        const userData = response.data?.data?.user || response.data?.user;
        
        if (token && userData) {
          localStorage.setItem('token', token);
          localStorage.removeItem('tempUsername');
          localStorage.removeItem('tempPassword');
        }
      } else {
        // Configuração normal
        response = await authService.enableTwoFactor(verificationCode);
        setBackupCodes(response.data?.backupCodes || []);
        if (response.data?.backupCodes?.length > 0) {
          setShowBackupCodes(true);
        }
      }
      
      setStep('complete');
    } catch (error: any) {
      console.error('Erro ao habilitar 2FA:', error);
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
    if (isFirstLogin) {
      // No primeiro acesso, redireciona para dashboard
      navigate('/dashboard', { replace: true });
    } else {
      // Na configuração normal, retorna para Minha Segurança se veio de lá
      if (fromUserSecurity) {
        navigate('/user/security', { replace: true });
      } else {
        // Fallback: redireciona para dashboard
        navigate('/dashboard', { replace: true });
      }
    }
  };

  const handleCancel = () => {
    // Na configuração normal, volta para Minha Segurança
    // Se veio da página de segurança do usuário, retorna para lá
    if (fromUserSecurity) {
      navigate('/user/security');
    } else {
      // Fallback: volta para dashboard se não vier da página de segurança
      navigate('/dashboard');
    }
  };

  return (
    <div className="mfa-setup-page" style={{ 
      backgroundColor: '#ffffff',
      minHeight: '100vh',
      padding: '1.5rem 1rem'
    }}>
      <div style={{ 
        maxWidth: '500px', 
        margin: '0 auto',
        width: '100%'
      }}>
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.75rem',
          marginBottom: '1.25rem'
        }}>
          {!isFirstLogin && (
            <Button 
              onClick={handleCancel}
              variant="secondary" 
              style={{ minWidth: 'auto', padding: '0.4rem' }}
            >
              <ArrowLeft size={16} />
            </Button>
          )}
          <div>
            <h1 style={{ 
              margin: 0, 
              fontSize: '1.25rem', 
              fontWeight: 600,
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <Shield size={20} />
              {isFirstLogin ? 'Configuração Obrigatória de 2FA' : 'Configurar 2FA'}
            </h1>
            <p style={{ 
              margin: '0.2rem 0 0 0', 
              fontSize: '0.8rem', 
              color: 'var(--text-light)'
            }}>
              {isFirstLogin 
                ? 'Obrigatório no primeiro acesso'
                : 'Adicione segurança extra à sua conta'}
            </p>
          </div>
        </div>

        {error && (
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            backgroundColor: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            marginBottom: '1rem',
            color: '#991b1b',
            fontSize: '0.875rem'
          }}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Gerar QR Code */}
        {step === 'qr' && (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            padding: '1.25rem',
            border: '1px solid var(--border)'
          }}>
            {isFirstLogin && (
              <div style={{ 
                backgroundColor: '#fff3cd', 
                border: '1px solid #ffc107', 
                borderRadius: '6px', 
                padding: '0.75rem', 
                marginBottom: '1rem',
                fontSize: '0.8rem'
              }}>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <AlertCircle size={14} style={{ color: '#856404' }} />
                  <p style={{ margin: 0, color: '#856404', fontWeight: 'bold', fontSize: '0.875rem' }}>
                    Configuração Obrigatória
                  </p>
                </div>
                <p style={{ margin: 0, color: '#856404', lineHeight: 1.5, fontSize: '0.8rem' }}>
                  O 2FA é obrigatório no primeiro login. Configure para acessar o sistema.
                </p>
              </div>
            )}

            <div style={{ textAlign: 'center' }}>
              {loading ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-light)' }}>Gerando QR Code...</p>
              ) : (
                <Button onClick={generateQRCode} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <QrCode size={16} />
                  Gerar QR Code
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Verificar Código */}
        {step === 'verify' && (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            padding: '1.25rem',
            border: '1px solid var(--border)'
          }}>
            <h2 style={{ 
              margin: '0 0 0.75rem 0', 
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--text)'
            }}>
              Escaneie o QR Code
            </h2>
            
            <p style={{ marginBottom: '1rem', color: 'var(--text-light)', lineHeight: 1.5, fontSize: '0.875rem' }}>
              Use o Google Authenticator para escanear:
            </p>

            {qrCode && (
              <div style={{ 
                textAlign: 'center', 
                marginBottom: '1.25rem',
                padding: '1rem',
                backgroundColor: '#f9fafb',
                borderRadius: '6px'
              }}>
                <img 
                  src={qrCode} 
                  alt="QR Code" 
                  style={{ 
                    maxWidth: '200px', 
                    width: '100%',
                    border: '1px solid #e5e7eb', 
                    padding: '0.75rem', 
                    borderRadius: '6px',
                    backgroundColor: '#ffffff'
                  }} 
                />
              </div>
            )}

            {secret && (
              <div style={{ 
                marginBottom: '1.25rem', 
                padding: '0.75rem', 
                backgroundColor: '#f9fafb', 
                borderRadius: '6px',
                border: '1px solid var(--border)'
              }}>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', fontWeight: 600 }}>
                  Ou digite manualmente:
                </p>
                <code style={{ 
                  display: 'block', 
                  padding: '0.6rem', 
                  backgroundColor: '#ffffff', 
                  borderRadius: '4px', 
                  fontFamily: 'monospace', 
                  fontSize: '0.85rem', 
                  letterSpacing: '1px',
                  border: '1px solid #e5e7eb',
                  textAlign: 'center',
                  color: 'var(--text)',
                  wordBreak: 'break-all'
                }}>
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
                label="Código de Verificação (6 dígitos)"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                maxLength={LIMITS.MFA_CODE_LENGTH}
                pattern="\d{6}"
                autoFocus
                style={{ marginBottom: '1rem' }}
              />
              
              <div style={{ 
                display: 'flex', 
                gap: '0.75rem', 
                justifyContent: 'flex-end'
              }}>
                {!isFirstLogin && (
                  <Button
                    type="button"
                    onClick={handleCancel}
                    variant="secondary"
                    disabled={loading}
                  >
                    Cancelar
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={loading || verificationCode.length !== 6}
                >
                  {loading ? 'Verificando...' : 'Verificar e Habilitar'}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Step 3: Concluído */}
        {step === 'complete' && (
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            padding: '1.25rem',
            border: '1px solid var(--border)',
            textAlign: 'center'
          }}>
            <CheckCircle size={48} style={{ color: '#10b981', marginBottom: '0.75rem' }} />
            <h2 style={{ 
              margin: '0 0 0.5rem 0', 
              fontSize: '1.125rem',
              fontWeight: 600,
              color: 'var(--text)'
            }}>
              2FA Configurado com Sucesso!
            </h2>
            <p style={{ 
              color: 'var(--text-light)', 
              marginBottom: '1.5rem',
              lineHeight: 1.5,
              fontSize: '0.875rem'
            }}>
              Autenticação de dois fatores habilitada.
              {isFirstLogin 
                ? ' Redirecionando...'
                : ' Use o código do Google Authenticator no próximo login.'}
            </p>

            {showBackupCodes && backupCodes.length > 0 && (
              <div style={{
                backgroundColor: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '6px',
                padding: '1rem',
                marginBottom: '1.5rem',
                textAlign: 'left'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <Key size={16} style={{ color: '#856404' }} />
                  <h3 style={{ margin: 0, color: '#856404', fontSize: '0.9rem', fontWeight: 600 }}>
                    Códigos de Backup
                  </h3>
                </div>
                <div style={{ 
                  display: 'flex', 
                  gap: '0.4rem', 
                  marginBottom: '0.75rem',
                  flexWrap: 'wrap'
                }}>
                  {backupCodes.map((code, index) => (
                    <div 
                      key={index} 
                      style={{
                        padding: '0.4rem 0.75rem',
                        backgroundColor: '#ffffff',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        fontSize: '0.8rem',
                        color: 'var(--text)'
                      }}
                    >
                      {code}
                    </div>
                  ))}
                </div>
                <p style={{ 
                  margin: 0, 
                  color: '#856404', 
                  fontSize: '0.8rem',
                  lineHeight: 1.5
                }}>
                  <strong>IMPORTANTE:</strong> Salve estes códigos em local seguro. 
                  Use-os caso perca acesso ao Google Authenticator.
                </p>
              </div>
            )}

            <Button onClick={handleComplete} style={{ width: '100%' }}>
              {isFirstLogin ? 'Continuar' : 'Voltar'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

