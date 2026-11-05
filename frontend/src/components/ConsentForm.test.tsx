import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConsentPermission } from '@/types/models';

// The eConsent / TCLE form, rendered directly (no page mounts it, #1445).
// The real AssinaturaDigitalTCLE runs inside it; only its canvas library is
// replaced, since jsdom has no 2D canvas. `h.empty` decides whether the
// stand-in canvas holds a stroke.
const h = vi.hoisted(() => ({ empty: false }));

vi.mock('react-signature-canvas', () => ({
  default: forwardRef(function SignatureCanvasStub(
    props: { canvasProps: Record<string, unknown> },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      isEmpty: () => h.empty,
      clear: () => undefined,
      getTrimmedCanvas: () => ({
        toDataURL: () => 'data:image/png;base64,U0lH',
        toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })),
      }),
    }));
    return <canvas {...props.canvasProps} />;
  }),
}));
vi.mock('@/api/requestId', () => ({ fetchWithRequestId: vi.fn() }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'pt-BR' }),
}));

import ConsentForm from '@/components/ConsentForm';
import { fetchWithRequestId } from '@/api/requestId';

const PERMS: ConsentPermission[] = [
  { key: 'storage', label: 'Armazenamento', required: true },
  { key: 'future.use', label: 'Uso futuro' },
];
const VALID_CAAE = '83746219.8.0000.5432';

