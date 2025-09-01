/* global TrelloPowerUp, Papa */
const t = TrelloPowerUp.iframe();

const els = {
  apiKey: document.getElementById('apiKey'),
  apiToken: document.getElementById('apiToken'),
  btnGenToken: document.getElementById('btnGenToken'),
  btnSaveCreds: document.getElementById('btnSaveCreds'),
  authStatus: document.getElementById('authStatus'),
  fileInput: document.getElementById('fileInput'),
  btnImport: document.getElementById('btnImport'),
  progress: document.getElementById('progress'),
  createLists: document.getElementById('createLists'),
  createLabels: document.getElementById('createLabels'),
  log: document.getElementById('log'),
};

function log(msg) {
  const li = document.createElement('li');
  li.textContent = msg;
  els.log.appendChild(li);
}

async function loadCreds() {
  const key = await t.get('member', 'private', 'trello_api_key');
  const token = await t.get('member', 'private', 'trello_token');
  if (key) els.apiKey.value = key;
  if (token) els.apiToken.value = token;
  els.authStatus.textContent = (key && token) ? 'Credentials saved' : 'Not authorized';
  els.btnImport.disabled = !(key && token);
}

async function saveCreds() {
  const key = els.apiKey.value.trim();
  const token = els.apiToken.value.trim();
  await t.set('member', 'private', 'trello_api_key', key || null);
  await t.set('member', 'private', 'trello_token', token || null);
  els.authStatus.textContent = (key && token) ? 'Credentials saved' : 'Not authorized';
  els.btnImport.disabled = !(key && token);
}

function buildTokenUrl(apiKey) {
  const appName = encodeURIComponent('Horizon Importer Power-Up');
  return `https://trello.com/1/authorize?expiration=never&name=${appName}&scope=read,write&response_type=token&key=${encodeURIComponent(apiKey)}`;
}

els.btnGenToken.addEventListener('click', async () => {
  const key = els.apiKey.value.trim();
  if (!key) {
    alert('Enter your API Key first.');
    return;
  }
  window.open(buildTokenUrl(key), '_blank', 'noopener');
});

els.btnSaveCreds.addEventListener('click', saveCreds);

let parsedRows = [];

function parseFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected'));

    if (file.type === 'application/json' || file.name.toLowerCase().endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const json = JSON.parse(reader.result);
          // Support two shapes:
          // a) Array of rows: [{List, Card, Description, Labels}, ...]
          // b) { rows: [...] }
          const rows = Array.isArray(json) ? json : (Array.isArray(json.rows) ? json.rows : []);
          resolve(rows);
        } catch (e) { reject(e); }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data),
        error: reject,
      });
    }
  });
}

async function fetchJSON(url, method = 'GET', body = null) {
  const key = await t.get('member', 'private', 'trello_api_key');
  const token = await t.get('member', 'private', 'trello_token');
  const sep = url.includes('?') ? '&' : '?';
  const authUrl = `${url}${sep}key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;

  const init = { method, headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } };
  if (body) init.body = new URLSearchParams(body).toString();

  const res = await fetch(authUrl, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function ensureLists(boardId, listNames) {
  // fetch existing lists
  const existing = await fetchJSON(`https://api.trello.com/1/boards/${boardId}/lists?fields=id,name&cards=none`);
  const mapNameToId = new Map(existing.map(l => [l.name, l.id]));
  const created = [];

  for (const name of listNames) {
    if (!mapNameToId.has(name)) {
      if (!els.createLists.checked) {
        throw new Error(`Missing list "${name}" and Create missing lists is disabled.`);
      }
      const list = await fetchJSON(`https://api.trello.com/1/lists`, 'POST', { name, idBoard: boardId, pos: 'bottom' });
      mapNameToId.set(name, list.id);
      created.push(name);
      log(`Created list: ${name}`);
      await delay(150);
    }
  }
  return { mapNameToId, created };
}

async function ensureLabels(boardId, labelNames) {
  if (!els.createLabels.checked) return new Map(); // skip
  // fetch existing labels
  const existing = await fetchJSON(`https://api.trello.com/1/boards/${boardId}/labels?fields=id,name,color&limit=1000`);
  const mapNameToId = new Map(existing.filter(l => l.name).map(l => [l.name, l.id]));

  for (const name of labelNames) {
    if (!name) continue;
    if (!mapNameToId.has(name)) {
      const label = await fetchJSON(`https://api.trello.com/1/labels`, 'POST', { idBoard: boardId, name, color: 'null' });
      mapNameToId.set(name, label.id);
      log(`Created label: ${name}`);
      await delay(120);
    }
  }
  return mapNameToId;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runImport() {
  try {
    els.btnImport.disabled = true;
    els.progress.textContent = 'Parsing file…';
    parsedRows = await parseFile(els.fileInput.files[0]);
    if (!parsedRows || !parsedRows.length) throw new Error('No rows found in file.');

    // Normalize rows
    const rows = parsedRows.map(r => ({
      list: (r.List || r.list || '').toString().trim(),
      card: (r.Card || r.card || '').toString().trim(),
      desc: (r.Description || r.description || '').toString(),
      labels: (r.Labels || r.labels || '').toString()
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    })).filter(r => r.list && r.card);

    // Get board id
    const board = await t.board('id', 'name');
    const boardId = board.id;

    // Ensure lists
    const listNames = Array.from(new Set(rows.map(r => r.list)));
    els.progress.textContent = 'Ensuring lists…';
    const { mapNameToId } = await ensureLists(boardId, listNames);

    // Ensure labels
    const uniqueLabels = Array.from(new Set(rows.flatMap(r => r.labels)));
    els.progress.textContent = 'Ensuring labels…';
    const labelMap = await ensureLabels(boardId, uniqueLabels);

    // Create cards
    let created = 0;
    for (const r of rows) {
      els.progress.textContent = `Creating cards… (${created}/${rows.length})`;
      const idList = mapNameToId.get(r.list);
      const idLabels = r.labels.map(name => labelMap.get(name)).filter(Boolean);

      await fetchJSON(`https://api.trello.com/1/cards`, 'POST', {
        idList,
        name: r.card,
        desc: r.desc || '',
        idLabels: idLabels.join(','),
        pos: 'bottom',
      });
      created++;
      if (created % 5 === 0) await delay(150); // be gentle with API
    }
    els.progress.textContent = `Done. Created ${created} cards.`;
    log(`✅ Import complete: ${created} cards.`);
    await t.alert({ message: `Import complete: ${created} cards.`, duration: 6 });
    await t.closePopup();
  } catch (e) {
    console.error(e);
    log(`❌ ${e.message}`);
    els.progress.textContent = 'Error. Check log.';
  } finally {
    els.btnImport.disabled = false;
  }
}

els.fileInput.addEventListener('change', () => {
  els.btnImport.disabled = !(els.apiKey.value && els.apiToken.value && els.fileInput.files.length);
});

els.btnImport.addEventListener('click', runImport);

(async function init() {
  await loadCreds();
  // If opened in
