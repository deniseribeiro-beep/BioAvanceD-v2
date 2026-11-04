import { NavLink, useLocation } from 'react-router-dom';
import { SIDEBAR_SECTIONS } from '../catalog/routes';
import { cn } from '../lib/cn';
import logo from '../LOGO_BIOAVANCED_CORE.png';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const current = `${location.pathname}${location.search}`;

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-white">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <img src={logo} alt="" className="h-9 w-9 rounded-md object-contain" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">BioAvanceD</p>
          <p className="truncate text-xs text-muted-foreground">UI Gold Demo · Sectioned</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Menu principal">
        {SIDEBAR_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = current === item.path || current.startsWith(item.path);
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center rounded-md px-2.5 py-2 text-sm font-medium leading-snug text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary',
                        active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                      )}
                    >
                      <span className="line-clamp-2">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        Fase 0 · aprovação visual · {SIDEBAR_SECTIONS.reduce((n, s) => n + s.items.length, 0)} atalhos
      </div>
    </aside>
  );
}
