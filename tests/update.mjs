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

// Updating from a store version (1.1.0 by default; FROM_COMMIT=9965b31 for
// 1.0.2) to this version must be smooth: same settings, same shortcuts, no
// new permission prompt, no welcome page, and the same behaviour until the
// user opts in to anything new. The one addition is the what's-new notice: a
// NEW badge and the settings page in a background tab, which asks people who
// set up Ctrl+Tab before Ctrl+Shift+Tab existed to run the setup code again.
const FROM = process.env.FROM_COMMIT ?? '8e26dbb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (label, cond, info) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info ?? '');

const dir = mkdtempSync(`${tmpdir()}/mru-update-`);
execSync(`git -C "${REPO}" archive ${FROM} | tar -x -C "${dir}"`);

const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: false,
  args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
for (let i = 0; i < 30; i++) {   // close the welcome tab (1.1.0 and later)
  const closed = await sw.evaluate(async () => {
    const t = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    for (const x of t) await chrome.tabs.remove(x.tabId);
    return t.length;
  });
  if (closed) break;
  await sleep(100);
}

// A user of that version: Ctrl+Tab set up with its own setup code (1.0.x's
// only binds Ctrl+Tab), their own settings.
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
const win = execSync('xdotool search --onlyvisible --class chromium | tail -1').toString().trim();
const title = () => execSync(`xdotool getwindowname ${win}`).toString().trim().replace(/ - Chromium$/, '');

// Update in place to this version (same folder and key, so the same extension).
const reload = async () => {
  await mgr.evaluate((id) => new Promise((r) => chrome.developerPrivate.reload(id, { failQuietly: true }, r)), id);
  await sleep(3000);
};
execSync(`bash -c 'cp -r "${REPO}"/{manifest.json,background.js,content.js,options.html,options.js,icons,scripts} "${dir}/"'`);
await reload();
const after = summary(await info());

check(`updated ${before.version} -> ${after.version}, still enabled`, before.version !== after.version && after.state === 'ENABLED', { before: before.version, after: after.version, state: after.state });
check('no permission warnings before or after (Chrome asks existing users nothing)', before.warnings.length === 0 && after.warnings.length === 0, { before: before.warnings, after: after.warnings });
const reverseBefore = before.shortcuts['cycle-in-reverse'];   // none in 1.0.x
check('shortcuts kept (Ctrl+Shift+Tab gets its default if this version is the first to have it)',
  after.shortcuts['switch-to-previous-tab'] === 'Ctrl+Tab' && after.shortcuts['cycle-in-reverse'] === (reverseBefore ?? 'Alt+Shift+Y'),
  { before: before.shortcuts, after: after.shortcuts });

