/* Taxonomy options for vlement.com/admin are stored alongside the artwork records. */
const COLLECTIONS_PATH = 'src/data/collections.json';
const CATEGORIES_PATH = 'src/data/categories.json';
let collections = [];
let categories = [];
let taxonomyLoadPromise = null;

function normalizedTaxonomy(items, defaults, recordValues) {
  const result = [];
  const seen = new Set();
  for (const item of [...items, ...defaults, ...recordValues]) {
    const name = typeof item === 'string' ? item.trim() : String(item?.name || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, slug: slugify(name) });
  }
  return result;
}

function parseTaxonomyFile(file, path) {
  if (!file) return [];
  const parsed = JSON.parse(base64ToUtf8(file.content));
  if (!Array.isArray(parsed) || parsed.some(item => typeof item?.name !== 'string')) {
    throw new Error(`${path} must contain a JSON array of named taxonomy values.`);
  }
  return parsed;
}

async function ensureTaxonomiesLoaded() {
  if (!taxonomyLoadPromise) {
    taxonomyLoadPromise = (async () => {
      const [collectionsFile, categoriesFile] = await Promise.all([
        ghGetFile(COLLECTIONS_PATH),
        ghGetFile(CATEGORIES_PATH)
      ]);
      collections = normalizedTaxonomy(
        parseTaxonomyFile(collectionsFile, COLLECTIONS_PATH),
        COLLECTION_OPTIONS,
        entries.map(entry => entry.data.collection)
      );
      categories = normalizedTaxonomy(
        parseTaxonomyFile(categoriesFile, CATEGORIES_PATH),
        CATEGORY_OPTIONS,
        entries.map(entry => entry.data.category)
      );
      syncTaxonomyOptions();
    })().catch(err => {
      taxonomyLoadPromise = null;
      throw err;
    });
  }
  return taxonomyLoadPromise;
}

function syncTaxonomyOptions() {
  syncCollectionOptions();
  CATEGORY_OPTIONS.splice(0, CATEGORY_OPTIONS.length, ...categories.map(c => c.name));
}

// Keeps the artwork editor's Collection dropdown in step with the list
function syncCollectionOptions() {
  COLLECTION_OPTIONS.splice(0, COLLECTION_OPTIONS.length, ...collections.map(c => c.name));
}

async function saveCollections(message) {
  await ghPutFileSafe(COLLECTIONS_PATH, utf8ToBase64(JSON.stringify(collections, null, 2) + '\n'), message);
  syncTaxonomyOptions();
}

const collectionUsage = name => entries.filter(e => e.data.collection === name).length;
const collectionExists = name => collections.some(c => c.name.toLowerCase() === name.toLowerCase());
const categoryExists = name => categories.some(c => c.name.toLowerCase() === name.toLowerCase());

async function createTaxonomyFromEditor(type) {
  await ensureTaxonomiesLoaded();
  const isCollection = type === 'collection';
  const label = isCollection ? 'collection' : 'category';
  const name = prompt(`New ${label} name`);
  if (!name || !name.trim()) return;
  const normalizedName = name.trim();
  const list = isCollection ? collections : categories;
  const exists = isCollection ? collectionExists(normalizedName) : categoryExists(normalizedName);
  const select = document.getElementById(`f-${type}`);
  if (exists) {
    const existing = list.find(item => item.name.toLowerCase() === normalizedName.toLowerCase());
    if (select) select.value = existing.name;
    showBanner(`"${existing.name}" already exists and has been selected.`, 'info');
    return;
  }

  const updated = [...list, { name: normalizedName, slug: slugify(normalizedName) }];
  const path = isCollection ? COLLECTIONS_PATH : CATEGORIES_PATH;
  await ghPutFileSafe(path, utf8ToBase64(JSON.stringify(updated, null, 2) + '\n'), `Add ${label}: ${normalizedName}`);
  if (isCollection) collections = updated;
  else categories = updated;
  syncTaxonomyOptions();
  if (select) {
    const option = document.createElement('option');
    option.value = normalizedName;
    option.textContent = normalizedName;
    select.appendChild(option);
    select.value = normalizedName;
  }
  showBanner(`Added ${label} "${normalizedName}".`, 'info');
}

