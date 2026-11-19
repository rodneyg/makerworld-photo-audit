import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../scripts/playwright.js';

const [mode, out = 'test-output'] = process.argv.slice(2);
if (!['live', 'replay', 'store'].includes(mode)) throw new Error('Usage: node test/browser.js live|replay|store [output-directory]');
const evidence = resolve(out);
const repo = fileURLToPath(new URL('../', import.meta.url));
const extension = resolve(process.env.EXTENSION_DIR || resolve(repo, 'src'));
const profiles = [
  {
    name: 'BambuLab',
    url: 'https://makerworld.com/en/@BambuLab/upload',
    cards: [
      [92486, 'ams-lite-top-mount-for-a1-a2l', 'AMS Lite Top Mount for A1 & A2L'],
      [12703, 'bambu-bed-scraper', 'Bambu Bed Scraper'],
      [40146, 'benchy-bambu-pla-basic', 'Benchy Bambu Pla Basic']
    ],
    deferred: 1,
    linked: 1
  },
  {
    name: 'MarksMakerSpace',
    url: 'https://makerworld.com/en/@MarksMakerSpace/upload',
    cards: [[544229, 'filament-swatch-system', 'Filament Swatch System']]
  }
];

const fields = ['Cover risk', 'Edit-blocked', 'OK', 'Unverified'];
const results = [];
await mkdir(evidence, { recursive: true });
const userDataDir = await mkdtemp(resolve(tmpdir(), 'makerworld-audit-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  acceptDownloads: true,
  viewport: { width: 1280, height: 800 }
});
const requests = [];
const errors = [];
context.on('request', request => {
  const url = new URL(request.url());
  if (url.hostname === 'api.bambulab.com') {
    requests.push({ resource: url.pathname, search: url.search, method: request.method(), receivedAt: Date.now() });
  }
});
context.on('weberror', failure => errors.push(failure.error().message));

