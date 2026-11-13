import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { User as UserType } from '@/types/models';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/shadcn/button';
import LanguageSelector from '../LanguageSelector';
import { canRoleAccessRoute } from '@/utils/rolePermissions';
import { ChevronDown, LogOut, Settings, ShieldCheck, Workflow } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/shadcn/avatar';
import { Separator } from '@/components/shadcn/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/shadcn/dropdown-menu';
import logo from '@/LOGO_BIOAVANCED_CORE.png';

export default function Header() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const canOpenIntake = canRoleAccessRoute(user?.roleName, '/next/intake');
  const isAdmin = user?.roleName === 'Administrador' || user?.accessType === 4;

  const handleLogout = async () => {
    await logout();
  };

  const getAccessTypeLabel = (currentUser?: UserType) => {
    if (currentUser?.roleName) {
      const roleMap: Record<string, string> = {
        Administrador: t('roles.administrator'),
        Coordenador: t('roles.coordinator'),
        Técnico: t('roles.technician'),
        'Usuário Externo': t('roles.externalUser'),
      };
      return roleMap[currentUser.roleName] || currentUser.roleName;
    }
    switch (currentUser?.accessType) {
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

  const initials = (user?.name || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 xl:hidden">
          <img src={logo} alt="" className="ml-10 h-7 w-7 rounded object-contain" />
          <h2 className="truncate text-sm font-semibold text-foreground">{t('app.title')}</h2>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LanguageSelector />
          {user ? (
            <>
              <Separator orientation="vertical" className="hidden h-6 sm:block" />
              {isAdmin ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="account-menu-trigger"
                      className="flex items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <span className="hidden min-w-0 leading-tight sm:block">
                        <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t('roles.access')}: {getAccessTypeLabel(user)}
                        </span>
                      </span>
                      <ChevronDown data-testid="account-menu-chevron" className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem data-testid="account-menu-security" onSelect={() => navigate('/security')}>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {t('dashboard.security', 'Segurança')}
                    </DropdownMenuItem>
                    <DropdownMenuItem data-testid="account-menu-settings" onSelect={() => navigate('/system-management')}>
                      <Settings className="mr-2 h-4 w-4" />
                      {t('dashboard.settings', 'Configurações')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="hidden items-center gap-2 sm:flex">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t('roles.access')}: {getAccessTypeLabel(user)}
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : null}
          {canOpenIntake ? (
            <Button
              onClick={() => navigate('/next/intake')}
              className="intake-button hidden gap-1.5 sm:inline-flex"
            >
              <Workflow className="h-4 w-4" />
              {t('navigation.newIntake')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={handleLogout} className="logout-button gap-1.5" aria-label={t('auth.logout')}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t('auth.logout')}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