function openCollections() {
  const rows = collections.map((c, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)">
      <span>${escapeHtml(c.name)} <span style="color:var(--muted);font-size:12px">· ${collectionUsage(c.name)} artwork(s)</span></span>
      <span style="display:flex;gap:6px">
        <button class="btn" data-rename="${i}">Rename</button>
        <button class="btn danger" data-delete="${i}">Delete</button>
      </span>
    </div>`).join('') || '<p>No collections yet.</p>';

  document.getElementById('modal').innerHTML = `
    <h2>Collections</h2>
    <div>${rows}</div>
    <div class="field">
      <label>New collection</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="col-new" style="flex:1" placeholder="e.g. Yellow Balloon">
        <button class="btn primary" id="col-add">Add</button>
      </div>
    </div>
    <div id="modal-error"></div>
    <div class="modal-footer"><span></span><div class="right"><button class="btn" id="col-close">Close</button></div></div>`;
  document.getElementById('modal-overlay').hidden = false;

  const modal = document.getElementById('modal');
  document.getElementById('col-close').onclick = closeModal;
  document.getElementById('col-add').onclick = () => runCollectionAction(addCollection);
  modal.querySelectorAll('[data-rename]').forEach(b => b.onclick = () => runCollectionAction(() => renameCollection(+b.dataset.rename)));
  modal.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => runCollectionAction(() => deleteCollection(+b.dataset.delete)));
}

async function runCollectionAction(fn) {
  const modal = document.getElementById('modal');
  const buttons = modal.querySelectorAll('button');
  buttons.forEach(b => b.disabled = true);
  try {
    const changed = await fn();
    if (changed) { renderGrid(); showBanner(changed, 'info'); }
    openCollections();
  } catch (err) {
    openCollections();
    document.getElementById('modal-error').innerHTML = `<div class="status-banner error">${escapeHtml(err.message)}</div>`;
  }
}

async function addCollection() {
  const name = document.getElementById('col-new').value.trim();
  if (!name) throw new Error('Enter a collection name.');
  if (collectionExists(name)) throw new Error(`"${name}" already exists.`);
  collections.push({ name, slug: slugify(name) });
  await saveCollections(`Add collection: ${name}`);
  return `Added collection "${name}".`;
}

async function renameCollection(i) {
  const old = collections[i].name;
  const input = prompt('Rename collection', old);
  const name = input && input.trim();
  if (!name || name === old) return null;
  if (collectionExists(name) && name.toLowerCase() !== old.toLowerCase()) throw new Error(`"${name}" already exists.`);
  const affected = entries.filter(e => e.data.collection === old);
  if (affected.length && !confirm(`${affected.length} artwork(s) will be updated to "${name}". Continue?`)) return null;

  // Update every artwork first, then the list. If this fails midway, run Rename again to finish.
  for (const e of affected) {
    e.data.collection = name;
    const res = await ghPutFileSafe(e.path, utf8ToBase64(buildFrontmatter(e.data, e.body)),
      `Move ${e.data.title || e.slug} to collection ${name}`);
    e.sha = res?.content?.sha;
  }
  collections[i] = { name, slug: slugify(name) };
  await saveCollections(`Rename collection ${old} to ${name}`);
  return `Renamed "${old}" to "${name}".`;
}

async function deleteCollection(i) {
  const { name } = collections[i];
  const used = collectionUsage(name);
  if (used) throw new Error(`"${name}" still has ${used} artwork(s). Move them to another collection first.`);
  if (!confirm(`Delete collection "${name}"?`)) return null;
  collections.splice(i, 1);
  await saveCollections(`Delete collection: ${name}`);
  return `Deleted collection "${name}".`;
}

function initCollections() {
  if (document.getElementById('collections-btn')) return;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.id = 'collections-btn';
  btn.textContent = 'Collections';
  btn.onclick = () => ensureTaxonomiesLoaded()
    .then(openCollections)
    .catch(err => showBanner('Could not load collections: ' + err.message, 'error'));
  document.getElementById('new-entry-btn').before(btn);
  ensureTaxonomiesLoaded().catch(err => showBanner('Could not load categories and collections: ' + err.message, 'error'));
}
