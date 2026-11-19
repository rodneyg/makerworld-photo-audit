import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from './playwright.js';

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 440, height: 280 } });
  for (const size of [16, 32, 48, 128]) {
    const png = await page.evaluate(size => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      context.scale(size / 128, size / 128);
      context.beginPath();
      context.roundRect(0, 0, 128, 128, 28);
      context.fillStyle = '#0e5d4e';
      context.fill();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = '#ffffff';
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(31, 49);
      context.lineTo(44, 49);
      context.lineTo(49, 38);
      context.lineTo(72, 38);
      context.lineTo(78, 49);
      context.lineTo(97, 49);
      context.lineTo(97, 84);
      context.lineTo(31, 84);
      context.closePath();
      context.stroke();
      context.fillStyle = '#0e5d4e';
      context.beginPath();
      context.arc(65, 65, 10, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = '#c9f1d5';
      context.beginPath();
      context.arc(92, 86, 19, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#0e5d4e';
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(84, 86);
      context.lineTo(90, 92);
      context.lineTo(100, 81);
      context.stroke();
      return canvas.toDataURL('image/png').split(',')[1];
    }, size);
    await writeFile(new URL(`../src/icons/audit-${size}.png`, import.meta.url), Buffer.from(png, 'base64'));
  }

  const icon = (await readFile(new URL('../src/icons/audit-128.png', import.meta.url))).toString('base64');
  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>
    body { margin: 0; background: #e5f0e9; color: #14372e; font: 16px system-ui, sans-serif; }
    main { height: 280px; display: flex; align-items: center; gap: 22px; padding: 0 31px; box-sizing: border-box; }
    img { width: 96px; height: 96px; }
    h1 { margin: 0; font-size: 37px; line-height: 1; letter-spacing: -.055em; }
    p { margin: 8px 0 0; color: #3e5e54; font-size: 19px; }
    </style><main><img alt="" src="data:image/png;base64,${icon}"><div><h1>Photo Audit</h1><p>for MakerWorld</p></div></main></html>`);
  await page.screenshot({ path: new URL('../store/promo-440x280.png', import.meta.url).pathname, type: 'png' });
} finally {
  await browser.close();
}
