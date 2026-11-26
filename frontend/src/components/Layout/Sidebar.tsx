import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { canRoleAccessRoute } from '@/utils/rolePermissions';
import {
  Menu,
  LayoutDashboard,
  Stethoscope,
  FlaskConical,
  Workflow,
  FileText,
  Box,
  Shield,
  BarChart3,
  FileSearch,
  Database,
  UserCog,
  FileWarning,
  Upload,
  ScrollText,
  FileCheck,
  LayoutTemplate,
  Dna,
  BookOpen,
  HardDrive,
  ShieldCheck,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/shadcn/button';
import { ScrollArea } from '@/components/shadcn/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/shadcn/sheet';
import { cn } from '@/lib/utils';
import logo from '@/LOGO_BIOAVANCED_CORE.png';

type MenuItem = {
  path: string;
  icon: LucideIcon;
  label: string;
  roles: string[];
  featured?: boolean;
  auditReader?: boolean;
};

type MenuSection = {
  label: string;
  items: MenuItem[];
};

function NavItems({
  sections,
  onNavigate,
  ariaLabel,
}: {
  sections: MenuSection[];
  onNavigate?: () => void;
  ariaLabel: string;
}) {
  const navigate = useNavigate();

  return (
    <nav className="sidebar-nav flex flex-col gap-4 px-2 py-3" aria-label={ariaLabel}>
      {sections.map((section) => (
        <div key={section.label}>
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {section.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={(e) => {
                    onNavigate?.();
                    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                      e.preventDefault();
                      navigate(item.path);
                    }
                  }}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium leading-snug text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary',
                      item.featured && !isActive && 'border border-primary/15 bg-primary-soft/70 text-primary',
                      isActive && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                    )
                  }
                  aria-label={item.label}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="line-clamp-2">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function Sidebar() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  let roleName = user?.roleName;
  if (!roleName && user?.accessType) {
    const roleNameMap: Record<number, string> = {
      1: 'Usuário Externo',
      2: 'Técnico',
      3: 'Coordenador',
      4: 'Administrador',
    };
    roleName = roleNameMap[user.accessType] as any;
  }

  const allRoles = ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] as const;

  const sections: MenuSection[] = [
    {
      label: t('navigation.sectionPrincipal', 'Principal'),
      items: [
        { path: '/dashboard', icon: LayoutDashboard, label: t('navigation.dashboard'), roles: [...allRoles] },
        { path: '/next/intake', icon: Workflow, label: t('navigation.newIntake', 'New Registration'), roles: ['Administrador', 'Coordenador', 'Técnico'], featured: true },
        { path: '/patients', icon: Stethoscope, label: t('navigation.patients') || 'Diretório de Pacientes', roles: ['Administrador', 'Coordenador', 'Técnico'] },
      ],
    },
    {
      label: t('navigation.sectionLab', 'Laboratório'),
      items: [
        { path: '/samples', icon: FlaskConical, label: t('navigation.samples') || 'Inventário de Amostras', roles: ['Administrador', 'Coordenador', 'Técnico'] },
        { path: '/results', icon: FileText, label: t('navigation.results'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
        { path: '/facility-management', icon: Box, label: t('navigation.facilityManagement'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
        { path: '/patients/import-fhir', icon: Upload, label: t('navigation.importBatch', 'Importação em lote'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
        { path: '/import/quarantine', icon: FileWarning, label: t('navigation.importQuarantine', 'Quarentena de Importação'), roles: ['Administrador', 'Coordenador', 'Técnico'] },
      ],
    },
    {
      label: t('navigation.sectionGov', 'Governança'),
      items: [
        { path: '/admin/tcle/new', icon: ScrollText, label: t('navigation.tcleBuilder', 'Construtor de TCLE'), roles: ['Administrador', 'Coordenador'] },
        { path: '/consents', icon: FileCheck, label: t('navigation.consentHistory', 'Consentimentos (TCLE)'), roles: ['Administrador', 'Coordenador'] },
        { path: '/biomarker-associations', icon: Dna, label: t('navigation.biomarkerAssociations', 'Associações de Biomarcadores'), roles: ['Administrador', 'Coordenador'] },
        { path: '/access-requests', icon: ShieldCheck, label: t('navigation.accessRequests', 'Solicitações de Acesso'), roles: ['Administrador'] },
      ],
    },
    {
      label: t('navigation.sectionReports', 'Relatórios'),
      items: [
        { path: '/reports', icon: BarChart3, label: t('navigation.reports'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] },
        { path: '/reports/templates', icon: LayoutTemplate, label: t('navigation.reportTemplates'), roles: ['Administrador', 'Coordenador'] },
        { path: '/logs', icon: FileSearch, label: t('navigation.logs'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'], auditReader: true },
      ],
    },
    {
      label: t('navigation.sectionSystem', 'Sistema'),
      items: [
        { path: '/system-management', icon: UserCog, label: t('navigation.systemManagement') || 'Gerenciamento do Sistema', roles: ['Administrador'] },
        { path: '/runbook', icon: BookOpen, label: t('navigation.runbook', 'Runbook / Processos'), roles: [...allRoles] },
        { path: '/backup', icon: HardDrive, label: t('navigation.backup'), roles: ['Administrador'] },
        { path: '/user/security', icon: KeyRound, label: t('navigation.userSecurity'), roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'] },
      ],
    },
  ];

  const filteredSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!roleName) return item.path === '/dashboard';
        if (item.auditReader && user?.isAuditReader !== true) return false;
        return item.roles.includes(roleName) && canRoleAccessRoute(roleName, item.path);
      }),
    }))
    .filter((section) => section.items.length > 0);

  const brand = (
    <div className="flex items-center gap-2.5 px-1">
      <img src={logo} alt="" className="h-9 w-9 rounded-md object-contain" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{t('app.title')}</p>
        <p className="truncate text-xs text-muted-foreground">{t('app.subtitle')}</p>
      </div>
    </div>
  );

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="sidebar-toggle fixed left-3 top-3 z-50 xl:hidden"
        onClick={() => setIsOpen(true)}
        aria-label={t('layout.toggleMenu', 'Alternar menu')}
        aria-controls="app-sidebar"
      >
        <Menu className="h-4 w-4" />
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader>
            <SheetTitle className="sr-only">{t('layout.mainNavigation', 'Navegação principal')}</SheetTitle>
            {brand}
          </SheetHeader>
          {isOpen ? (
            <ScrollArea className="h-[calc(100vh-4rem)]">
              <NavItems
                sections={filteredSections}
                onNavigate={() => setIsOpen(false)}
                ariaLabel={t('layout.mainNavigation', 'Navegação principal')}
              />
            </ScrollArea>
          ) : null}
        </SheetContent>
      </Sheet>

      <aside
        id="app-sidebar"
        className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-border bg-card xl:flex xl:flex-col"
      >
        <div className="border-b border-border px-4 py-4">{brand}</div>
        <ScrollArea className="flex-1">
          <NavItems sections={filteredSections} ariaLabel={t('layout.mainNavigation', 'Navegação principal')} />
        </ScrollArea>
      </aside>
    </>
  );
}
