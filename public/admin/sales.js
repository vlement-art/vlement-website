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

  async function apiRequest(path, options = {}) {
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
          Authorization: `******`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers
        }
      });
    } catch {
      throw new Error('Could not reach the sales service. Check the connection and try again.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Sales service returned ${response.status}.`);
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
      setStatus(`Recorded ${recorded.sale.sale_number}.`);
      document.getElementById('sales-buyer-name').value = '';
      document.getElementById('sales-buyer-email').value = '';
      document.getElementById('sales-notes').value = '';
      await Promise.all([loadArtworks(), loadSales(1)]);
    } finally {
      submit.disabled = false;
    }
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
    recentContainer.id = 'sales-recent-list';
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
