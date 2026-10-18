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
  whatsNew: document.querySelector('.whats-new').checkVisibility(),
  showWhatsNew: document.getElementById('show-whats-new').checked,
}));
check('page shows the current shortcuts', ui.shortcuts.includes('Alt+Y') && ui.shortcuts.includes('Alt+Shift+Y'), ui.shortcuts);
check('page shows the setup code from the script file', ui.code === readFileSync(`${ext}/scripts/set-ctrl-tab-shortcut.js`, 'utf8'), ui.code.slice(0, 40));
check('Ctrl+Tab status: not set up yet', /Not set up yet/.test(ui.status), ui.status);
check('default pause shown as 0.70 s', ui.pause === '0.70 s', ui.pause);
check('fresh install: no what\'s-new card; "Show what\'s new after an update" on', !ui.whatsNew && ui.showWhatsNew, ui);

// Screenshots for a visual check (light, dark).
await opts.setViewportSize({ width: 900, height: 1400 });
await opts.emulateMedia({ colorScheme: 'light' }); await opts.screenshot({ path: `${tmpdir()}/mru-options-light.png`, fullPage: true });
await opts.emulateMedia({ colorScheme: 'dark' }); await opts.screenshot({ path: `${tmpdir()}/mru-options-dark.png`, fullPage: true });
await opts.emulateMedia({ colorScheme: 'light' });

// 4. Changing settings on the page reaches the background.
await opts.click('#brave-history'); await opts.check('input[name="scope"][value="all"]'); await opts.click('#show-whats-new');
await opts.fill('#pause', '300'); await opts.dispatchEvent('#pause', 'change'); await sleep(300);
check('settings saved and picked up by the background', JSON.stringify(await ev(() => settings)) === JSON.stringify({ pauseMs: 300, braveHistory: false, scope: 'all', showWhatsNew: false }), await ev(() => settings));

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

// 7. Ctrl+Tab status: only Ctrl+Tab (as set up in version 1.0), then both.
const mgr2 = await ctx.newPage(); await mgr2.goto('chrome://extensions/shortcuts');
await mgr2.evaluate((id) => new Promise(r => chrome.developerPrivate.updateExtensionCommand({ extensionId: id, commandName: 'switch-to-previous-tab', keybinding: 'Ctrl+Tab' }, r)), id);
const opts2 = await ctx.newPage(); await opts2.goto(`chrome-extension://${id}/options.html#whats-new`); await sleep(600);
const ctrlTab = () => opts2.evaluate(async () => {
  await renderShortcuts();
  return {
    status: document.getElementById('ctrl-tab-status').textContent,
    card: document.querySelector('.whats-new').checkVisibility(),
    nudge: document.getElementById('ctrl-tab-nudge').checkVisibility(),
    shortcuts: [...document.querySelectorAll('[data-shortcut]')].map(k => k.textContent),
  };
});
let after = await ctrlTab();
check('only Ctrl+Tab set up: says so, and what\'s new asks to run the setup code once more', after.card && after.nudge && /^Ctrl\+Tab is set up, but Ctrl\+Shift\+Tab isn't yet \(the reverse shortcut is Alt\+Shift\+Y\)/.test(after.status), after);
await mgr2.evaluate(readFileSync(`${ext}/scripts/set-ctrl-tab-shortcut.js`, 'utf8')); await sleep(500);
after = await ctrlTab();
check('after setup, the page shows Ctrl+Tab and Ctrl+Shift+Tab as set up', after.status === '✓ Set up: Ctrl+Tab and Ctrl+Shift+Tab.' && !after.nudge && after.shortcuts.includes('Ctrl+Shift+Tab'), after);
await opts2.close(); await mgr2.close();

// 8. What's new after an update (onInstalled calls announceUpdate; called directly here).
const version = await ev(() => chrome.runtime.getManifest().version);
const newsTabs = () => ev(async () => Promise.all((await chrome.runtime.getContexts({ contextTypes: ['TAB'] }))
  .filter(c => c.documentUrl.endsWith('/options.html#whats-new'))
  .map(async c => ({ id: c.tabId, active: (await chrome.tabs.get(c.tabId)).active }))));
const badge = () => ev(async () => ({ text: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}),
  pending: (await chrome.storage.local.get('whatsNew')).whatsNew ?? null, on: await getIsEnabled() }));
