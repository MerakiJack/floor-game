// Renders public/icons/icon.svg to the PNG sizes needed by iOS / Android / Quest home screens.
// Usage: node scripts/make-icons.mjs   (needs Playwright's Chromium)
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); }
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await pw.chromium.launch();
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(`../public/icons/${name}.png`, import.meta.url).pathname });
  await page.close();
}
await browser.close();
