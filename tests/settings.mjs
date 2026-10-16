import { createRequire } from 'module';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
// Paths: the repo (or EXT_DIR) and Playwright (or PLAYWRIGHT=/path/to/playwright).
const REPO = process.env.EXT_DIR ?? fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright';
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT);
const ext = process.argv[2] ?? REPO;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const check = (label, cond, info) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info ?? '');
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const ev = (fn, arg) => sw.evaluate(fn, arg);
const id = new URL(sw.url()).host;

// 1. Welcome page on install.
let welcome = [];
for (let i = 0; i < 30 && !welcome.length; i++) { welcome = await ev(() => chrome.runtime.getContexts({ contextTypes: ['TAB'] })); await sleep(100); }
check('welcome page opens on install', welcome.length === 1 && welcome[0].documentUrl.endsWith('options.html#welcome'), welcome.map(c => c.documentUrl));
await ev(async () => { for (const c of await chrome.runtime.getContexts({ contextTypes: ['TAB'] })) await chrome.tabs.remove(c.tabId); });

// 2. No install-time permission warnings (storage, contextMenus have none).
const mgr = await ctx.newPage(); await mgr.goto('chrome://extensions');
const info = await mgr.evaluate((id) => new Promise(r => chrome.developerPrivate.getExtensionInfo(id, r)), id);
check('no permission warnings at install', info.permissions.simplePermissions.length === 0 && info.installWarnings.length === 0 && info.manifestErrors.length === 0,
  { warnings: info.permissions.simplePermissions.map(p => p.message), install: info.installWarnings });
check('options page registered', info.optionsPage?.openInTab === true, info.optionsPage);

