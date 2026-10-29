import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FORMAT_POLICY,
  isMimeAllowedForExtension,
  checkFileSignature,
  canonicalMimeType
} = require('../../src/utils/uploadFormatPolicy');

// #1321 (RF007 AC1, RNF029 C1): an upload's extension, MIME and leading
// bytes must agree. These cases write real files so the head read is real.
const written = [];

function writeTemp(ext, content) {
  const filePath = path.join(
    os.tmpdir(),
    `upload-format-policy-${process.pid}-${written.length}-${Date.now()}${ext}`
  );
  fs.writeFileSync(filePath, content);
  written.push(filePath);
  return filePath;
}

const bytes = (...values) => Buffer.from(values);

afterEach(() => {
  while (written.length) {
    const filePath = written.pop();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

describe('uploadFormatPolicy - checkFileSignature', () => {
  const families = [
    { ext: '.pdf', good: Buffer.concat([Buffer.from('\n\n'), Buffer.from('%PDF-1.7\n')]) },
    { ext: '.png', good: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00) },
    { ext: '.jpg', good: bytes(0xff, 0xd8, 0xff, 0xe0) },
    { ext: '.jpeg', good: bytes(0xff, 0xd8, 0xff, 0xdb) },
    { ext: '.zip', good: bytes(0x50, 0x4b, 0x03, 0x04, 0x14) },
    { ext: '.zip', good: bytes(0x50, 0x4b, 0x05, 0x06, 0x00) },
    { ext: '.xlsx', good: bytes(0x50, 0x4b, 0x03, 0x04, 0x14) },
    { ext: '.xls', good: bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) },
    { ext: '.rar', good: bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00) },
    { ext: '.fastq.gz', good: bytes(0x1f, 0x8b, 0x08) },
    { ext: '.vcf.gz', good: bytes(0x1f, 0x8b, 0x08) },
    { ext: '.bam', good: bytes(0x1f, 0x8b, 0x08, 0x04) },
    { ext: '.h5', good: bytes(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a) },
    { ext: '.fcs', good: Buffer.from('FCS3.1    ') }
  ];

  it.each(families)('$ext passes with its own signature', ({ ext, good }) => {
    expect(checkFileSignature(writeTemp(ext, good), ext)).toEqual({ ok: true });
  });

  it.each(families)('$ext fails with text content', ({ ext }) => {
    const result = checkFileSignature(writeTemp(ext, 'just,some,text\n'), ext);
    expect(result.ok).toBe(false);
    expect(result.reason).toEqual(expect.any(String));
  });

  it('.h5 passes with its signature after a 512-byte user block', () => {
    const content = Buffer.concat([
      Buffer.alloc(512, 0x20),
      bytes(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a)
    ]);
    expect(checkFileSignature(writeTemp('.h5', content), '.h5')).toEqual({ ok: true });
  });

  it('.xlsx fails with an empty-archive zip signature', () => {
    const content = bytes(0x50, 0x4b, 0x05, 0x06, 0x00);
    expect(checkFileSignature(writeTemp('.xlsx', content), '.xlsx').ok).toBe(false);
  });

  it.each(['.csv', '.tsv', '.txt', '.sam', '.fastq', '.json', '.vcf'])('%s passes with plain text', (ext) => {
    expect(checkFileSignature(writeTemp(ext, 'a\tb\n1\t2\n'), ext)).toEqual({ ok: true });
  });

  it('.raw passes with arbitrary bytes', () => {
    expect(checkFileSignature(writeTemp('.raw', bytes(0x01, 0x00, 0xff, 0x10)), '.raw')).toEqual({ ok: true });
  });

  it('.csv fails when its head is a PE executable', () => {
    expect(checkFileSignature(writeTemp('.csv', bytes(0x4d, 0x5a, 0x90, 0x00, 0x03)), '.csv').ok).toBe(false);
  });

  it('.csv passes with a mass-spectrometry header row starting MZ', () => {
    expect(checkFileSignature(writeTemp('.csv', 'MZ,Intensity\n100.1,2000\n'), '.csv')).toEqual({ ok: true });
  });

  it('.csv fails when it starts with a #! script line', () => {
    expect(checkFileSignature(writeTemp('.csv', '#!/bin/sh\necho hi\n'), '.csv').ok).toBe(false);
  });

  it('.raw fails when its head is a PE executable', () => {
    expect(checkFileSignature(writeTemp('.raw', bytes(0x4d, 0x5a, 0x90, 0x00)), '.raw').ok).toBe(false);
  });

  it('.txt fails when it starts with a #! script line', () => {
    expect(checkFileSignature(writeTemp('.txt', '#!/bin/sh\necho hi\n'), '.txt').ok).toBe(false);
  });

  it.each([
    ['ELF', bytes(0x7f, 0x45, 0x4c, 0x46, 0x02)],
    ['Mach-O', bytes(0xcf, 0xfa, 0xed, 0xfe, 0x07)],
    ['Mach-O fat', bytes(0xca, 0xfe, 0xba, 0xbe, 0x00)]
  ])('.raw fails when its head is %s', (_name, content) => {
    expect(checkFileSignature(writeTemp('.raw', content), '.raw').ok).toBe(false);
  });

  it('.csv fails when it holds a NUL byte', () => {
    expect(checkFileSignature(writeTemp('.csv', Buffer.from('a,b\u0000,c\n')), '.csv').ok).toBe(false);
  });

  it('.csv passes as UTF-16 LE with its BOM', () => {
    const content = Buffer.concat([bytes(0xff, 0xfe), Buffer.from('a,b\n', 'utf16le')]);
    expect(checkFileSignature(writeTemp('.csv', content), '.csv')).toEqual({ ok: true });
  });

  it('an empty .csv passes and an empty .pdf fails', () => {
    expect(checkFileSignature(writeTemp('.csv', ''), '.csv')).toEqual({ ok: true });
    expect(checkFileSignature(writeTemp('.pdf', ''), '.pdf').ok).toBe(false);
  });

  it('a missing path fails closed', () => {
    const missing = path.join(os.tmpdir(), `upload-format-policy-missing-${process.pid}-${Date.now()}.csv`);
    expect(checkFileSignature(missing, '.csv').ok).toBe(false);
  });

  it('an unknown extension fails', () => {
    expect(checkFileSignature(writeTemp('.xyz', 'hello'), '.xyz').ok).toBe(false);
  });
});

