import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { canRoleAccessRoute } from '@/utils/rolePermissions';
import { 
  Menu, 
  X, 
  LayoutDashboard, 
  Stethoscope,
  FlaskConical, 
  Workflow,
  FileText, 
  Box, 
  MessageCircle, 
  Shield, 
  BarChart3, 
  FileSearch, 
  Database, 
  UserCog 
} from 'lucide-react';
import './Sidebar.css';

type MenuItem = {
  path: string;
  icon: typeof LayoutDashboard;
  label: string;
  roles: string[];
  featured?: boolean;
};

export default function Sidebar() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const isMobileOrTablet = window.matchMedia('(max-width: 1024px)').matches;
    if (!isMobileOrTablet) return;

    const previousOverflow = document.body.style.overflow;
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = previousOverflow || '';
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);
  
  // Mapeia accessType para roleName se não tiver roleName
  let roleName = user?.roleName;
  if (!roleName && user?.accessType) {
    const roleNameMap: Record<number, string> = {
      1: 'Usuário Externo',
      2: 'Técnico',
      3: 'Coordenador',
      4: 'Administrador'
    };
    roleName = roleNameMap[user.accessType] as any;
  }

  const allMenuItems: MenuItem[] = [
    { path: '/dashboard', icon: LayoutDashboard, label: t('navigation.dashboard'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] },
    { path: '/next/intake', icon: Workflow, label: t('navigation.newIntake') || 'Novo Atendimento', roles: ['Administrador', 'Coordenador', 'Técnico'], featured: true },
    { path: '/patients', icon: Stethoscope, label: t('navigation.patients') || 'Diretório de Pacientes', roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/samples', icon: FlaskConical, label: t('navigation.samples') || 'Inventário de Amostras', roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/results', icon: FileText, label: t('navigation.results'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/facility-management', icon: Box, label: t('navigation.facilityManagement'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/assistant', icon: MessageCircle, label: t('navigation.assistant'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] },
    { path: '/admin/tcle/new', icon: FileText, label: 'Construtor de TCLE', roles: ['Administrador', 'Coordenador'] },
    { path: '/user/security', icon: Shield, label: t('navigation.userSecurity'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] },
    { path: '/reports', icon: BarChart3, label: t('navigation.reports'), roles: ['Administrador', 'Coordenador', 'Usuário Externo'] },
    { path: '/logs', icon: FileSearch, label: t('navigation.logs'), roles: ['Administrador', 'Coordenador'] },
    { path: '/system-management', icon: UserCog, label: t('navigation.systemManagement') || 'Gerenciamento do Sistema', roles: ['Administrador'] },
    { path: '/admin/dicionario', icon: Database, label: 'Dicionário de Dados', roles: ['Administrador'] },
    { path: '/backup', icon: Database, label: t('navigation.backup'), roles: ['Administrador'] },
  ];

  // Filtra itens baseado na role do usuário
  const menuItems = allMenuItems.filter(item => {
    if (!roleName) {
      // Se não tem roleName nem accessType, não mostra nada (exceto dashboard)
      if (item.path === '/dashboard') return true;
      return false;
    }
    // Verifica se a role do usuário está na lista de roles permitidas
    return item.roles.includes(roleName) || canRoleAccessRoute(roleName, item.path);
  });

  return (
    <>
      {/* Menu hambúrguer para mobile */}
      <button 
        className="sidebar-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle menu"
        aria-controls="app-sidebar"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>
      
      {/* Overlay para fechar sidebar no mobile */}
      {isOpen && (
        <div 
          className="sidebar-overlay"
          onClick={() => setIsOpen(false)}
        />
      )}
      
      <aside id="app-sidebar" className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1 className="sidebar-title">{t('app.title')}</h1>
          <p className="sidebar-subtitle">{t('app.subtitle')}</p>
        </div>
        <nav className="sidebar-nav">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `sidebar-link ${item.featured ? 'sidebar-link--featured' : ''} ${isActive ? 'active' : ''}`
                }
                onClick={e => {
                  setIsOpen(false);
                  // fallback manual se o NavLink não funcionar
                  if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                    e.preventDefault();
                    window.history.pushState({}, '', item.path);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }
                }}
                aria-label={item.label}
                tabIndex={0}
                role="link"
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setIsOpen(false);
                    window.history.pushState({}, '', item.path);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }
                }}
              >
                <span className="sidebar-link__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="sidebar-link__label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