const announce = async (from) => { await ev((from) => enqueue(() => announceUpdate(from)), from); await sleep(800); };
check('only feature updates count: 1.1 -> 1.2, 1.0.2 -> 1.2.0, 1.9 -> 2.0 yes; 1.2.0 -> 1.2.1 and reloads no',
  await ev(() => [isFeatureUpdate('1.1.0', '1.2.0'), isFeatureUpdate('1.0.2', '1.2.0'), isFeatureUpdate('1.9.0', '2.0'),
    !isFeatureUpdate('1.2.0', '1.2.1'), !isFeatureUpdate('1.2.0', '1.2.0'), !isFeatureUpdate(undefined, '1.2.0')].every(Boolean)));
await announce('1.1.0');
check('"Show what\'s new" off: an update opens nothing, badge stays ON', (await newsTabs()).length === 0 && (await badge()).text === 'ON', { tabs: await newsTabs(), badge: await badge() });
await set({ showWhatsNew: true });
await announce('1.1.0');
let news = await newsTabs(); let b = await badge();
check('feature update: what\'s new opens once, in a background tab', news.length === 1 && !news[0].active, news);
check('...and the badge says NEW', b.text === 'NEW' && b.title === `MRU Tab Switcher was updated to ${version}: click to see what's new`, b);
await announce(version);
check('reload of the same version: nothing more', (await newsTabs()).length === 1, await newsTabs());
await ev(() => onActionClicked()); await sleep(800);
news = await newsTabs(); b = await badge();
check('icon click while NEW: brings what\'s new to the front, doesn\'t switch OFF', news.length === 1 && news[0].active && b.on, { news, b });
check('once seen: badge back to ON', b.text === 'ON' && b.pending === null && b.title === 'MRU Tab Switcher: ON (click to turn OFF)', b);
await ev(() => onActionClicked()); await sleep(300);
check('the next click switches OFF as usual', (await badge()).text === 'OFF');
await ev(() => onActionClicked()); await sleep(300);
await ev(async () => { for (const c of await chrome.runtime.getContexts({ contextTypes: ['TAB'] })) await chrome.tabs.remove(c.tabId); });
await announce('1.1.0');
await ev(async () => { for (const c of await chrome.runtime.getContexts({ contextTypes: ['TAB'] })) await chrome.tabs.remove(c.tabId); }); await sleep(300);
check('closed without being seen: NEW stays', (await badge()).text === 'NEW', await badge());
await ev(() => onActionClicked()); await sleep(800);
news = await newsTabs(); b = await badge();
check('...then the icon opens what\'s new in a new tab and NEW goes', news.length === 1 && news[0].active && b.text === 'ON', { news, b });

// 9. An update applied while Chrome starts, before it has a window: waits for
// Chrome's first window instead of opening one of its own.
await ev(async () => {
  await chrome.windows.create({ type: 'popup', url: 'data:text/html,<title>popup</title>popup' }); // keeps Chrome running
  for (const w of await chrome.windows.getAll({ windowTypes: ['normal'] })) await chrome.windows.remove(w.id);
}); await sleep(800);
const normalWindows = () => ev(async () => (await chrome.windows.getAll({ windowTypes: ['normal'], populate: true })).map(w => w.tabs.length));
await announce('1.1.0'); await sleep(700);
check('no window yet: opens no window of its own', (await normalWindows()).length === 0, await normalWindows());
await ev(() => chrome.windows.create({ url: 'data:text/html,<title>restored</title>restored' })); await sleep(2000);
news = await newsTabs();
check('...then opens in Chrome\'s first window, behind its tab', (await normalWindows()).join() === '2' && news.length === 1 && !news[0].active, { windows: await normalWindows(), news });
await ctx.close();