describe('uploadFormatPolicy - isMimeAllowedForExtension', () => {
  it('accepts application/octet-stream on every extension', () => {
    for (const ext of Object.keys(FORMAT_POLICY)) {
      expect(isMimeAllowedForExtension(ext, 'application/octet-stream')).toBe(true);
    }
  });

  it('accepts a MIME with parameters, case-insensitively', () => {
    expect(isMimeAllowedForExtension('.csv', 'text/csv; charset=utf-8')).toBe(true);
    expect(isMimeAllowedForExtension('.pdf', 'Application/PDF')).toBe(true);
  });

  it('rejects a MIME that belongs to another format', () => {
    expect(isMimeAllowedForExtension('.csv', 'application/pdf')).toBe(false);
  });

  it('rejects an unknown extension', () => {
    expect(isMimeAllowedForExtension('.xyz', 'application/octet-stream')).toBe(false);
  });

  it('rejects a missing or empty MIME', () => {
    expect(isMimeAllowedForExtension('.csv', undefined)).toBe(false);
    expect(isMimeAllowedForExtension('.csv', '')).toBe(false);
  });
});

// RF007 AC3, V2E-0471 (#1321): a DataFile's mimeType is its extension's
// canonical type, never the client's declared one.
describe('canonicalMimeType', () => {
  it('answers the first MIME of the extension policy', () => {
    expect(canonicalMimeType('.csv')).toBe('text/csv');
    expect(canonicalMimeType('.fastq.gz')).toBe('application/gzip');
  });

  it('answers text/plain for a .vcf, a Variant Call Format file, never a vCard, and still accepts the vCard MIMEs browsers send', () => {
    expect(canonicalMimeType('.vcf')).toBe('text/plain');
    expect(isMimeAllowedForExtension('.vcf', 'text/vcard')).toBe(true);
    expect(isMimeAllowedForExtension('.vcf', 'text/x-vcard')).toBe(true);
  });

  it('answers application/octet-stream for a policy with no MIME list', () => {
    expect(canonicalMimeType('.raw')).toBe('application/octet-stream');
    expect(canonicalMimeType('.bam')).toBe('application/octet-stream');
  });

  it('answers application/octet-stream for an unknown extension', () => {
    expect(canonicalMimeType('.xyz')).toBe('application/octet-stream');
    expect(canonicalMimeType(undefined)).toBe('application/octet-stream');
  });
});
