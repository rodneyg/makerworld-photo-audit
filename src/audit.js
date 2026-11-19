import { Status, compareRows } from './classification.js';
import { coverLabel, makeCsv, realPhotoLabel } from './csv.js';

const byId = id => document.getElementById(id);
const scanButton = byId('scan');
const exportButton = byId('export');
const modelsButton = byId('models-tab');
const fullButton = byId('full-view');
const progress = byId('progress');
const rows = new Map();
const numberFormat = new Intl.NumberFormat();
const view = /^#tab=([1-9]\d*)$/.exec(location.hash);
const pinnedTabId = view ? Number(view[1]) : null;
const statusMetrics = {
  [Status.COVER]: ['cover', 'risk'],
  [Status.EDIT]: ['edit', 'edit'],
  [Status.OK]: ['ok', 'okay'],
  [Status.UNKNOWN]: ['unknown', 'unknown']
};
let sourceTabId = pinnedTabId;
let source;
let profileHandle;
let running = false;
let pendingRefresh = 0;

if (pinnedTabId) document.documentElement.classList.add('full-view');

function setProgress(message) {
  progress.textContent = message;
}

function sortedRows() {
  return [...rows.values()].sort(compareRows);
}

function badge(status) {
  const span = document.createElement('span');
  span.className = 'badge ' + statusMetrics[status][1];
  span.textContent = status;
  return span;
}

function valueCell(tr, value, numeric = false) {
  const td = tr.insertCell();
  if (numeric) td.className = 'number';
  td.textContent = typeof value === 'number' ? numberFormat.format(value) : value ?? '–';
}

function render() {
  const allRows = sortedRows();
  byId('dashboard-results').hidden = allRows.length === 0;
  byId('table-container').hidden = allRows.length === 0;
  exportButton.disabled = allRows.length === 0 || running;
  const counts = Object.fromEntries(Object.values(Status).map(status => [status, 0]));
  const showPoints = allRows.some(row => row.points !== null);
  byId('points-heading').hidden = !showPoints;
  const body = document.createDocumentFragment();

  for (const row of allRows) {
    counts[row.status]++;
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.dataset.status = row.status;
    if (row.editBlocked === true) tr.dataset.editBlocked = 'true';
    const cell = tr.insertCell();
    cell.className = 'model-cell';
    const link = document.createElement('a');
    link.textContent = row.title;
    link.href = row.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    cell.append(link);
    if (row.note) {
      const note = document.createElement('p');
      note.className = 'row-note';
      note.textContent = row.note;
      cell.append(note);
    }

    valueCell(tr, row.totalPhotos, true);
    valueCell(tr, realPhotoLabel(row), true);
    valueCell(tr, coverLabel(row));
    valueCell(tr, row.downloads, true);
    if (showPoints) valueCell(tr, row.points, true);
    tr.insertCell().append(badge(row.status));
    body.append(tr);
  }

  for (const [status, [key]] of Object.entries(statusMetrics)) byId('count-' + key).textContent = counts[status];
  byId('rows').replaceChildren(body);
}

async function refreshSource({ preserveProgress = false } = {}) {
  const refresh = ++pendingRefresh;
  if (running) return;
  scanButton.disabled = true;
  modelsButton.hidden = true;
  source = null;
  fullButton.hidden = true;
  if (!sourceTabId) {
    setProgress('Open a MakerWorld profile and select Models.');
    return;
  }
  let info;
  try {
    info = await chrome.tabs.sendMessage(sourceTabId, { type: 'profile-info' });
  } catch {
    const tab = await chrome.tabs.get(sourceTabId).catch(() => null);
    if (refresh !== pendingRefresh) return;
    const profileUrl = tab?.url?.startsWith('https://makerworld.com/') && tab.url.includes('/@');
    setProgress(profileUrl
      ? 'Could not read the profile. Let MakerWorld load or reload the tab.'
      : 'Open a MakerWorld profile and select Models.');
    return;
  }
  if (refresh !== pendingRefresh) return;
  if (!info?.handle) {
    setProgress('Open a MakerWorld profile and select Models.');
    return;
  }
  source = info;
  if (profileHandle && info.handle.toLowerCase() !== profileHandle) {
    rows.clear();
    render();
  }
  profileHandle = info.handle.toLowerCase();
  byId('profile-label').textContent = '@' + info.handle;
  fullButton.hidden = Boolean(pinnedTabId);
  modelsButton.hidden = info.modelsTab || info.blocked;
  scanButton.disabled = info.blocked || !info.modelsTab;
  if (info.blocked) setProgress('MakerWorld blocked this profile page. Load it normally, then try again.');
  else if (!info.modelsTab) setProgress('Open the Models tab to find public designs.');
  else if (!rows.size && !preserveProgress) setProgress('Scan public models on this profile.');
}