// 3. Settings page content.
const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`); await sleep(600);
const ui = await opts.evaluate(() => ({
  shortcuts: [...document.querySelectorAll('[data-shortcut]')].map(k => k.textContent),
  code: document.getElementById('setup-code').textContent,
  status: document.getElementById('ctrl-tab-status').textContent,
  pause: document.getElementById('pause-value').textContent,
}));
check('page shows the current shortcuts', ui.shortcuts.includes('Alt+Y') && ui.shortcuts.includes('Alt+Shift+Y'), ui.shortcuts);
check('page shows the setup code from the script file', ui.code === readFileSync(`${ext}/scripts/set-ctrl-tab-shortcut.js`, 'utf8'), ui.code.slice(0, 40));
check('Ctrl+Tab status: not set up yet', /Not set up yet/.test(ui.status), ui.status);
check('default pause shown as 0.70 s', ui.pause === '0.70 s', ui.pause);

// Screenshots for a visual check (light, dark).
await opts.setViewportSize({ width: 900, height: 1400 });
await opts.emulateMedia({ colorScheme: 'light' }); await opts.screenshot({ path: `${tmpdir()}/mru-options-light.png`, fullPage: true });
await opts.emulateMedia({ colorScheme: 'dark' }); await opts.screenshot({ path: `${tmpdir()}/mru-options-dark.png`, fullPage: true });
await opts.emulateMedia({ colorScheme: 'light' });

// 4. Changing settings on the page reaches the background.
await opts.click('#brave-history'); await opts.check('input[name="scope"][value="all"]');
await opts.fill('#pause', '300'); await opts.dispatchEvent('#pause', 'change'); await sleep(300);
check('settings saved and picked up by the background', JSON.stringify(await ev(() => settings)) === JSON.stringify({ pauseMs: 300, braveHistory: false, scope: 'all' }), await ev(() => settings));

// 5. ON/OFF from the page updates the badge (and icon).
await opts.click('#enabled'); await sleep(300);
check('switching OFF on the page: badge OFF', (await ev(() => chrome.action.getBadgeText({}))) === 'OFF');
await opts.click('#enabled'); await sleep(300);
check('switching back ON: badge ON', (await ev(() => chrome.action.getBadgeText({}))) === 'ON');

// 6. Behaviour under each setting, with real key presses.
await opts.close(); await mgr.close();
const tabs = await ev(async () => {
  const w = await chrome.windows.getLastFocused(); const ids = {};
  for (const n of ['A', 'B', 'C', 'D', 'E']) ids[n] = (await chrome.tabs.create({ windowId: w.id, url: `data:text/html,<title>${n}</title>${n}`, active: false })).id;
  return ids;
});
const name = (tid) => Object.keys(tabs).find(k => tabs[k] === tid) ?? '_';
const active = async () => name(await ev(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id));
const order = async () => (await ev(async () => (await chrome.storage.session.get('mruStack')).mruStack)).map(name).join('');
const set = (patch) => ev((patch) => chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, ...patch } })), patch).then(() => sleep(200));
const win = execSync('xdotool search --onlyvisible --class chromium | tail -1').toString().trim();
const hold = async (gap, n) => { execSync(`xdotool windowfocus --sync ${win} keydown alt key --delay ${gap} ${'y '.repeat(n)} keyup alt`); await sleep(300); const a = await active(); await sleep(Math.max(1600, 0)); return a; };
const reset = async () => { for (const n of ['A', 'B', 'C', 'D', 'E']) { await ev(tid => chrome.tabs.update(tid, { active: true }), tabs[n]); await sleep(200); } await sleep(400); };

await set({ scope: 'window', braveHistory: false, pauseMs: 700 }); await reset();
let shown = await hold(150, 3);
check('Brave-style history OFF: E -> D -> C -> B, passed-through D, C not recorded', shown === 'B' && (await order()).startsWith('BEDCA'), { shown, order: await order() });

await set({ braveHistory: true }); await reset();
shown = await hold(150, 3);
check('Brave-style history ON: passed-through D, C recorded', shown === 'B' && (await order()).startsWith('BCDEA'), { shown, order: await order() });

await set({ pauseMs: 300 }); await reset();
shown = await hold(500, 2);
check('pause 0.30 s: presses 500 ms apart start over (E -> D, then back to E)', shown === 'E', shown);
await set({ pauseMs: 1200 }); await reset();
shown = await hold(1000, 2);
check('pause 1.20 s: presses 1 s apart keep cycling (E -> D -> C)', shown === 'C', shown);

// Scope: a new one-tab window, previous tab is in window 1.
await set({ pauseMs: 700, scope: 'window' }); await reset();
const F = await ev(async () => (await chrome.windows.create({ url: 'data:text/html,<title>F</title>F', focused: true })).tabs[0].id); tabs.F = F; await sleep(800);
execSync('xdotool keydown alt key y keyup alt'); await sleep(1200);
check('scope "this window": one-tab window, nothing happens', (await active()) === 'F', await active());
await set({ scope: 'all' });
execSync('xdotool keydown alt key y keyup alt'); await sleep(1200);
const where = await ev(async (E) => { const t = await chrome.tabs.get(E); const w = await chrome.windows.get(t.windowId); return { active: t.active, focused: w.focused }; }, tabs.E);
check('scope "all windows": goes to E in window 1 and focuses that window', where.active && where.focused, where);

// 7. Status after running the Ctrl+Tab setup script.
const mgr2 = await ctx.newPage(); await mgr2.goto('chrome://extensions/shortcuts');
await mgr2.evaluate(readFileSync(`${ext}/scripts/set-ctrl-tab-shortcut.js`, 'utf8')); await sleep(500);
const opts2 = await ctx.newPage(); await opts2.goto(`chrome-extension://${id}/options.html#ctrl-tab`); await sleep(600);
const after = await opts2.evaluate(() => ({ status: document.getElementById('ctrl-tab-status').textContent, shortcuts: [...document.querySelectorAll('[data-shortcut]')].map(k => k.textContent) }));
check('after setup, the page shows Ctrl+Tab as set up', /Set up: the shortcut is Ctrl\+Tab/.test(after.status) && after.shortcuts.includes('Ctrl+Shift+Tab'), after);
await ctx.close();
