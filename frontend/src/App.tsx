import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
const EConsentPage = lazy(() => import('./pages/patient/EConsentPage'));
const EConsentImportPage = lazy(() => import('./pages/patient/EConsentImportPage'));
const EConsentLinkPanel = lazy(() => import('./pages/patient/EConsentLinkPanel'));

const LoginPage = lazy(() => import('./views/LoginPage'));
const Dashboard = lazy(() => import('./views/Dashboard'));
const PatientsPage = lazy(() => import('./views/PatientsPage'));
const FhirImportPage = lazy(() => import('./views/FhirImportPage'));
const ImportQuarantinePage = lazy(() => import('./views/ImportQuarantinePage'));
const ImportLGPDPage = lazy(() => import('./views/ImportLGPDPage'));
const ConsentTokenPage = lazy(() => import('./pages/patient/ConsentTokenPage'));
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
const ReportTemplatesPage = lazy(() => import('./views/ReportTemplatesPage'));
const QualityDescriptionPage = lazy(() => import('./views/QualityDescriptionPage'));
const ImportForm = lazy(() => import('./components/v2/ImportForm'));
const BackupPage = lazy(() => import('./views/BackupPage'));
const UserSecurityPage = lazy(() => import('./views/UserSecurityPage'));
const MFASetupPage = lazy(() => import('./views/MFASetupPage'));
const ResetPasswordPage = lazy(() => import('./views/ResetPasswordPage'));
const SettingsParametersPage = lazy(() => import('./views/SettingsParametersPage'));
const DataDictionaryPage = lazy(() => import('./views/DataDictionaryPage'));
const TcleBuilderPage = lazy(() => import('./views/TcleBuilderPage'));
const AccessRequestsPage = lazy(() => import('./views/AccessRequestsPage'));
const ConsentHistoryPage = lazy(() => import('./views/ConsentHistoryPage'));
const BiomarkerAssociationsPage = lazy(() => import('./views/BiomarkerAssociationsPage'));
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
          <Route path="/patient/e-consent/import/:token" element={<EConsentImportPage />} />
          {/* #809: the bulk consent-token link (buildConsentLink) lands here. The
              64-char token in the query string IS the credential, exactly as the
              JWT is for /patient/e-consent/:token above -- a participant following
              an emailed invitation has no account to log into, so this route must
              stay outside ProtectedRoute. It previously pointed at EConsentPage
              (an alias import of the JWT page) behind ProtectedRoute, which read
              its token from a route param this URL does not have. */}
          <Route path="/patients/:id/consent" element={<ConsentTokenPage />} />
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
          {/* Sample static paths must be registered before /samples/:id or
              withdrawal-return / custody-reports are captured as an :id. */}
          <Route
            path="/samples/withdrawal-return"
            element={
              <Layout>
                <ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}>
                  <SampleWithdrawalReturnPage />
                </ProtectedRoute>
              </Layout>
            }
          />
          <Route
            path="/samples/custody-reports"
            element={
              <Layout>
                <ProtectedRoute>
                  <SampleCustodyReportsPage />
                </ProtectedRoute>
              </Layout>
            }
          />
          <Route
            path="/samples/:id/label"
            element={
              <Layout>
                <ProtectedRoute>
                  <SampleLabelPage />
                </ProtectedRoute>
              </Layout>
            }
          />
          <Route
            path="/samples/:id/chain"
            element={
              <Layout>
                <ProtectedRoute>
                  <SampleChainPage />
                </ProtectedRoute>
              </Layout>
            }
          />
          <Route
            path="/samples/:id/movements"
            element={
              <Layout>
                <ProtectedRoute>
                  <SampleMovementsPage />
                </ProtectedRoute>
              </Layout>
            }
          />
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
                  <Route path="/locations" element={<Navigate to="/facility-management?tab=equipment" replace />} />
                  <Route path="/temperature" element={<Navigate to="/facility-management?tab=temperature" replace />} />
                  <Route path="/sensors" element={<Navigate to="/facility-management?tab=sensors" replace />} />
                  <Route path="/policies" element={<Navigate to="/facility-management?tab=policies" replace />} />
                  <Route path="/logs" element={<ProtectedRoute requireAuditReader><LogsPage /></ProtectedRoute>} />
                  <Route path="/logs/:id" element={<ProtectedRoute requireAuditReader><LogDetailPage /></ProtectedRoute>} />
                  <Route path="/reports" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo']}><ReportsPage /></ProtectedRoute>} />
                  {/* #726 (RF008 AC#6): template management is Coordenador+Administrador
                      only (manageReportTemplates), narrower than /reports' own view-only gate. */}
                  <Route path="/reports/templates" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador']}><ReportTemplatesPage /></ProtectedRoute>} />
                  <Route path="/reports/query/:type" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo']}><ReportQueryPage /></ProtectedRoute>} />
                  <Route path="/reports/:id" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo']}><ReportViewPage /></ProtectedRoute>} />
                  <Route path="/quality-descriptions" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><QualityDescriptionPage /></ProtectedRoute>} />
                  {/* #808: the LGPD import's own surface. `/import` posts to the
                      *async* importer; #813 landed, so that importer now
                      quarantines its rejected rows too, into
                      import_staging_records with type ASYNC_BATCH_IMPORT. This
                      posts to the LGPD importer, whose batches are the ones
                      ImportQuarantinePage actually lists -- that page calls
                      /import-lgpd/batches, which filters to LGPD quarantine
                      types, so async batches are quarantined but not yet
                      listable (#950). (RNF011 AC#4 / RF029 AC#6.) Same roles as
                      /import and /import/quarantine -- the backend gates the two
                      import routes on createPatient/createSample respectively,
                      which these three roles hold. */}
                  <Route
                    path="/import/lgpd"
                    element={
                      <ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}>
                        <ImportLGPDPage />
                      </ProtectedRoute>
                    }
                  />
                  {/* #794 item 2 (RNF011 AC#4): the quarantine review surface.
                      Same roles as /import — the backend gates both the list
                      and the batch read on createSample, which is the
                      permission the import itself requires. */}
                  <Route
                    path="/import/quarantine"
                    element={
                      <ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}>
                        <ImportQuarantinePage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/import"
                    element={
                      <ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}>
                        <ImportForm />
                      </ProtectedRoute>
                    }
                  />
                  {/* RF024 (#1350): the backend gates every access-request route on manageAccessRequests, which only Administrador holds. */}
                  <Route path="/access-requests" element={<ProtectedRoute requiredRole="Administrador"><AccessRequestsPage /></ProtectedRoute>} />
                  <Route path="/consents" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador']}><ConsentHistoryPage /></ProtectedRoute>} />
                  {/* ELM-0275..0285 (#1402): BiomarkerAssociation entry, behind the backend's requireRole(3, 4). */}
                  <Route path="/biomarker-associations" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador']}><BiomarkerAssociationsPage /></ProtectedRoute>} />
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

