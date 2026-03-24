import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Modal from '../components/UI/Modal';
import LanguageSelector from '../components/LanguageSelector';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { authService } from '../services/api';
import { getPostLoginRoute } from '../utils/rolePermissions';
import { Mail, CheckCircle, AlertCircle } from 'lucide-react';
import { LIMITS } from '../config/constants/limits.constants';
import { VALIDATION_PATTERNS } from '../config/constants/validation.constants';
import './LoginPage.css';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState(false);
  const [forgotPasswordError, setForgotPasswordError] = useState('');
  const [resetLink, setResetLink] = useState('');
  const { login, isAuthenticated, user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Se já estiver autenticado, redireciona
  useEffect(() => {
    if (isAuthenticated) {
      navigate(getPostLoginRoute(user?.roleName, user?.accessType));
    }
  }, [isAuthenticated, navigate, user?.roleName, user?.accessType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(username, password, requiresTwoFactor ? twoFactorCode : undefined);
      
      if (result && result.requiresTwoFactorSetup) {
        // Redireciona para página de configuração de MFA
        navigate('/mfa-setup', { 
          state: { 
            isFirstLogin: true,
            username: username,
            password: password
          } 
        });
        setLoading(false);
        return;
      }
      
      if (result && result.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setLoading(false);
        return;
      }
      
      // Login bem-sucedido - redireciona por perfil
      const targetRoute = getPostLoginRoute(result?.user?.roleName, result?.user?.accessType);
      navigate(targetRoute, { replace: true });
    } catch (err: any) {
      if (err.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setAttemptsRemaining(err.attemptsRemaining);
        setError(err.message || t('auth.mfaRequired'));
      } else {
        const errorMessage = err.response?.data?.error || 
                           err.response?.data?.message || 
                           err.message || 
                           t('auth.loginError');
        setError(errorMessage);
        setRequiresTwoFactor(false);
        setTwoFactorCode('');

        if (import.meta.env.DEV && !(String(errorMessage).includes('credentials') || String(errorMessage).includes('Credenciais'))) {
          console.warn('Falha inesperada no login:', err);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <Card className="login-card">
          <div className="login-header">
            <h1 className="login-title">{t('app.title')}</h1>
            <p className="login-subtitle">{t('app.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <Input
              label={t('auth.username')}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              placeholder={t('auth.username')}
            />

            <Input
              label={t('auth.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder={t('auth.password')}
              disabled={requiresTwoFactor}
            />

            {requiresTwoFactor && (
              <div className="two-factor-section">
                <Input
                  label={t('auth.twoFactorCode')}
                  type="text"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  placeholder={t('mfa.enterCode')}
                  autoFocus
                  inputMode="numeric"
                  maxLength={LIMITS.MFA_CODE_LENGTH}
                  pattern={VALIDATION_PATTERNS.numericCode6.source}
                />
                {attemptsRemaining !== undefined && attemptsRemaining > 0 && (
                  <p className="attempts-warning">
                    {t('auth.attemptsRemaining')}: {attemptsRemaining}
                  </p>
                )}
                <p className="two-factor-info">
                  {t('auth.twoFactorInfo')}
                </p>
              </div>
            )}

            <Button 
              type="submit" 
              className="login-button"
              disabled={loading}
            >
              {loading ? t('common.loading') : requiresTwoFactor ? t('mfa.verify') : t('auth.login')}
            </Button>

            <div className="forgot-password-link">
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="link-button"
              >
                {t('auth.forgotPassword')}
              </button>
            </div>
          </form>

          <div className="login-language-selector">
            <LanguageSelector />
          </div>
        </Card>
      </div>


      {/* Modal de recuperação de senha */}
      <Modal
        isOpen={showForgotPassword}
        onClose={() => {
          setShowForgotPassword(false);
          setForgotPasswordEmail('');
          setForgotPasswordSuccess(false);
          setForgotPasswordError('');
          setResetLink('');
        }}
        title={t('auth.resetPassword')}
      >
        <div className="forgot-password-modal">
          {forgotPasswordError && (
            <div className="error-message" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={16} />
              {forgotPasswordError}
            </div>
          )}
          {!forgotPasswordSuccess ? (
            <>
              <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
                Digite seu email cadastrado. Enviaremos um link para redefinir sua senha.
              </p>
              <Input
                label="Email"
                type="email"
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                autoFocus
              />
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <Button
                  onClick={async () => {
                    if (!forgotPasswordEmail) {
                      setForgotPasswordError('Digite seu email');
                      return;
                    }
                    setForgotPasswordLoading(true);
                    setForgotPasswordError('');
                    try {
                      const response = await authService.requestPasswordReset(forgotPasswordEmail);
                      setForgotPasswordSuccess(true);
                      if (response.data.resetLink) {
                        setResetLink(response.data.resetLink);
                      }
                      if (response.data.token) {
                        // Em desenvolvimento, mostra o token
                        setResetLink(`${window.location.origin}/reset-password?token=${response.data.token}`);
                      }
                    } catch (err: any) {
                      setForgotPasswordError(err.response?.data?.error || 'Erro ao solicitar recuperação de senha');
                    } finally {
                      setForgotPasswordLoading(false);
                    }
                  }}
                  disabled={forgotPasswordLoading || !forgotPasswordEmail}
                >
                  <Mail size={18} />
                  {t('auth.sendResetLink')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setForgotPasswordEmail('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <div className="forgot-password-success">
              <CheckCircle size={48} style={{ color: '#28a745', marginBottom: '1rem' }} />
              <h3 style={{ margin: '0 0 1rem 0' }}>Link de Recuperação Enviado!</h3>
              <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                {resetLink ? (
                  <>
                    Em desenvolvimento, o link de recuperação é:
                    <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
                      <Link to={resetLink.replace(window.location.origin, '')} style={{ wordBreak: 'break-all', color: 'var(--primary)' }}>
                        {resetLink}
                      </Link>
                    </div>
                    <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-light)' }}>
                      Em produção, este link seria enviado por email.
                    </p>
                  </>
                ) : (
                  'Se o email existir em nosso sistema, um link de recuperação foi enviado. Verifique sua caixa de entrada.'
                )}
              </p>
              <Button
                onClick={() => {
                  setShowForgotPassword(false);
                  setForgotPasswordEmail('');
                  setForgotPasswordSuccess(false);
                  setResetLink('');
                }}
              >
                Fechar
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