function renderForm(over: Partial<Parameters<typeof ConsentForm>[0]> = {}) {
  const props = {
    patientName: 'Maria Souza',
    patientId: 'PAC-0001',
    templateText: 'Termo de consentimento.',
    permissions: PERMS,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  const view = render(<ConsentForm {...props} />);
  return { ...view, props };
}

const caae = () => screen.getByTestId('consent-caae-input') as HTMLInputElement;
const signatureName = () => screen.getByTestId('consent-signature-name-input') as HTMLInputElement;
const submit = () => screen.getByTestId('consent-submit-button');

async function confirmSignature() {
  fireEvent.click(screen.getByTestId('consent-signature-confirm-button'));
  await waitFor(() => expect(screen.queryByTestId('consent-signature-hint')).toBeNull());
}

async function fillValid() {
  fireEvent.change(caae(), { target: { value: VALID_CAAE } });
  fireEvent.click(screen.getByTestId('consent-permission-storage'));
  await confirmSignature();
}

beforeEach(() => {
  h.empty = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConsentForm', () => {
  it('shows the patient and a plain-text template as preformatted text', () => {
    renderForm();
    expect(screen.getByTestId('consent-form-patient-name')).toHaveTextContent('Maria Souza');
    expect(screen.getByTestId('consent-form-patient-id')).toHaveTextContent('PAC-0001');
    const pre = screen.getByTestId('consent-form-content').querySelector('pre');
    expect(pre).toHaveTextContent('Termo de consentimento.');
  });

  it('renders an empty template as an empty preformatted block', () => {
    renderForm({ templateText: '' });
    const pre = screen.getByTestId('consent-form-content').querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre).toBeEmptyDOMElement();
  });

  it('renders an HTML template with scripts, handlers and javascript: links stripped', () => {
    renderForm({
      templateText:
        '<h1 onclick="alert(1)">TCLE</h1><script>alert(2)</script><iframe src="x"></iframe>' +
        '<a href="javascript:alert(3)">mau</a><a href="https://cep.example/termo">bom</a>' +
        '<img src=" JavaScript:alert(4)" alt="i">',
    });
    const content = screen.getByTestId('consent-form-content');
    expect(content.querySelector('pre')).toBeNull();
    expect(content.querySelector('h1')).toHaveTextContent('TCLE');
    expect(content.querySelector('h1')).not.toHaveAttribute('onclick');
    expect(content.querySelector('script')).toBeNull();
    expect(content.querySelector('iframe')).toBeNull();
    const [bad, good] = Array.from(content.querySelectorAll('a'));
    expect(bad).not.toHaveAttribute('href');
    expect(good).toHaveAttribute('href', 'https://cep.example/termo');
    expect(content.querySelector('img')).not.toHaveAttribute('src');
  });

  it('starts every permission unchecked and marks only the explicitly required one', () => {
    renderForm();
    expect(screen.getByTestId('consent-permission-storage')).not.toBeChecked();
    expect(screen.getByTestId('consent-permission-future_use')).not.toBeChecked();
    const required = screen.getAllByText('(consent.form.required)');
    expect(required).toHaveLength(1);
    expect(required[0].closest('label')).toHaveTextContent('Armazenamento');
  });

  it('falls back to a terms permission as the required one when none is flagged', () => {
    renderForm({
      permissions: [
        { key: 'genetic', label: 'Genético' },
        { key: 'general_terms', label: 'Termos' },
      ],
    });
    expect(screen.getAllByText('(consent.form.required)')).toHaveLength(1);
    expect(screen.getByText('Termos').closest('label')).toHaveTextContent('(consent.form.required)');
  });

  it('falls back to a "termos gerais" label as the required one', () => {
    renderForm({
      permissions: [
        { key: 'a', label: 'Genético' },
        { key: 'b', label: 'Aceito os Termos Gerais' },
      ],
    });
    expect(screen.getByText('Aceito os Termos Gerais').closest('label')).toHaveTextContent(
      '(consent.form.required)',
    );
    expect(screen.getByText('Genético').closest('label')).not.toHaveTextContent('(consent.form.required)');
  });

  it('falls back to the first permission when none is flagged or named terms', () => {
    renderForm({
      permissions: [
        { key: 'x', label: 'Primeira' },
        { key: 'y', label: 'Segunda' },
      ],
    });
    expect(screen.getByText('Primeira').closest('label')).toHaveTextContent('(consent.form.required)');
    expect(screen.getByText('Segunda').closest('label')).not.toHaveTextContent('(consent.form.required)');
  });

  it('never enables submit when there are no permissions at all', async () => {
    renderForm({ permissions: [] });
    fireEvent.change(caae(), { target: { value: VALID_CAAE } });
    await confirmSignature();
    expect(screen.getByTestId('consent-required-hint')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });

  it('masks the CAAE as typed and flags an incomplete one', () => {
    renderForm();
    fireEvent.change(caae(), { target: { value: '83746219800005432' } });
    expect(caae().value).toBe(VALID_CAAE);
    expect(screen.queryByText(/Formato de CAAE inválido/)).toBeNull();

    fireEvent.change(caae(), { target: { value: '837462198' } });
    expect(caae().value).toBe('83746219.8');
    expect(screen.getByText('Formato de CAAE inválido. Use XXXXXXXX.X.XXXX.XXXX')).toBeInTheDocument();

    fireEvent.blur(caae());
    expect(screen.getByText('Formato de CAAE inválido. Use XXXXXXXX.X.XXXX.XXXX')).toBeInTheDocument();

    fireEvent.change(caae(), { target: { value: 'abc' } });
    expect(caae().value).toBe('');
    expect(screen.queryByText(/Formato de CAAE inválido/)).toBeNull();
  });

  it('drops digits past the seventeenth from the CAAE', () => {
    renderForm();
    fireEvent.change(caae(), { target: { value: '8374621980000543299' } });
    expect(caae().value).toBe(VALID_CAAE);
  });

  it('defaults the signature name to the patient id and keeps a typed one', () => {
    const { rerender, props } = renderForm();
    expect(signatureName().value).toBe('PAC-0001');
    fireEvent.change(signatureName(), { target: { value: 'Maria S.' } });
    rerender(<ConsentForm {...props} patientId="PAC-0002" />);
    expect(signatureName().value).toBe('Maria S.');
  });

  it('leaves the signature name empty for a blank patient id', () => {
    renderForm({ patientId: '   ' });
    expect(signatureName().value).toBe('');
  });

  it('refills an emptied signature name with the patient id when the signature is confirmed', async () => {
    renderForm();
    fireEvent.change(signatureName(), { target: { value: '' } });
    await confirmSignature();
    expect(signatureName().value).toBe('PAC-0001');
  });

  it('keeps submit disabled until CAAE, required consent and digital signature all hold', async () => {
    renderForm();
    expect(submit()).toBeDisabled();
    expect(screen.getByTestId('consent-required-hint')).toBeInTheDocument();
    expect(screen.getByTestId('consent-signature-hint')).toBeInTheDocument();

    fireEvent.change(caae(), { target: { value: VALID_CAAE } });
    fireEvent.click(screen.getByTestId('consent-permission-storage'));
    expect(screen.queryByTestId('consent-required-hint')).toBeNull();
    expect(submit()).toBeDisabled();

    await confirmSignature();
    expect(submit()).not.toBeDisabled();
  });

  it('keeps submit disabled for an empty CAAE', async () => {
    renderForm();
    fireEvent.click(screen.getByTestId('consent-permission-storage'));
    await confirmSignature();
    expect(submit()).toBeDisabled();
  });

  it('keeps submit disabled for an invalid CAAE', async () => {
    renderForm();
    await fillValid();
    fireEvent.change(caae(), { target: { value: '8374621' } });
    expect(submit()).toBeDisabled();
  });

  it('keeps submit disabled for a signature name of three characters or fewer', async () => {
    renderForm();
    await fillValid();
    fireEvent.change(signatureName(), { target: { value: 'Ana' } });
    expect(submit()).toBeDisabled();
    fireEvent.change(signatureName(), { target: { value: 'Anas' } });
    expect(submit()).not.toBeDisabled();
  });

  it('keeps submit disabled when the required permission is unchecked again', async () => {
    renderForm();
    await fillValid();
    fireEvent.click(screen.getByTestId('consent-permission-storage'));
    expect(screen.getByTestId('consent-permission-storage')).not.toBeChecked();
    expect(submit()).toBeDisabled();
  });

  it('keeps the signature hint when the canvas is empty', () => {
    h.empty = true;
    renderForm();
    fireEvent.click(screen.getByTestId('consent-signature-confirm-button'));
    expect(screen.getByTestId('consent-signature-error')).toBeInTheDocument();
    expect(screen.getByTestId('consent-signature-hint')).toBeInTheDocument();
  });

  it('submits the responses, signature name and PNG signature without posting it itself', async () => {
    const { props } = renderForm();
    await fillValid();
    fireEvent.click(screen.getByTestId('consent-permission-future_use'));
    fireEvent.click(submit());
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).toHaveBeenCalledWith({
      responses: { storage: true, 'future.use': true },
      signatureName: 'PAC-0001',
      signatureImageBase64: 'data:image/png;base64,U0lH',
      signatureMimeType: 'image/png',
    });
    expect(fetchWithRequestId).not.toHaveBeenCalled();
  });

  it('calls onCancel from the cancel button', () => {
    const { props } = renderForm();
    fireEvent.click(screen.getByTestId('consent-cancel-button'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
