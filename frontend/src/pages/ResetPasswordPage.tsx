import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { authService } from '../services/api';
import { CheckCircle, AlertCircle, Lock } from 'lucide-react';
import { validatePasswordAndGetError } from '../utils/passwordValidator';
import './ResetPasswordPage.css';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  useEffect(() => {
    if (!token) {
      setError('Token de recuperação não fornecido');
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword || !confirmPassword) {
      setError('Preencha todos os campos');
      return;
    }

    // Valida complexidade da senha
    const passwordError = validatePasswordAndGetError(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (!token) {
      setError('Token inválido');
      return;
    }

    setLoading(true);
    try {
      await authService.resetPassword(token, newPassword);
      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao redefinir senha');
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

          <form onSubmit={handleSubmit} className="reset-password-form">
            <Input
              label="Nova Senha"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 12 caracteres com maiúscula, minúscula e especial"
              required
              autoFocus
              minLength={12}
            />

            <Input
              label="Confirmar Nova Senha"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Digite a senha novamente"
              required
              minLength={12}
            />

            <div className="password-requirements">
              <p><strong>Requisitos da senha:</strong></p>
              <ul>
                <li>Mínimo de 12 caracteres</li>
                <li>Pelo menos uma letra maiúscula</li>
                <li>Pelo menos uma letra minúscula</li>
                <li>Pelo menos um caractere especial ({specialChars})</li>
              </ul>
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


