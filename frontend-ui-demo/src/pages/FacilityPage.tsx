import { AlertCircle, Box, Radio, Shield, Thermometer } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { CryoBoxGridMock } from '../components/CryoBoxGridMock';
import { PageHeader } from '../components/PageHeader';
import { cn } from '../lib/cn';

const TABS = [
  { id: 'equipment', label: 'Equipamentos', icon: Box },
  { id: 'temperature', label: 'Temperatura', icon: Thermometer },
  { id: 'history', label: 'Histórico', icon: AlertCircle },
  { id: 'incidents', label: 'Incidentes', icon: AlertCircle },
  { id: 'sensors', label: 'Sensores', icon: Radio },
  { id: 'policies', label: 'Políticas', icon: Shield },
] as const;

export function FacilityPage() {
  const [params] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'equipment';

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Facility"
        title="Gerenciamento de Instalações"
        subtitle="Temperatura, sensores, políticas e grid de localização de amostras (CryoBox)"
      />

      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-white p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Link
            key={id}
            to={`/facility-management?tab=${id}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground',
              tab === id && 'bg-primary text-primary-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </div>

      {tab === 'equipment' ? (
        <div className="space-y-4">
          <div className="card-surface overflow-x-auto">
            <h3 className="mb-3 text-base font-semibold">Equipamentos</h3>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">ID</th>
                  <th className="px-2 py-2 font-medium">Nome</th>
                  <th className="px-2 py-2 font-medium">Tipo</th>
                  <th className="px-2 py-2 font-medium">Setpoint</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['FZ-A02', 'Freezer -80 Sala A', 'Ultra-low', '-80 °C', 'OK'],
                  ['LN-B01', 'Tanque N2 Banco B', 'LN2', '-196 °C', 'OK'],
                  ['RF-C03', 'Geladeira 4 °C', 'Fridge', '4 °C', 'Alerta'],
                ].map((row) => (
                  <tr key={row[0]} className="border-b border-border/60">
                    {row.map((cell) => (
                      <td key={cell} className="px-2 py-2.5">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CryoBoxGridMock />
        </div>
      ) : null}

      {tab === 'temperature' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card-surface lg:col-span-2">
            <h3 className="mb-2 text-base font-semibold">Controle de temperatura</h3>
            <p className="mb-4 text-sm text-muted-foreground">Leituras mock das últimas 24 h — visual para aprovação de layout</p>
            <div className="flex h-48 items-end gap-2 rounded-lg bg-primary-soft/50 p-4">
              {[62, 58, 55, 70, 66, 60, 72, 68, 64, 59, 63, 67].map((h, i) => (
                <div key={i} className="flex-1 rounded-t bg-primary" style={{ height: `${h}%` }} title={`-8${i % 3}.${i} °C`} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Eixo Y relativo · Freezer FZ-A02</p>
          </div>
          <div className="space-y-4">
            <div className="card-surface">
              <p className="text-sm text-muted-foreground">Atual</p>
              <p className="text-3xl font-semibold text-primary">-79,4 °C</p>
              <p className="mt-1 text-xs text-success">Dentro da faixa (-82 a -78)</p>
            </div>
            <div className="card-surface">
              <p className="text-sm font-medium">Alertas ativos</p>
              <ul className="mt-2 space-y-2 text-sm">
                <li className="rounded-md border border-warning/30 bg-amber-50 px-2 py-1.5 text-warning">RF-C03 acima de 6 °C</li>
                <li className="rounded-md border border-border px-2 py-1.5">FZ-A02 nominal</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'history' ? (
        <div className="card-surface overflow-x-auto">
          <h3 className="mb-3 text-base font-semibold">Histórico de leituras</h3>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b text-muted-foreground"><tr><th className="py-2 text-left">Quando</th><th className="text-left">Sensor</th><th className="text-left">Valor</th></tr></thead>
            <tbody>
              {['10:42 FZ-A02 -79.4°C', '10:40 RF-C03 6.8°C', '10:38 LN-B01 -195.2°C'].map((line) => {
                const [t, s, v] = line.split(' ');
                return <tr key={line} className="border-b"><td className="py-2">{t}</td><td>{s}</td><td>{v}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'incidents' ? (
        <div className="card-surface space-y-2">
          <h3 className="text-base font-semibold">Incidentes</h3>
          <div className="rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-sm text-danger">INC-104 · Desvio térmico RF-C03 · aberto</div>
          <div className="rounded-lg border border-border px-3 py-2 text-sm">INC-098 · Porta FZ-A02 · resolvido</div>
        </div>
      ) : null}

      {tab === 'sensors' ? (
        <div className="card-surface overflow-x-auto">
          <h3 className="mb-3 text-base font-semibold">Sensores</h3>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-b text-muted-foreground"><tr><th className="py-2 text-left">Key</th><th className="text-left">Equipamento</th><th className="text-left">Estado</th></tr></thead>
            <tbody>
              {[['sns-fz-a02', 'FZ-A02', 'online'], ['sns-rf-c03', 'RF-C03', 'online'], ['sns-ln-b01', 'LN-B01', 'online']].map((r) => (
                <tr key={r[0]} className="border-b"><td className="py-2 font-mono text-xs">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'policies' ? (
        <div className="card-surface space-y-3">
          <h3 className="text-base font-semibold">Políticas de temperatura</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3 text-sm"><strong>ULF padrão</strong><p className="text-muted-foreground">-82 a -78 °C · alerta 15 min</p></div>
            <div className="rounded-lg border border-border p-3 text-sm"><strong>Fridge 4 °C</strong><p className="text-muted-foreground">2 a 6 °C · alerta 10 min</p></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
