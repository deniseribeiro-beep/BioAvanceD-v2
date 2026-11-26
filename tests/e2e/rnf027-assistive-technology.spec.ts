import { test, expect, Locator } from '@playwright/test';
import { MongoClient, Db } from 'mongodb';
import crypto from 'crypto';
import { realAuthLogin, realLogin } from './helpers/realAuth';
import { generateValidCpf } from './helpers/cpf';
import { waitForIntakeWizardReady } from './helpers/waitForIntakeWizardReady';
import { clearLoginAttempts, closeLoginAttemptsDb } from './helpers/queryLoginAttempts';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

// RNF027 C3 (critical components tested with representative assistive
// technologies), #1473. A screen reader, a voice-control tool and a switch
// device all work from the browser's accessibility tree, so this spec asserts
// on that tree as Playwright exposes it: each control's role and accessible
// name, the name matching the control's visible label, the state a control
// announces, and messages announced as alerts or status. It covers the three
// critical components: login, the sample step of the intake wizard (sample
// registration) and the participant consent page. No call is routed: the
// cases run against the real backend stack at the e2e gate, so the tree is
// the one a real 401, a real wizard session and a real consent link build.

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

// Every visible control in the region is in the accessibility tree with a
// non-empty name, a control with a <label> is named by that label's text, and
// none is named by the generic fallback the shared Input and Select carry.
async function expectEveryControlNamedByItsLabel(region: Locator): Promise<void> {
  const controls = region.locator(
    'input:not([type="hidden"]):visible, select:visible, textarea:visible, button:visible'
  );
  const count = await controls.count();
  expect(count, 'controls in the region').toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const described = await control.evaluate((el) => {
      const testId = el.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${testId ? `[data-testid="${testId}"]` : `#${el.id}`}`;
    });
    const labelText = await control.evaluate((el) => {
      const labels = (el as HTMLInputElement).labels;
      return labels && labels.length > 0 ? (labels[0].textContent ?? '').replace(/\s+/g, ' ').trim() : '';
    });
    if (labelText) {
      await expect(control, `${described} is named by its label`).toHaveAccessibleName(labelText);
    } else {
      await expect(control, `${described} has an accessible name`).toHaveAccessibleName(/\S/);
    }
    // The shared Input and Select fall back to these when no label reaches
    // them; a screen reader then reads the same word for every such field.
    await expect(control, `${described} is not named by a generic fallback`).not.toHaveAccessibleName(
      /^Campo de (seleção|entrada)$/
    );
  }
}

test.describe('RNF027 assistive technology (accessibility tree)', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // The consent page reads the active term of the lineage the participant was
  // enrolled under; this one carries a required and an optional purpose.
  const template = {
    title: `TCLE RNF027 C3 ${suffix}`,
    content: 'Termo de Consentimento Livre e Esclarecido do teste de tecnologia assistiva.',
    version: 'rnf027-c3',
    versionGroupId: `rnf027-c3-${suffix}`,
    permissions: [
      { key: 'research-c3', label: 'Uso das amostras em pesquisa', required: true },
      { key: 'recontact-c3', label: 'Novo contato para estudos futuros', required: false },
    ],
  };
  let client: MongoClient | null = null;
  let db: Db;
  let templateId = '';
  let governedCollection: GovernedCollection | null = null;
  const participantIds: string[] = [];

  test.beforeAll(async () => {
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    db = client.db(mongoDbName);
    const inserted = await db.collection('consent_templates').insertOne({
      ...template,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    templateId = inserted.insertedId.toString();
    governedCollection = await seedGovernedCollection(`rnf027-c3-${suffix}`);
  });

  test.afterAll(async () => {
    // The failed login counts against the runner's source row, which every
    // spec shares; give the failure back.
    await clearLoginAttempts();
    await closeLoginAttemptsDb();
    await cleanupGovernedCollection(governedCollection);
    await closeGovernedCollectionDb();
    if (!client) return;
    await db.collection('patients').deleteMany({ participantId: { $in: participantIds } });
    await db.collection('participantIdentities').deleteMany({ participantId: { $in: participantIds } });
    await db.collection('patientConsents').deleteMany({ participantId: { $in: participantIds } });
    await db.collection('consent_templates').deleteMany({ versionGroupId: template.versionGroupId });
    await client.close();
    client = null;
  });

  test('login: the form exposes a heading, named fields and an announced error', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-form')).toBeVisible();

    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(/\S/);
    await expect(page.getByTestId('login-username-input')).toHaveRole('textbox');
    await expect(page.getByTestId('login-password-input')).toHaveRole('textbox');
    await expect(page.getByTestId('login-submit-button')).toHaveRole('button');
    await expectEveryControlNamedByItsLabel(page.getByTestId('login-page'));

    // An account that does not exist, so the real 401 locks no account out.
    await page.getByTestId('login-username-input').fill(`rnf027-c3-${suffix}`);
    await page.getByTestId('login-password-input').fill('wrong-password');
    await page.getByTestId('login-submit-button').click();
    // The text is the backend's localized answer; what is asserted is that it
    // is announced, as an alert, by the login error.
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText(/\S/);
    await expect(alert).toHaveAttribute('data-testid', 'login-error');
  });

  test('sample registration: the wizard sample step names every field and announces its errors', async ({ page, request }) => {
    await realAuthLogin(request, page);

    await page.goto('/next/intake');
    await waitForIntakeWizardReady(page);
    await page.getByTestId('wizard-full-name').fill(`Participante Acessibilidade ${suffix}`);
    await page.getByTestId('wizard-birth-date').fill('01/01/1990');
    await page.getByTestId('wizard-gender').selectOption('F');
    await page.getByTestId('wizard-email').fill(`rnf027-c3-${suffix}@example.test`);
    await page.getByTestId('wizard-document').fill(generateValidCpf());
    await page.getByTestId('wizard-next-button').click();

    await expect(page.getByTestId('wizard-sprec-axis-1')).toBeVisible();
    await page.getByTestId('wizard-sprec-matrix').selectOption('fluid');
    // The collection select lists the real collections, the seeded one among them.
    await expect(
      page.getByTestId('wizard-collection').locator(`option[value="${governedCollection!.collectionId}"]`)
    ).toHaveCount(1);
    const wizard = page.getByTestId('intake-wizard-root');
    await expect(wizard.getByRole('heading', { level: 3 })).toHaveAccessibleName(/\S/);
    await expect(page.getByTestId('wizard-sprec-axis-4')).toHaveRole('combobox');
    await expect(page.getByTestId('wizard-processing-unknown')).toHaveRole('checkbox');
    await expect(page.getByTestId('wizard-quantity')).toHaveRole('spinbutton');
    await expectEveryControlNamedByItsLabel(wizard);

    // Advancing with the step empty announces the quantity error as an alert
    // that the field itself is described by.
    await page.getByTestId('wizard-next-button').click();
    const quantityError = wizard.getByRole('alert').filter({ hasText: /\S/ }).first();
    await expect(quantityError).toBeVisible();
    await expect(page.getByTestId('wizard-quantity')).toHaveAccessibleDescription(
      (await quantityError.textContent())?.trim() ?? ''
    );
  });

  test('consent: the participant page names its purposes, announces the accept state and the result', async ({ page, request }) => {
    // A participant enrolled through the real API under the term above. The
    // API emails a link whose token it keeps only as a SHA-256 (#1049), so the
    // spec sets a token it knows, stored the same way.
    const admin = await realLogin(request);
    const created = await request.post(`${apiBaseURL}/api/patients`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: 'placeholder',
        patientName: `RNF027 C3 participant ${suffix}`,
        birthDate: '1990-01-01',
        sex: 'F',
        consentTemplateId: templateId,
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const participantId = String((await created.json())?.data?.participantId ?? '');
    expect(participantId).toMatch(/^\d{8}$/);
    participantIds.push(participantId);
    const token = crypto.randomBytes(32).toString('hex');
    await db.collection('patients').updateOne(
      { participantId },
      { $set: { consentTokenHash: crypto.createHash('sha256').update(token).digest('hex') } }
    );

    await page.goto(`/patients/${participantId}/consent?token=${token}`);
    await expect(page.getByTestId('consent-token-content')).toContainText(template.content, { timeout: 15_000 });

    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(template.title);
    const research = page.getByTestId('consent-token-permission-research-c3');
    await expect(research).toHaveRole('checkbox');
    await expect(research).toHaveAccessibleName('Uso das amostras em pesquisa (obrigatória)');
    await expect(research).not.toBeChecked();
    await expectEveryControlNamedByItsLabel(page.getByTestId('consent-token-permissions'));

    const accept = page.getByRole('button', { name: 'Aceitar o termo' });
    await expect(accept).toBeDisabled();
    await research.check();
    await expect(research).toBeChecked();
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(page.getByRole('status')).toContainText('Aceite registrado');
  });
});
