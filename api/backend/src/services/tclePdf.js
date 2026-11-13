const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

function unfilterRow(filter, row, previous, channels) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= channels ? row[index - channels] : 0;
    const up = previous[index];
    const upLeft = index >= channels ? previous[index - channels] : 0;
    let value = row[index];
    if (filter === 1) value = (value + left) & 255;
    else if (filter === 2) value = (value + up) & 255;
    else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error('Filtro PNG não suportado');
    row[index] = value;
  }
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Assinatura não é um PNG');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (bitDepth !== 8 || !channels || !width || !height) {
    throw new Error('PNG da assinatura não suportado');
  }

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgb = Buffer.alloc(width * height * 3);
  let cursor = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor];
    cursor += 1;
    const row = Buffer.from(inflated.subarray(cursor, cursor + stride));
    cursor += stride;
    unfilterRow(filter, row, previous, channels);
    previous = row;
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 3;
      if (channels === 4) {
        const alpha = row[x * 4 + 3] / 255;
        rgb[target] = Math.round(row[x * 4] * alpha + 255 * (1 - alpha));
        rgb[target + 1] = Math.round(row[x * 4 + 1] * alpha + 255 * (1 - alpha));
        rgb[target + 2] = Math.round(row[x * 4 + 2] * alpha + 255 * (1 - alpha));
      } else if (channels === 3) {
        rgb[target] = row[x * 3];
        rgb[target + 1] = row[x * 3 + 1];
        rgb[target + 2] = row[x * 3 + 2];
      } else if (channels === 2) {
        const alpha = row[x * 2 + 1] / 255;
        const gray = Math.round(row[x * 2] * alpha + 255 * (1 - alpha));
        rgb[target] = gray;
        rgb[target + 1] = gray;
        rgb[target + 2] = gray;
      } else {
        rgb[target] = row[x];
        rgb[target + 1] = row[x];
        rgb[target + 2] = row[x];
      }
    }
  }

  return { width, height, rgb };
}

function pngFromSignature(signatureImageBase64) {
  const match = String(signatureImageBase64 || '').match(/^data:[^;]+;base64,(.+)$/i);
  const payload = match ? match[1] : String(signatureImageBase64 || '');
  return decodePng(Buffer.from(payload, 'base64'));
}

function pdfLiteral(value) {
  return String(value || '')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function htmlToLines(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
  const wrapped = [];
  text.split(/\n/).forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push('');
      return;
    }
    let line = '';
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (next.length > 90) {
        if (line) wrapped.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) wrapped.push(line);
  });
  return wrapped.slice(0, 40);
}

function formatCollectedAt(decisionDateTime) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(decisionDateTime));
}

function buildSignedTclePdf({ template, collectionPlace, decisionDateTime, signatureImageBase64 }) {
  const image = pngFromSignature(signatureImageBase64);
  const compressed = zlib.deflateSync(image.rgb);
  const lines = [
    template?.title || 'TCLE',
    template?.version ? `Versão ${template.version}` : '',
    '',
    ...htmlToLines(template?.htmlContent || template?.content || ''),
    '',
    `Local da coleta: ${collectionPlace || ''}`,
    `Data e hora: ${formatCollectedAt(decisionDateTime)}`,
    'Assinatura do participante:'
  ];

  const commands = ['BT', '/F1 11 Tf', '50 790 Td', '14 TL'];
  lines.forEach((line, index) => {
    if (index === 0) commands.push(`(${pdfLiteral(line)}) Tj`);
    else commands.push(`T* (${pdfLiteral(line)}) Tj`);
  });
  commands.push('ET');
  const displayWidth = Math.min(220, image.width);
  const displayHeight = Math.min(70, Math.round(image.height * (displayWidth / image.width)) || 40);
  commands.push(`q ${displayWidth} 0 0 ${displayHeight} 50 ${790 - lines.length * 14 - displayHeight - 8} cm /Im1 Do Q`);
  const content = Buffer.from(commands.join('\n'), 'latin1');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content.toString('latin1')}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n${compressed.toString('latin1')}\nendstream`
  ];

  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

module.exports = {
  decodePng,
  buildSignedTclePdf
};
