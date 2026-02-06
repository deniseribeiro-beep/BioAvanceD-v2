import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import PatientsPage from './pages/PatientsPage';
import NewPatientPage from './pages/NewPatientPage';
import ConsentPage from './pages/ConsentPage';
import SamplesPage from './pages/SamplesPage';
import SampleDetailsPage from './pages/SampleDetailsPage';
import NewSamplePage from './pages/NewSamplePage';
import ResultsPage from './pages/ResultsPage';
import NewUserPage from './pages/NewUserPage';
import NewUserSuccessPage from './pages/NewUserSuccessPage';
import LogsPage from './pages/LogsPage';
import LogDetailPage from './pages/LogDetailPage';
import SampleLabelPage from './pages/SampleLabelPage';
import SampleChainPage from './pages/SampleChainPage';
import SampleMovementsPage from './pages/SampleMovementsPage';
import SampleWithdrawalReturnPage from './pages/SampleWithdrawalReturnPage';
import SampleCustodyReportsPage from './pages/SampleCustodyReportsPage';
import FacilityManagementPage from './pages/FacilityManagementPage';
import SystemManagementPage from './pages/SystemManagementPage';
import ReportsPage from './pages/ReportsPage';
import ReportViewPage from './pages/ReportViewPage';
import ReportQueryPage from './pages/ReportQueryPage';
import QualityDescriptionPage from './pages/QualityDescriptionPage';
import ImportPage from './pages/ImportPage';
import AssistantPage from './pages/AssistantPage';
import BackupPage from './pages/BackupPage';
import UserSecurityPage from './pages/UserSecurityPage';
import MFASetupPage from './pages/MFASetupPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SettingsParametersPage from './pages/SettingsParametersPage';
import ConsentManager from './pages/ConsentManager';
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

