import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { canRoleAccessRoute } from '../../utils/rolePermissions';
import { 
  LayoutDashboard, 
  Users, 
  FlaskConical, 
  FileText, 
  UserCog,
  Shield,
  FileSearch,
  Box,
  BarChart3,
  MessageCircle,
  Database,
  Menu,
  X
} from 'lucide-react';
import './Sidebar.css';

export default function Sidebar() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  
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

  const allMenuItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: t('navigation.dashboard'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] },
    { path: '/patients', icon: Users, label: t('navigation.patients'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/samples', icon: FlaskConical, label: t('navigation.samples'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/samples/withdrawal-return', icon: FlaskConical, label: t('navigation.withdrawalReturn') || 'Retirada/Devolução', roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/results', icon: FileText, label: t('navigation.results'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/facility-management', icon: Box, label: t('navigation.facilityManagement'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
    { path: '/assistant', icon: MessageCircle, label: t('navigation.assistant'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] },
    { path: '/user/security', icon: Shield, label: t('navigation.userSecurity'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] },
    { path: '/reports', icon: BarChart3, label: t('navigation.reports'), roles: ['Administrador', 'Coordenador', 'Usuário Externo'] },
    { path: '/logs', icon: FileSearch, label: t('navigation.logs'), roles: ['Administrador', 'Coordenador'] },
    { path: '/system-management', icon: UserCog, label: t('navigation.systemManagement') || 'Gerenciamento do Sistema', roles: ['Administrador'] },
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
      
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
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
                  `sidebar-link ${isActive ? 'active' : ''}`
                }
                onClick={() => setIsOpen(false)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

