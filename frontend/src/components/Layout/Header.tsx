import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { User as UserType } from '@/types/models';
import { useNavigate } from 'react-router-dom';
import Button from '../UI/Button';
import LanguageSelector from '../LanguageSelector';
import { canRoleAccessRoute } from '@/utils/rolePermissions';
import { LogOut, User, Workflow } from 'lucide-react';
import './Header.css';

export default function Header() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const canOpenIntake = canRoleAccessRoute(user?.roleName, '/next/intake');

  const handleLogout = async () => {
    await logout();
  };

  const getAccessTypeLabel = (user?: UserType) => {
    if (user?.roleName) {
      const roleMap: Record<string, string> = {
        'Administrador': t('roles.administrator'),
        'Coordenador': t('roles.coordinator'),
        'Técnico': t('roles.technician'),
        'Usuário Externo': t('roles.externalUser'),
      };
      return roleMap[user.roleName] || user.roleName;
    }
    switch (user?.accessType) {
      case 1:
        return t('roles.basic');
      case 2:
        return t('roles.intermediate');
      case 3:
        return t('roles.complete');
      default:
        return t('roles.unknown');
    }
  };

  return (
    <header className="header">
      <div className="header-content">
        <h2 className="header-title">{t('app.title')}</h2>
        <div className="header-user-section">
          <LanguageSelector />
          {user && (
            <div className="user-info">
              <User size={18} />
              <div className="user-details">
                <span className="user-name">{user.name}</span>
                <span className="user-access">{t('roles.access')}: {getAccessTypeLabel(user)}</span>
              </div>
            </div>
          )}
          {canOpenIntake && (
            <Button variant="secondary" onClick={() => navigate('/next/intake')} className="intake-button">
              <Workflow size={18} />
              {t('navigation.newIntake')}
            </Button>
          )}
          <Button variant="secondary" onClick={handleLogout} className="logout-button">
            <LogOut size={18} />
            {t('auth.logout')}
          </Button>
        </div>
      </div>
    </header>
  );
}


