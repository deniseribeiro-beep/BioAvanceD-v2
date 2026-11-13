import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DemoShell } from './layout/DemoShell';
import { DashboardPage } from './pages/DashboardPage';
import { FacilityPage } from './pages/FacilityPage';
import { GenericScreen } from './pages/GenericScreen';
import { IndexPage } from './pages/IndexPage';
import { LoginPage } from './pages/LoginPage';
import { TcleBuilderPage } from './pages/TcleBuilderPage';

function AuthShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth / público — fora do shell app */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/mfa-setup" element={<AuthShell><GenericScreen title="Configurar MFA" eyebrow="Auth" /></AuthShell>} />
        <Route path="/reset-password" element={<AuthShell><GenericScreen title="Redefinir senha" eyebrow="Auth" /></AuthShell>} />
        <Route path="/patient/e-consent" element={<AuthShell><GenericScreen title="Painel e-Consent" eyebrow="Público" /></AuthShell>} />
        <Route path="/patient/e-consent/:token" element={<AuthShell><GenericScreen title="Aceite do participante" eyebrow="Público" /></AuthShell>} />
        <Route path="/patient/e-consent/import/:token" element={<AuthShell><GenericScreen title="Importação de consentimento" eyebrow="Público" /></AuthShell>} />
        <Route path="/patients/:id/consent" element={<AuthShell><GenericScreen title="Consent token page" eyebrow="Público" /></AuthShell>} />

        <Route element={<DemoShell />}>
          <Route path="/" element={<IndexPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/next" element={<GenericScreen title="Foundation Overview" />} />
          <Route path="/next/contracts" element={<GenericScreen title="Foundation Contracts" />} />
          <Route path="/next/intake" element={<GenericScreen title="Novo Cadastro (Intake)" subtitle="Wizard demografia → pré-analítica → biomarcadores/TCLE" />} />
          <Route path="/patients" element={<GenericScreen title="Diretório de Pacientes" />} />
          <Route path="/patients/import-fhir" element={<GenericScreen title="Importação FHIR" />} />

          <Route path="/samples" element={<GenericScreen title="Inventário de Amostras" />} />
          <Route path="/samples/withdrawal-return" element={<GenericScreen title="Retirada e Devolução" />} />
          <Route path="/samples/custody-reports" element={<GenericScreen title="Relatórios de Custódia" />} />
          <Route path="/samples/:id" element={<GenericScreen title="Detalhes da Amostra" />} />
          <Route path="/samples/:id/label" element={<GenericScreen title="Etiqueta da Amostra" />} />
          <Route path="/samples/:id/chain" element={<GenericScreen title="Cadeia de Custódia" />} />
          <Route path="/samples/:id/movements" element={<GenericScreen title="Movimentações" />} />
          <Route path="/results" element={<GenericScreen title="Arquivos de Análise" />} />
          <Route path="/quality-descriptions" element={<GenericScreen title="Descrições de Qualidade" />} />

          <Route path="/facility-management" element={<FacilityPage />} />

          <Route path="/admin/tcle/new" element={<TcleBuilderPage />} />
          <Route path="/admin/tcle/edit/:templateId" element={<TcleBuilderPage />} />
          <Route path="/consents" element={<GenericScreen title="Consentimentos (TCLE)" />} />
          <Route path="/biomarker-associations" element={<GenericScreen title="Associações de Biomarcadores" />} />
          <Route path="/access-requests" element={<GenericScreen title="Solicitações de Acesso" />} />

          <Route path="/patients/import-fhir" element={<GenericScreen title="Importação em lote" />} />
          <Route path="/import/lgpd" element={<Navigate to="/patients/import-fhir" replace />} />
          <Route path="/import/quarantine" element={<GenericScreen title="Quarentena de Importação" />} />
          <Route path="/import" element={<Navigate to="/patients/import-fhir" replace />} />

          <Route path="/reports" element={<GenericScreen title="Central de Relatórios" />} />
          <Route path="/reports/templates" element={<GenericScreen title="Modelos de Relatório" />} />
          <Route path="/reports/query/:type" element={<GenericScreen title="Consulta de Relatório" />} />
          <Route path="/reports/:id" element={<GenericScreen title="Visualizar Relatório" />} />
          <Route path="/logs" element={<GenericScreen title="Logs de Auditoria" />} />
          <Route path="/logs/:id" element={<GenericScreen title="Detalhe do Log" />} />

          <Route path="/system-management" element={<GenericScreen title="Gerenciamento do Sistema" subtitle="Use ?tab=users|organizations|collections|security" />} />
          <Route path="/users/new" element={<GenericScreen title="Novo Usuário" />} />
          <Route path="/users/new/success" element={<GenericScreen title="Usuário Criado" />} />
          <Route path="/users" element={<Navigate to="/system-management?tab=users" replace />} />
          <Route path="/security" element={<Navigate to="/system-management?tab=security" replace />} />
          <Route path="/backup" element={<GenericScreen title="Backup" />} />
          <Route path="/settings/parameters" element={<GenericScreen title="Parâmetros" />} />
          <Route path="/admin/dicionario" element={<GenericScreen title="Dicionário de Dados" />} />
          <Route path="/admin/dictionary" element={<Navigate to="/admin/dicionario" replace />} />
          <Route path="/user/security" element={<GenericScreen title="Segurança do Usuário" />} />
          <Route path="/security/mfa-setup" element={<GenericScreen title="MFA (autenticado)" />} />

          {/* aliases facility */}
          <Route path="/temperature" element={<Navigate to="/facility-management?tab=temperature" replace />} />
          <Route path="/sensors" element={<Navigate to="/facility-management?tab=sensors" replace />} />
          <Route path="/policies" element={<Navigate to="/facility-management?tab=policies" replace />} />
          <Route path="/equipment" element={<Navigate to="/facility-management?tab=equipment" replace />} />
          <Route path="/locations" element={<Navigate to="/facility-management?tab=equipment" replace />} />

          <Route path="*" element={<GenericScreen title="Rota não catalogada" subtitle="Adicione ao catálogo se for tela do sistema" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
