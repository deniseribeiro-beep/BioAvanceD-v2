import { useMemo } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { ChevronRight, LayoutDashboard, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import {
  CONSENT_SCOPES,
  FOUNDATION_CONTRACT_SUMMARY,
  ROLE_DEFINITIONS,
  SAMPLE_LIFECYCLE_STATUSES,
  STORAGE_BOX_STATUSES,
  STORAGE_CONTAINER_TYPES,
  LEGACY_SAMPLE_STATUS_LABELS,
  USER_STATUSES,
} from './contracts';

const foundationRoutes = [
  { path: '/next', label: 'Visão geral', icon: LayoutDashboard },
  { path: '/next/contracts', label: 'Contratos', icon: ShieldCheck },
  { path: '/next/intake', label: 'Cadastro Integrado', icon: Workflow },
];

function FoundationShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="foundation-shell">
      <div className="foundation-shell__glow foundation-shell__glow--left" />
      <div className="foundation-shell__glow foundation-shell__glow--right" />
      <aside className="foundation-sidebar">
        <div className="foundation-brand">
          <div className="foundation-brand__mark">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="foundation-eyebrow">Strangler Pattern</p>
            <h1>Nova fundação</h1>
          </div>
        </div>

        <p className="foundation-sidebar__copy">
          Base paralela para substituir o legado rota por rota, preservando regras e contratos do backend.
        </p>

        <nav className="foundation-nav" aria-label="Rotas da nova fundação">
          {foundationRoutes.map((route) => {
            const Icon = route.icon;
            return (
              <NavLink
                key={route.path}
                to={route.path}
                end={route.path === '/next'}
                className={({ isActive }) => `foundation-nav__item ${isActive ? 'is-active' : ''}`}
              >
                <Icon size={16} />
                <span>{route.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="foundation-sidebar__note">
          <p>Primeiro corte</p>
          <strong>/next</strong>
          <span>Sem alterar o fluxo antigo.</span>
        </div>
      </aside>

      <main className="foundation-main">
        <header className="foundation-topbar">
          <div>
            <p className="foundation-eyebrow">BioAvanceD</p>
            <h2>Interface nova, contrato antigo intacto</h2>
          </div>
          <div className="foundation-topbar__status">
            <span className="foundation-pill">Base em construção</span>
            <span className="foundation-pill foundation-pill--muted">Legacy preservado</span>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}

function FoundationOverviewPage() {
  const summaryCards = useMemo(
    () => [
      { label: 'Perfis de acesso', value: FOUNDATION_CONTRACT_SUMMARY.roles, detail: 'Com hierarquia alinhada ao backend' },
      { label: 'Escopos de consentimento', value: FOUNDATION_CONTRACT_SUMMARY.consentScopes, detail: 'LGPD + operação clínica' },
      { label: 'Status de amostra', value: FOUNDATION_CONTRACT_SUMMARY.sampleStatuses, detail: 'Ciclo de vida canônico' },
      { label: 'Tipos de armazenamento', value: FOUNDATION_CONTRACT_SUMMARY.storageTypes, detail: 'Estrutura física padronizada' },
    ],
    [],
  );

  return (
    <section className="foundation-page">
      <section className="foundation-hero">
        <div className="foundation-hero__content">
          <p className="foundation-eyebrow">Nova base do frontend</p>
          <h3>Fundação limpa para migrar o legado sem ruptura</h3>
          <p>
            Esta camada nasce ao lado da interface atual e consome os mesmos contratos que o backend já consolidou.
            A migração passa a ser incremental, previsível e testável.
          </p>

          <div className="foundation-hero__actions">
            <NavLink className="foundation-button" to="contracts">
              Ver contratos
              <ChevronRight size={16} />
            </NavLink>
            <NavLink className="foundation-button foundation-button--ghost" to="/patients">
              Abrir pacientes
            </NavLink>
          </div>
        </div>

        <div className="foundation-hero__panel">
          <div className="foundation-panel__label">Objetivo desta etapa</div>
          <ul>
            <li>não remover telas antigas</li>
            <li>alinhar contratos de domínio</li>
            <li>preparar substituição rota por rota</li>
          </ul>
        </div>
      </section>

      <section className="foundation-grid foundation-grid--summary">
        {summaryCards.map((card) => (
          <article key={card.label} className="foundation-card foundation-card--metric">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="foundation-grid foundation-grid--targets">
        <article className="foundation-card">
          <p className="foundation-card__eyebrow">Próximos alvos</p>
          <h4>Primeira onda de migração</h4>
          <div className="foundation-targets">
            <NavLink key="contracts" to="contracts" className="foundation-targets__item">
              <span>Consentimento</span>
              <ChevronRight size={14} />
            </NavLink>
            <div className="foundation-targets__item">
              <span>Pacientes</span>
              <small>Operação consolidada em /patients</small>
            </div>
            <div className="foundation-targets__item">
              <span>Amostras</span>
              <small>Operação consolidada em /samples</small>
            </div>
          </div>
        </article>

        <article className="foundation-card">
          <p className="foundation-card__eyebrow">Base compartilhada</p>
          <h4>Catálogo de contratos ativo</h4>
          <div className="foundation-tags">
            {ROLE_DEFINITIONS.map((role) => (
              <span key={role.value} className="foundation-tag">{role.label} #{role.accessType}</span>
            ))}
            {USER_STATUSES.map((status) => (
              <span key={status.value} className="foundation-tag foundation-tag--soft">{status.label}</span>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}

function ContractsPage() {
  return (
    <section className="foundation-page">
      <div className="foundation-page__header">
        <div>
          <p className="foundation-eyebrow">Contratos canônicos</p>
          <h3>Domínio centralizado</h3>
          <p>Esses valores espelham os enums, status e escopos consolidados no backend.</p>
        </div>
      </div>

      <div className="foundation-contract-layout">
        <article className="foundation-card">
          <h4>Perfis de acesso</h4>
          <div className="foundation-table">
            {ROLE_DEFINITIONS.map((role) => (
              <div key={role.value} className="foundation-table__row">
                <span>{role.label}</span>
                <span>AccessType {role.accessType}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="foundation-card">
          <h4>Status e armazenamento</h4>
          <div className="foundation-stack">
            <div>
              <strong>Status de usuário</strong>
              <div className="foundation-tags">
                {USER_STATUSES.map((status) => (
                  <span key={status.value} className="foundation-tag">{status.label}</span>
                ))}
              </div>
            </div>
            <div>
              <strong>Ciclo de vida de amostras</strong>
              <div className="foundation-tags">
                {SAMPLE_LIFECYCLE_STATUSES.map((status) => (
                  <span key={status.value} className="foundation-tag foundation-tag--soft">
                    {status.label} / {LEGACY_SAMPLE_STATUS_LABELS[status.value]}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <strong>Armazenamento</strong>
              <div className="foundation-tags">
                {STORAGE_CONTAINER_TYPES.map((type) => (
                  <span key={type.value} className="foundation-tag">{type.label}</span>
                ))}
                {STORAGE_BOX_STATUSES.map((status) => (
                  <span key={status.value} className="foundation-tag foundation-tag--soft">{status.label}</span>
                ))}
              </div>
            </div>
          </div>
        </article>

        <article className="foundation-card foundation-card--full">
          <h4>Escopos de consentimento</h4>
          <div className="foundation-scope-list">
            {CONSENT_SCOPES.map((scope) => (
              <div key={scope.key} className="foundation-scope-item">
                <div>
                  <strong>{scope.label}</strong>
                  <p>{scope.description}</p>
                </div>
                <span className={`foundation-pill foundation-pill--${scope.riskLevel}`}>{scope.riskLevel}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

export default function FoundationApp() {
  return (
    <FoundationShell>
      <Routes>
        <Route index element={<FoundationOverviewPage />} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route path="*" element={<Navigate to="/next" replace />} />
      </Routes>
    </FoundationShell>
  );
}