function readModels() {
  return new Promise((resolve, reject) => {
    const port = chrome.tabs.connect(sourceTabId, { name: 'profile-audit', frameId: 0 });
    port.onDisconnect.addListener(() => reject(new Error('The Models tab changed or closed. Try again.')));
    port.onMessage.addListener(result => {
      if (result.error) reject(new Error(result.error));
      else resolve(result);
      port.disconnect();
    });
    port.postMessage({ type: 'scan' });
  });
}

function unavailable(model, note) {
  return {
    ...model,
    title: model.title || 'Model ' + model.id,
    totalPhotos: null,
    realPhotos: null,
    knownRealPhotos: 0,
    coverMarked: null,
    editBlocked: null,
    downloads: null,
    points: null,
    status: Status.UNKNOWN,
    note
  };
}

scanButton.addEventListener('click', async () => {
  if (running || !source?.modelsTab || source.blocked) return;
  running = true;
  scanButton.disabled = true;
  exportButton.disabled = true;
  setProgress('Reading the Models tab…');
  try {
    const { handle, models, more } = await readModels();
    if (handle.toLowerCase() !== profileHandle) throw new Error('The profile changed. Open the audit again.');
    let rateLimited = false;
    let excluded = 0;
    for (const [index, model] of models.entries()) {
      setProgress(`Checking model ${index + 1} of ${models.length}…`);
      const result = await chrome.runtime.sendMessage({ type: 'audit-design', id: model.id });
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
      if (result.row?.handle && result.row.handle.toLowerCase() !== profileHandle) {
        rows.delete(model.id);
        excluded++;
        continue;
      }
      rows.set(model.id, result.row?.handle
        ? { ...result.row, url: model.url }
        : unavailable(model, result.error || 'Design creator could not be verified.'));
    }

    const label = rows.size === 1 ? '1 model' : numberFormat.format(rows.size) + ' models';
    const note = excluded ? ` ${excluded} from another profile skipped.` : '';
    if (rateLimited) setProgress(`MakerWorld asked us to slow down. ${label} checked. Try again later.`);
    else if (!models.length) setProgress('No public models were found on the loaded page.');
    else if (more) {
      const paging = pinnedTabId ? 'Check the next page and scan again.' : 'Open in tab and scan again to keep results while paging.';
      setProgress(`${label} checked.${note} More may be available. ${paging}`);
    }
    else setProgress(`${label} checked from the loaded Models tab.${note}`);
  } catch (error) {
    setProgress(error.message || 'The scan ended early. Try again.');
  } finally {
    running = false;
    render();
    await refreshSource({ preserveProgress: true });
  }
});

exportButton.addEventListener('click', () => {
  const data = new Blob(['\uFEFF', makeCsv(sortedRows())], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.download = `makerworld-${profileHandle.replace(/[^\p{L}\p{N}._-]/gu, '-')}-photo-audit.csv`;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
});

modelsButton.addEventListener('click', async () => {
  if (!source?.modelsUrl || !sourceTabId) return;
  try {
    await chrome.tabs.update(sourceTabId, { url: source.modelsUrl });
    setProgress('Opening the Models tab…');
  } catch {
    setProgress('Open the Models tab on MakerWorld.');
  }
});

fullButton.addEventListener('click', () => {
  if (sourceTabId) chrome.tabs.create({ url: chrome.runtime.getURL('audit.html') + '#tab=' + sourceTabId });
});

chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === sourceTabId && (change.url || change.status === 'complete')) void refreshSource();
});
chrome.tabs.onRemoved.addListener(id => {
  if (id === sourceTabId) {
    sourceTabId = null;
    void refreshSource();
  }
});

if (!pinnedTabId) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  sourceTabId = active?.id;
}
void refreshSource();
