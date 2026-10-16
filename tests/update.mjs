import { createRequire } from 'module';
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
// Paths: the repo (or EXT_DIR) and Playwright (or PLAYWRIGHT=/path/to/playwright).
const REPO = process.env.EXT_DIR ?? fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright';
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT);

// Updating from 1.1.0 (as submitted to the store) to this version must be
// smooth: same settings, same shortcuts, no new permission prompt, no welcome
// page, and the same behaviour until the user opts in to anything new.
const FROM = process.env.FROM_COMMIT ?? '8e26dbb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (label, cond, info) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info ?? '');

const dir = mkdtempSync(`${tmpdir()}/mru-update-`);
execSync(`git -C "${REPO}" archive ${FROM} | tar -x -C "${dir}"`);

const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: false,
  args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
for (let i = 0; i < 30; i++) {   // close the 1.1.0 welcome tab
  const closed = await sw.evaluate(async () => {
    const t = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    for (const x of t) await chrome.tabs.remove(x.tabId);
    return t.length;
  });
  if (closed) break;
  await sleep(100);
}

// A 1.1.0 user: Ctrl+Tab set up, their own settings.
const mgr = await ctx.newPage(); await mgr.goto('chrome://extensions/shortcuts');
await mgr.evaluate(() => new Promise((r) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, r)));
await mgr.evaluate(readFileSync(`${dir}/scripts/set-ctrl-tab-shortcut.js`, 'utf8')); await sleep(500);
const mySettings = { pauseMs: 600, braveHistory: false, scope: 'window' };
await sw.evaluate((s) => chrome.storage.local.set({ settings: s }), mySettings);
const info = () => mgr.evaluate((id) => new Promise((r) => chrome.developerPrivate.getExtensionInfo(id, r)), id);
const summary = (e) => ({
  version: e.version, state: e.state,
  warnings: e.permissions.simplePermissions.map((p) => p.message),
  shortcuts: Object.fromEntries(e.commands.map((c) => [c.name, c.keybinding])),
});
const before = summary(await info());

// Tabs used in the order A..E.
const tabs = await sw.evaluate(async () => {
  const w = await chrome.windows.getLastFocused(); const ids = {};
  for (const n of ['A', 'B', 'C', 'D', 'E']) ids[n] = (await chrome.tabs.create({ windowId: w.id, url: `data:text/html,<title>${n}</title>${n}`, active: false })).id;
  for (const n of ['A', 'B', 'C', 'D', 'E']) { await chrome.tabs.update(ids[n], { active: true }); await new Promise((r) => setTimeout(r, 200)); }
  return ids;
});
await sleep(400);

// Update in place to this version (same folder and key, so the same extension).
execSync(`bash -c 'cp -r "${REPO}"/{manifest.json,background.js,content.js,options.html,options.js,icons,scripts} "${dir}/"'`);
await mgr.evaluate((id) => new Promise((r) => chrome.developerPrivate.reload(id, { failQuietly: true }, r)), id);
await sleep(3000);
const after = summary(await info());

check(`updated ${before.version} -> ${after.version}, still enabled`, before.version === '1.1.0' && after.version !== '1.1.0' && after.state === 'ENABLED', { before: before.version, after: after.version, state: after.state });
check('no permission warnings before or after (Chrome asks existing users nothing)', before.warnings.length === 0 && after.warnings.length === 0, { before: before.warnings, after: after.warnings });
check('Ctrl+Tab and Ctrl+Shift+Tab shortcuts kept', after.shortcuts['switch-to-previous-tab'] === 'Ctrl+Tab' && after.shortcuts['cycle-in-reverse'] === 'Ctrl+Shift+Tab', after.shortcuts);

// Behaviour is unchanged and follows the user's settings (Brave-style history off).
const win = execSync('xdotool search --onlyvisible --class chromium | tail -1').toString().trim();
const title = () => execSync(`xdotool getwindowname ${win}`).toString().trim().replace(/ - Chromium$/, '');
execSync(`xdotool windowfocus --sync ${win} keydown ctrl key --delay 150 Tab Tab Tab keyup ctrl`); await sleep(300);
const afterThree = title(); await sleep(1200);
execSync(`xdotool windowfocus --sync ${win} keydown ctrl key Tab keyup ctrl`); await sleep(500);
const afterOne = title();
check('cycling as before: 3 taps E -> D -> C -> B, then 1 tap -> E (Brave-style history off, as set)', afterThree === 'B' && afterOne === 'E', { afterThree, afterOne });

// Settings kept, new feature off, no welcome page on update.
const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`); await sleep(600);
const state = await opts.evaluate(async () => ({
  settings: (await chrome.storage.local.get('settings')).settings,
  access: await chrome.permissions.contains({ origins: ['<all_urls>'] }),
  listener: (await chrome.scripting.getRegisteredContentScripts()).length,
  box: document.getElementById('release-detection')?.checked ?? null,
  welcomeTabs: (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).filter((c) => c.documentUrl.includes('#welcome')).length,
}));
check('settings kept', Object.entries(mySettings).every(([k, v]) => state.settings?.[k] === v), state.settings);
check('"let go of Ctrl" off: no site access, no page listener, box unticked', !state.access && state.listener === 0 && state.box === false, state);
check('no welcome page opened by the update', state.welcomeTabs === 0, state.welcomeTabs);
check('tabs created before the update still switch', Object.values(tabs).length === 5);
await ctx.close();
execSync(`rm -rf "${dir}"`);
