import { classifyDesign } from './classification.js';

const CACHE_NAME = 'design-audit-v1';
const CACHE_TIME = 15 * 60_000;
const CACHE_LIMIT = 750;
const REQUEST_GAP = 450;
let queue = Promise.resolve();
let lastRequestEnded = 0;
let pauseUntil = 0;

async function cachedRow(cache, url) {
  const response = await cache?.match(url);
  if (!response) return null;
  const item = await response.json();
  if (Date.now() - item.savedAt < CACHE_TIME) return item.row;
  await cache.delete(url);
  return null;
}

async function cacheRow(cache, url, row) {
  if (!cache) return;
  await cache.put(url, new Response(JSON.stringify({ savedAt: Date.now(), row })));
  const entries = await cache.keys();
  if (entries.length > CACHE_LIMIT) await cache.delete(entries[0]);
}

async function getDesign(id) {
  const url = `https://api.bambulab.com/v1/design-service/design/${id}?visitHistory=false`;
  const cache = await caches.open(CACHE_NAME).catch(() => null);
  const hit = await cachedRow(cache, url).catch(() => null);
  if (hit) return { row: hit, cached: true };

  if (Date.now() < pauseUntil) return { rateLimited: true };
  const wait = lastRequestEnded + REQUEST_GAP - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));

  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const delay = /^\d+$/.test(header ?? '') ? Number(header) * 1000 : Date.parse(header) - Date.now();
      pauseUntil = Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60_000);
      return { rateLimited: true };
    }
    if (!response.ok) return { error: `Design service returned HTTP ${response.status}.` };
    const design = await response.json();
    if (String(design?.id) !== id || typeof design.title !== 'string' || !design.title.trim()) {
      return { error: 'Design metadata is unavailable.' };
    }
    const row = classifyDesign(design);
    await cacheRow(cache, url, row).catch(() => {});
    return { row, cached: false };
  } catch {
    return { error: 'Could not read the public design details.' };
  } finally {
    lastRequestEnded = Date.now();
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url?.split('#')[0] !== chrome.runtime.getURL('audit.html')) return;
  if (message?.type !== 'audit-design' || typeof message.id !== 'string' || !/^[1-9]\d{0,15}$/.test(message.id)) return;
  const job = queue.then(() => getDesign(message.id));
  queue = job.catch(() => {});
  job.then(reply, () => reply({ error: 'Could not read the public design details.' }));
  return true;
});
