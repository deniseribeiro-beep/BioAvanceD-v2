import { useState, useId } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { ArrowLeft } from 'lucide-react';
import { User } from '../types/models';
import { useUsers } from '../hooks/useUsers';
import { userService } from '../services/api';
import { useOrganizations } from '../hooks/useOrganizations';
import UserOrganizationScopes from './UserOrganizationScopes';
import { getAccessTypeForRole, getRoleDescription, RoleName } from '../utils/rolePermissions';
import { useLanguage } from '../contexts/LanguageContext';
import { validatePassword } from '../utils/passwordValidator';
import { getPasswordIssues, passwordRequirementItems } from '../utils/passwordRules';
import { usePasswordPolicy } from '../hooks/usePasswordPolicy';

/**
 * Monta o payload a ser enviado ao backend a partir do formData bruto:
 * remove campos que não devem ser (re)enviados, normaliza telefone e
 * organizationId, e aplica as regras de MFA por papel/edição.
 * Implementa: preparação de User para PUT/POST /api/users.
 */
export function buildUserSubmissionPayload(formData: Partial<User>, editingUser: User | null): any {
  const dataToSave: any = { ...formData };

  // Remove campos que não devem ser enviados para atualização
  delete dataToSave._id;
  delete dataToSave.id;
  delete dataToSave.createdAt;
  delete dataToSave.lastLogin;
  // #1072: the backend field is mfaSecretCiphertext since the rename; both
  // names are dropped so a stale client payload can never carry either.
  delete dataToSave.mfaSecret;
  delete dataToSave.mfaSecretCiphertext;
  delete dataToSave.mfaActivationDate;
  delete dataToSave.mfaFailedAttempts;
  delete dataToSave.mfaLocked;
  delete dataToSave.accessIDs; // Campo não é mais usado
  delete dataToSave.modelVersion; // Remove modelVersion se existir
  // #1240: the auditor role is granted through PUT /api/users/:id only.
  if (!editingUser) {
    delete dataToSave.auditorRole;
  }

  // Normaliza telefone: remove formatação antes de salvar (apenas números)
  if (dataToSave.phone !== undefined) {
    if (dataToSave.phone && typeof dataToSave.phone === 'string') {
      const phoneNumbers = dataToSave.phone.replace(/\D/g, '');
      dataToSave.phone = phoneNumbers.length > 0 ? phoneNumbers : null;
    } else {
      dataToSave.phone = null;
    }
  }

  // Normaliza organizationId: string vazia (nenhuma organização selecionada) vira null
  if (dataToSave.organizationId !== undefined) {
    dataToSave.organizationId = dataToSave.organizationId || null;
  }

  // Remove senha se estiver vazia (não atualiza senha)
  if (!dataToSave.password || dataToSave.password.trim() === '') {
    delete dataToSave.password;
  }
  // #1013: PUT /api/users/:id refuses a password; an edit sets it through
  // POST /:id/set-password instead (handleSubmit).
  if (editingUser) {
    delete dataToSave.password;
  }

  // Se for Administrador e não for edição, não envia campos MFA (será opcional e setado manualmente)
  if (dataToSave.roleName === 'Administrador' || dataToSave.accessType === 4) {
    // Para admin, MFA é opcional e pode ser setado manualmente
    // Mantém mfaEnabled se estiver sendo editado e foi setado manualmente
    if (!editingUser) {
      // Novo admin - MFA desabilitado por padrão
      delete dataToSave.mfaEnabled;
    }
    // Se for edição de admin, mantém mfaEnabled se foi fornecido
  } else {
    // Para não-admin, remove campos MFA (não podem ser editados manualmente)
    delete dataToSave.mfaEnabled;
  }

  return dataToSave;
}

