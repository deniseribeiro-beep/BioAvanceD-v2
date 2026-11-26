import { DEMO_ROUTES } from '../catalog/routes';
import { PageHeader } from '../components/PageHeader';
import { useLocation } from 'react-router-dom';

function findRoute(pathname: string, search: string) {
  const full = `${pathname}${search}`;
  return (
    DEMO_ROUTES.find((r) => r.path === full)
    || DEMO_ROUTES.find((r) => r.path === pathname)
    || DEMO_ROUTES.find((r) => pathname.startsWith(r.path.split('?')[0]) && r.path.includes(':') === false)
  );
}

export function GenericScreen({
  title,
  subtitle,
  eyebrow,
  children,
}: {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  children?: React.ReactNode;
}) {
  const location = useLocation();
  const meta = findRoute(location.pathname, location.search);

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow={eyebrow || meta?.group || 'Tela'}
        title={title || meta?.title || location.pathname}
        subtitle={subtitle || meta?.description || 'Mock visual TailAdmin Sectioned · BioAvanceD'}
      />
      {children || (
        <div className="card-surface space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {['Filtro A', 'Filtro B', 'Ação principal'].map((label) => (
              <div key={label} className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {label}
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Coluna 1</th>
                  <th className="px-2 py-2 font-medium">Coluna 2</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((n) => (
                  <tr key={n} className="border-b border-border/70">
                    <td className="px-2 py-2.5">Item {n}</td>
                    <td className="px-2 py-2.5">Valor demonstrativo</td>
                    <td className="px-2 py-2.5"><span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">Ativo</span></td>
                    <td className="px-2 py-2.5">
                      <button type="button" className="rounded-md border border-border px-2 py-1 text-xs">Abrir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-xs text-muted-foreground">rota: {location.pathname}{location.search}</p>
        </div>
      )}
    </div>
  );
}
