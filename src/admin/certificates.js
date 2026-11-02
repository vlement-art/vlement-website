import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import { getNfcTagUidLabel } from './certificate-pdf-label';

(() => {
  const configUrl = window.CERTIFICATES_API_URL;
  let activePreviewUrl = null;
  const types = [
    { value: 'original', label: 'Original' },
    { value: 'limited_edition', label: 'Limited edition' },
    { value: 'open_edition', label: 'Open edition' }
  ];

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const formatType = type => types.find(item => item.value === type)?.label || type;
  const getEntries = () => window.VlementAdmin.getEntries();
  const getArtwork = slug => getEntries().find(entry => entry.slug === slug);
  const authorizationHeaders = () => ({
    Authorization: `Bearer ${window.VlementAdmin.getToken()}`
  });

  async function apiRequest(path, options = {}) {
    if (!configUrl) throw new Error('Certificate services are not configured for this site yet.');
    const response = await fetch(`${configUrl}${path}`, {
      ...options,
      headers: {
        ...authorizationHeaders(),
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Certificate service returned ${response.status}.`);
    return payload;
  }

  function showManager(message = '') {
    if (activePreviewUrl) URL.revokeObjectURL(activePreviewUrl);
    activePreviewUrl = null;
    document.getElementById('modal').innerHTML = `
      <h2>Artwork certificates</h2>
      <p class="hint">New certificates become valid after their PDF is created and stored.</p>
      ${message ? `<div class="status-banner info">${escapeHtml(message)}</div>` : ''}
      <div id="certificates-list" class="field">Loading certificates…</div>
      <div id="modal-error"></div>
      <div class="modal-footer">
        <button class="btn" id="certificates-refresh">Refresh</button>
        <div class="right">
          <button class="btn" id="certificates-close">Close</button>
          <button class="btn" id="certificates-backup">Download backup (.zip)</button>
          <button class="btn primary" id="certificate-new">Issue certificate</button>
        </div>
      </div>`;
    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('certificates-close').onclick = () => {
      document.getElementById('modal-overlay').hidden = true;
    };
    document.getElementById('certificates-refresh').onclick = () => loadCertificates().catch(error => {
      const list = document.getElementById('certificates-list');
      if (list) list.innerHTML = `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
    });
    document.getElementById('certificates-backup').onclick = downloadBackup;
    document.getElementById('certificate-new').onclick = () => openIssueForm();
    loadCertificates().catch(error => {
      const list = document.getElementById('certificates-list');
      if (list) list.innerHTML = `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
    });
  }

  async function loadCertificates() {
    const list = document.getElementById('certificates-list');
    if (list) list.textContent = 'Loading certificates…';
    const payload = await apiRequest('/api/admin/certificates');
    const certificates = payload.certificates || [];
    const rows = certificates.map(certificate => {
      const snapshot = certificate.snapshot || {};
      const pending = certificate.version_status === 'pending'
        && !['revoked', 'voided'].includes(certificate.status);
      const valid = certificate.status === 'valid'
        && ['valid', 'voided'].includes(certificate.version_status);
      const status = certificate.status === 'revoked' ? 'Revoked'
        : certificate.status === 'voided' ? 'Voided'
          : pending ? 'Pending PDF'
            : valid && certificate.version_status === 'voided' ? 'Valid (previous version)'
              : valid ? 'Valid' : escapeHtml(certificate.version_status);
      return `
        <article style="border-bottom:1px solid var(--line);padding:12px 0">
          <strong>${escapeHtml(certificate.certificate_number)}</strong>
          <span class="hint"> · ${escapeHtml(formatType(certificate.certificate_type))} · ${escapeHtml(snapshot.title || certificate.artwork_slug)}</span>
          <div class="hint">${escapeHtml(status)}</div>
          ${pending ? `<div class="hint">${escapeHtml(certificate.verificationUrl)}</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn" data-history="${escapeHtml(certificate.id)}">History</button>
            ${pending ? `<button class="btn primary" data-complete="${escapeHtml(certificate.id)}" data-version="${escapeHtml(certificate.version_id)}">Review PDF</button>` : ''}
            ${valid ? `<button class="btn" data-reissue="${escapeHtml(certificate.id)}">Reissue</button>
              <button class="btn" data-tags="${escapeHtml(certificate.id)}">NFC tags</button>
              <button class="btn danger" data-revoke="${escapeHtml(certificate.id)}">Revoke</button>` : ''}
            ${pending ? `<button class="btn danger" data-void="${escapeHtml(certificate.id)}" data-version="${escapeHtml(certificate.version_id)}">Void pending</button>` : ''}
          </div>
        </article>`;
    }).join('');
    if (list) {
      list.innerHTML = rows || '<p>No certificates have been issued.</p>';
      list.querySelectorAll('[data-reissue]').forEach(button => {
        button.onclick = () => {
          const record = certificates.find(item => item.id === button.dataset.reissue);
          openIssueForm(record);
        };
      });
      list.querySelectorAll('[data-revoke]').forEach(button => {
        button.onclick = () => revokeCertificate(button.dataset.revoke);
      });
      list.querySelectorAll('[data-void]').forEach(button => {
        button.onclick = () => voidVersion(button.dataset.void, button.dataset.version);
      });
      list.querySelectorAll('[data-complete]').forEach(button => {
        button.onclick = () => completePending(
          certificates.find(item => item.id === button.dataset.complete),
        );
      });
      list.querySelectorAll('[data-tags]').forEach(button => {
        button.onclick = () => openTagManager(
          certificates.find(item => item.id === button.dataset.tags),
        );
      });
      list.querySelectorAll('[data-history]').forEach(button => {
        button.onclick = () => openVersionHistory(
          certificates.find(item => item.id === button.dataset.history),
        );
      });
    }
  }

  function openIssueForm(reissue = null, pendingDraft = null) {
    const entries = getEntries();
    const sourceCertificate = pendingDraft?.certificate || reissue;
    const sourceSnapshot = pendingDraft?.request?.artwork || sourceCertificate?.snapshot || {};
    const artworkSlug = sourceSnapshot.slug || sourceCertificate?.artwork_slug;
    const artworkSelect = sourceCertificate
      ? `<input type="hidden" id="certificate-artwork" value="${escapeHtml(artworkSlug)}">
         <p>${escapeHtml(sourceSnapshot.title || artworkSlug)}</p>`
      : `<select id="certificate-artwork">
          <option value="">Choose artwork</option>
          ${entries.map(entry => `<option value="${escapeHtml(entry.slug)}">${escapeHtml(entry.data.title || entry.slug)}</option>`).join('')}
        </select>`;
    const defaultType = sourceCertificate?.certificate_type || 'original';
    const reason = pendingDraft?.reason || sourceCertificate?.reissue_reason || '';
    document.getElementById('modal').innerHTML = `
      <h2>${pendingDraft ? 'Edit pending certificate' : reissue ? 'Reissue certificate' : 'Issue certificate'}</h2>
      <div class="field"><label for="certificate-artwork">Artwork</label>${artworkSelect}</div>
      <div class="field"><label for="certificate-type">Certificate type</label>
        <select id="certificate-type">${types.map(type =>
          `<option value="${type.value}" ${type.value === defaultType ? 'selected' : ''}>${type.label}</option>`
        ).join('')}</select>
      </div>
      <div class="row2" id="certificate-edition-fields">
        <div class="field"><label for="certificate-edition-number">Edition number</label>
          <input type="number" id="certificate-edition-number" min="1" value="${escapeHtml(pendingDraft?.request?.editionNumber ?? sourceSnapshot.editionNumber ?? sourceCertificate?.edition_number ?? '')}">
        </div>
        <div class="field"><label for="certificate-edition-size">Edition size</label>
          <input type="number" id="certificate-edition-size" min="1" value="${escapeHtml(pendingDraft?.request?.editionSize ?? sourceSnapshot.editionSize ?? sourceCertificate?.edition_size ?? '')}">
        </div>
      </div>
      <div class="row2">
        <div class="field"><label for="certificate-nfc-uid">NFC tag UID (optional)</label>
          <input id="certificate-nfc-uid" maxlength="120" pattern="[A-Za-z0-9._:-]*"
            value="${escapeHtml(pendingDraft?.request?.nfcTagUid || sourceSnapshot.nfcTagUid || sourceCertificate?.nfc_tag_uid || '')}" placeholder="e.g. 04:A3:2B:C1:D4:E5:F6">
          <span class="hint">Letters, numbers, dots, colons, dashes and underscores only. Reissues keep an existing active matching UID linked.</span>
        </div>
        <div class="field"><label for="certificate-nfc-placement">Tag placement</label>
          <input id="certificate-nfc-placement" maxlength="200"
            value="${escapeHtml(pendingDraft?.request?.nfcTagPlacement || sourceSnapshot.nfcTagPlacement || sourceCertificate?.nfc_tag_placement || '')}" placeholder="e.g. reverse lower-right corner">
          <span class="hint">Required when entering a UID. Existing active tags keep their saved placement.</span>
        </div>
      </div>
      ${reissue || (pendingDraft && sourceCertificate?.status === 'valid') ? `<div class="field"><label for="certificate-reissue-reason">Reason for reissue</label>
        <input id="certificate-reissue-reason" maxlength="500" required value="${escapeHtml(reason)}"></div>` : ''}
      <div class="field"><label for="certificate-original-image">Original artwork image (JPEG, PNG, WebP or AVIF; max 8 MB)</label>
        <input type="file" id="certificate-original-image" accept="image/jpeg,image/png,image/webp,image/avif">
        <span class="hint">${pendingDraft ? 'The current preview image is kept unless you choose a replacement.' : "If no file is chosen, the artwork's current full-size site image is used."}</span>
      </div>
      <div id="modal-error"></div>
      <div class="modal-footer"><button class="btn" id="certificate-cancel">Cancel</button>
        <div class="right"><button class="btn primary" id="certificate-submit">${pendingDraft ? 'Update preview' : reissue ? 'Create pending reissue' : 'Create pending certificate'}</button></div>
      </div>`;
    document.getElementById('certificate-cancel').onclick = () => showManager();
    document.getElementById('certificate-type').onchange = event => {
      event.target.dataset.userSelected = 'true';
      updateEditionVisibility();
    };
    document.getElementById('certificate-artwork').onchange = updateEditionDefaults;
    document.getElementById('certificate-submit').onclick = () => submitIssue(reissue, pendingDraft);
    updateEditionDefaults();
  }

  function updateEditionVisibility() {
    document.getElementById('certificate-edition-fields').hidden =
      document.getElementById('certificate-type').value !== 'limited_edition';
  }

  function updateEditionDefaults() {
    updateEditionVisibility();
    const entry = getArtwork(document.getElementById('certificate-artwork').value);
    const type = document.getElementById('certificate-type');
    if (entry?.data.editionType && !type.dataset.userSelected) {
      type.value = {
        original: 'original',
        limited: 'limited_edition',
        open: 'open_edition'
      }[entry.data.editionType] || type.value;
      updateEditionVisibility();
    }
    document.getElementById('certificate-edition-size').value =
      entry?.data.editionSize || document.getElementById('certificate-edition-size').value;
  }

  async function submitIssue(reissue, pendingDraft = null) {
    const button = document.getElementById('certificate-submit');
    const error = document.getElementById('modal-error');
    button.disabled = true;
    error.textContent = '';
    try {
      const entry = getArtwork(document.getElementById('certificate-artwork').value);
      if (!entry) throw new Error('Choose an artwork.');
      const certificateType = document.getElementById('certificate-type').value;
      const sourceArtwork = pendingDraft?.request?.artwork || pendingDraft?.certificate?.snapshot || entry.data;
      const request = {
        certificateType,
        artwork: {
          slug: pendingDraft ? sourceArtwork.slug : entry.slug,
          title: sourceArtwork.title,
          year: sourceArtwork.year,
          medium: sourceArtwork.medium,
          dimensions: sourceArtwork.dimensions,
          image: sourceArtwork.image,
          altText: sourceArtwork.altText,
          support: sourceArtwork.support,
          printDate: sourceArtwork.printDate,
          signed: sourceArtwork.signed,
          editionType: sourceArtwork.editionType,
          editionSize: sourceArtwork.editionSize
        }
      };
      if (certificateType === 'limited_edition') {
        request.editionNumber = Number(document.getElementById('certificate-edition-number').value);
        request.editionSize = Number(document.getElementById('certificate-edition-size').value);
      }
      const nfcTagUid = document.getElementById('certificate-nfc-uid').value.trim();
      const nfcTagPlacement = document.getElementById('certificate-nfc-placement').value.trim();
      if (nfcTagUid) {
        if (!/^[A-Za-z0-9._:-]+$/.test(nfcTagUid)) {
          throw new Error('Enter an NFC tag UID using letters, numbers, dots, colons, dashes or underscores.');
        }
        if (!nfcTagPlacement) throw new Error('Enter the NFC tag placement to register this UID.');
        request.nfcTagUid = nfcTagUid;
        request.nfcTagPlacement = nfcTagPlacement;
      }
      if (reissue || pendingDraft?.certificate?.status === 'valid') {
        request.reason = document.getElementById('certificate-reissue-reason').value.trim();
      }
      const selectedFile = document.getElementById('certificate-original-image').files[0];
      let imageFile = selectedFile || pendingDraft?.imageFile;
      if (!imageFile) {
        const response = await fetch(entry.data.image, { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load the artwork image. Choose a file to upload instead.');
        const blob = await response.blob();
        const filename = entry.data.image.split('/').pop() || `${entry.slug}`;
        imageFile = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      }
      const formData = new FormData();
      formData.append('request', JSON.stringify(request));
      formData.append('originalImage', imageFile);
      const path = pendingDraft
        ? `/api/admin/certificates/${encodeURIComponent(pendingDraft.certificate.id)}/versions/${encodeURIComponent(pendingDraft.certificate.version_id)}/replace`
        : reissue
          ? `/api/admin/certificates/${encodeURIComponent(reissue.id)}/reissue`
          : '/api/admin/certificates/issue';
      const result = await apiRequest(path, { method: 'POST', body: formData });
      await previewCertificate(result.certificate, imageFile);
    } catch (issueError) {
      error.innerHTML = `<div class="status-banner error">${escapeHtml(issueError.message)}</div>`;
      button.disabled = false;
    }
  }

  async function completePending(certificate) {
    try {
      const response = await fetch(
        `${configUrl}/api/admin/certificates/${encodeURIComponent(certificate.id)}/versions/${encodeURIComponent(certificate.version_id)}/image`,
        { headers: authorizationHeaders(), cache: 'no-store' },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Could not load the saved artwork image.');
      }
      const blob = await response.blob();
      const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      const imageFile = new File([blob], `artwork-original.${extension}`, { type: blob.type });
      await previewCertificate(certificate, imageFile);
    } catch (error) {
      showManager(error.message);
    }
  }

  async function previewCertificate(certificate, imageFile) {
    try {
      const pdfBytes = await createCertificatePdf(
        certificate.snapshot,
        certificate.verificationUrl,
        certificate.certificate_number,
        imageFile,
      );
      activePreviewUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
      document.getElementById('modal').innerHTML = `
        <h2>Review certificate PDF · ${escapeHtml(certificate.certificate_number)}</h2>
        <p class="hint">Check the certificate details, NFC UID and verification QR code. It stays pending until you approve and finalize.</p>
        <iframe title="Certificate PDF preview" src="${activePreviewUrl}"
          style="width:100%;height:min(68vh,720px);border:1px solid var(--line);background:#fff"></iframe>
        <div id="certificate-preview-error"></div>
        <div class="modal-footer">
          <button class="btn" id="certificate-preview-edit">Back to edit</button>
          <div class="right"><button class="btn primary" id="certificate-preview-approve">Approve and finalize</button></div>
        </div>`;
      const pdf = new File([pdfBytes], 'certificate.pdf', { type: 'application/pdf' });
      document.getElementById('certificate-preview-approve').onclick = async event => {
        const button = event.currentTarget;
        const errorBox = document.getElementById('certificate-preview-error');
        button.disabled = true;
        errorBox.textContent = '';
        try {
          const formData = new FormData();
          formData.append('certificatePdf', pdf);
          await apiRequest(
            `/api/admin/certificates/${encodeURIComponent(certificate.id)}/versions/${encodeURIComponent(certificate.version_id)}/finalize`,
            { method: 'POST', body: formData },
          );
          showManager(`${certificate.certificate_number} was approved and finalized.`);
        } catch (error) {
          errorBox.innerHTML = `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
          button.disabled = false;
        }
      };
      document.getElementById('certificate-preview-edit').onclick = () => {
        if (activePreviewUrl) URL.revokeObjectURL(activePreviewUrl);
        activePreviewUrl = null;
        const existingCertificate = certificate.status === 'valid' ? certificate : null;
        openIssueForm(existingCertificate, {
          certificate,
          imageFile,
          reason: certificate.reissue_reason || '',
          request: {
            artwork: certificate.snapshot,
            certificateType: certificate.certificate_type,
            editionNumber: certificate.snapshot.editionNumber,
            editionSize: certificate.snapshot.editionSize,
            nfcTagUid: certificate.snapshot.nfcTagUid,
            nfcTagPlacement: certificate.snapshot.nfcTagPlacement,
          },
        });
      };
    } catch (error) {
      showManager(`The PDF preview could not be prepared. The certificate remains pending: ${error.message}`);
    }
  }

  async function createCertificatePdf(snapshot, verificationUrl, certificateNumber, sourceImage) {
    const bitmap = await createImageBitmap(sourceImage);
    const maxEdge = 2200;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare the certificate image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!jpeg) throw new Error('Your browser could not convert the artwork image for the certificate.');

    const pdf = await PDFDocument.create();
    pdf.setTitle(`${snapshot.certificateTypeTitle || 'Artwork certificate'} — ${snapshot.title}`);
    pdf.setAuthor(snapshot.artist || 'Vlement J Rodrigues');
    pdf.setSubject(`Certificate ${snapshot.title}`);
    const page = pdf.addPage([595.28, 841.89]);
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const paper = rgb(1, 1, 1);
    const ink = rgb(0.141, 0.141, 0.122);
    const drawCenteredText = (text, font, size, x, width, y, options = {}) => {
      const textWidth = font.widthOfTextAtSize(String(text), size);
      page.drawText(String(text), {
        x: x + Math.max(0, (width - textWidth) / 2),
        y,
        font,
        size,
        color: ink,
        maxWidth: width,
        ...options,
      });
    };
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: paper });
    page.drawRectangle({
      x: 22, y: 22, width: 551.28, height: 797.89,
      borderColor: rgb(0.4, 0.4, 0.37), borderWidth: 0.8
    });
    drawCenteredText('VLEMENT J. RODRIGUES', bold, 12, 214, 185, 777);
    drawCenteredText(
      snapshot.certificateTypeTitle || 'Certificate of Authenticity',
      regular,
      18,
      150,
      296,
      739,
    );
    drawCenteredText(certificateNumber, regular, 9, 250, 90, 117);

    const artworkBytes = new Uint8Array(await jpeg.arrayBuffer());
    const artworkImage = await pdf.embedJpg(artworkBytes);
    const imageBox = { x: 185, y: 524, width: 229, height: 162 };
    const imageScale = Math.min(
      imageBox.width / artworkImage.width,
      imageBox.height / artworkImage.height,
    );
    const imageWidth = artworkImage.width * imageScale;
    const imageHeight = artworkImage.height * imageScale;
    page.drawImage(artworkImage, {
      x: imageBox.x + (imageBox.width - imageWidth) / 2,
      y: imageBox.y + (imageBox.height - imageHeight) / 2,
      width: imageWidth,
      height: imageHeight
    });

    const drawField = (label, value, labelX, valueX, y, valueMaxWidth) => {
      if (value === undefined || value === null || value === '') return;
      page.drawText(String(label).toUpperCase(), {
        x: labelX, y, font: bold, size: 7, color: ink, maxWidth: valueX - labelX - 4
      });
      page.drawText(String(value), {
        x: valueX, y: y - 1, font: regular, size: 10, color: ink,
        maxWidth: valueMaxWidth, lineHeight: 13
      });
    };

    drawField('Artwork', snapshot.title, 80, 126, 482, 205);
    drawField('Medium', snapshot.medium, 345, 382, 482, 145);
    drawField('Year', snapshot.year, 79, 107, 446, 210);
    drawField('Dimensions', snapshot.dimensions, 346, 399, 446, 130);
    const extraFields = [
      ['Support', snapshot.support],
      ['Edition', snapshot.editionNumber && snapshot.editionSize
        ? `${snapshot.editionNumber} of ${snapshot.editionSize}`
        : snapshot.editionStatement],
      ['Print date', snapshot.printDate],
      ['Signed', snapshot.signed ? 'Yes' : null],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');
    extraFields.forEach(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const labelX = column === 0 ? 80 : 345;
      const valueX = column === 0 ? 126 : 382;
      const maxWidth = column === 0 ? 205 : 145;
      drawField(label, value, labelX, valueX, 413 - row * 26, maxWidth);
    });
    if (snapshot.certificateWording) {
      drawCenteredText(snapshot.certificateWording, regular, 9, 72, 451, 30, { lineHeight: 11 });
    }

    const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'M', margin: 1, width: 240
    });
    const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), character => character.charCodeAt(0));
    const qr = await pdf.embedPng(qrBytes);
    page.drawImage(qr, { x: 253, y: 198, width: 60, height: 60 });
    drawCenteredText('Scan to verify', regular, 8, 259, 64, 184);
    drawCenteredText('This certificate is valid only when verified online.', regular, 9, 147, 305, 78);
    drawCenteredText('VLEMENT.COM/VERIFY', bold, 8, 217, 160, 58);
    page.drawLine({
      start: { x: 104, y: 337 }, end: { x: 239, y: 337 },
      thickness: 0.6, color: rgb(0.52, 0.52, 0.49)
    });
    page.drawLine({
      start: { x: 358, y: 337 }, end: { x: 493, y: 337 },
      thickness: 0.6, color: rgb(0.52, 0.52, 0.49)
    });
    drawCenteredText('Date', regular, 7, 104, 135, 322);
    drawCenteredText('Artist Signature', regular, 7, 358, 135, 322);
    const nfcTagUidLabel = getNfcTagUidLabel(snapshot);
    if (nfcTagUidLabel) {
      page.drawText(nfcTagUidLabel, {
        x: 144, y: 169, font: regular, size: 6,
        color: rgb(0.38, 0.38, 0.36), maxWidth: 109, lineHeight: 8
      });
    }
    return pdf.save({ useObjectStreams: false });
  }

  async function revokeCertificate(id) {
    const reason = prompt('Reason for revoking this certificate');
    if (!reason?.trim()) return;
    try {
      await apiRequest(`/api/admin/certificates/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      await loadCertificates();
    } catch (error) {
      showManager(error.message);
    }
  }

  async function voidVersion(certificateId, versionId) {
    const reason = prompt('Reason for voiding this pending certificate');
    if (!reason?.trim()) return;
    try {
      await apiRequest(`/api/admin/certificates/${encodeURIComponent(certificateId)}/versions/${encodeURIComponent(versionId)}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
      await loadCertificates();
    } catch (error) {
      showManager(error.message);
    }
  }

  async function openTagManager(certificate) {
    const tagPath = `/api/admin/certificates/${encodeURIComponent(certificate.id)}/tags`;
    document.getElementById('modal').innerHTML = `
      <h2>NFC tags · ${escapeHtml(certificate.certificate_number)}</h2>
      <p class="hint">Write this artwork's verification URL to the physical NFC tag after registering it.</p>
      <div id="nfc-url" class="field">Loading verification URL…</div>
      <div id="nfc-tags-list" class="field">Loading tags…</div>
      <div class="row2">
        <div class="field"><label for="nfc-reference">Tag reference / UID</label>
          <input id="nfc-reference" maxlength="120" placeholder="e.g. NFC tag UID">
        </div>
        <div class="field"><label for="nfc-placement">Placement</label>
          <input id="nfc-placement" maxlength="200" placeholder="e.g. reverse lower-right corner">
        </div>
      </div>
      <div id="nfc-error"></div>
      <div class="modal-footer"><button class="btn" id="nfc-back">Back</button>
        <div class="right"><button class="btn primary" id="nfc-register">Register tag</button></div>
      </div>`;
    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('nfc-back').onclick = () => showManager();
    document.getElementById('nfc-register').onclick = async () => {
      try {
        await apiRequest(tagPath, {
          method: 'POST',
          body: JSON.stringify({
            tagReference: document.getElementById('nfc-reference').value.trim(),
            placement: document.getElementById('nfc-placement').value.trim(),
          }),
        });
        await openTagManager(certificate);
      } catch (error) {
        document.getElementById('nfc-error').innerHTML =
          `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
      }
    };

    try {
      const { verificationUrl, tags } = await apiRequest(tagPath);
      const urlBox = document.getElementById('nfc-url');
      if (urlBox) {
        urlBox.innerHTML = `<label>Verification URL</label><input readonly value="${escapeHtml(verificationUrl)}">`;
      }
      const list = document.getElementById('nfc-tags-list');
      if (!list) return;
      list.innerHTML = tags.map(tag => `
        <article style="border-bottom:1px solid var(--line);padding:10px 0">
          <strong>${escapeHtml(tag.tag_reference)}</strong>
          <div class="hint">${escapeHtml(tag.placement)} · ${escapeHtml(tag.status)} · ${tag.tested ? 'Tested' : 'Not tested'}</div>
          ${tag.status === 'active' ? `<div style="display:flex;gap:8px;margin-top:8px">
            ${tag.tested ? '' : `<button class="btn" data-test-tag="${escapeHtml(tag.id)}">Mark tested</button>`}
            <button class="btn" data-replace-tag="${escapeHtml(tag.id)}">Replace</button>
            <button class="btn danger" data-revoke-tag="${escapeHtml(tag.id)}">Revoke</button>
          </div>` : ''}
        </article>`).join('') || '<p>No NFC tags registered.</p>';
      list.querySelectorAll('[data-test-tag]').forEach(button => {
        button.onclick = () => runTagAction(certificate, tagPath, button.dataset.testTag, 'test');
      });
      list.querySelectorAll('[data-replace-tag]').forEach(button => {
        button.onclick = () => replaceTag(certificate, tagPath, button.dataset.replaceTag);
      });
      list.querySelectorAll('[data-revoke-tag]').forEach(button => {
        button.onclick = () => runTagAction(certificate, tagPath, button.dataset.revokeTag, 'revoke');
      });
    } catch (error) {
      const list = document.getElementById('nfc-tags-list');
      if (list) list.innerHTML = `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
    }
  }

  async function openVersionHistory(certificate) {
    try {
      const { versions } = await apiRequest(
        `/api/admin/certificates/${encodeURIComponent(certificate.id)}/versions`,
      );
      document.getElementById('modal').innerHTML = `
        <h2>Certificate history · ${escapeHtml(certificate.certificate_number)}</h2>
        ${versions.map(version => `
          <article style="border-bottom:1px solid var(--line);padding:12px 0">
            <strong>Version ${escapeHtml(version.version_number)}</strong>
            <span class="hint"> · ${escapeHtml(version.status)} · ${escapeHtml(version.issued_at || version.created_at)}</span>
            ${version.reissue_reason ? `<p>${escapeHtml(version.reissue_reason)}</p>` : ''}
            ${version.pdf_sha256 ? `<p class="hint" style="overflow-wrap:anywhere">PDF SHA-256: ${escapeHtml(version.pdf_sha256)}</p>` : ''}
          </article>`).join('') || '<p>No certificate versions recorded.</p>'}
        <div class="modal-footer"><span></span><div class="right">
          <button class="btn" id="history-back">Back</button>
        </div></div>`;
      document.getElementById('history-back').onclick = () => showManager();
    } catch (error) {
      showManager(error.message);
    }
  }

  async function runTagAction(certificate, tagPath, tagId, action) {
    try {
      const reason = action === 'revoke' ? prompt('Reason for revoking this NFC tag') : null;
      if (action === 'revoke' && !reason?.trim()) return;
      await apiRequest(`${tagPath}/${encodeURIComponent(tagId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason: reason.trim() } : {}),
      });
      await openTagManager(certificate);
    } catch (error) {
      showManager(error.message);
    }
  }

  async function replaceTag(certificate, tagPath, tagId) {
    const tagReference = prompt('Replacement NFC tag reference / UID');
    if (!tagReference?.trim()) return;
    const placement = prompt('Replacement tag placement');
    if (!placement?.trim()) return;
    try {
      await apiRequest(`${tagPath}/${encodeURIComponent(tagId)}/replace`, {
        method: 'POST',
        body: JSON.stringify({ tagReference: tagReference.trim(), placement: placement.trim() }),
      });
      await openTagManager(certificate);
    } catch (error) {
      showManager(error.message);
    }
  }

  async function downloadBackup() {
    const button = document.getElementById('certificates-backup');
    button.disabled = true;
    button.textContent = 'Preparing…';
    try {
      const backup = await apiRequest('/api/admin/backup', { method: 'POST' });
      const archive = new JSZip();
      archive.file('backup.json', JSON.stringify(backup.snapshot, null, 2));
      const files = backup.objects || [];
      for (let index = 0; index < files.length; index += 1) {
        const object = files[index];
        button.textContent = `Backing up ${index + 1}/${files.length}…`;
        const response = await fetch(
          `${configUrl}/api/admin/backup/file?key=${encodeURIComponent(object.key)}`,
          { headers: authorizationHeaders(), cache: 'no-store' },
        );
        if (!response.ok) throw new Error(`Could not download ${object.key} (${response.status}).`);
        archive.file(`objects/${object.key}`, await response.blob());
      }
      const zip = await archive.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 1 },
      });
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest(
        'SHA-256', await zip.arrayBuffer(),
      )), byte => byte.toString(16).padStart(2, '0')).join('');
      await apiRequest(`/api/admin/backup/${encodeURIComponent(backup.backupId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({ sha256: digest, objectCount: files.length }),
      });
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vlement-certificates-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      button.textContent = 'Backup downloaded';
    } catch (error) {
      button.textContent = 'Download backup (.zip)';
      document.getElementById('modal-error').innerHTML =
        `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#certificates-btn')) showManager();
  });
})();