export default function NewUserPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { registerUser, updateUser, loadUsers } = useUsers();
  const { organizations } = useOrganizations();
  const { t } = useLanguage();
  const roleSelectId = useId();
  const organizationSelectId = useId();
  
  // Verifica se há usuário para edição (vindo da navegação)
  const editingUser = (location.state as any)?.user as User | null;

  // Função para formatar telefone brasileiro: (XX) XXXXX-XXXX
  const formatPhone = (value: string | null | undefined): string => {
    if (!value) return '';
    // Remove tudo que não é número
    const numbers = value.replace(/\D/g, '');
    if (numbers.length === 0) return '';
    // Aplica a máscara
    if (numbers.length <= 2) {
      return numbers;
    } else if (numbers.length <= 7) {
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    } else {
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
    }
  };

  // Função para inicializar formData corretamente
  const getInitialFormData = (): Partial<User> => {
    let data = editingUser ? {
      ...editingUser,
      phone: formatPhone(editingUser.phone || null) // Formata telefone se existir
    } : {
      name: '',
      email: '',
      phone: '',
      organizationId: null,
      username: '',
      password: '',
      // #1464: the access type of the role the select shows; 1 registered an
      // external user while the form said Técnico.
      accessType: getAccessTypeForRole('Técnico'),
      roleName: 'Técnico' as RoleName,
      accessIDs: [],
      status: 'Ativo',
    };

    // Se o usuário não tem roleName mas tem accessType, mapeia para roleName
    if (data.accessType && !data.roleName) {
      switch (data.accessType) {
        case 4:
          data.roleName = 'Administrador';
          break;
        case 3:
          data.roleName = 'Coordenador';
          break;
        case 2:
          data.roleName = 'Técnico';
          break;
        case 1:
          data.roleName = 'Usuário Externo';
          break;
        default:
          data.roleName = 'Técnico';
      }
    }
    
    // Se tem roleName mas não tem accessType, mapeia roleName para accessType
    if (data.roleName && !data.accessType) {
      const accessTypeMap: Record<RoleName, number> = {
        'Usuário Externo': 1,
        'Técnico': 2,
        'Coordenador': 3,
        'Administrador': 4
      };
      data.accessType = accessTypeMap[data.roleName] || 2;
    }

    return data;
  };

  const [formData, setFormData] = useState<Partial<User>>(getInitialFormData());
  const [inviteByLink, setInviteByLink] = useState(!editingUser);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // #1246: the server's passwordRules, not a fixed copy.
  const passwordRules = usePasswordPolicy();
  const passwordIssues = getPasswordIssues(formData.password || '', passwordRules);

  // Função para formatar telefone durante digitação: (XX) XXXXX-XXXX
  const formatPhoneInput = (value: string): string => {
    // Remove tudo que não é número
    const numbers = value.replace(/\D/g, '');
    
    // Limita a 11 dígitos (máximo para telefone brasileiro)
    const limitedNumbers = numbers.slice(0, 11);
    
    // Aplica a máscara
    if (limitedNumbers.length <= 2) {
      return limitedNumbers;
    } else if (limitedNumbers.length <= 7) {
      return `(${limitedNumbers.slice(0, 2)}) ${limitedNumbers.slice(2)}`;
    } else {
      return `(${limitedNumbers.slice(0, 2)}) ${limitedNumbers.slice(2, 7)}-${limitedNumbers.slice(7)}`;
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneInput(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isSubmitting) {
      return; // Previne múltiplos submits
    }
    
    const form = e.currentTarget;
    
    // Validação HTML5 nativa primeiro
    if (!form.checkValidity()) {
      // Encontra o primeiro campo inválido e foca nele
      const firstInvalid = form.querySelector(':invalid') as HTMLInputElement;
      if (firstInvalid) {
        firstInvalid.focus();
        firstInvalid.reportValidity(); // Mostra mensagem de validação HTML5 nativa
      }
      return;
    }
    
    // Validação adicional JavaScript para campos que não têm validação HTML5 nativa
    const errors: string[] = [];
    
    if (!formData.name || formData.name.trim() === '') {
      errors.push(t('users.nameRequired'));
    }
    
    if (!formData.username || formData.username.trim() === '') {
      errors.push(t('users.usernameRequired'));
    }
    
    if (!editingUser && !inviteByLink && !formData.password) {
      errors.push(t('users.passwordRequired'));
    }
    
    // Valida complexidade da senha
    if (!inviteByLink && formData.password) {
      const passwordValidation = validatePassword(formData.password, passwordRules);
      if (!passwordValidation.isValid) {
        errors.push(...passwordValidation.errors);
      }
    }
    
    if (!formData.roleName) {
      errors.push(t('users.roleRequired'));
    }
    
    // Invitees activate as active; status is only meaningful for create/edit with password.
    if ((!inviteByLink || editingUser) && !formData.status) {
      errors.push(t('users.statusRequired'));
    }
    
    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const dataToSave = buildUserSubmissionPayload(formData, editingUser);

      if (editingUser) {
        const userId = (editingUser as any)._id || editingUser.id;
        if (!userId) {
          alert(t('users.userIdNotFound'));
          return;
        }
        // #1013: a typed password goes to its own route, first, so a password
        // the policy refuses (strength, recent reuse) stops the whole save.
        if (formData.password) {
          await userService.setPassword(userId, formData.password);
        }
        await updateUser(userId, dataToSave);
        await loadUsers();
        navigate('/users');
      } else if (inviteByLink) {
        const invitePayload = { ...dataToSave };
        delete invitePayload.password;
        delete invitePayload.status;
        const response = await userService.createInvite(invitePayload);
        await loadUsers();
        const link = response.data?.data?.inviteLink;
        if (link) {
          window.prompt('Convite criado — copie o link para o operador:', link);
        } else {
          alert('Convite criado. Encaminhe o link de ativação ao operador (por canal seguro do tenant).');
        }
        navigate('/users');
      } else {
        await registerUser(dataToSave);
        await loadUsers();
        navigate('/users');
      }
    } catch (error: any) {
      console.error('Erro ao salvar usuário:', error);
      alert(error.response?.data?.error || error.response?.data?.message || error.message || t('users.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ 
      maxWidth: '900px', 
      margin: '0 auto', 
      padding: '2rem',
      minHeight: '100vh',
      backgroundColor: '#ffffff',
      width: '100%'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '1rem',
        marginBottom: '2rem'
      }}>
        <Button 
          onClick={() => navigate('/users')} 
          variant="secondary" 
          style={{ minWidth: 'auto', padding: '0.5rem' }}
        >
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 style={{ 
            margin: 0, 
            fontSize: '1.5rem', 
            fontWeight: 600,
            color: 'var(--text)'
          }}>
            {editingUser ? t('users.editTitle') : t('users.newTitle')}
          </h1>
          <p style={{ 
            margin: '0.25rem 0 0 0', 
            fontSize: '0.875rem', 
            color: 'var(--text-light)'
          }}>
            {editingUser ? t('users.editSubtitle') : t('users.newSubtitle')}
          </p>
        </div>
      </div>

      {/* Formulário */}
      <form onSubmit={handleSubmit} className="new-user-form" data-testid="new-user-form" style={{ 
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        padding: '2rem',
        border: '1px solid var(--border)'
      }} noValidate={false}>
        <div className="form-grid">
          <Input
            data-testid="new-user-name-input"
            label={t('users.name')}
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <Input
            data-testid="new-user-email-input"
            label={t('users.email')}
            type="email"
            value={formData.email || ''}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            autoComplete="email"
            placeholder="usuario@exemplo.com"
            title="Por favor, insira um endereço de email válido (exemplo: usuario@exemplo.com)"
          />
          <Input
            data-testid="new-user-phone-input"
            label={t('users.phone')}
            type="tel"
            value={formData.phone || ''}
            onChange={handlePhoneChange}
            placeholder="(00) 00000-0000"
            maxLength={15}
          />
          <div>
            <label htmlFor={organizationSelectId} className="form-label">{t('users.institution')}</label>
            <select
              data-testid="new-user-organization-select"
              id={organizationSelectId}
              name="organizationId"
              value={formData.organizationId || ''}
              onChange={(e) =>
                setFormData({ ...formData, organizationId: e.target.value || null })
              }
              className="form-select"
              title={t('users.institution')}
            >
              <option value="">{t('common.select')}</option>
              {organizations.map((org) => (
                <option key={org.organizationId} value={org.organizationId}>
                  {org.officialName}
                </option>
              ))}
            </select>
          </div>
          <Input
            data-testid="new-user-username-input"
            label={t('users.username')}
            value={formData.username || ''}
            onChange={(e) =>
              setFormData({ ...formData, username: e.target.value })
            }
            required
          />
          {!editingUser && (
            <div className="form-grid-full">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  data-testid="new-user-invite-checkbox"
                  checked={inviteByLink}
                  onChange={(e) => setInviteByLink(e.target.checked)}
                />
                Convidar usuário (ativação por link — sem senha aqui)
              </label>
            </div>
          )}
          {(!editingUser && !inviteByLink) || editingUser ? (
            <Input
              data-testid="new-user-password-input"
              label={t('users.password')}
              type="password"
              value={formData.password || ''}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              required={!editingUser && !inviteByLink}
            />
          ) : null}
          {!inviteByLink && (
          <div style={{ gridColumn: '1 / -1', marginTop: '-0.5rem' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{t('password.requirements.title')}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.25rem' }}>
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
          </div>
          )}
          <div className="form-grid-full">
            <label htmlFor={roleSelectId} className="form-label">{t('users.roleLabel')} *</label>
            <select
              data-testid="new-user-role-select"
              id={roleSelectId}
              name="roleName"
              value={formData.roleName || 'Técnico'}
              onChange={(e) => {
                const newRoleName = e.target.value as RoleName;
                const newAccessType = getAccessTypeForRole(newRoleName);
                setFormData({ 
                  ...formData, 
                  roleName: newRoleName,
                  accessType: newAccessType,
                  // Limpa accessIDs para todas as roles (não é mais usado)
                  accessIDs: [],
                  // Se mudou para Administrador, desabilita MFA por padrão
                  mfaEnabled: newRoleName === 'Administrador' ? false : formData.mfaEnabled
                });
              }}
              className="form-select"
              title={t('users.role')}
              required
            >
              <option value="Técnico">{t('users.roleTechnician')}</option>
              <option value="Coordenador">{t('users.roleCoordinator')}</option>
              <option value="Administrador">{t('users.roleAdministrator')}</option>
              <option value="Usuário Externo">{t('users.roleExternalUser')}</option>
            </select>
            <div className="role-description">
              <p className="form-help-text">
                <strong>{formData.roleName || 'Técnico'}:</strong> {getRoleDescription((formData.roleName || 'Técnico') as RoleName)}
              </p>
            </div>
          </div>

          {editingUser && ((editingUser as any)._id || editingUser.id) && (
            <UserOrganizationScopes
              userId={(editingUser as any)._id || editingUser.id}
              organizations={organizations}
            />
          )}

          {editingUser && (
            <div className="form-grid-full">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  data-testid="new-user-auditor-checkbox"
                  checked={Boolean(formData.auditorRole)}
                  onChange={(e) => setFormData({ ...formData, auditorRole: e.target.checked })}
                />
                {t('users.auditorRole')}
              </label>
              <p className="form-help-text">{t('users.auditorRoleHelp')}</p>
            </div>
          )}

          {(editingUser || !inviteByLink) && (
          <div className="form-grid-full">
            <label className="form-label">{t('users.status')} *</label>
            <select
              data-testid="new-user-status-select"
              value={formData.status || 'Ativo'}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="form-select"
              title={t('users.status')}
              required
            >
              <option value="Ativo">{t('users.statusActive')}</option>
              <option value="Inativo">{t('users.statusInactive')}</option>
              <option value="Suspenso">{t('users.statusSuspended')}</option>
              <option value="Bloqueado">{t('users.statusBlocked')}</option>
            </select>
          </div>
          )}
        </div>
        
        <div className="form-actions">
          <Button 
            type="button" 
            variant="secondary" 
            onClick={() => navigate('/users')}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button 
            type="submit"
            data-testid="new-user-submit-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? t('users.saving') : (inviteByLink && !editingUser ? 'Convidar usuário' : t('common.save'))}
          </Button>
        </div>
      </form>
    </div>
  );
}