function escapeText(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

function replayDocument(item, pageTwo = false) {
  const card = ([id, slug, title]) => `<li><a href="/en/models/${id}-${slug}">${escapeText(title)}</a></li>`;
  const firstPage = item.linked ? item.cards.slice(0, -item.linked) : item.cards;
  const cards = (pageTwo ? item.cards.slice(-item.linked) : firstPage).map(card);
  const deferred = pageTwo ? 0 : item.deferred;
  const initial = deferred ? cards.slice(0, -deferred) : cards;
  const hidden = deferred ? cards.slice(-deferred) : [];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${item.name} | Sample Models</title>
  <body><main><h1>${item.name}</h1><nav><a href="/en/@${item.name}/upload">Models</a></nav>
  <ul id="models">${initial.join('')}
  <li><a href="https://example.org/en/models/999-outside">Outside link</a></li>
  <li hidden><a href="/en/models/998-hidden">Hidden link</a></li>
  </ul>
  ${hidden.length ? `<button id="more">Load more models</button><template id="extra">${hidden.join('')}${cards[0]}</template><script>
    document.querySelector('#more').onclick = function () {
      document.querySelector('#models').append(document.querySelector('#extra').content.cloneNode(true));
      this.remove();
    };
  </script>` : ''}
  ${item.linked && !pageTwo ? '<nav aria-label="Pagination"><a rel="next" href="?page=2">Next page</a></nav>' : ''}
  </main><footer><a href="/en/models/999-footer">Footer link</a></footer></body></html>`;
}

async function auditPage(worker, source) {
  const tabId = await worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({ url: 'https://makerworld.com/*' });
    return tabs.find(tab => tab.url === url)?.id;
  }, source.url());
  assert.ok(tabId, 'MakerWorld source has a Chrome tab ID');
  const extensionUrl = new URL('audit.html', worker.url()).href;
  let dashboard;
  if (mode === 'store') {
    const opened = context.waitForEvent('page');
    await worker.evaluate(async ({ url, sourceId }) => {
      await chrome.tabs.update(sourceId, { active: true });
      // The action popup is not a Playwright page. An inactive extension page
      // exercises its unpinned entry point while leaving the profile active.
      await chrome.tabs.create({ url, active: false });
    }, { url: extensionUrl, sourceId: tabId });
    const popup = await opened;
    await popup.waitForURL(extensionUrl);
    await popup.locator('#full-view').waitFor({ state: 'visible' });
    assert.match(await popup.locator('#profile-label').textContent(), /@ExampleStudio/);
    const expanded = context.waitForEvent('page');
    await popup.locator('#full-view').click();
    dashboard = await expanded;
    await dashboard.waitForURL(extensionUrl + '#tab=' + tabId);
    await popup.close();
  } else {
    dashboard = await context.newPage();
    await dashboard.goto(extensionUrl + '#tab=' + tabId);
  }
  await dashboard.waitForFunction(() => !document.querySelector('#scan').disabled
    || /blocked|Could not read|Open the Models tab/.test(document.querySelector('#progress').textContent));
  return dashboard;
}

async function runProfile(worker, item) {
  const slug = item.name.toLowerCase();
  const source = await context.newPage();
  let dashboard;
  try {
    const response = await source.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    if (mode === 'live' && response?.status() === 403) {
      await source.waitForTimeout(7000);
      if (/just a moment|attention required|access denied/i.test(await source.title())) {
        await source.screenshot({ path: resolve(evidence, `live-${slug}-challenge.png`), animations: 'disabled' });
        dashboard = await auditPage(worker, source);
        await dashboard.screenshot({ path: resolve(evidence, `live-${slug}-audit-blocked.png`), animations: 'disabled' });
        return { profile: item.name, url: item.url, http: 403, title: await source.title(),
          outcome: 'Blocked by Cloudflare', counts: null, csv: null };
      }
    }
    dashboard = await auditPage(worker, source);
    const ready = await dashboard.locator('#scan').isEnabled();
    assert.ok(ready, await dashboard.locator('#progress').textContent());
    await dashboard.locator('#scan').click();
    await dashboard.waitForFunction(() => !document.querySelector('#scan').disabled, null, { timeout: 120_000 });

    const progress = await dashboard.locator('#progress').textContent();
    const rows = await dashboard.locator('#rows tr').evaluateAll(entries => entries.map(row => ({
      id: Number(row.dataset.id), status: row.dataset.status, editBlocked: Boolean(row.dataset.editBlocked),
      title: row.querySelector('a').textContent, note: row.querySelector('.row-note')?.textContent ?? null
    })));
    assert.deepEqual(await dashboard.locator('#rows tr').evaluateAll(entries =>
      entries.map(row => [...row.querySelectorAll('.badge')].map(badge => badge.textContent))
    ), rows.map(row => [row.status]));
    const counts = Object.fromEntries(fields.map(value => [value, rows.filter(row => row.status === value).length]));
    for (const [key, field] of Object.entries({ cover: fields[0], edit: fields[1], ok: fields[2], unknown: fields[3] })) {
      assert.equal(Number(await dashboard.locator('#count-' + key).textContent()), counts[field]);
    }

    if (mode === 'replay') {
      assert.deepEqual(rows.map(row => row.id).sort(), item.cards.map(card => card[0]).sort());
    }
    assert.ok(rows.length, `No rows from ${item.name}: ${progress}`);
    const fileName = `${mode}-${slug}.csv`;
    const downloaded = dashboard.waitForEvent('download');
    await dashboard.locator('#export').click();
    await (await downloaded).saveAs(resolve(evidence, fileName));
    const csv = await readFile(resolve(evidence, fileName), 'utf8');
    assert.ok(csv.startsWith('\uFEFF"Model","Link","Total photos","Real-life photos"'));
    for (const row of rows) {
      const line = csv.split('\r\n').find(line => new RegExp(`/models/${row.id}(?:-|")`).test(line));
      assert.ok(line, `Missing CSV row for ${row.id}`);
      assert.ok(line.includes(`,"${row.status}","${row.editBlocked ? 'Yes' : 'No'}",`)
        || (!row.editBlocked && line.includes(`,"${row.status}","Unknown",`)), line);
    }
    if (mode === 'store') {
      const cover = dashboard.locator('#rows tr[data-id="1006"]');
      assert.equal(await cover.locator('td').nth(1).textContent(), '4');
      assert.equal(await cover.locator('td').nth(3).textContent(), 'Unknown');
      assert.match(csv, /"4","3","Unknown","2048","","Unverified","No",""/);
    }

    const screenshot = mode === 'store' ? resolve(evidence, 'screenshot-1280x800.png') : resolve(evidence, `${mode}-${slug}.png`);
    await dashboard.screenshot({ path: screenshot, animations: 'disabled' });
    if (mode === 'replay') {
      assert.ok(rows.every(row => row.note === null), JSON.stringify(rows));
      const cached = await dashboard.evaluate(id => chrome.runtime.sendMessage({ type: 'audit-design', id }), String(rows[0].id));
      assert.equal(cached.cached, true, 'worker reused the previous network result');
    }
    return { profile: item.name, url: item.url, http: response.status(), progress, outcome: 'Pass', counts, rows, csv: fileName };
  } finally {
    await dashboard?.close();
    await source.close();
  }
}

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  console.log(JSON.stringify({ mode, extensionRoot: extension, extensionLoaded: worker.url().startsWith('chrome-extension://') }));
  if (mode === 'store') {
    const fixtures = Object.values(JSON.parse(await readFile(new URL('./fixtures/designs.json', import.meta.url))));
    const item = {
      name: 'ExampleStudio',
      url: 'https://makerworld.com/en/@ExampleStudio/upload',
      cards: fixtures.map(data => [data.id, data.title.toLowerCase().replaceAll(' ', '-'), data.title])
    };
    await context.route(item.url, route => route.fulfill({ contentType: 'text/html', body: replayDocument(item) }));
    await context.route('https://api.bambulab.com/v1/design-service/design/*', route => {
      const url = new URL(route.request().url());
      const data = fixtures.find(data => data.id === Number(url.pathname.split('/').at(-1)));
      assert.ok(data, url.pathname);
      return route.fulfill({ json: data });
    });
    const sample = await runProfile(worker, item);
    assert.deepEqual(sample.counts, { 'Cover risk': 1, 'Edit-blocked': 2, 'OK': 1, 'Unverified': 2 });
    assert.deepEqual(sample.rows.map(row => row.id), [1001, 1003, 1002, 1006, 1005, 1004]);
    results.push(sample);
  } else {
    for (const item of profiles) {
      if (mode === 'replay') {
        await context.route(item.url, route => route.fulfill({ contentType: 'text/html', body: replayDocument(item) }));
        if (item.linked) {
          await context.route(item.url + '?page=2', route => route.fulfill({ contentType: 'text/html', body: replayDocument(item, true) }));
        }
      }
      try {
        results.push(await runProfile(worker, item));
      } catch (error) {
        results.push({ profile: item.name, url: item.url, outcome: 'Failed', error: error.message });
      }
    }
  }
  assert.deepEqual(errors, [], 'Uncaught page errors');
  assert.ok(requests.every(entry => entry.method === 'GET' && entry.search === '?visitHistory=false'));
  if (mode === 'replay') {
    assert.deepEqual(requests.map(entry => Number(entry.resource.split('/').at(-1))).sort(),
      profiles.flatMap(item => item.cards.map(card => card[0])).sort());
    for (let i = 1; i < requests.length; i++) assert.ok(requests[i].receivedAt - requests[i - 1].receivedAt >= 425);
  }
} finally {
  for (const result of results) console.log(JSON.stringify(result));
  await writeFile(resolve(evidence, `${mode}-summary.json`), JSON.stringify({ mode, results, requests, errors }, null, 2) + '\n');
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
}
if (results.some(result => result.outcome === 'Failed')) process.exitCode = 1;
else if (results.some(result => result.outcome !== 'Pass')) process.exitCode = 2;
