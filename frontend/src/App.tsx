import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

const EConsentPage = lazy(() => import('./pages/patient/EConsentPage'));
const EConsentLinkPanel = lazy(() => import('./pages/patient/EConsentLinkPanel'));

const LoginPage = lazy(() => import('./views/LoginPage'));
const Dashboard = lazy(() => import('./views/Dashboard'));
const PatientsPage = lazy(() => import('./views/PatientsPage'));
const FhirImportPage = lazy(() => import('./views/FhirImportPage'));
const ConsentPage = lazy(() => import('./views/ConsentPage'));
const SamplesPage = lazy(() => import('./views/SamplesPage'));
const SampleDetailsPage = lazy(() => import('./views/SampleDetailsPage'));
const ResultsPage = lazy(() => import('./views/ResultsPage'));
const NewUserPage = lazy(() => import('./views/NewUserPage'));
const NewUserSuccessPage = lazy(() => import('./views/NewUserSuccessPage'));
const LogsPage = lazy(() => import('./views/LogsPage'));
const LogDetailPage = lazy(() => import('./views/LogDetailPage'));
const SampleLabelPage = lazy(() => import('./views/SampleLabelPage'));
const SampleChainPage = lazy(() => import('./views/SampleChainPage'));
const SampleMovementsPage = lazy(() => import('./views/SampleMovementsPage'));
const SampleWithdrawalReturnPage = lazy(() => import('./views/SampleWithdrawalReturnPage'));
const SampleCustodyReportsPage = lazy(() => import('./views/SampleCustodyReportsPage'));
const FacilityManagementPage = lazy(() => import('./views/FacilityManagementPage'));
const SystemManagementPage = lazy(() => import('./views/SystemManagementPage'));
const ReportsPage = lazy(() => import('./views/ReportsPage'));
const ReportViewPage = lazy(() => import('./views/ReportViewPage'));
const ReportQueryPage = lazy(() => import('./views/ReportQueryPage'));
const QualityDescriptionPage = lazy(() => import('./views/QualityDescriptionPage'));
const ImportForm = lazy(() => import('./components/v2/ImportForm'));
const AssistantPage = lazy(() => import('./views/AssistantPage'));
const BackupPage = lazy(() => import('./views/BackupPage'));
const UserSecurityPage = lazy(() => import('./views/UserSecurityPage'));
const MFASetupPage = lazy(() => import('./views/MFASetupPage'));
const ResetPasswordPage = lazy(() => import('./views/ResetPasswordPage'));
const SettingsParametersPage = lazy(() => import('./views/SettingsParametersPage'));
const DataDictionaryPage = lazy(() => import('./views/DataDictionaryPage'));
const TcleBuilderPage = lazy(() => import('./views/TcleBuilderPage'));
const FoundationApp = lazy(() => import('./foundation/FoundationApp'));
const IntakeWizardPage = lazy(() => import('./pages/v2/intake/IntakeWizardPage'));

