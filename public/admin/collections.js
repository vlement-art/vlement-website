/* Collections manager for vlement.com/admin
   Load AFTER the main admin script:
   Stores the list in src/data/collections.json (created on first change). */
const COLLECTIONS_PATH = 'src/data/collections.json';
let collections = [];

async function loadCollections() {
  const f = await ghGetFile(COLLECTIONS_PATH);
  collections = f
    ? JSON.parse(base64ToUtf8(f.content))
    : COLLECTION_OPTIONS.map(n => ({ name: n, slug: slugify(n) })); // seed from current list
  syncCollectionOptions();
}

// Keeps the artwork editor's Collection dropdown in step with the list
function syncCollectionOptions() {
  COLLECTION_OPTIONS.splice(0, COLLECTION_OPTIONS.length, ...collections.map(c => c.name));
}

async function saveCollections(message) {
  await ghPutFileSafe(COLLECTIONS_PATH, utf8ToBase64(JSON.stringify(collections, null, 2) + '\n'), message);
  syncCollectionOptions();
}

const collectionUsage = name => entries.filter(e => e.data.collection === name).length;
const collectionExists = name => collections.some(c => c.name.toLowerCase() === name.toLowerCase());

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
  btn.onclick = openCollections;
  document.getElementById('new-entry-btn').before(btn);
  loadCollections().catch(err => showBanner('Could not load collections: ' + err.message, 'error'));
}

// Run after sign-in, and straight away if already signed in
const _showApp = showApp;
showApp = function () { _showApp(); initCollections(); };
if (!document.getElementById('app-screen').hidden) initCollections();
