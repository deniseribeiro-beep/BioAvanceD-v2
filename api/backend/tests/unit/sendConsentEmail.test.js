import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// NOTE: `nodemailer` is required at the top of src/utils/sendConsentEmail.js,
// but it is not declared in api/backend/package.json nor installed in
// node_modules anywhere in this repo (verified: no nodemailer dir under any
// node_modules, no entry in package.json). vi.mock('nodemailer', factory)
// cannot intercept this because vitest still needs to resolve the module id
// before applying the mock, and resolution fails outright ("Cannot find
// module 'nodemailer'") even with a mock factory registered.
//
// Per the task's scope rules, package.json/config files are off-limits, so
// instead of adding the dependency we inject a synthetic 'nodemailer' module
// into Node's module cache and hijack Module._resolveFilename, purely from
// within this test file, so that requiring sendConsentEmail.js succeeds.
const Module = require('module');

const sendMailMock = vi.fn();
const fakeNodemailer = {
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'nodemailer') return 'nodemailer';
  return originalResolveFilename.call(this, request, ...rest);
};
require.cache['nodemailer'] = {
  id: 'nodemailer',
  filename: 'nodemailer',
  loaded: true,
  exports: fakeNodemailer,
};

const { sendConsentEmail } = require('../../src/utils/sendConsentEmail');

describe('sendConsentEmail', () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    sendMailMock.mockReset();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('sends the email with the patient email, subject and consent link', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-123' });

    await sendConsentEmail('patient@example.com', 'Jane Doe', 'token-abc');

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailOptions = sendMailMock.mock.calls[0][0];
    expect(mailOptions.to).toBe('patient@example.com');
    expect(mailOptions.subject).toContain('Termo de Consentimento');
    expect(mailOptions.html).toContain('Jane Doe');
    expect(mailOptions.html).toContain('token-abc');
    expect(mailOptions.html).toContain('/paciente/consentimento/token-abc');
  });

  it('logs a success message including the patient email and message id on success', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-999' });

    await sendConsentEmail('someone@example.com', 'Someone', 'tok-1');

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const logMessage = consoleLogSpy.mock.calls[0][0];
    expect(logMessage).toContain('someone@example.com');
    expect(logMessage).toContain('msg-999');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('does not throw and logs the error when sendMail rejects', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP connection refused'));

    await expect(
      sendConsentEmail('fail@example.com', 'Failer', 'tok-2')
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const errorMessage = consoleErrorSpy.mock.calls[0][0];
    expect(errorMessage).toContain('fail@example.com');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('builds the consent URL using the BIOBANK_DOMAIN env var when set', async () => {
    const originalDomain = process.env.BIOBANK_DOMAIN;
    process.env.BIOBANK_DOMAIN = 'custom.example.org';
    sendMailMock.mockResolvedValue({ messageId: 'msg-domain' });

    try {
      await sendConsentEmail('patient@example.com', 'Jane', 'tok-domain');
      const mailOptions = sendMailMock.mock.calls[0][0];
      expect(mailOptions.html).toContain('https://custom.example.org/paciente/consentimento/tok-domain');
      expect(mailOptions.from).toContain('custom.example.org');
    } finally {
      if (originalDomain === undefined) {
        delete process.env.BIOBANK_DOMAIN;
      } else {
        process.env.BIOBANK_DOMAIN = originalDomain;
      }
    }
  });

  it('uses the BIOBANK_NAME env var in the from field and subject when set', async () => {
    const originalName = process.env.BIOBANK_NAME;
    process.env.BIOBANK_NAME = 'MyBiobank';
    sendMailMock.mockResolvedValue({ messageId: 'msg-name' });

    try {
      await sendConsentEmail('patient@example.com', 'Jane', 'tok-name');
      const mailOptions = sendMailMock.mock.calls[0][0];
      expect(mailOptions.from).toContain('MyBiobank');
      expect(mailOptions.subject).toContain('MyBiobank');
    } finally {
      if (originalName === undefined) {
        delete process.env.BIOBANK_NAME;
      } else {
        process.env.BIOBANK_NAME = originalName;
      }
    }
  });
});