function App() {
  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Suspense fallback={<div>Carregando...</div>}>
        <Routes>
          <Route path="/patient/e-consent" element={<EConsentLinkPanel />} />
          <Route path="/patient/e-consent/:token" element={<EConsentPage />} />
          <Route
            path="/next/intake"
            element={
              <Layout>
                <ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}>
                  <IntakeWizardPage />
                </ProtectedRoute>
              </Layout>
            }
          />
          <Route path="/pacientes/novo-atendimento" element={<Navigate to="/next/intake" replace />} />
          <Route path="/next/*" element={<FoundationApp />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mfa-setup" element={<MFASetupPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/samples/:id"
            element={
              <Layout>
                <ProtectedRoute>
                  <SampleDetailsPage />
                </ProtectedRoute>
              </Layout>
            }
          />
          <Route
            path="/*"
            element={
              <Layout>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                  <Route path="/patients" element={<ProtectedRoute><PatientsPage /></ProtectedRoute>} />
                  <Route path="/patients/import-fhir" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><FhirImportPage /></ProtectedRoute>} />
                  <Route path="/import/fhir" element={<Navigate to="/patients/import-fhir" replace />} />
                  <Route path="/patients/:id/consent" element={<ProtectedRoute><ConsentPage /></ProtectedRoute>} />
                  <Route path="samples/custody-reports" element={<ProtectedRoute><SampleCustodyReportsPage /></ProtectedRoute>} />
                  <Route path="samples/withdrawal-return" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><SampleWithdrawalReturnPage /></ProtectedRoute>} />
                  <Route path="samples/:id/label" element={<ProtectedRoute><SampleLabelPage /></ProtectedRoute>} />
                  <Route path="samples/:id/chain" element={<ProtectedRoute><SampleChainPage /></ProtectedRoute>} />
                  <Route path="samples/:id/movements" element={<ProtectedRoute><SampleMovementsPage /></ProtectedRoute>} />
                  <Route path="samples/:id" element={<ProtectedRoute><SampleDetailsPage /></ProtectedRoute>} />
                  {/* Rota de Nova Amostra removida. Cadastro de amostras agora é feito apenas via Intake Wizard. */}
                  <Route path="samples" element={<ProtectedRoute><SamplesPage /></ProtectedRoute>} />
                  <Route path="/results" element={<ProtectedRoute><ResultsPage /></ProtectedRoute>} />
                  <Route path="/system-management" element={<ProtectedRoute requiredRole="Administrador"><SystemManagementPage /></ProtectedRoute>} />
                  <Route path="/users" element={<Navigate to="/system-management?tab=users" replace />} />
                  <Route path="/access" element={<Navigate to="/system-management?tab=users" replace />} />
                  <Route path="/security" element={<Navigate to="/system-management?tab=security" replace />} />
                  <Route path="/users/new" element={<ProtectedRoute requiredRole="Administrador"><NewUserPage /></ProtectedRoute>} />
                  <Route path="/users/new/success" element={<ProtectedRoute requiredRole="Administrador"><NewUserSuccessPage /></ProtectedRoute>} />
                  <Route path="/facility-management" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><FacilityManagementPage /></ProtectedRoute>} />
                  <Route path="/equipment" element={<Navigate to="/facility-management?tab=equipment" replace />} />
                  <Route path="/locations" element={<Navigate to="/facility-management?tab=locations" replace />} />
                  <Route path="/temperature" element={<Navigate to="/facility-management?tab=temperature" replace />} />
                  <Route path="/sensors" element={<Navigate to="/facility-management?tab=sensors" replace />} />
                  <Route path="/policies" element={<Navigate to="/facility-management?tab=policies" replace />} />
                  <Route path="/logs" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador']}><LogsPage /></ProtectedRoute>} />
                  <Route path="/logs/:id" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador']}><LogDetailPage /></ProtectedRoute>} />
                  <Route path="/reports" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Usuário Externo']}><ReportsPage /></ProtectedRoute>} />
                  <Route path="/reports/query/:type" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Usuário Externo']}><ReportQueryPage /></ProtectedRoute>} />
                  <Route path="/reports/:id" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Usuário Externo']}><ReportViewPage /></ProtectedRoute>} />
                  <Route path="/quality-descriptions" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><QualityDescriptionPage /></ProtectedRoute>} />
                  <Route
                    path="/import"
                    element={
                      <ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}>
                        <ImportForm onSuccess={() => {}} onError={() => {}} />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/assistant" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo']}><AssistantPage /></ProtectedRoute>} />
                  <Route path="/admin/tcle/new" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador']}><TcleBuilderPage /></ProtectedRoute>} />
                  <Route path="/admin/tcle/edit/:templateId" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador']}><TcleBuilderPage /></ProtectedRoute>} />
                  <Route path="/backup" element={<ProtectedRoute requiredRole="Administrador"><BackupPage /></ProtectedRoute>} />
                  <Route path="/settings/parameters" element={<ProtectedRoute requiredRole="Administrador"><SettingsParametersPage /></ProtectedRoute>} />
                  <Route path="/admin/dicionario" element={<ProtectedRoute requiredRole="Administrador"><DataDictionaryPage /></ProtectedRoute>} />
                  <Route path="/admin/dictionary" element={<Navigate to="/admin/dicionario" replace />} />
                  <Route path="/admin/master-data" element={<Navigate to="/admin/dicionario" replace />} />
                  <Route path="/user/security" element={<ProtectedRoute><UserSecurityPage /></ProtectedRoute>} />
                  <Route path="/security/mfa-setup" element={<ProtectedRoute><MFASetupPage /></ProtectedRoute>} />
                </Routes>
              </Layout>
            }
          />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;

