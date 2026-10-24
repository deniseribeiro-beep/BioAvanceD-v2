import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createFilesystemObjectStore, ownerSegment } = require('../../../src/infrastructure/objectStorage/filesystemObjectStore');

const sha256Hex = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

describe('createFilesystemObjectStore (RF007 AC2, RNF016 C4)', () => {
  let root;
  let store;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'objstore-'));
    store = createFilesystemObjectStore({ root });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exposes only putObject and getObject: no delete and no overwrite', () => {
    expect(Object.keys(store).sort()).toEqual(['getObject', 'putObject']);
  });

  it('puts the body at its content-addressed key and returns its uri, version and path', async () => {
    const body = Buffer.from('ciphertext bytes');
    const hex = sha256Hex(body);

    const stored = await store.putObject({ area: 'samples', ownerKey: 'owner-1', body });

    expect(stored).toEqual({
      uri: `objstore://samples/owner-1/sha256/${hex}`,
      version: `sha256:${hex}`,
      path: path.join(root, 'samples', 'owner-1', 'sha256', hex)
    });
    expect(fs.readFileSync(stored.path).equals(body)).toBe(true);
    expect(listFiles(root)).toEqual([stored.path]);
  });

  it('keeps a plain ownerKey as its own segment', async () => {
    const stored = await store.putObject({ area: 'assays', ownerKey: 'ASSAY-01_b', body: Buffer.from('x') });

    expect(ownerSegment('ASSAY-01_b')).toBe('ASSAY-01_b');
    expect(stored.uri).toMatch(/^objstore:\/\/assays\/ASSAY-01_b\/sha256\/[0-9a-f]{64}$/);
  });

  // A client-supplied parent id is data, never a path (#1321).
  it.each([
    ['a space and an accent', 'Ensaio São Paulo 1'],
    ['a dot-dot id', '..'],
    ['a slash', 'a/b'],
    ['a dotted id', 'ds.v1'],
    ['an id in the x- namespace', 'x-abc']
  ])('maps an ownerKey with %s to an x- segment inside the root and reads it back', async (_label, ownerKey) => {
    const body = Buffer.from(`body of ${ownerKey}`);
    const segment = `x-${sha256Hex(ownerKey)}`;

    const stored = await store.putObject({ area: 'assays', ownerKey, body });

    expect(ownerSegment(ownerKey)).toBe(segment);
    expect(stored.uri).toBe(`objstore://assays/${segment}/sha256/${sha256Hex(body)}`);
    expect(stored.path).toBe(path.join(root, 'assays', segment, 'sha256', sha256Hex(body)));
    expect(listFiles(root)).toEqual([stored.path]);
    expect((await store.getObject(stored.uri)).equals(body)).toBe(true);
  });

  // #1321: the key-rotation rewrite puts under the owner segment of a stored URI.
  it('puts under a given owner segment as is, an x- segment included', async () => {
    const owner = ownerSegment('a b');
    const body = Buffer.from('rewritten under its owner');

    const stored = await store.putObject({ area: 'assays', owner, body });

    expect(stored.uri).toBe(`objstore://assays/${owner}/sha256/${sha256Hex(body)}`);
    expect(stored.uri.split('/')[3]).not.toBe(ownerSegment(owner));
    expect((await store.getObject(stored.uri)).equals(body)).toBe(true);
  });

  it('refuses an owner outside the plain pattern, or given with an ownerKey', async () => {
    const body = Buffer.from('x');
    for (const args of [{ owner: '../x' }, { owner: 'a.b' }, { owner: 'o', ownerKey: 'o' }]) {
      await expect(store.putObject({ area: 'samples', body, ...args })).rejects.toMatchObject({ code: 'OBJECT_KEY_INVALID' });
    }

    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('reuses the existing object for a second put of the same bytes', async () => {
    const body = Buffer.from('same bytes');

    const first = await store.putObject({ area: 'samples', ownerKey: 'o', body });
    const second = await store.putObject({ area: 'samples', ownerKey: 'o', body });

    expect(second).toEqual(first);
    expect(listFiles(root)).toEqual([first.path]);
  });

  it('refuses a put whose key path holds other bytes and leaves them unchanged', async () => {
    const body = Buffer.from('new bytes');
    const hex = sha256Hex(body);
    const keyPath = path.join(root, 'samples', 'o', 'sha256', hex);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, 'other bytes');

    await expect(store.putObject({ area: 'samples', ownerKey: 'o', body }))
      .rejects.toMatchObject({ code: 'OBJECT_CONFLICT' });

    expect(fs.readFileSync(keyPath, 'utf8')).toBe('other bytes');
    expect(listFiles(root)).toEqual([keyPath]);
  });

  it('refuses a put whose key path is a directory', async () => {
    const body = Buffer.from('dir bytes');
    const keyPath = path.join(root, 'samples', 'o', 'sha256', sha256Hex(body));
    fs.mkdirSync(keyPath, { recursive: true });

    await expect(store.putObject({ area: 'samples', ownerKey: 'o', body }))
      .rejects.toMatchObject({ code: 'OBJECT_CONFLICT' });

    expect(fs.statSync(keyPath).isDirectory()).toBe(true);
    expect(listFiles(root)).toEqual([]);
  });

  it.each([
    ['an area of ../x', { area: '../x' }],
    ['an area of a/b', { area: 'a/b' }],
    ['an area of ..', { area: '..' }],
    ['an area of .', { area: '.' }],
    ['an empty area', { area: '' }],
    ['an empty ownerKey', { ownerKey: '' }],
    ['a non-string ownerKey', { ownerKey: 42 }],
    ['a body that is not a Buffer', { body: 'text' }]
  ])('refuses %s and writes nothing under the root', async (_label, overrides) => {
    const args = { area: 'samples', ownerKey: 'o', body: Buffer.from('x'), ...overrides };

    await expect(store.putObject(args)).rejects.toMatchObject({ code: 'OBJECT_KEY_INVALID' });

    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('getObject returns the stored bytes for the uri putObject returned', async () => {
    const body = Buffer.from('round trip');
    const { uri } = await store.putObject({ area: 'samples', ownerKey: 'o', body });

    const read = await store.getObject(uri);

    expect(read.equals(body)).toBe(true);
  });

  it.each([
    ['a /files/ label', 'objstore://samples/o/files/upload.csv'],
    ['a short digest', 'objstore://samples/o/sha256/abc'],
    ['a dot-only owner', `objstore://samples/../sha256/${'a'.repeat(64)}`],
    ['another scheme', `s3://samples/o/sha256/${'a'.repeat(64)}`]
  ])('getObject refuses %s', async (_label, uri) => {
    await expect(store.getObject(uri)).rejects.toMatchObject({ code: 'OBJECT_KEY_INVALID' });
  });

  it('getObject refuses an object whose bytes no longer match its key', async () => {
    const { uri, path: objectPath } = await store.putObject({ area: 'samples', ownerKey: 'o', body: Buffer.from('original') });
    fs.writeFileSync(objectPath, 'tampered');

    await expect(store.getObject(uri)).rejects.toMatchObject({ code: 'OBJECT_CONFLICT' });
  });
});
