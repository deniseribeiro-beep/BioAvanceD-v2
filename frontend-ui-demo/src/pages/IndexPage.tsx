import { Link } from 'react-router-dom';
import { DEMO_ROUTES, groupRoutes } from '../catalog/routes';
import { PageHeader } from '../components/PageHeader';

export function IndexPage() {
  const groups = groupRoutes();

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Fase 0"
        title="Mapa completo de telas"
        subtitle={`${DEMO_ROUTES.length} rotas de tela para aprovação visual antes do deploy. Percorra cada uma pelo índice ou pela sidebar.`}
      />
      {[...groups.entries()].map(([group, routes]) => (
        <section key={group} className="card-surface">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {routes.map((route) => (
              <li key={route.path}>
                <Link
                  to={route.path}
                  className="block rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary-soft"
                >
                  <span className="block text-sm font-medium text-foreground">
                    {route.title}
                    {route.highlight ? <span className="ml-2 text-[10px] font-semibold uppercase text-brand-cyan">destaque</span> : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{route.description}</span>
                  <span className="mt-1 block font-mono text-[11px] text-primary">{route.path}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
