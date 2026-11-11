(() => {
  const TYPES = {
    original: 'Original',
    limited_edition: 'Limited edition',
    open_edition: 'Open edition'
  };
  let artworks = [];
  let sales = [];
  let page = 1;
  let total = 0;
  let status;
  let form;
  let artworkSelect;
  let itemTypeSelect;
  let editionField;
  let editionInput;
  let priceInput;
  let currencyInput;
  let sheetJsPromise;

  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  function setStatus(message, kind = 'info') {
    status.textContent = message;
    status.className = `status-banner ${kind}`;
    status.hidden = !message;
  }

  async function apiRequest(path, options = {}, responseType = 'json') {
    const base = window.CERTIFICATES_API_URL;
    if (!base) throw new Error('Sales are not configured until the certificate Worker URL is set.');
    const token = window.VlementAdmin?.getToken();
    if (!token) throw new Error('Sign in again before managing sales.');
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        ...options,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers
        }
      });
    } catch {
      throw new Error('Could not reach the sales service. Check the connection and try again.');
    }
    const payload = response.ok && responseType === 'text'
      ? await response.text()
      : await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error(`Your GitHub sign-in is missing or expired. Sign out and sign in again.${payload.error ? ` ${payload.error}` : ''}`);
    }
    if (response.status === 403) {
      throw new Error('The certificate Worker rejected this GitHub account. Check its allowed user ID and repository write access.');
    }
    if (response.status === 503) {
      throw new Error(payload.error || 'Certificate Worker admin authorization is not configured.');
    }
    if (!response.ok) {
      const error = new Error(payload.error || `Sales service returned ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function formatPrice(price, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(price));
    } catch {
      return `${currency} ${Number(price).toFixed(2)}`;
    }
  }

  function localDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function parseArtworkPrice(value) {
    const text = String(value || '');
    const currency = text.includes('£') ? 'GBP' : text.includes('€') ? 'EUR' : text.includes('$') ? 'USD' : 'GBP';
    const numeric = Number(text.replace(/,/g, '').replace(/[^\d.-]/g, ''));
    return { price: Number.isFinite(numeric) ? numeric : 0, currency };
  }

  function createField(labelText, control, hintText = '') {
    const field = element('div', undefined, 'field');
    const label = element('label', labelText);
    label.htmlFor = control.id;
    field.append(label, control);
    if (hintText) field.append(element('span', hintText, 'hint'));
    return field;
  }

  function input(id, type = 'text', value = '') {
    const control = element('input');
    control.id = id;
    control.type = type;
    control.value = value;
    return control;
  }

  function fillArtworkSelect() {
    artworkSelect.replaceChildren();
    for (const artwork of artworks.filter(item => item.available)) {
      const option = element('option', `${artwork.title} (${artwork.category || 'Artwork'})`);
      option.value = artwork.slug;
      artworkSelect.append(option);
    }
    artworkSelect.disabled = artworkSelect.options.length === 0;
    updateArtworkFields();
  }

  function selectedArtwork() {
    return artworks.find(artwork => artwork.slug === artworkSelect.value) || null;
  }

  function updateArtworkFields() {
    const artwork = selectedArtwork();
    itemTypeSelect.replaceChildren();
    editionField.hidden = !artwork || artwork.editionType !== 'limited';
    if (!artwork) {
      priceInput.value = '';
      return;
    }
    const itemType = artwork.editionType === 'limited'
      ? 'limited_edition'
      : artwork.editionType === 'open'
        ? 'open_edition'
        : 'original';
    const option = element('option', TYPES[itemType]);
    option.value = itemType;
    itemTypeSelect.append(option);

    const parsed = parseArtworkPrice(artwork.price);
    priceInput.value = String(parsed.price);
    currencyInput.value = parsed.currency;

    if (itemType === 'limited_edition') {
      const soldNumbers = new Set(artwork.soldEditionNumbers || []);
      const next = Array.from({ length: Number(artwork.editionSize) }, (_, index) => index + 1)
        .find(number => !soldNumbers.has(number));
      editionInput.max = String(artwork.editionSize || 1);
      editionInput.value = next ? String(next) : '';
      editionInput.disabled = !next;
      editionInput.required = true;
    } else {
      editionInput.value = '';
      editionInput.disabled = true;
      editionInput.required = false;
    }
  }

  function formRow() {
    const row = element('div', undefined, 'row2');
    row.style.gridTemplateColumns = 'repeat(auto-fit, minmax(160px, 1fr))';
    const date = input('sales-date', 'date', localDate());
    date.required = true;
    row.append(
      createField('Item type', itemTypeSelect),
      createField('Sale date', date)
    );
    return row;
  }

  function renderForm(container) {
    form = element('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      submitSale().catch(error => setStatus(error.message, 'error'));
    });

    artworkSelect = element('select');
    artworkSelect.id = 'sales-artwork';
    artworkSelect.addEventListener('change', updateArtworkFields);

    itemTypeSelect = element('select');
    itemTypeSelect.id = 'sales-item-type';
    itemTypeSelect.disabled = true;

    editionInput = input('sales-edition-number', 'number');
    editionInput.min = '1';
    editionField = createField('Edition number', editionInput, 'Choose an unsold number within this edition.');
    editionField.hidden = true;

    priceInput = input('sales-price', 'number');
    priceInput.min = '0';
    priceInput.step = '0.01';
    priceInput.required = true;
    currencyInput = input('sales-currency', 'text', 'GBP');
    currencyInput.maxLength = 3;
    currencyInput.required = true;
    currencyInput.autocomplete = 'off';

    const buyerName = input('sales-buyer-name');
    buyerName.maxLength = 200;
    buyerName.required = true;
    const buyerEmail = input('sales-buyer-email', 'email');
    buyerEmail.maxLength = 254;
    const notes = element('textarea');
    notes.id = 'sales-notes';
    notes.maxLength = 1000;
    notes.rows = 3;

    const priceRow = element('div', undefined, 'row2');
    priceRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(160px, 1fr))';
    priceRow.append(createField('Price', priceInput), createField('Currency', currencyInput, 'Three-letter code, for example GBP.'));
    const buyerRow = element('div', undefined, 'row2');
    buyerRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(160px, 1fr))';
    buyerRow.append(createField('Buyer name', buyerName), createField('Buyer email (optional)', buyerEmail));

    const submit = element('button', 'Review and record sale', 'btn primary');
    submit.type = 'submit';
    form.append(
      createField('Artwork', artworkSelect),
      formRow(),
      editionField,
      buyerRow,
      priceRow,
      createField('Notes (optional)', notes, 'Maximum 1000 characters.'),
      submit
    );
    container.append(form);
    fillArtworkSelect();
  }

  function saleDescription(sale) {
    const kind = TYPES[sale.item_type] || sale.item_type;
    const edition = sale.item_type === 'limited_edition'
      ? ` · edition ${sale.edition_number}`
      : sale.item_type === 'open_edition'
        ? ` · open edition #${sale.open_edition_number}`
        : '';
    return `${sale.sale_number} · ${sale.artwork_slug} · ${kind}${edition}`;
  }

  function renderSalesList(container) {
    container.replaceChildren();
    if (!sales.length) {
      container.append(element('p', 'No sales recorded yet.', 'hint'));
      return;
    }
    for (const sale of sales) {
      const row = element('article');
      row.style.borderBottom = '1px solid var(--line)';
      row.style.padding = '12px 0';
      const title = element('strong', saleDescription(sale));
      const detail = element(
        'p',
        `${sale.buyer_name}${sale.buyer_email ? ` · ${sale.buyer_email}` : ''} · ${sale.sale_date} · ${formatPrice(sale.price, sale.currency)}`,
        'hint'
      );
      if (sale.status === 'cancelled') {
        title.style.textDecoration = 'line-through';
        detail.style.textDecoration = 'line-through';
      }
      row.append(title, detail);
      if (sale.notes) row.append(element('p', sale.notes, 'hint'));
      row.append(element('p', sale.status === 'cancelled' ? 'Cancelled' : 'Active', 'hint'));
      if (sale.receipt_printed_at) row.append(element('p', `Printed ${new Date(sale.receipt_printed_at).toLocaleString()}`, 'hint'));
      if (sale.receipt_emailed_at) row.append(element('p', `Emailed ${new Date(sale.receipt_emailed_at).toLocaleString()}`, 'hint'));
      const receipt = element('button', 'Receipt', 'btn');
      receipt.type = 'button';
      receipt.addEventListener('click', () => openReceiptDialog(sale));
      row.append(receipt);
      if (sale.certificate_id) {
        row.append(element('p', 'A certificate was issued for this sale. Manual follow-up is required.', 'hint'));
      }
      if (sale.status === 'active') {
        const cancel = element('button', 'Cancel sale', 'btn danger');
        cancel.type = 'button';
        cancel.addEventListener('click', () => cancelRecordedSale(sale));
        row.append(cancel);
      }
      container.append(row);
    }
    if (sales.length < total) {
      const more = element('button', 'Load more sales', 'btn');
      more.type = 'button';
      more.addEventListener('click', () => loadSales(page + 1));
      container.append(more);
    }
  }

  async function loadArtworks() {
    const result = await apiRequest('/api/admin/sales/artworks');
    artworks = result.artworks || [];
    fillArtworkSelect();
  }

  async function loadSales(nextPage = 1) {
    page = nextPage;
    const result = await apiRequest(`/api/admin/sales?page=${page}&per_page=20`);
    sales = nextPage === 1 ? result.sales || [] : sales.concat(result.sales || []);
    total = Number(result.total || 0);
    const list = document.getElementById('sales-recent-list');
    if (list) renderSalesList(list);
  }

  function ensureSheetJs() {
    if (window.XLSX?.utils) return Promise.resolve(window.XLSX);
    if (!sheetJsPromise) {
      sheetJsPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        script.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
        script.crossOrigin = 'anonymous';
        script.onload = () => window.XLSX?.utils ? resolve(window.XLSX) : reject(new Error('SheetJS did not load correctly.'));
        script.onerror = () => reject(new Error('Could not load the Excel export library. Check your connection and try again.'));
        document.head.appendChild(script);
      }).catch(error => {
        sheetJsPromise = null;
        throw error;
      });
    }
    return sheetJsPromise;
  }

  async function exportSales(button) {
    button.disabled = true;
    try {
      setStatus('Loading sales for Excel export…');
      const [xlsx, exceljs] = await Promise.all([ensureSheetJs(), ensureExcelJsLibrary()]);
      const all = [];
      let totalSales = 0;
      let nextPage = 1;
      do {
        let result;
        for (let attempt = 0; ; attempt++) {
          try {
            result = await apiRequest(`/api/admin/sales?page=${nextPage}&per_page=100`);
            break;
          } catch (error) {
            if (error.status !== 429 || attempt >= 2) throw error;
            setStatus('Sales service is busy; waiting before continuing the export…');
            await new Promise(resolve => setTimeout(resolve, 61_000));
          }
        }
        if (!Array.isArray(result.sales) || !Number.isInteger(result.total)) throw new Error('Sales service returned an invalid export page.');
        totalSales = result.total;
        if (!result.sales.length && all.length < totalSales) throw new Error('Sales changed during export. Please try again.');
        all.push(...result.sales);
        nextPage++;
        setStatus(`Loading sales for Excel export… ${all.length} of ${totalSales}`);
      } while (all.length < totalSales);
      if (all.length !== totalSales || new Set(all.map(sale => sale.sale_number)).size !== all.length) {
        throw new Error('Sales changed during export. Please try again.');
      }
      const titles = new Map(artworks.map(artwork => [artwork.slug, artwork.title]));
      const headers = [
        'Sale number', 'Sale date', 'Artwork slug', 'Artwork title', 'Item type',
        'Edition number', 'Buyer name', 'Buyer email', 'Price', 'Currency',
        'Status', 'Notes', 'Receipt printed at', 'Receipt emailed at'
      ];
      const rows = all.map(sale => [
        sale.sale_number, new Date(`${sale.sale_date}T00:00:00Z`), sale.artwork_slug,
        titles.get(sale.artwork_slug) || sale.artwork_slug, TYPES[sale.item_type] || sale.item_type,
        sale.item_type === 'limited_edition' ? sale.edition_number : sale.item_type === 'open_edition' ? sale.open_edition_number : null,
        sale.buyer_name, sale.buyer_email || '', Number(sale.price), sale.currency, sale.status,
        sale.notes || '', sale.receipt_printed_at ? new Date(sale.receipt_printed_at) : null,
        sale.receipt_emailed_at ? new Date(sale.receipt_emailed_at) : null
      ]);
      const book = xlsx.utils.book_new();
      const sheet = xlsx.utils.aoa_to_sheet([headers, ...rows], {
        cellDates: false, dateNF: 'yyyy-mm-dd hh:mm:ss'
      });
      xlsx.utils.book_append_sheet(book, sheet, 'Sales');
      const workbook = new exceljs.Workbook();
      await workbook.xlsx.load(xlsx.write(book, { type: 'array', bookType: 'xlsx' }));
      const worksheet = workbook.getWorksheet('Sales');
      if (!worksheet) throw new Error('Could not create the Sales worksheet.');
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
      [24, 16, 28, 32, 20, 18, 28, 32, 16, 12, 14, 48, 24, 24]
        .forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
      worksheet.getRow(1).font = { bold: true };
      worksheet.getColumn(2).numFmt = 'yyyy-mm-dd';
      worksheet.getColumn(9).numFmt = '0.00';
      worksheet.getColumn(13).numFmt = 'yyyy-mm-dd hh:mm:ss';
      worksheet.getColumn(14).numFmt = 'yyyy-mm-dd hh:mm:ss';
      all.forEach((sale, index) => {
        if (sale.status === 'cancelled') {
          worksheet.getRow(index + 2).eachCell({ includeEmpty: true }, cell => {
            cell.font = { color: { argb: 'FF888888' }, strike: true };
          });
        }
      });
      const bytes = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `vlement-sales-${localDate()}.xlsx`;
        link.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setStatus(`Downloaded ${all.length} sales. D1 remains the source of truth.`, 'success');
    } catch (error) {
      setStatus(`Excel export failed: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function displaySale(sale) {
    const artwork = selectedArtwork();
    const itemType = TYPES[sale.item_type] || sale.item_type;
    const edition = sale.item_type === 'limited_edition' ? `, edition ${sale.edition_number}` : '';
    const amount = formatPrice(sale.price, sale.currency);
    const summary = [
      `Artwork: ${artwork?.title || sale.artwork_slug}`,
      `Item: ${itemType}${edition}`,
      `Buyer: ${sale.buyer_name}`,
      `Date: ${sale.sale_date}`,
      `Price: ${amount}`
    ].join('\n');
    return window.confirm(`Confirm this sale:\n\n${summary}\n\nRecord the sale?`);
  }

  async function submitSale() {
    const artwork = selectedArtwork();
    if (!artwork) throw new Error('Choose an available artwork.');
    const saleData = {
      artworkSlug: artwork.slug,
      itemType: itemTypeSelect.value,
      editionNumber: itemTypeSelect.value === 'limited_edition' ? Number(editionInput.value) : null,
      buyerName: document.getElementById('sales-buyer-name').value.trim(),
      buyerEmail: document.getElementById('sales-buyer-email').value.trim(),
      saleDate: document.getElementById('sales-date').value,
      price: Number(priceInput.value),
      currency: currencyInput.value.trim().toUpperCase(),
      notes: document.getElementById('sales-notes').value.trim()
    };
    if (!saleData.buyerName) throw new Error('Enter the buyer name.');

    const confirmRecord = {
      ...saleData,
      sale_date: saleData.saleDate,
      item_type: saleData.itemType,
      edition_number: saleData.editionNumber
    };
    if (!displaySale(confirmRecord)) return;

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    setStatus('Recording sale…');
    let recorded;
    try {
      recorded = await apiRequest('/api/admin/sales', {
        method: 'POST',
        body: JSON.stringify(saleData)
      });
      if (saleData.itemType !== 'open_edition'
        && Boolean(artwork.available) !== Boolean(recorded.artworkAvailable)) {
        try {
          await window.VlementAdmin.updateArtworkAvailability(
            artwork.slug,
            Boolean(recorded.artworkAvailable),
            `Update availability after sale ${recorded.sale.sale_number}`
          );
        } catch (writeError) {
          let cancelled = false;
          try {
            await apiRequest('/api/admin/sales/cancel', {
              method: 'POST',
              body: JSON.stringify({ saleNumber: recorded.sale.sale_number })
            });
            cancelled = true;
          } catch {
            // Report the committed sale and failed rollback below.
          }
          if (cancelled) {
            try {
              await window.VlementAdmin.updateArtworkAvailability(
                artwork.slug,
                Boolean(artwork.available),
                `Restore availability after failed sale ${recorded.sale.sale_number}`
              );
            } catch {
              throw new Error(
                `The sale was cancelled, but artwork availability also needs manual correction: ${writeError.message}`
              );
            }
            throw new Error(`Sale was cancelled because artwork availability could not be updated: ${writeError.message}`);
          }
          throw new Error(`Sale ${recorded.sale.sale_number} is saved, but artwork availability could not be updated. Retry the availability change in the artwork editor.`);
        }
      }
      openReceiptDialog(recorded.sale);
    } finally {
      submit.disabled = false;
    }
  }

  async function printReceipt(sale, container) {
    const html = await apiRequest(`/api/admin/sales/receipt?saleNumber=${encodeURIComponent(sale.sale_number)}`, {}, 'text');
    const frame = element('iframe');
    frame.hidden = true;
    frame.setAttribute('title', 'Receipt for printing');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    const loaded = new Promise((resolve, reject) => {
      frame.onload = resolve;
      frame.onerror = () => reject(new Error('Could not prepare the receipt for printing.'));
    });
    frame.srcdoc = html;
    container.append(frame);
    await loaded;
    if (!frame.contentWindow) throw new Error('Could not open the print dialog.');
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setStatus('Print dialog opened. Saving the print record…');
    try {
      const result = await apiRequest('/api/admin/sales/receipt/printed', {
        method: 'POST', body: JSON.stringify({ saleNumber: sale.sale_number })
      });
      sale.receipt_printed_at = result.sale.receipt_printed_at;
    } catch (error) {
      throw new Error(`Print dialog opened, but the print record could not be saved: ${error.message}`);
    }
  }

  function openReceiptDialog(sale) {
    const modal = document.getElementById('modal');
    modal.replaceChildren();
    const heading = element('h2', 'Sale recorded');
    if (sale.status === 'cancelled') heading.textContent = 'Cancelled sale receipt';
    const artwork = artworks.find(item => item.slug === sale.artwork_slug);
    const summary = element('p', `${sale.sale_number} · ${artwork?.title || sale.artwork_slug} · ${TYPES[sale.item_type] || sale.item_type} · ${sale.buyer_name} · ${formatPrice(sale.price, sale.currency)}`);
    const receiptStatus = element('div', '', 'status-banner info');
    receiptStatus.setAttribute('role', 'status');
    receiptStatus.hidden = true;
    status = receiptStatus;
    const email = input('receipt-buyer-email', 'email', sale.buyer_email || '');
    email.maxLength = 254;
    const emailField = createField('Buyer email for receipt', email, 'Confirm the email address before sending.');
    const actions = element('div', undefined, 'modal-footer');
    const print = element('button', 'Print', 'btn');
    const send = element('button', 'Email', 'btn');
    const both = element('button', 'Both', 'btn primary');
    const skip = element('button', 'Skip', 'btn');
    const buttons = [print, send, both, skip];
    buttons.forEach(button => { button.type = 'button'; actions.append(button); });
    skip.addEventListener('click', () => { document.getElementById('modal-overlay').hidden = true; });
    const run = async (shouldPrint, shouldEmail) => {
      buttons.forEach(button => { button.disabled = true; });
      let printed = false;
      try {
        if (shouldPrint) {
          setStatus('Preparing receipt for printing…');
          await printReceipt(sale, modal);
          printed = true;
        }
        if (shouldEmail) {
          if (!email.value.trim() || !email.checkValidity()) {
            throw new Error('Enter a valid buyer email address.');
          }
          const warning = sale.status === 'cancelled' ? ' This sale is CANCELLED.' : '';
          if (!window.confirm(`Email the receipt to ${email.value.trim()}?${warning}`)) {
            setStatus(printed ? 'Print dialog opened. Email was not sent.' : 'Email was not sent.');
            return;
          }
          setStatus(printed ? 'Print dialog opened. Sending email…' : 'Sending receipt email…');
          await apiRequest('/api/admin/sales/receipt/email', {
            method: 'POST',
            body: JSON.stringify({
              saleNumber: sale.sale_number,
              buyerEmail: email.value.trim(),
              ...(sale.status === 'cancelled' ? { confirmCancelled: true } : {})
            })
          });
          if (!sale.buyer_email) sale.buyer_email = email.value.trim();
        }
        setStatus(printed && shouldEmail ? 'Print dialog opened. Receipt email sent.'
          : printed ? 'Print dialog opened.' : 'Receipt email sent.', 'success');
      } catch (error) {
        setStatus(`${printed ? 'Print dialog opened. ' : ''}${error.message}`, 'error');
      } finally {
        buttons.forEach(button => { button.disabled = false; });
      }
    };
    print.addEventListener('click', () => run(true, false));
    send.addEventListener('click', () => run(false, true));
    both.addEventListener('click', () => run(true, true));
    modal.append(heading, summary, receiptStatus, emailField, actions);
  }

  async function cancelRecordedSale(sale) {
    const openEditionNote = sale.item_type === 'open_edition'
      ? '\n\nThis open-edition number will not be reused.'
      : '';
    if (!window.confirm(`Cancel ${sale.sale_number} for ${sale.buyer_name}?${openEditionNote}`)) return;
    setStatus('Cancelling sale…');
    try {
      const result = await apiRequest('/api/admin/sales/cancel', {
        method: 'POST',
        body: JSON.stringify({ saleNumber: sale.sale_number })
      });
      if (sale.item_type !== 'open_edition') {
        try {
          await window.VlementAdmin.updateArtworkAvailability(
            sale.artwork_slug,
            true,
            `Restore artwork availability after cancelling ${sale.sale_number}`
          );
        } catch (error) {
          await loadSales(1);
          throw new Error(`Sale cancelled, but artwork availability could not be restored. Update it in the artwork editor: ${error.message}`);
        }
      }
      await Promise.all([loadArtworks(), loadSales(1)]);
      setStatus(result.certificateRequiresManualReview
        ? `Cancelled ${sale.sale_number}. Its certificate needs manual follow-up.`
        : `Cancelled ${sale.sale_number}.`);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  async function openSales() {
    const modal = document.getElementById('modal');
    modal.replaceChildren();
    const heading = element('h2', 'Record a sale');
    const hint = element('p', 'Sales are stored in the certificate database. Sale numbers use the certificate numbering system.');
    const tabs = element('div');
    tabs.style.display = 'flex';
    tabs.style.gap = '8px';
    const formTab = element('button', 'Record sale', 'btn');
    const recentTab = element('button', 'Recent sales', 'btn');
    formTab.type = recentTab.type = 'button';
    const formContainer = element('section');
    const recentContainer = element('section');
    recentContainer.hidden = true;
    const exportButton = element('button', 'Download Excel', 'btn');
    exportButton.type = 'button';
    exportButton.addEventListener('click', () => exportSales(exportButton));
    const recentList = element('div');
    recentList.id = 'sales-recent-list';
    recentContainer.append(exportButton, recentList);
    status = element('div', '', 'status-banner info');
    status.setAttribute('role', 'status');
    status.hidden = true;
    const footer = element('div');
    footer.className = 'modal-footer';
    const close = element('button', 'Close', 'btn');
    close.type = 'button';
    close.addEventListener('click', () => { document.getElementById('modal-overlay').hidden = true; });
    footer.append(close);
    formTab.addEventListener('click', () => {
      formContainer.hidden = false;
      recentContainer.hidden = true;
    });
    recentTab.addEventListener('click', () => {
      formContainer.hidden = true;
      recentContainer.hidden = false;
      loadSales(1).catch(error => setStatus(error.message, 'error'));
    });
    tabs.append(formTab, recentTab);
    modal.append(heading, hint, tabs, status, formContainer, recentContainer, footer);
    renderForm(formContainer);
    document.getElementById('modal-overlay').hidden = false;
    setStatus('Loading artworks and recent sales…');
    try {
      await Promise.all([loadArtworks(), loadSales(1)]);
      setStatus(artworks.some(artwork => artwork.available)
        ? ''
        : 'No artworks are currently available to sell.');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  window.VlementSales = { open: openSales };
})();
