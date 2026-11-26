import { test } from '@playwright/test';
import path from 'node:path';
import { realAuthLogin } from './helpers/realAuth';

/**
 * Full-page visual evidence for every DEMO_ROUTES screen (Zenodo gold / all sessions).
 * Mirrors frontend-ui-demo/src/catalog/routes.ts — keep in sync when routes change.
 * Artifacts: test-results/ui-gold-screenshots/<group-slug>/<name>.png
 */
const OUT = path.join('test-results', 'ui-gold-screenshots');

type GoldRoute = {
  name: string;
  path: string;
  group: string;
  auth: boolean;
};

const ROUTES: GoldRoute[] = [
  // Auth / Público
  { name: '01-login', path: '/login', group: 'auth-publico', auth: false },
  { name: '02-mfa-setup', path: '/mfa-setup', group: 'auth-publico', auth: false },
  { name: '03-reset-password', path: '/reset-password', group: 'auth-publico', auth: false },
  { name: '04-e-consent-panel', path: '/patient/e-consent', group: 'auth-publico', auth: false },
  { name: '05-e-consent-accept', path: '/patient/e-consent/demo-token', group: 'auth-publico', auth: false },
  { name: '06-e-consent-import', path: '/patient/e-consent/import/demo-token', group: 'auth-publico', auth: false },
  { name: '07-consent-token', path: '/patients/demo-id/consent', group: 'auth-publico', auth: false },

  // Principal
  { name: '08-dashboard', path: '/dashboard', group: 'principal', auth: true },
  { name: '09-intake', path: '/next/intake', group: 'principal', auth: true },
  { name: '10-foundation', path: '/next', group: 'principal', auth: true },
  { name: '11-foundation-contracts', path: '/next/contracts', group: 'principal', auth: true },
  { name: '12-patients', path: '/patients', group: 'principal', auth: true },
  { name: '13-import-fhir', path: '/patients/import-fhir', group: 'principal', auth: true },

  // Laboratório
  { name: '14-samples', path: '/samples', group: 'laboratorio', auth: true },
  { name: '15-sample-details', path: '/samples/demo-id', group: 'laboratorio', auth: true },
  { name: '16-sample-label', path: '/samples/demo-id/label', group: 'laboratorio', auth: true },
  { name: '17-sample-chain', path: '/samples/demo-id/chain', group: 'laboratorio', auth: true },
  { name: '18-sample-movements', path: '/samples/demo-id/movements', group: 'laboratorio', auth: true },
  { name: '19-withdrawal-return', path: '/samples/withdrawal-return', group: 'laboratorio', auth: true },
  { name: '20-custody-reports', path: '/samples/custody-reports', group: 'laboratorio', auth: true },
  { name: '21-results', path: '/results', group: 'laboratorio', auth: true },
  { name: '22-quality-descriptions', path: '/quality-descriptions', group: 'laboratorio', auth: true },
  { name: '22b-quality-descriptions-new', path: '/quality-descriptions/new', group: 'laboratorio', auth: true },

  // Facility
  { name: '23-facility-equipment', path: '/facility-management?tab=equipment', group: 'facility', auth: true },
  { name: '24-facility-temperature', path: '/facility-management?tab=temperature', group: 'facility', auth: true },
  { name: '25-facility-history', path: '/facility-management?tab=history', group: 'facility', auth: true },
  { name: '26-facility-incidents', path: '/facility-management?tab=incidents', group: 'facility', auth: true },
  { name: '27-facility-sensors', path: '/facility-management?tab=sensors', group: 'facility', auth: true },
  { name: '28-facility-policies', path: '/facility-management?tab=policies', group: 'facility', auth: true },
  { name: '28b-equipment-new', path: '/equipment/new', group: 'facility', auth: true },
  { name: '28c-sensors-new', path: '/sensors/new', group: 'facility', auth: true },
  { name: '28d-policies-new', path: '/policies/new', group: 'facility', auth: true },

  // Governança
  { name: '29-tcle-builder', path: '/admin/tcle/new', group: 'governanca', auth: true },
  { name: '30-tcle-edit', path: '/admin/tcle/edit/demo-template', group: 'governanca', auth: true },
  { name: '31-consents', path: '/consents', group: 'governanca', auth: true },
  { name: '32-biomarkers', path: '/biomarker-associations', group: 'governanca', auth: true },
  { name: '32b-biomarkers-new', path: '/biomarker-associations/new', group: 'governanca', auth: true },
  { name: '33-access-requests', path: '/access-requests', group: 'governanca', auth: true },

  // Importação
  { name: '34-import-batch', path: '/patients/import-fhir', group: 'importacao', auth: true },
  { name: '35-import-quarantine', path: '/import/quarantine', group: 'importacao', auth: true },

  // Relatórios
  { name: '36-reports', path: '/reports', group: 'relatorios', auth: true },
  { name: '37-report-templates', path: '/reports/templates', group: 'relatorios', auth: true },
  { name: '37b-report-templates-new', path: '/reports/templates/new', group: 'relatorios', auth: true },
  { name: '38-report-query', path: '/reports/query/custody', group: 'relatorios', auth: true },
  { name: '39-report-view', path: '/reports/demo-id', group: 'relatorios', auth: true },
  { name: '40-logs', path: '/logs', group: 'relatorios', auth: true },
  { name: '41-log-detail', path: '/logs/demo-id', group: 'relatorios', auth: true },

  // Sistema
  { name: '42-system-users', path: '/system-management?tab=users', group: 'sistema', auth: true },
  { name: '43-system-orgs', path: '/system-management?tab=organizations', group: 'sistema', auth: true },
  { name: '43b-organizations-new', path: '/organizations/new', group: 'sistema', auth: true },
  { name: '44-system-collections', path: '/system-management?tab=collections', group: 'sistema', auth: true },
  { name: '44b-collections-new', path: '/collections/new', group: 'sistema', auth: true },
  { name: '45-system-security', path: '/system-management?tab=security', group: 'sistema', auth: true },
  { name: '46-users-new', path: '/users/new', group: 'sistema', auth: true },
  { name: '47-users-new-success', path: '/users/new/success', group: 'sistema', auth: true },
  { name: '48-backup', path: '/backup', group: 'sistema', auth: true },
  { name: '49-parameters', path: '/settings/parameters', group: 'sistema', auth: true },
  { name: '50-runbook', path: '/runbook', group: 'sistema', auth: true },
  { name: '50b-legal-terms', path: '/legal/terms', group: 'sistema', auth: true },
  { name: '50c-legal-privacy', path: '/legal/privacy', group: 'sistema', auth: true },
  { name: '51-user-security', path: '/user/security', group: 'sistema', auth: true },
  { name: '52-security-mfa', path: '/security/mfa-setup', group: 'sistema', auth: true },
];

test.describe('UI gold fullPage screenshots — all sessions', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const route of ROUTES) {
    test(`screenshot ${route.group}/${route.name}`, async ({ page, request }) => {
      test.setTimeout(120_000);
      if (route.auth) {
        await realAuthLogin(request, page);
      }
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(OUT, route.group, `${route.name}.png`),
        fullPage: true,
      });
    });
  }
});