// What's new: the settings page in a background tab, and NEW on the icon.
const whatsNewPages = () => ctx.pages().filter((p) => p.url().endsWith('/options.html#whats-new'));
for (let i = 0; i < 30 && whatsNewPages().length === 0; i++) await sleep(100);
const [news] = whatsNewPages();
// (Its tab isn't active. Playwright makes every tab report itself visible.)
const shown = await news?.evaluate(async () => ({
  active: (await chrome.tabs.getCurrent()).active,
  title: document.title,
  card: document.querySelector('.whats-new').checkVisibility(),
  version: document.getElementById('whats-new-version').textContent,
  nudge: document.getElementById('ctrl-tab-nudge').checkVisibility(),
  badge: await chrome.action.getBadgeText({}),
  tooltip: await chrome.action.getTitle({}),
}));
check("what's new opened once, in a background tab", whatsNewPages().length === 1 && shown?.active === false, { pages: ctx.pages().map((p) => p.url()), shown });
check("it lists what's new in this version", shown?.card && shown.version === after.version && /What's new/.test(shown.title), shown);
check("toolbar badge NEW until it's seen", shown?.badge === 'NEW' && shown.tooltip === `MRU Tab Switcher was updated to ${after.version}: click to see what's new`, shown);
const halfDone = !/Tab/.test(reverseBefore ?? '');
check(halfDone ? 'Ctrl+Tab without Ctrl+Shift+Tab: asks to run the setup code once more' : 'both Tab shortcuts set: no setup prompt',
  shown?.nudge === halfDone, { reverseBefore, nudge: shown?.nudge });
check('the tab on screen is unchanged', title() === 'E', title());

// Behaviour is unchanged and follows the user's settings (Brave-style history off).
execSync(`xdotool windowfocus --sync ${win} keydown ctrl key --delay 150 Tab Tab Tab keyup ctrl`); await sleep(300);
const afterThree = title(); await sleep(1200);
execSync(`xdotool windowfocus --sync ${win} keydown ctrl key Tab keyup ctrl`); await sleep(500);
const afterOne = title();
check('cycling as before: 3 taps E -> D -> C -> B, then 1 tap -> E (Brave-style history off, as set)', afterThree === 'B' && afterOne === 'E', { afterThree, afterOne });

// Looking at the page clears the badge.
await news.bringToFront(); await sleep(600);
const seen = await news.evaluate(async () => ({
  badge: await chrome.action.getBadgeText({}),
  tooltip: await chrome.action.getTitle({}),
  pending: (await chrome.storage.local.get('whatsNew')).whatsNew ?? null,
}));
check('once seen, the badge is back to ON', seen.badge === 'ON' && seen.tooltip === 'MRU Tab Switcher: ON (click to turn OFF)' && seen.pending === null, seen);

if (halfDone) {
  await mgr.evaluate(readFileSync(`${REPO}/scripts/set-ctrl-tab-shortcut.js`, 'utf8')); await sleep(500);
  const done = await news.evaluate(async () => {
    await renderShortcuts();
    return { nudge: document.getElementById('ctrl-tab-nudge').checkVisibility(), status: document.getElementById('ctrl-tab-status').textContent };
  });
  check('running the setup code again sets Ctrl+Shift+Tab too; the prompt goes', !done.nudge && /✓ Set up: Ctrl\+Tab and Ctrl\+Shift\+Tab\./.test(done.status), done);
}

// Settings kept, new feature off, no welcome page on update.
const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`); await sleep(600);
const state = await opts.evaluate(async () => ({
  settings: (await chrome.storage.local.get('settings')).settings,
  access: await chrome.permissions.contains({ origins: ['<all_urls>'] }),
  listener: (await chrome.scripting.getRegisteredContentScripts()).length,
  box: document.getElementById('release-detection')?.checked ?? null,
  showWhatsNew: document.getElementById('show-whats-new')?.checked ?? null,
  welcomeTabs: (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).filter((c) => c.documentUrl.includes('#welcome')).length,
}));
check('settings kept', Object.entries(mySettings).every(([k, v]) => state.settings?.[k] === v), state.settings);
check('"let go of Ctrl" off: no site access, no page listener, box unticked', !state.access && state.listener === 0 && state.box === false, state);
check('"Show what\'s new after an update" on', state.showWhatsNew === true, state.showWhatsNew);
check('no welcome page opened by the update', state.welcomeTabs === 0, state.welcomeTabs);
check('tabs created before the update still switch', Object.values(tabs).length === 5);

// A patch update (fixes only) says nothing.
await news.close(); await opts.close();
const patch = after.version.replace(/\d+$/, (n) => Number(n) + 1);
execSync(`sed -i 's/"version": "${after.version}"/"version": "${patch}"/' "${dir}/manifest.json"`);
await reload();
const quiet = summary(await info());
check(`patch update ${after.version} -> ${patch}: no what's-new page`, quiet.version === patch && whatsNewPages().length === 0,
  { version: quiet.version, pages: ctx.pages().map((p) => p.url()) });
await ctx.close();
execSync(`rm -rf "${dir}"`);
