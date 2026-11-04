import { AlertTriangle, FlaskConical, Shield, Thermometer, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { KpiCard } from '../components/KpiCard';
import { PageHeader } from '../components/PageHeader';

export function DashboardPage() {
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Principal"
        title="Painel de Controle"
        subtitle="Visão operacional do biobanco — layout TailAdmin Sectioned com brand BioAvanceD"
        actions={
          <Link to="/next/intake" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Novo Cadastro
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Participantes" value="1.284" hint="+12 esta semana" tone="indigo" />
        <KpiCard icon={FlaskConical} label="Amostras ativas" value="8.431" hint="94% alocadas" tone="cyan" />
        <KpiCard icon={Thermometer} label="Alertas de temperatura" value="3" hint="1 crítico" tone="warning" />
        <KpiCard icon={Shield} label="TCLE pendentes" value="27" hint="fila de convites" tone="success" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card-surface">
          <h2 className="mb-3 text-base font-semibold">Atividade recente</h2>
          <ul className="space-y-2 text-sm">
            {['Intake SMP-2026-8841 publicado', 'Sensor Freezer-A02: -79,2 °C', 'TCLE v3 enviado a 14 participantes', 'CryoBox B3 posição D3 atribuída'].map((item) => (
              <li key={item} className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card-surface">
          <h2 className="mb-3 text-base font-semibold">Atalhos facility</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <Link to="/facility-management?tab=temperature" className="rounded-lg border border-border px-3 py-3 text-sm font-medium hover:bg-primary-soft">Temperatura</Link>
            <Link to="/facility-management?tab=equipment" className="rounded-lg border border-border px-3 py-3 text-sm font-medium hover:bg-primary-soft">CryoBox / Grid</Link>
            <Link to="/admin/tcle/new" className="rounded-lg border border-border px-3 py-3 text-sm font-medium hover:bg-primary-soft">Construtor TCLE</Link>
            <Link to="/samples" className="rounded-lg border border-border px-3 py-3 text-sm font-medium hover:bg-primary-soft">Inventário</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
