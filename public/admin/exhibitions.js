(() => {
  const EXHIBITIONS_PATH = 'src/data/exhibitions.json';
  let exhibitions = [];

  const statusOf = (exhibition, today = new Date().toISOString().slice(0, 10)) => {
    if (exhibition.startDate > today) return 'upcoming';
    if (exhibition.endDate < today) return 'past';
    return 'current';
  };
  const formatDate = value => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
  const formatDates = exhibition => exhibition.startDate === exhibition.endDate
    ? formatDate(exhibition.startDate)
    : `${formatDate(exhibition.startDate)}–${formatDate(exhibition.endDate)}`;

  async function loadExhibitions() {
    const file = await ghGetFile(EXHIBITIONS_PATH);
    if (!file) {
      exhibitions = [];
      return;
    }
    const parsed = JSON.parse(base64ToUtf8(file.content));
    if (!Array.isArray(parsed)) {
      throw new Error('The exhibitions file must contain a JSON array.');
    }
    exhibitions = parsed.map(validateExhibition);
  }

  function validateExhibition(exhibition) {
    if (!exhibition || typeof exhibition !== 'object') {
      throw new Error('An exhibition entry is invalid.');
    }
    const value = {
      title: typeof exhibition.title === 'string' ? exhibition.title.trim() : '',
      venue: typeof exhibition.venue === 'string' ? exhibition.venue.trim() : '',
      startDate: typeof exhibition.startDate === 'string' ? exhibition.startDate : '',
      endDate: typeof exhibition.endDate === 'string' ? exhibition.endDate : '',
      ...(typeof exhibition.url === 'string' && exhibition.url.trim()
        ? { url: exhibition.url.trim() }
        : {}),
    };
    if (!value.title) throw new Error('Enter an exhibition title.');
    if (!value.venue) throw new Error('Enter a venue.');
    if (!isCalendarDate(value.startDate) || !isCalendarDate(value.endDate)) {
      throw new Error('Choose a valid start and end date.');
    }
    if (value.endDate < value.startDate) {
      throw new Error('The end date must be on or after the start date.');
    }
    if (value.url) {
      let url;
      try {
        url = new URL(value.url);
      } catch {
        throw new Error('Enter a valid HTTP or HTTPS exhibition link.');
      }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Enter a valid HTTP or HTTPS exhibition link.');
      }
    }
    return value;
  }

  function isCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function openExhibitions() {
    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('modal').innerHTML = `
      <h2>Exhibitions</h2>
      <p class="hint">Upcoming and past status updates automatically from each exhibition's dates.</p>
      <div id="exhibitions-list" class="field">Loading exhibitions…</div>
      <div id="exhibitions-error"></div>
      <div class="modal-footer">
        <button class="btn" id="exhibitions-close">Close</button>
        <div class="right"><button class="btn primary" id="exhibition-new">Add exhibition</button></div>
      </div>`;
    document.getElementById('exhibitions-close').onclick = closeModal;
    document.getElementById('exhibition-new').onclick = () => openExhibitionForm();
    loadExhibitions().then(renderExhibitions).catch(error => {
      const list = document.getElementById('exhibitions-list');
      if (list) list.innerHTML = `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
    });
  }

  function renderExhibitions() {
    const modal = document.getElementById('modal');
    const today = new Date().toISOString().slice(0, 10);
    const groups = [
      ['On now', exhibitions.filter(item => statusOf(item, today) === 'current')],
      ['Coming up', exhibitions.filter(item => statusOf(item, today) === 'upcoming')
        .sort((a, b) => a.startDate.localeCompare(b.startDate))],
      ['Past', exhibitions.filter(item => statusOf(item, today) === 'past')
        .sort((a, b) => b.endDate.localeCompare(a.endDate))],
    ];
    const html = groups.map(([label, items]) => `
      <h3 style="margin:18px 0 4px;font-family:Georgia,serif;font-size:20px">${label}</h3>
      ${items.map(item => {
        const index = exhibitions.indexOf(item);
        return `
          <article style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)">
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <div class="hint">${escapeHtml(item.venue)} · ${escapeHtml(formatDates(item))}</div>
              ${item.url ? `<a class="hint" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Exhibition link ↗</a>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="btn" data-edit="${index}">Edit</button>
              <button class="btn danger" data-delete="${index}">Delete</button>
            </div>
          </article>`;
      }).join('') || '<p class="hint">No exhibitions.</p>'}
    `).join('');
    const list = document.getElementById('exhibitions-list');
    if (list) list.innerHTML = html;
    modal.querySelectorAll('[data-edit]').forEach(button => {
      button.onclick = () => openExhibitionForm(Number(button.dataset.edit));
    });
    modal.querySelectorAll('[data-delete]').forEach(button => {
      button.onclick = () => deleteExhibition(Number(button.dataset.delete));
    });
  }

  function openExhibitionForm(index = null, error = '') {
    const exhibition = index === null
      ? { title: '', venue: '', startDate: '', endDate: '', url: '' }
      : exhibitions[index];
    document.getElementById('modal').innerHTML = `
      <h2>${index === null ? 'Add exhibition' : 'Edit exhibition'}</h2>
      <p class="hint">The exhibition appears as upcoming until its last day, on now during its date range, and past after it ends.</p>
      <div class="field"><label for="exhibition-title">Exhibition title</label>
        <input id="exhibition-title" maxlength="160" required value="${escapeHtml(exhibition.title)}"></div>
      <div class="field"><label for="exhibition-venue">Venue and location</label>
        <input id="exhibition-venue" maxlength="200" required placeholder="e.g. Gallery name, London" value="${escapeHtml(exhibition.venue)}"></div>
      <div class="row2">
        <div class="field"><label for="exhibition-start">Start date</label>
          <input id="exhibition-start" type="date" required value="${escapeHtml(exhibition.startDate)}"></div>
        <div class="field"><label for="exhibition-end">End date</label>
          <input id="exhibition-end" type="date" required value="${escapeHtml(exhibition.endDate)}"></div>
      </div>
      <div class="field"><label for="exhibition-url">Exhibition details link (optional)</label>
        <input id="exhibition-url" type="url" maxlength="1000" placeholder="https://…" value="${escapeHtml(exhibition.url || '')}"></div>
      <div id="exhibitions-error">${error ? `<div class="status-banner error">${escapeHtml(error)}</div>` : ''}</div>
      <div class="modal-footer"><button class="btn" id="exhibition-cancel">Cancel</button>
        <div class="right"><button class="btn primary" id="exhibition-save">Save exhibition</button></div>
      </div>`;
    document.getElementById('exhibition-cancel').onclick = openExhibitions;
    document.getElementById('exhibition-save').onclick = () => saveExhibition(index);
  }

  async function saveExhibition(index) {
    const button = document.getElementById('exhibition-save');
    const errorBox = document.getElementById('exhibitions-error');
    button.disabled = true;
    errorBox.textContent = '';
    try {
      const exhibition = validateExhibition({
        title: document.getElementById('exhibition-title').value,
        venue: document.getElementById('exhibition-venue').value,
        startDate: document.getElementById('exhibition-start').value,
        endDate: document.getElementById('exhibition-end').value,
        url: document.getElementById('exhibition-url').value,
      });
      if (index === null) exhibitions.push(exhibition);
      else exhibitions[index] = exhibition;
      exhibitions.sort((a, b) => a.startDate.localeCompare(b.startDate));
      await ghPutFileSafe(
        EXHIBITIONS_PATH,
        utf8ToBase64(`${JSON.stringify(exhibitions, null, 2)}\n`),
        `${index === null ? 'Add' : 'Update'} exhibition: ${exhibition.title}`,
      );
      openExhibitions();
      showBanner(`Saved exhibition "${exhibition.title}". The site will update after its next build.`, 'info');
    } catch (error) {
      button.disabled = false;
      errorBox.innerHTML = `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
    }
  }

  function deleteExhibition(index) {
    const exhibition = exhibitions[index];
    if (!confirm(`Delete "${exhibition.title}"?`)) return;
    exhibitions.splice(index, 1);
    ghPutFileSafe(
      EXHIBITIONS_PATH,
      utf8ToBase64(`${JSON.stringify(exhibitions, null, 2)}\n`),
      `Delete exhibition: ${exhibition.title}`,
    ).then(() => {
      openExhibitions();
      showBanner(`Deleted exhibition "${exhibition.title}".`, 'info');
    }).catch(error => {
      exhibitions.splice(index, 0, exhibition);
      document.getElementById('exhibitions-error').innerHTML =
        `<div class="status-banner error">${escapeHtml(error.message)}</div>`;
    });
  }

  window.VlementAdminExhibitions = { open: openExhibitions };
})();
