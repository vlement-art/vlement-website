(() => {
  const configUrl = window.CERTIFICATES_API_URL;
  const codesBySlug = new Map();
  const types = [
    { value: 'original', label: 'Original', code: 'O' },
    { value: 'limited', label: 'Limited edition', code: 'LE' },
    { value: 'open', label: 'Open edition', code: 'OE' }
  ];

  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  function authorizationHeaders() {
    const token = window.VlementAdmin?.getToken();
    if (!token) throw new Error('Sign in again before managing artwork codes.');
    return { Authorization: ['Bearer', token].join(' ') };
  }

  async function apiRequest(path, options = {}) {
    if (!configUrl) throw new Error('Artwork codes are not configured until the certificate Worker URL is set.');
    let response;
    try {
      response = await fetch(`${configUrl}${path}`, {
        ...options,
        cache: 'no-store',
        headers: {
          ...authorizationHeaders(),
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers
        }
      });
    } catch {
      throw new Error('Could not reach the artwork-code service. Check the connection and try again.');
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Your GitHub sign-in is missing or expired. Sign out and sign in again.');
    if (response.status === 403) throw new Error('The certificate Worker rejected this GitHub account. Check its allowed user ID and repository write access.');
    if (response.status === 503) throw new Error(payload.error || 'Certificate Worker admin authorization is not configured.');
    if (!response.ok) throw new Error(payload.error || `Artwork-code service returned ${response.status}.`);
    return payload;
  }

  async function loadCodes() {
    const payload = await apiRequest('/api/admin/artwork-codes');
    codesBySlug.clear();
    for (const code of payload.codes || []) codesBySlug.set(code.artwork_slug, code);
    window.VlementAdmin?.renderGrid();
    return [...codesBySlug.values()];
  }

  function getCode(slug) {
    return codesBySlug.get(slug) || null;
  }

  async function createForArtwork(slug, type, editionSize) {
    const body = { slug, type };
    if (type === 'limited') body.edition_size = Number(editionSize);
    const payload = await apiRequest('/api/admin/artwork-codes', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    if (!payload.code) throw new Error('The artwork code was created but could not be loaded.');
    codesBySlug.set(slug, payload.code);
    window.VlementAdmin?.renderGrid();
    return payload.code;
  }

  function typeLabel(type) {
    return types.find(item => item.code === type)?.label || type;
  }

  function showManager() {
    const modal = document.getElementById('modal');
    modal.innerHTML = `
      <h2>Artwork Codes</h2>
      <p class="hint">Codes are permanent. Choose the correct type before creating one; existing artworks are never assigned a type automatically.</p>
      <div id="artwork-codes-list" class="field">Loading artwork codes…</div>
      <div class="modal-footer">
        <button class="btn" id="artwork-codes-refresh">Refresh</button>
        <div class="right"><button class="btn" id="artwork-codes-close">Close</button></div>
      </div>`;
    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('artwork-codes-close').onclick = () => {
      document.getElementById('modal-overlay').hidden = true;
    };
    document.getElementById('artwork-codes-refresh').onclick = () => renderManagerList();
    renderManagerList();
  }

  function renderManagerError(error) {
    const list = document.getElementById('artwork-codes-list');
    if (list) {
      list.replaceChildren(element('div', error.message, 'status-banner error'));
    }
  }

  async function renderManagerList() {
    const list = document.getElementById('artwork-codes-list');
    if (!list) return;
    list.textContent = 'Loading artwork codes…';
    try {
      await loadCodes();
      const artworks = window.VlementAdmin?.getEntries() || [];
      list.replaceChildren();
      if (!artworks.length) {
        list.append(element('p', 'No artworks found.'));
        return;
      }

      for (const artwork of artworks) {
        const row = element('div', undefined, 'code-manager-row');
        const details = element('div', undefined, 'code-manager-details');
        details.append(
          element('strong', artwork.data.title || artwork.slug),
          element('span', artwork.slug, 'hint')
        );
        const code = getCode(artwork.slug);
        if (code) {
          details.append(element(
            'span',
            `${code.artwork_code} · ${typeLabel(code.type)}${code.edition_size ? ` · edition of ${code.edition_size}` : ''}${code.status !== 'active' ? ` · ${code.status}` : ''}`,
            'code-label'
          ));
          row.append(details);
        } else {
          const controls = element('div', undefined, 'code-manager-controls');
          const typeSelect = element('select');
          typeSelect.setAttribute('aria-label', `Artwork type for ${artwork.data.title || artwork.slug}`);
          const placeholder = element('option', 'Choose artwork type');
          placeholder.value = '';
          typeSelect.append(placeholder);
          for (const type of types) {
            const option = element('option', type.label);
            option.value = type.value;
            if (artwork.data.editionType === type.value) option.selected = true;
            typeSelect.append(option);
          }
          const editionSize = element('input');
          editionSize.type = 'number';
          editionSize.min = '1';
          editionSize.step = '1';
          editionSize.placeholder = 'Edition size';
          editionSize.value = artwork.data.editionSize || '';
          editionSize.setAttribute('aria-label', `Edition size for ${artwork.data.title || artwork.slug}`);
          editionSize.hidden = typeSelect.value !== 'limited';
          typeSelect.addEventListener('change', () => {
            editionSize.hidden = typeSelect.value !== 'limited';
          });
          const createButton = element('button', 'Create code', 'btn primary');
          createButton.type = 'button';
          const rowError = element('div', undefined, 'status-banner error');
          rowError.hidden = true;
          createButton.onclick = async () => {
            if (!typeSelect.value) {
              rowError.textContent = `Choose a type for "${artwork.data.title || artwork.slug}" first.`;
              rowError.hidden = false;
              return;
            }
            if (typeSelect.value === 'limited'
              && (!Number.isInteger(Number(editionSize.value)) || Number(editionSize.value) < 1)) {
              rowError.textContent = 'Enter a valid limited-edition size.';
              rowError.hidden = false;
              return;
            }
            rowError.hidden = true;
            createButton.disabled = true;
            try {
              await createForArtwork(
                artwork.slug,
                typeSelect.value,
                typeSelect.value === 'limited' ? editionSize.value : null
              );
              await renderManagerList();
            } catch (error) {
              rowError.textContent = error.message;
              rowError.hidden = false;
              createButton.disabled = false;
            }
          };
          controls.append(typeSelect, editionSize, createButton, rowError);
          details.append(element('span', 'No code assigned', 'hint'));
          row.append(details, controls);
        }
        list.append(row);
      }
    } catch (error) {
      renderManagerError(error);
    }
  }

  window.VlementAdminArtworkCodes = {
    getCode,
    load: loadCodes,
    createForArtwork,
    open: showManager
  };
})();
