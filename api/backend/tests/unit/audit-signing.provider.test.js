const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const env = require('../../src/config/env');
const auditSigningProvider = require('../../src/services/audit-signing.provider');

describe('audit-signing.provider', () => {
  let tmpKeyFile;

  beforeEach(() => {
    env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = '';
    env.AUDIT_MERKLE_SIGN_KEY_ID = '';
    env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = '';
  });

  afterEach(() => {
    if (tmpKeyFile) {
      fs.rmSync(tmpKeyFile, { force: true });
      tmpKeyFile = undefined;
    }
  });

  function makeKeyPair() {
    const pair = crypto.generateKeyPairSync('ed25519');
    const privatePem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    return { privatePem, publicPem };
  }

  function writeTempKeyFile(pem) {
    tmpKeyFile = path.join(os.tmpdir(), `audit-signing-provider-test-${Date.now()}-${Math.random()}.pem`);
    fs.writeFileSync(tmpKeyFile, pem, 'utf8');
    return tmpKeyFile;
  }

  describe('loadPrivateKey', () => {
    it('rejeita quando AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE nao configurado', async () => {
      await expect(auditSigningProvider.loadPrivateKey()).rejects.toThrow(
        'AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE não configurado'
      );
    });

    it('rejeita quando a variavel contem apenas espacos', async () => {
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = '   ';
      await expect(auditSigningProvider.loadPrivateKey()).rejects.toThrow(
        'AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE não configurado'
      );
    });

    it('le o conteudo do arquivo configurado', async () => {
      const { privatePem } = makeKeyPair();
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = writeTempKeyFile(privatePem);
      const content = await auditSigningProvider.loadPrivateKey();
      expect(content).toBe(privatePem);
    });
  });

  describe('getKeyId', () => {
    it('rejeita quando AUDIT_MERKLE_SIGN_KEY_ID nao configurado', () => {
      expect(() => auditSigningProvider.getKeyId()).toThrow('AUDIT_MERKLE_SIGN_KEY_ID não configurado');
    });

    it('rejeita quando a variavel contem apenas espacos', () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = '   ';
      expect(() => auditSigningProvider.getKeyId()).toThrow('AUDIT_MERKLE_SIGN_KEY_ID não configurado');
    });

    it('retorna o keyId configurado, aparado', () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = '  key-1  ';
      expect(auditSigningProvider.getKeyId()).toBe('key-1');
    });
  });

  describe('getPublicKeyRegistry', () => {
    it('retorna objeto vazio quando nao configurado', () => {
      expect(auditSigningProvider.getPublicKeyRegistry()).toEqual({});
    });

    it('retorna objeto vazio quando a variavel contem apenas espacos', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = '   ';
      expect(auditSigningProvider.getPublicKeyRegistry()).toEqual({});
    });

    it('faz parse de um objeto JSON valido', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': 'pem-1' });
      expect(auditSigningProvider.getPublicKeyRegistry()).toEqual({ 'key-1': 'pem-1' });
    });

    it('retorna objeto vazio quando o JSON e um array', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify(['key-1', 'pem-1']);
      expect(auditSigningProvider.getPublicKeyRegistry()).toEqual({});
    });

    it('retorna objeto vazio quando o JSON e um primitivo', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify('not-an-object');
      expect(auditSigningProvider.getPublicKeyRegistry()).toEqual({});
    });

    it('propaga erro quando o JSON e invalido', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = '{not valid json';
      expect(() => auditSigningProvider.getPublicKeyRegistry()).toThrow();
    });
  });

  describe('getPublicKeyPem', () => {
    it('retorna null quando o registro esta vazio', () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-1';
      expect(auditSigningProvider.getPublicKeyPem()).toBeNull();
    });

    it('retorna null quando o keyId nao existe no registro', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': 'pem-1' });
      expect(auditSigningProvider.getPublicKeyPem('key-2')).toBeNull();
    });

    it('retorna o pem aparado para o keyId informado', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': '  pem-1  ' });
      expect(auditSigningProvider.getPublicKeyPem('key-1')).toBe('pem-1');
    });

    it('usa getKeyId() como default quando nenhum keyId e informado', () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-1';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': 'pem-1' });
      expect(auditSigningProvider.getPublicKeyPem()).toBe('pem-1');
    });
  });

  describe('getPublicKeyIdFingerprint', () => {
    it('retorna null quando nao ha pem para o keyId', () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-1';
      expect(auditSigningProvider.getPublicKeyIdFingerprint()).toBeNull();
    });

    it('retorna o sha256 hex do pem quando presente', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': 'pem-1' });
      const expected = crypto.createHash('sha256').update('pem-1').digest('hex');
      expect(auditSigningProvider.getPublicKeyIdFingerprint('key-1')).toBe(expected);
    });

    it('usa getKeyId() como default quando nenhum keyId e informado', () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-1';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': 'pem-1' });
      const expected = crypto.createHash('sha256').update('pem-1').digest('hex');
      expect(auditSigningProvider.getPublicKeyIdFingerprint()).toBe(expected);
    });
  });

  describe('sign', () => {
    it('assina os bytes e retorna metadados da assinatura', async () => {
      const { privatePem, publicPem } = makeKeyPair();
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = writeTempKeyFile(privatePem);
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-1';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': publicPem });

      const bytes = Buffer.from('hello world');
      const result = await auditSigningProvider.sign(bytes);

      expect(result.signatureAlgorithm).toBe('Ed25519');
      expect(result.keyId).toBe('key-1');
      expect(result.publicKeyFingerprint).toBe(
        crypto.createHash('sha256').update(publicPem.trim()).digest('hex')
      );
      const verifyOk = crypto.verify(null, bytes, publicPem, Buffer.from(result.signature, 'base64'));
      expect(verifyOk).toBe(true);
    });

    it('rejeita quando a chave privada nao esta configurada', async () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-1';
      await expect(auditSigningProvider.sign(Buffer.from('x'))).rejects.toThrow(
        'AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE não configurado'
      );
    });
  });

  describe('verify', () => {
    it('retorna unknown_key_id quando nao ha chave publica para o keyId', () => {
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-1';
      const result = auditSigningProvider.verify(Buffer.from('x'), 'c2ln', 'key-1');
      expect(result).toEqual({ ok: false, reason: 'unknown_key_id' });
    });

    it('retorna ok quando a assinatura e valida', () => {
      const { privatePem, publicPem } = makeKeyPair();
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': publicPem });
      const bytes = Buffer.from('payload');
      const signature = crypto.sign(null, bytes, privatePem).toString('base64');

      const result = auditSigningProvider.verify(bytes, signature, 'key-1');
      expect(result).toEqual({ ok: true, reason: null });
    });

    it('retorna falha quando a assinatura nao corresponde aos bytes', () => {
      const { privatePem, publicPem } = makeKeyPair();
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': publicPem });
      const signature = crypto.sign(null, Buffer.from('other payload'), privatePem).toString('base64');

      const result = auditSigningProvider.verify(Buffer.from('payload'), signature, 'key-1');
      expect(result).toEqual({ ok: false, reason: 'signature_verification_failed' });
    });

    it('usa getKeyId() como default quando nenhum keyId e informado', () => {
      const { privatePem, publicPem } = makeKeyPair();
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-1';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': publicPem });
      const bytes = Buffer.from('payload');
      const signature = crypto.sign(null, bytes, privatePem).toString('base64');

      const result = auditSigningProvider.verify(bytes, signature);
      expect(result).toEqual({ ok: true, reason: null });
    });

    it('trata assinatura ausente como base64 vazio', () => {
      const { publicPem } = makeKeyPair();
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'key-1': publicPem });

      const result = auditSigningProvider.verify(Buffer.from('payload'), undefined, 'key-1');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('signature_verification_failed');
    });
  });
});
