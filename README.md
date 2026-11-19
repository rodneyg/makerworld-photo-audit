# Photo Audit for MakerWorld

A free, MIT-licensed Chrome Manifest V3 extension for reviewing public MakerWorld model photo flags. It runs locally, uses no AI or remote code, and makes read-only requests.

## Use

1. Load `src/` as an unpacked extension in Chrome.
2. Visit a public MakerWorld profile. Open its **Models** tab or use **Open Models** from the extension.
3. Click **Scan models**. Use **Export CSV** to save the sorted table.
4. For a long audit or a profile with additional pages, use **Open in tab**. If a page needs to be opened manually, use the profile's own navigation and scan again in the same audit tab. That view combines the models it finds.

## How model IDs are listed

MakerWorld uses profile routes such as `/en/@handle` and a published-model tab at `/en/@handle/upload`. Public model links carry a numeric design ID at the start of `/en/models/<id>-<slug>`. The extension reads those links from the rendered Models tab, deduplicates IDs, scrolls for lazy loading and uses an explicit **Load more** control when present. It reads same-profile **Next page** links with credential-free GETs when they return model links in HTML. For client-only pagination, it prompts for the next page and keeps the accumulated rows in the full audit view. The public design response's `designCreator.handle` confirms that a candidate belongs to the profile. [Public examples of Models-tab links](https://forum.bambulab.com/t/is-this-cheating/107486?page=12)

Live verification of the profile's HTML and XHR was blocked by Cloudflare in headless Chromium on November 19, 2026. DOM discovery and pagination were exercised against controlled profile-page fixtures. The extension uses the public UI surface and does not depend on a guessed profile-list endpoint.

## Design metadata and flags

The extension requests `GET https://api.bambulab.com/v1/design-service/design/{id}?visitHistory=false` anonymously, one request at a time, with at least 450 ms between requests. Successful rows are cached locally and reused for 15 minutes. An HTTP 429 stops the scan and honors the retry window.

Live responses expose `id`, `title`, `designCreator.handle`, `coverUrl`, `downloadCount`, and the design gallery at `designExtension.design_pictures` and `designExtension.real_pictures`. Gallery entries have `url` and numeric `isRealLifePhoto` flags. The extension deduplicates the same photo across fields, checks the cover by URL, and excludes print-profile photos under `instances[].pictures`. Total photos includes the cover once, even when the cover is separate from the gallery. Real-life photo counts use the gallery. A separate cover can carry no real-life marker even when gallery photos are marked. In that case the cover flag is Unknown. Points appear when the response exposes a numeric `points` or `pointCount` field. The live samples did not expose either. [Sample public design API response](https://api.bambulab.com/v1/design-service/design/544229?visitHistory=false)

- **Cover risk** means the cover is explicitly flagged as unmarked in the available metadata.
- **Edit-blocked** means the available gallery flags establish that fewer than three photos can be marked real-life. This flag estimates the photo count check before a cover edit.
- **OK** means the cover is marked and at least three gallery photos are marked real-life.
- **Unverified** means there is too little metadata to classify the model.

A model with both findings appears under **Edit-blocked** and shows its cover flag in the Cover flag column. The summary, table, and CSV use the same primary status. The audit reads labels. Review flagged models to confirm the cover shows the complete print and matches the files. The three-photo upload rule and review period for older covers are described in MakerWorld's announcement. [MakerWorld announcement](https://makerworld.com/en/community/post/1934883), [Bambu Lab forum discussion](https://forum.bambulab.com/t/263032)

## Test and package

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser -- replay ./test-output
npm run test:browser -- live ./test-output/live
npm run test:browser -- store ./test-output/store
npm run package
```

The replay uses fixture profile HTML and live Bambu Lab design metadata. The store run uses fictional models and captures the actual extension UI. The live run uses the real profile URL and reports when the page is challenged. The test runner can point `PLAYWRIGHT_MODULE` at an existing Playwright installation. [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)

- ZIP for upload in `dist/`
- Listing copy, a 1280×800 screenshot and a 440×280 tile in `store/`
- Static privacy policy in `privacy/index.html`. Use `privacy/` as the static project root on Vercel if deploying it later.
