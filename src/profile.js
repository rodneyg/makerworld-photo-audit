(() => {
  const origin = 'https://makerworld.com';
  let scanning = false;

  function profile() {
    const match = location.pathname.match(/^(\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?@([^/]+))(?:\/(upload|models|profile))?\/?$/i);
    if (!match) return null;
    const route = match[1];
    let handle;
    try {
      handle = decodeURIComponent(match[2]);
    } catch {
      return null;
    }
    return {
      handle,
      modelsTab: match[3] === 'upload' || match[3] === 'models',
      modelsUrl: origin + route + '/upload',
      blocked: /just a moment|attention required|access denied/i.test(document.title)
        || Boolean(document.querySelector('#challenge-running, #challenge-form, #cf-challenge-running'))
    };
  }

  function modelCards(scope, base, live = true) {
    const cards = [];
    for (const anchor of scope.querySelectorAll('a[href*="/models/"]')) {
      if (anchor.closest('header, footer, nav, aside, [hidden], [aria-hidden="true"]')) continue;
      if (live && !anchor.getClientRects().length) continue;
      const url = URL.parse(anchor.getAttribute('href'), base);
      if (!url) continue;
      const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/([1-9]\d{0,15})(?:-[^/]+)?\/?$/i);
      if (url.origin !== origin || !match) continue;
      const labels = [anchor.getAttribute('aria-label'), anchor.title, anchor.textContent, anchor.querySelector('img[alt]')?.alt];
      const title = (labels.find(label => label?.trim()) ?? '').trim().replace(/\s+/g, ' ').slice(0, 180);
      cards.push({ anchor, model: { id: match[1], url: url.origin + url.pathname, title } });
    }
    return cards;
  }

  function loadMoreButton(scope) {
    return [...scope.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])')].find(button =>
      !button.form && !button.closest('header, footer, nav, aside') && button.getClientRects().length
      && /^load more(?: models)?$|^show more models$/i.test((button.getAttribute('aria-label') || button.textContent).trim())
    );
  }

  const nextControls = 'a[rel~="next"], button[aria-label="next page" i], a[aria-label="next page" i]';

  function pageScope(doc) {
    return doc.querySelector('main, [role="main"]') || doc.body || doc;
  }

  function nextLink(doc, base) {
    const current = new URL(base);
    const controls = [...doc.querySelectorAll('link[rel~="next"], a[rel~="next"], a[aria-label="next page" i]')];
    for (const control of controls) {
      const href = control.getAttribute('href');
      if (!href || control.matches('[aria-disabled="true"]')) continue;
      const url = URL.parse(href, base);
      if (url?.origin !== origin || url.username || url.password || !url.search || url.search === current.search) continue;
      if (url.pathname.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '')) continue;
      url.hash = '';
      return url.href;
    }
    return null;
  }

  function rememberCards(found, cards) {
    for (const { model } of cards) {
      const previous = found.get(model.id);
      if (!previous || (!previous.title && model.title)) found.set(model.id, model);
    }
  }

  async function scanLinkedPages(found, isClosed) {
    let next = nextLink(document, location.href);
    if (!next) {
      return [...pageScope(document).querySelectorAll(nextControls)].some(control =>
        !control.matches(':disabled, [aria-disabled="true"]') && control.getClientRects().length
      );
    }
    const seen = new Set([location.href.split('#')[0]]);
    while (next && seen.size <= 20 && !isClosed()) {
      if (seen.has(next)) return true;
      seen.add(next);
      await new Promise(resolve => setTimeout(resolve, 500));
      if (isClosed()) return true;
      try {
        const response = await fetch(next, {
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return true;
        const page = document.createElement('template');
        page.innerHTML = await response.text();
        const cards = modelCards(pageScope(page.content), next, false);
        if (!cards.length) return true;
        rememberCards(found, cards);
        next = nextLink(page.content, next);
      } catch {
        return true;
      }
    }
    return Boolean(next);
  }

  function scrollContainer(anchor) {
    for (let element = anchor?.parentElement; element && element !== document.body; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)) {
        return element;
      }
    }
    return document.scrollingElement;
  }

  async function scan(port, isClosed) {
    const current = profile();
    if (!current?.modelsTab || current.blocked) {
      port.postMessage({ error: 'Open the public Models tab and wait for it to load.' });
      return;
    }

    const scope = pageScope(document);
    const found = new Map();
    const positions = new Map();
    let settled = 0;
    let attemptedButton;
    try {
      for (let step = 0; step < 24 && settled < 4; step++) {
        if (isClosed()) return;
        if (profile()?.handle !== current.handle || !profile()?.modelsTab) {
          port.postMessage({ error: 'The profile changed during the scan.' });
          return;
        }
        const cards = modelCards(scope, location.href);
        const previousCount = found.size;
        rememberCards(found, cards);
        settled = found.size === previousCount ? settled + 1 : 0;
        if (settled >= 4) break;
        const more = loadMoreButton(scope);
        if (more && (attemptedButton?.element !== more || attemptedButton?.count !== found.size)) {
          more.click();
          attemptedButton = { element: more, count: found.size };
        }
        const scroller = scrollContainer(cards.at(-1)?.anchor);
        if (scroller) {
          if (!positions.has(scroller)) positions.set(scroller, scroller.scrollTop);
          // Advance a viewport at a time so virtualized lists can mount intermediate cards.
          const previousTop = scroller.scrollTop;
          scroller.scrollTo({ top: previousTop + Math.max(350, scroller.clientHeight * 0.85), behavior: 'instant' });
          if (scroller.scrollTop !== previousTop) settled = 0;
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      const unreadPages = await scanLinkedPages(found, isClosed);
      if (!isClosed()) port.postMessage({
        handle: current.handle,
        models: [...found.values()],
        more: unreadPages || settled < 4
      });
    } finally {
      for (const [scroller, top] of positions) scroller.scrollTo({ top, behavior: 'instant' });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id === chrome.runtime.id && message?.type === 'profile-info') reply(profile());
  });

  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'profile-audit' || port.sender?.id !== chrome.runtime.id) return;
    let closed = false;
    port.onDisconnect.addListener(() => { closed = true; });
    port.onMessage.addListener(async message => {
      if (message?.type !== 'scan') return;
      if (scanning) {
        port.postMessage({ error: 'A scan is already reading this Models tab.' });
        return;
      }
      scanning = true;
      try {
        await scan(port, () => closed);
      } catch {
        if (!closed) port.postMessage({ error: 'Could not read the Models tab. Reload it and try again.' });
      } finally {
        scanning = false;
      }
    });
  });
})();
