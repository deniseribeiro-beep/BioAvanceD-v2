import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { authService } from '../services/api';
import { CheckCircle, AlertCircle, Lock } from 'lucide-react';
import { validatePasswordAndGetError } from '../utils/passwordValidator';
import { getPasswordIssues, passwordRequirementItems } from '../utils/passwordRules';
import { usePasswordPolicy } from '../hooks/usePasswordPolicy';
import { useLanguage } from '../contexts/LanguageContext';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const token = searchParams.get('token');
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  // #1246: the server's passwordRules, not a fixed copy.
  const passwordRules = usePasswordPolicy();
  const passwordIssues = getPasswordIssues(newPassword, passwordRules);
  const confirmMismatch = newPassword && confirmPassword && newPassword !== confirmPassword;

  useEffect(() => {
    if (!token) {
      setError('Token de recuperação não fornecido');
    }
  }, [token]);

  // #1445: the form renders only once token is set, so its onSubmit passes the
  // narrowed token in; no submit can arrive without one.
  const handleSubmit = async (e: React.FormEvent, resetToken: string) => {
    e.preventDefault();
    setError('');

    if (!newPassword || !confirmPassword) {
      setError(t('password.error.requiredFields') || 'Preencha todos os campos');
      return;
    }

    // Valida complexidade da senha
    const passwordError = validatePasswordAndGetError(newPassword, passwordRules);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('password.mismatch') || 'As senhas não coincidem');
      return;
    }

    setLoading(true);
    try {
      await authService.resetPassword(resetToken, newPassword);
      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.message || t('auth.passwordResetError') || 'Erro ao redefinir senha');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="reset-password-page">
        <div className="reset-password-container">
          <Card className="reset-password-card">
            <div className="reset-password-header">
              <AlertCircle size={48} style={{ color: 'var(--danger)', marginBottom: '1rem' }} />
              <h1>Token Inválido</h1>
              <p>O link de recuperação de senha é inválido ou expirou.</p>
              <Button onClick={() => navigate('/login')}>
                Voltar para Login
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="reset-password-page">
        <div className="reset-password-container">
          <Card className="reset-password-card">
            <div className="reset-password-success">
              <CheckCircle size={64} style={{ color: '#28a745', marginBottom: '1.5rem' }} />
              <h1>Senha Redefinida com Sucesso!</h1>
              <p>Você será redirecionado para a página de login em instantes...</p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-password-page">
      <div className="reset-password-container">
        <Card className="reset-password-card">
          <div className="reset-password-header">
            <Lock size={48} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
            <h1>Redefinir Senha</h1>
            <p>Digite sua nova senha abaixo</p>
          </div>

          {error && (
            <div className="error-message" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <form onSubmit={(e) => handleSubmit(e, token)} className="reset-password-form">
            <Input
              label="Nova Senha"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('password.requirements.placeholder') || 'Mínimo 8 caracteres com maiúscula, minúscula, número e símbolo'}
              required
              autoFocus
              minLength={passwordRules.minLength}
            />

            <Input
              label="Confirmar Nova Senha"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Digite a senha novamente"
              required
              minLength={passwordRules.minLength}
            />

            <div className="password-requirements">
              <p><strong>{t('password.requirements.title')}</strong></p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.35rem' }}>
                {passwordRequirementItems(passwordRules, t).map((item) => {
                  const ok = !passwordIssues.includes(item.key as any);
                  return (
                    <li key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: ok ? 'var(--success)' : 'var(--text)' }}>
                      {ok ? '✓' : '•'}
                      <span style={{ color: ok ? 'var(--success)' : 'var(--text-light)' }}>{item.label}</span>
                    </li>
                  );
                })}
              </ul>
              {confirmMismatch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem', color: 'var(--danger)' }}>
                  <AlertCircle size={16} />
                  <span>{t('password.mismatch')}</span>
                </div>
              )}
            </div>

            <Button
              type="submit"
              className="reset-password-button"
              disabled={loading}
            >
              {loading ? 'Redefinindo...' : 'Redefinir Senha'}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/login')}
              style={{ marginTop: '1rem' }}
            >
              Voltar para Login
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}


