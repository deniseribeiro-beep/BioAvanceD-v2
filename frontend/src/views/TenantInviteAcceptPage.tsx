import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { authService } from '../services/api';
import { CheckCircle, AlertCircle, UserPlus } from 'lucide-react';
import { validatePasswordAndGetError } from '../utils/passwordValidator';
import { getPasswordIssues, passwordRequirementItems } from '../utils/passwordRules';
import { usePasswordPolicy } from '../hooks/usePasswordPolicy';

type InvitePreview = {
  email: string;
  username: string;
  displayName: string;
  organizationId?: string | null;
  roleName?: string | null;
};

export default function TenantInviteAcceptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const passwordRules = usePasswordPolicy();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const passwordIssues = getPasswordIssues(password, passwordRules);
  const confirmMismatch = password && confirmPassword && password !== confirmPassword;

  useEffect(() => {
    if (!token) {
      setError('Token de convite não fornecido');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await authService.previewTenantInvite(token);
        if (cancelled) return;
        const row = resp.data?.data ?? resp.data;
        setPreview(row);
        setUsername(row?.username || '');
      } catch (err: any) {
        if (!cancelled) {
          setError(err.response?.data?.message || err.response?.data?.error || 'Convite inválido ou expirado');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError('');
    const passwordError = validatePasswordAndGetError(password, passwordRules);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }
    setLoading(true);
    try {
      await authService.acceptTenantInvite(token, password, username);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Erro ao ativar conta');
    } finally {
      setLoading(false);
    }
  };

  if (!token || (error && !preview)) {
    return (
      <div className="reset-password-page">
        <div className="reset-password-container">
          <Card className="reset-password-card">
            <AlertCircle size={48} style={{ color: 'var(--danger)', marginBottom: '1rem' }} />
            <h1>Convite inválido</h1>
            <p>{error || 'O link de convite é inválido ou expirou.'}</p>
            <Button onClick={() => navigate('/login')}>Ir para login</Button>
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
            <CheckCircle size={64} style={{ color: '#28a745', marginBottom: '1.5rem' }} />
            <h1>Conta ativada</h1>
            <p>Redirecionando para o login...</p>
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
            <UserPlus size={48} style={{ marginBottom: '1rem' }} />
            <h1>Ativar conta</h1>
            {preview && (
              <p>
                Olá, <strong>{preview.displayName}</strong> ({preview.email})
                {preview.roleName ? ` — perfil ${preview.roleName}` : ''}
              </p>
            )}
          </div>
          <form onSubmit={handleSubmit} className="reset-password-form">
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <Input
              label="Usuário"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              data-testid="invite-username"
            />
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="invite-password"
            />
            <Input
              label="Confirmar senha"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <ul className="password-requirements">
              {passwordRequirementItems(passwordRules).map((item) => (
                <li key={item.key} className={passwordIssues.includes(item.key) ? 'invalid' : 'valid'}>
                  {item.label}
                </li>
              ))}
            </ul>
            {confirmMismatch && <p style={{ color: 'var(--danger)' }}>As senhas não coincidem</p>}
            <Button type="submit" disabled={loading || !preview} className="reset-password-button">
              {loading ? 'Ativando...' : 'Ativar conta'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}