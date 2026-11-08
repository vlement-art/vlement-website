import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import { formatDimensions } from '../lib/dimensions.mjs';

const CM = 72 / 2.54;
const WIDTH = 21 * CM;
const HEIGHT = 29.7 * CM;
const ink = rgb(36 / 255, 36 / 255, 31 / 255);
const accent = rgb(181 / 255, 72 / 255, 47 / 255);
const paper = rgb(247 / 255, 246 / 255, 243 / 255);

function textLines(text, font, size, width) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    let remaining = word;
    while (remaining) {
      const candidate = line ? `${line} ${remaining}` : remaining;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        break;
      }
      if (line) {
        lines.push(line);
        line = '';
        continue;
      }
      let end = remaining.length;
      while (end > 0 && font.widthOfTextAtSize(remaining.slice(0, end), size) > width) end--;
      if (!end) throw new Error('A character is too wide for the certificate layout.');
      lines.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function createCertificatePdf(snapshot, verificationUrl, certificateNumber, imageBytes, fonts) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Certificate of Authenticity — ${snapshot.title}`);
  pdf.setAuthor(snapshot.artist || 'Vlement J Rodrigues');
  pdf.setSubject(`Certificate ${snapshot.title}`);
  const page = pdf.addPage([WIDTH, HEIGHT]);
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const y = top => HEIGHT - top * CM;

  function draw(text, font, size, x, baseline, color = ink) {
    const value = String(text);
    const available = new Set(font.getCharacterSet());
    for (const character of value) {
      if (!available.has(character.codePointAt(0))) {
        throw new Error(`The certificate font does not support the character "${character}".`);
      }
    }
    page.drawText(value, { x, y: y(baseline), font, size, color });
  }

  function centered(text, font, size, baseline, color = ink) {
    const width = font.widthOfTextAtSize(String(text), size);
    if (width > 18 * CM) throw new Error('Text is too long for the certificate layout.');
    draw(text, font, size, (WIDTH - width) / 2, baseline, color);
  }

  function field(label, value, labelX, valueX, baseline, endX) {
    draw(`${label}:`, bold, 8, labelX * CM, baseline);
    const text = String(value ?? '');
    const width = (endX - valueX) * CM;
    let size = 10;
    while (size > 8 && regular.widthOfTextAtSize(text, size) > width) size -= 0.5;
    let lines = textLines(text, regular, size, width);
    if (lines.length > 2) {
      const characters = Array.from(text);
      let end = characters.length;
      while (end > 0 && regular.widthOfTextAtSize(characters.slice(0, end).join(''), size) > width) end--;
      lines = [characters.slice(0, end).join('').trimEnd(), characters.slice(end).join('').trimStart()];
    }
    if (lines.length > 2 || lines.some(line => regular.widthOfTextAtSize(line, size) > width)) {
      throw new Error(`${label} is too long for the certificate; shorten it before issuing.`);
    }
    lines.forEach((line, index) => draw(line, regular, size, valueX * CM, baseline + index * 0.4));
  }

  page.drawRectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, color: paper });
  page.drawRectangle({
    x: 0.78 * CM, y: 0.78 * CM, width: WIDTH - 1.56 * CM, height: HEIGHT - 1.56 * CM,
    borderColor: ink, borderWidth: 0.8,
  });
  centered('VLEMENT J. RODRIGUES', bold, 14, 2.5);
  centered('Certificate of Authenticity', regular, 18, 3.6);

  const artworkImage = await pdf.embedJpg(imageBytes);
  const scale = Math.min(12 * CM / artworkImage.width, 8 * CM / artworkImage.height);
  const imageWidth = artworkImage.width * scale;
  const imageHeight = artworkImage.height * scale;
  page.drawImage(artworkImage, {
    x: (WIDTH - imageWidth) / 2, y: y(4.8) - imageHeight, width: imageWidth, height: imageHeight,
  });

  field('ARTWORK', snapshot.title, 3.5, 5.8, 14.0, 10.9);
  field('YEAR', snapshot.year, 3.5, 5.8, 15.0, 10.9);
  field('MEDIUM', snapshot.medium, 11.2, 13.9, 14.0, 20.0);
  field('DIMENSIONS', formatDimensions(snapshot.dimensions), 11.2, 13.9, 15.0, 20.0);

  const wording = textLines(snapshot.certificateWording || '', regular, 9, 12.5 * CM);
  if (wording.length > 4) throw new Error('Certificate wording is too long for the layout.');
  wording.forEach((line, index) => centered(line, regular, 9, 16.8 + index * 0.4));
  if (snapshot.certificateType === 'limited_edition') {
    if (!snapshot.editionNumber || !snapshot.editionSize) throw new Error('The limited edition number and size are required.');
    centered(`Edition ${snapshot.editionNumber} of ${snapshot.editionSize}`, regular, 9, 18.6);
  } else if (snapshot.certificateType === 'open_edition') {
    centered('Open edition', regular, 9, 18.6);
  }

  for (const [left, right, label] of [[3.2, 9.5, 'Artist Signature'], [12.5, 16.5, 'Date']]) {
    page.drawLine({ start: { x: left * CM, y: y(19.6) }, end: { x: right * CM, y: y(19.6) }, thickness: 0.8, color: ink });
    const labelWidth = bold.widthOfTextAtSize(label, 8);
    draw(label, bold, 8, ((left + right) * CM - labelWidth) / 2, 20.2);
  }
  const uid = snapshot.nfcTagUid || '';
  const uidLabel = 'NFC UID:';
  const uidLabelWidth = bold.widthOfTextAtSize(uidLabel, 8);
  const uidWidth = uid ? regular.widthOfTextAtSize(uid, 8) : 5 * CM;
  if (uidLabelWidth + 6 + uidWidth > 18 * CM) throw new Error('NFC UID is too long for the certificate layout.');
  const uidX = (WIDTH - uidLabelWidth - 6 - uidWidth) / 2;
  draw(uidLabel, bold, 8, uidX, 21.5);
  if (uid) {
    draw(uid, regular, 8, uidX + uidLabelWidth + 6, 21.5);
  } else {
    page.drawLine({
      start: { x: uidX + uidLabelWidth + 6, y: y(21.5) },
      end: { x: uidX + uidLabelWidth + 6 + uidWidth, y: y(21.5) },
      thickness: 0.8, color: ink,
    });
  }
  centered('Scan to verify', regular, 8, 22.7);
  const matrix = QRCode.create(verificationUrl, { errorCorrectionLevel: 'M' }).modules;
  const qrSize = 2.8 * CM;
  const boxLeft = (WIDTH - qrSize) / 2;
  const boxBottom = y(23.0) - qrSize;
  const margin = Math.max(0.3 * CM, qrSize * 4 / (matrix.size + 8));
  page.drawRectangle({ x: boxLeft, y: boxBottom, width: qrSize, height: qrSize, color: rgb(1, 1, 1) });
  const moduleSize = (qrSize - 2 * margin) / matrix.size;
  const qrLeft = boxLeft + margin;
  const qrBottom = boxBottom + margin;
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (matrix.get(row, col)) {
        page.drawRectangle({
          x: qrLeft + col * moduleSize, y: qrBottom + (matrix.size - row - 1) * moduleSize,
          width: moduleSize, height: moduleSize, color: rgb(0, 0, 0),
        });
      }
    }
  }
  centered(snapshot.artworkCode || certificateNumber, bold, 9, 26.5, accent);
  centered('This certificate is valid only when verified online.', regular, 8, 27.2);
  centered('VLEMENT.COM/VERIFY', bold, 8, 27.8);
  return pdf.save({ useObjectStreams: false });
}
