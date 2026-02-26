import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './views/LoginPage';
import Dashboard from './views/Dashboard';
import PatientsPage from './views/PatientsPage';
import NewPatientPage from './views/NewPatientPage';
import ConsentPage from './views/ConsentPage';
import SamplesPage from './views/SamplesPage';
import SampleDetailsPage from './views/SampleDetailsPage';
import NewSamplePage from './views/NewSamplePage';
import ResultsPage from './views/ResultsPage';
import NewUserPage from './views/NewUserPage';
import NewUserSuccessPage from './views/NewUserSuccessPage';
import LogsPage from './views/LogsPage';
import LogDetailPage from './views/LogDetailPage';
import SampleLabelPage from './views/SampleLabelPage';
import SampleChainPage from './views/SampleChainPage';
import SampleMovementsPage from './views/SampleMovementsPage';
import SampleWithdrawalReturnPage from './views/SampleWithdrawalReturnPage';
import SampleCustodyReportsPage from './views/SampleCustodyReportsPage';
import FacilityManagementPage from './views/FacilityManagementPage';
import SystemManagementPage from './views/SystemManagementPage';
import ReportsPage from './views/ReportsPage';
import ReportViewPage from './views/ReportViewPage';
import ReportQueryPage from './views/ReportQueryPage';
import QualityDescriptionPage from './views/QualityDescriptionPage';
import ImportPage from './views/ImportPage';
import AssistantPage from './views/AssistantPage';
import BackupPage from './views/BackupPage';
import UserSecurityPage from './views/UserSecurityPage';
import MFASetupPage from './views/MFASetupPage';
import ResetPasswordPage from './views/ResetPasswordPage';
import SettingsParametersPage from './views/SettingsParametersPage';
import ConsentManager from './views/ConsentManager';
import './App.css';

function App() {
  return (
    <Router
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/mfa-setup" element={<MFASetupPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/patients" element={<ProtectedRoute><PatientsPage /></ProtectedRoute>} />
                <Route path="/patients/new" element={<ProtectedRoute><NewPatientPage /></ProtectedRoute>} />
                <Route path="/patients/:id/consent" element={<ProtectedRoute><ConsentPage /></ProtectedRoute>} />
                <Route path="/samples" element={<ProtectedRoute><SamplesPage /></ProtectedRoute>} />
                <Route path="/samples/:id" element={<ProtectedRoute><SampleDetailsPage /></ProtectedRoute>} />
                <Route path="/samples/new" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><NewSamplePage /></ProtectedRoute>} />
                <Route path="/samples/:id/label" element={<ProtectedRoute><SampleLabelPage /></ProtectedRoute>} />
                <Route path="/samples/:id/chain" element={<ProtectedRoute><SampleChainPage /></ProtectedRoute>} />
                <Route path="/samples/:id/movements" element={<ProtectedRoute><SampleMovementsPage /></ProtectedRoute>} />
                <Route path="/samples/custody-reports" element={<ProtectedRoute><SampleCustodyReportsPage /></ProtectedRoute>} />
                <Route path="/samples/withdrawal-return" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><SampleWithdrawalReturnPage /></ProtectedRoute>} />
                <Route path="/results" element={<ProtectedRoute><ResultsPage /></ProtectedRoute>} />
                <Route path="/system-management" element={<ProtectedRoute requiredRole="Administrador"><SystemManagementPage /></ProtectedRoute>} />
                {/* Rotas antigas redirecionam para a nova página consolidada */}
                <Route path="/users" element={<Navigate to="/system-management?tab=users" replace />} />
                <Route path="/access" element={<Navigate to="/system-management?tab=access" replace />} />
                <Route path="/security" element={<Navigate to="/system-management?tab=security" replace />} />
                <Route path="/users/new" element={<ProtectedRoute requiredRole="Administrador"><NewUserPage /></ProtectedRoute>} />
                <Route path="/users/new/success" element={<ProtectedRoute requiredRole="Administrador"><NewUserSuccessPage /></ProtectedRoute>} />
                <Route path="/facility-management" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><FacilityManagementPage /></ProtectedRoute>} />
                {/* Rotas antigas redirecionam para a nova página consolidada */}
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
                <Route path="/import" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico']}><ImportPage /></ProtectedRoute>} />
                <Route path="/assistant" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo']}><AssistantPage /></ProtectedRoute>} />
                <Route path="/consent-manager" element={<ProtectedRoute requiredRole={['Administrador', 'Coordenador']}><ConsentManager /></ProtectedRoute>} />
                <Route path="/backup" element={<ProtectedRoute requiredRole="Administrador"><BackupPage /></ProtectedRoute>} />
                <Route path="/settings/parameters" element={<ProtectedRoute requiredRole="Administrador"><SettingsParametersPage /></ProtectedRoute>} />
                <Route path="/user/security" element={<ProtectedRoute><UserSecurityPage /></ProtectedRoute>} />
                <Route path="/security/mfa-setup" element={<ProtectedRoute><MFASetupPage /></ProtectedRoute>} />
              </Routes>
            </Layout>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;

