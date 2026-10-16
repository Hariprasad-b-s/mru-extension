import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
// Paths: the repo (or EXT_DIR) and Playwright (or PLAYWRIGHT=/path/to/playwright).
const REPO = process.env.EXT_DIR ?? fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright';
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT);
const repo = REPO;
const pkg = process.env.PKG_DIR;                       // unzipped dist zip (no "key")
const fileCode = readFileSync(`${repo}/scripts/set-ctrl-tab-shortcut.js`, 'utf8');
const readme = readFileSync(`${repo}/README.md`, 'utf8');
const readmeCode = readme.match(/```js\n([\s\S]*?)```/)[1];
const check = (label, cond, info) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info ?? '');
check('README code block == script file code', fileCode.endsWith(readmeCode) && fileCode.slice(fileCode.indexOf('(() => {')) === readmeCode);

const launch = async (exts) => {
  const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${exts.join(',')}`, `--load-extension=${exts.join(',')}`] });
  await (ctx.serviceWorkers()[0] ?? ctx.waitForEvent('serviceworker'));
  await new Promise(r => setTimeout(r, 600));
  const page = await ctx.newPage(); await page.goto('chrome://extensions/shortcuts'); await page.waitForTimeout(500);
  return { ctx, page };
};
const run = async (page, code) => {
  const out = []; const h = m => out.push(`[${m.type()}] ${m.text()}`); page.on('console', h);
  await page.evaluate(code).catch(e => out.push('[threw] ' + e.message)); await page.waitForTimeout(700); page.off('console', h);
  return out.join(' | ');
};
const info = (page) => page.evaluate(() => new Promise(r => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true }, all => r(all.map(e => ({
  id: e.id, name: e.name, state: e.state, warnings: e.installWarnings, errors: e.manifestErrors.map(x => x.message),
  icon: e.iconUrl, shortcut: e.commands.find(c => c.name === 'switch-to-previous-tab')?.keybinding }))))));

for (const [label, dir] of [['source install (repo, fixed key)', repo], ['store build (packaged zip, no key)', pkg]]) {
  const { ctx, page } = await launch([dir]);
  const [e] = await info(page);
  console.log(`== ${label}: id ${e.id}`);
  check('  no manifest warnings or errors', e.warnings.length === 0 && e.errors.length === 0, { warnings: e.warnings, errors: e.errors });
  check('  name is the store name', e.name === 'MRU tab switcher - Smooth like brave browser', e.name);
  const sw = ctx.serviceWorkers()[0];
  const title = await sw.evaluate(() => chrome.action.getTitle({}));
  check('  toolbar tooltip', title === 'MRU Tab Switcher: ON (click to turn OFF)', title);
  const out = await run(page, readmeCode);
  check('  README code sets Ctrl+Tab and Ctrl+Shift+Tab', /switch-to-previous-tab is now Ctrl\+Tab\./.test(out) && /cycle-in-reverse is now Ctrl\+Shift\+Tab\./.test(out) && (await info(page))[0].shortcut === 'Ctrl+Tab', out);
  await ctx.close();
}

{ // Both installed (e.g. store + source): warns, sets one.
  const { ctx, page } = await launch([repo, pkg]);
  const out = await run(page, fileCode);
  const all = await info(page);
  check('two copies: warns and sets the first', /2 copies are installed/.test(out) && all.filter(e => e.shortcut === 'Ctrl+Tab').length === 1, { out, shortcuts: all.map(e => e.shortcut) });
  await ctx.close();
}
{ // Failure paths on one install.
  const { ctx, page } = await launch([repo]);
  let out = await run(page, fileCode.replace("'Ctrl+Tab'", "'MacCtrl+Tab'"));
  check('rejected keybinding is reported', /rejected "MacCtrl\+Tab"/.test(out), out);
  const web = await ctx.newPage(); await web.goto('data:text/html,hi');
  out = await run(web, fileCode);
  check('regular page is refused', /Run this on chrome:\/\/extensions\/shortcuts/.test(out), out);
  const [e] = await info(page);
  await page.evaluate((id) => new Promise(r => chrome.management.setEnabled(id, false, r)), e.id); await page.waitForTimeout(300);
  out = await run(page, fileCode);
  check('turned-off extension is reported', /not installed, or is turned off/.test(out), out);
  await ctx.close();
}
