import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// #1430: App.tsx registers a top-level `/samples/:id` route ahead of the `/*`
// layout route, whose descendant <Routes> hold the sample sub-pages. Without
// their own top-level entries, `/samples/custody-reports` and
// `/samples/withdrawal-return` were caught by the detail page as an :id; the
// three-segment sub-pages are pinned here against a regression.
vi.mock('./components/Layout/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/ProtectedRoute', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./views/SampleDetailsPage', () => ({ default: () => <p>page:detail</p> }));
vi.mock('./views/SampleCustodyReportsPage', () => ({ default: () => <p>page:custody-reports</p> }));
vi.mock('./views/SampleWithdrawalReturnPage', () => ({ default: () => <p>page:withdrawal-return</p> }));
vi.mock('./views/SampleLabelPage', () => ({ default: () => <p>page:label</p> }));
vi.mock('./views/SampleChainPage', () => ({ default: () => <p>page:chain</p> }));
vi.mock('./views/SampleMovementsPage', () => ({ default: () => <p>page:movements</p> }));

// #1443: every other lazy page App.tsx registers, each stubbed to a marker so a
// route row below proves which page its URL lands on.
vi.mock('./pages/patient/EConsentPage', () => ({ default: () => <p>page:econsent</p> }));
vi.mock('./pages/patient/EConsentImportPage', () => ({ default: () => <p>page:econsent-import</p> }));
vi.mock('./pages/patient/EConsentLinkPanel', () => ({ default: () => <p>page:econsent-link</p> }));
vi.mock('./pages/patient/ConsentTokenPage', () => ({ default: () => <p>page:consent-token</p> }));
vi.mock('./pages/v2/intake/IntakeWizardPage', () => ({ default: () => <p>page:intake</p> }));
vi.mock('./foundation/FoundationApp', () => ({ default: () => <p>page:foundation</p> }));
vi.mock('./views/LoginPage', () => ({ default: () => <p>page:login</p> }));
vi.mock('./views/MFASetupPage', () => ({ default: () => <p>page:mfa-setup</p> }));
vi.mock('./views/ResetPasswordPage', () => ({ default: () => <p>page:reset-password</p> }));
vi.mock('./views/Dashboard', () => ({ default: () => <p>page:dashboard</p> }));
vi.mock('./views/PatientsPage', () => ({ default: () => <p>page:patients</p> }));
vi.mock('./views/FhirImportPage', () => ({ default: () => <p>page:fhir-import</p> }));
vi.mock('./views/SamplesPage', () => ({ default: () => <p>page:samples</p> }));
vi.mock('./views/ResultsPage', () => ({ default: () => <p>page:results</p> }));
vi.mock('./views/SystemManagementPage', () => ({ default: () => <p>page:system-management</p> }));
vi.mock('./views/NewUserPage', () => ({ default: () => <p>page:new-user</p> }));
vi.mock('./views/NewUserSuccessPage', () => ({ default: () => <p>page:new-user-success</p> }));
vi.mock('./views/FacilityManagementPage', () => ({ default: () => <p>page:facility-management</p> }));
vi.mock('./views/LogsPage', () => ({ default: () => <p>page:logs</p> }));
vi.mock('./views/LogDetailPage', () => ({ default: () => <p>page:log-detail</p> }));
vi.mock('./views/ReportsPage', () => ({ default: () => <p>page:reports</p> }));
vi.mock('./views/ReportTemplatesPage', () => ({ default: () => <p>page:report-templates</p> }));
vi.mock('./views/ReportQueryPage', () => ({ default: () => <p>page:report-query</p> }));
vi.mock('./views/ReportViewPage', () => ({ default: () => <p>page:report-view</p> }));
vi.mock('./views/QualityDescriptionPage', () => ({ default: () => <p>page:quality-descriptions</p> }));
vi.mock('./views/ImportQuarantinePage', () => ({ default: () => <p>page:import-quarantine</p> }));
vi.mock('./components/v2/ImportForm', () => ({ default: () => <p>page:import</p> }));
vi.mock('./views/AccessRequestsPage', () => ({ default: () => <p>page:access-requests</p> }));
vi.mock('./views/ConsentHistoryPage', () => ({ default: () => <p>page:consents</p> }));
vi.mock('./views/BiomarkerAssociationsPage', () => ({ default: () => <p>page:biomarker-associations</p> }));
vi.mock('./views/TcleBuilderPage', () => ({ default: () => <p>page:tcle-builder</p> }));
vi.mock('./views/BackupPage', () => ({ default: () => <p>page:backup</p> }));
vi.mock('./views/SettingsParametersPage', () => ({ default: () => <p>page:settings-parameters</p> }));
vi.mock('./views/DataDictionaryPage', () => ({ default: () => <p>page:data-dictionary</p> }));
vi.mock('./views/UserSecurityPage', () => ({ default: () => <p>page:user-security</p> }));

import App from './App';

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

async function expectOnlyPage(url: string, page: string) {
  window.history.pushState({}, '', url);
  render(<App />);

  expect(await screen.findByText(page)).toBeInTheDocument();
  expect(screen.queryAllByText(/^page:/)).toHaveLength(1);
}

describe('sample routes in App.tsx', () => {
  it.each([
    ['/samples/custody-reports', 'page:custody-reports'],
    ['/samples/withdrawal-return', 'page:withdrawal-return'],
    ['/samples/S-1/label', 'page:label'],
    ['/samples/S-1/chain', 'page:chain'],
    ['/samples/S-1/movements', 'page:movements'],
    ['/samples/S-1', 'page:detail'],
  ])('%s renders %s', expectOnlyPage);
});

describe('page routes in App.tsx', () => {
  it.each([
    ['/patient/e-consent', 'page:econsent-link'],
    ['/patient/e-consent/T-1', 'page:econsent'],
    ['/patient/e-consent/import/T-1', 'page:econsent-import'],
    ['/patients/P-1/consent', 'page:consent-token'],
    ['/next/intake', 'page:intake'],
    ['/next/anything', 'page:foundation'],
    ['/login', 'page:login'],
    ['/mfa-setup', 'page:mfa-setup'],
    ['/reset-password', 'page:reset-password'],
    ['/dashboard', 'page:dashboard'],
    ['/patients', 'page:patients'],
    ['/patients/import-fhir', 'page:fhir-import'],
    ['/samples', 'page:samples'],
    ['/results', 'page:results'],
    ['/system-management', 'page:system-management'],
    ['/users/new', 'page:new-user'],
    ['/users/new/success', 'page:new-user-success'],
    ['/facility-management', 'page:facility-management'],
    ['/logs', 'page:logs'],
    ['/logs/L-1', 'page:log-detail'],
    ['/reports', 'page:reports'],
    ['/reports/templates', 'page:report-templates'],
    ['/reports/query/samples', 'page:report-query'],
    ['/reports/R-1', 'page:report-view'],
    ['/quality-descriptions', 'page:quality-descriptions'],
    ['/import/quarantine', 'page:import-quarantine'],
    ['/import', 'page:import'],
    ['/access-requests', 'page:access-requests'],
    ['/consents', 'page:consents'],
    ['/biomarker-associations', 'page:biomarker-associations'],
    ['/admin/tcle/new', 'page:tcle-builder'],
    ['/admin/tcle/edit/TPL-1', 'page:tcle-builder'],
    ['/backup', 'page:backup'],
    ['/settings/parameters', 'page:settings-parameters'],
    ['/admin/dicionario', 'page:data-dictionary'],
    ['/user/security', 'page:user-security'],
    ['/security/mfa-setup', 'page:mfa-setup'],
  ])('%s renders %s', expectOnlyPage);
});

describe('redirect routes in App.tsx', () => {
  it.each([
    ['/', 'page:dashboard', '/dashboard'],
    ['/pacientes/novo-atendimento', 'page:intake', '/next/intake'],
    ['/import/fhir', 'page:fhir-import', '/patients/import-fhir'],
    ['/import/lgpd', 'page:fhir-import', '/patients/import-fhir'],
    ['/admin/master-data', 'page:data-dictionary', '/admin/dicionario'],
  ])('%s lands on %s at %s', async (url, page, landed) => {
    await expectOnlyPage(url, page);
    expect(window.location.pathname).toBe(landed);
  });
});
