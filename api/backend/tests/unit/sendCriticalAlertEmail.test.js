const { Resend } = require('resend');
const { sendCriticalAlertEmail } = require('../../src/services/sendCriticalAlertEmail');

// `emails` is an instance of the internal `Emails` class created inside the
// Resend constructor, not a property on Resend.prototype itself. Grab its
// prototype (shared by every Resend instance) so vi.spyOn can find `send`.
const emailsPrototype = Object.getPrototypeOf(new Resend('placeholder-key').emails);

describe('sendCriticalAlertEmail', () => {
  const originalApiKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
  });

  it('sends the email and returns the raw resend.emails.send() result unmodified', async () => {
    const fakeResult = { data: { id: 'email-123' }, error: null };
    const sendSpy = vi
      .spyOn(emailsPrototype, 'send')
      .mockResolvedValue(fakeResult);

    const result = await sendCriticalAlertEmail('sensor-1', 25.5, 20, 'alert@example.com');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const callArgs = sendSpy.mock.calls[0][0];
    expect(callArgs.to).toBe('alert@example.com');
    expect(callArgs.subject).toContain('ALERTA CRÍTICO');
    expect(callArgs.html).toContain('sensor-1');
    expect(callArgs.html).toContain('25.5');
    expect(callArgs.html).toContain('20');
    expect(result).toBe(fakeResult);
  });

  it('throws when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(
      sendCriticalAlertEmail('sensor-1', 25.5, 20, 'alert@example.com')
    ).rejects.toThrow('RESEND_API_KEY não configurada');
  });

  it('throws when recipientEmail is empty', async () => {
    await expect(
      sendCriticalAlertEmail('sensor-1', 25.5, 20, '')
    ).rejects.toThrow('recipientEmail é obrigatório para envio do alerta crítico');
  });

  it('throws when recipientEmail is only whitespace', async () => {
    await expect(
      sendCriticalAlertEmail('sensor-1', 25.5, 20, '   ')
    ).rejects.toThrow('recipientEmail é obrigatório para envio do alerta crítico');
  });

  it('propagates a rejection from resend.emails.send()', async () => {
    const sendError = new Error('resend API failure');
    vi.spyOn(emailsPrototype, 'send').mockRejectedValue(sendError);

    await expect(
      sendCriticalAlertEmail('sensor-1', 25.5, 20, 'alert@example.com')
    ).rejects.toThrow('resend API failure');
  });
});
