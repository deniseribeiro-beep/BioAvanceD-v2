const zlib = require('zlib');
const { buildSignedTclePdf, decodePng } = require('../../src/services/tclePdf');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}

function png({ width, height, colorType, bitDepth = 8, raw, extraChunks = [] }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const idat = zlib.deflateSync(raw);
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr), ...extraChunks];
  const mid = Math.max(1, Math.floor(idat.length / 2));
  parts.push(chunk('IDAT', idat.subarray(0, mid)));
  parts.push(chunk('IDAT', idat.subarray(mid)));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function scanline(filter, bytes) {
  return Buffer.concat([Buffer.from([filter]), bytes]);
}

describe('tclePdf', () => {
  it('rejects a buffer that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('not-a-png'))).toThrow('Assinatura não é um PNG');
  });

  it('rejects an unsupported signature image', () => {
    const raw = scanline(0, Buffer.from([0]));
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 3, raw }))).toThrow('PNG da assinatura não suportado');
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 0, bitDepth: 16, raw }))).toThrow('PNG da assinatura não suportado');
    expect(() => decodePng(png({ width: 1, height: 1, colorType: 0, raw: scanline(5, Buffer.from([1])) }))).toThrow('Filtro PNG não suportado');
  });

  it('decodes the PNG color types and the five scanline filters', () => {
    const gray = decodePng(png({
      width: 2,
      height: 1,
      colorType: 0,
      raw: scanline(1, Buffer.from([10, 20])),
    }));
    expect(gray).toMatchObject({ width: 2, height: 1 });
    expect([...gray.rgb.subarray(0, 3)]).toEqual([10, 10, 10]);
    expect([...gray.rgb.subarray(3, 6)]).toEqual([30, 30, 30]);

    const rgb = decodePng(png({
      width: 1,
      height: 2,
      colorType: 2,
      raw: Buffer.concat([
        scanline(0, Buffer.from([1, 2, 3])),
        scanline(2, Buffer.from([4, 5, 6])),
      ]),
    }));
    expect([...rgb.rgb.subarray(3, 6)]).toEqual([5, 7, 9]);

    const grayAlpha = decodePng(png({
      width: 2,
      height: 1,
      colorType: 4,
      raw: scanline(3, Buffer.from([10, 255, 10, 128])),
    }));
    expect(grayAlpha.rgb[0]).toBe(10);
    expect(grayAlpha.rgb[3]).toBeGreaterThan(10);

    const rgba = decodePng(png({
      width: 1,
      height: 1,
      colorType: 6,
      raw: scanline(0, Buffer.from([0, 0, 0, 0])),
    }));
    expect([...rgba.rgb]).toEqual([255, 255, 255]);

    const paeth = decodePng(png({
      width: 2,
      height: 2,
      colorType: 0,
      raw: Buffer.concat([
        scanline(0, Buffer.from([5, 10])),
        scanline(4, Buffer.from([251, 0])),
      ]),
    }));
    expect(paeth.rgb[6]).toBe(0);
    expect(paeth.rgb[9]).toBe(5);

    const left = decodePng(png({
      width: 1,
      height: 1,
      colorType: 0,
      raw: scanline(4, Buffer.from([7])),
    }));
    expect(left.rgb[0]).toBe(7);
  });

  it('builds a one-page PDF from the term, the place and the signature', () => {
    const signature = png({
      width: 1000,
      height: 1,
      colorType: 0,
      raw: scanline(0, Buffer.alloc(1000, 1)),
      extraChunks: [chunk('tEXt', Buffer.from('Comment\0prova'))],
    }).toString('base64');
    const words = Array.from({ length: 30 }, (_, index) => `palavra${index}`).join(' ');
    const pdf = buildSignedTclePdf({
      template: {
        title: 'Termo (oficial) \\ você',
        version: '1.2',
        htmlContent: `<script>SEGREDO</script><style>.x{}</style><p>Linha &amp; &lt;texto&gt; &quot;ok&quot;</p><p></p><p>${words}</p>`,
      },
      collectionPlace: 'Laboratório',
      decisionDateTime: '2026-11-05T20:04:30.000Z',
      signatureImageBase64: `data:image/png;base64,${signature}`,
    });

    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Termo \\(oficial\\) \\\\ você');
    expect(text).toContain('Versão 1.2');
    expect(text).toContain('Linha & <texto> "ok"');
    expect(text).not.toContain('SEGREDO');
    expect(text).toContain('Local da coleta: Laboratório');
    expect(text).toContain('palavra29');
    expect(text).toContain('%%EOF');

    const bare = buildSignedTclePdf({
      template: { content: 'Somente texto' },
      decisionDateTime: '2026-11-05T12:00:00.000Z',
      signatureImageBase64: signature,
    });
    expect(bare.toString('latin1')).toContain('(TCLE) Tj');
    expect(bare.toString('latin1')).toContain('Somente texto');
  });
});
