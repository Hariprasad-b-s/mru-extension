import { createRequire } from 'module';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
// Paths: the repo (or EXT_DIR) and Playwright (or PLAYWRIGHT=/path/to/playwright).
const REPO = process.env.EXT_DIR ?? fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright';
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT);
const ext = REPO;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const check = (label, cond, info) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info ?? '');

// The setup snippet exactly as documented in background.js.
const snippet = readFileSync(`${ext}/scripts/set-ctrl-tab-shortcut.js`, 'utf8');

const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');

// 1.1.0 opens a welcome tab on install; close it so the tab layout is as before.
for (let i = 0; i < 30; i++) {
  const closed = await sw.evaluate(async () => {
    const t = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    for (const x of t) await chrome.tabs.remove(x.tabId);
    return t.length;
  });
  if (closed) break;
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, 300));
const ev = (fn, arg) => sw.evaluate(fn, arg);
const shortcut = async () => (await ev(() => chrome.commands.getAll())).find(c => c.name === 'switch-to-previous-tab').shortcut;

const shortcutsPage = await ctx.newPage();
await shortcutsPage.goto('chrome://extensions/shortcuts');
await shortcutsPage.evaluate(snippet); await sleep(300);
check('snippet binds Ctrl+Tab', (await shortcut()) === 'Ctrl+Tab', await shortcut());

const tabs = await ev(async () => {
  const w = await chrome.windows.getLastFocused();
  const ids = {};
  for (const n of ['A', 'B', 'C', 'D']) ids[n] = (await chrome.tabs.create({ windowId: w.id, url: `data:text/html,${n}`, active: false })).id;
  return ids;
});
const name = (id) => Object.keys(tabs).find(k => tabs[k] === id) ?? `other(${id})`;
const active = async () => name(await ev(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id));
const setup = async () => { for (const n of ['A', 'C']) { await ev(id => chrome.tabs.update(id, { active: true }), tabs[n]); await sleep(300); } };
const press = async (keys) => {
  const win = execSync('xdotool search --onlyvisible --class chromium | tail -1').toString().trim();
  execSync(`xdotool windowfocus --sync ${win} key --clearmodifiers ${keys}`);
  await sleep(1300);
};
const setEnabled = (on) => ev(async (on) => { if ((await getIsEnabled()) !== on) await toggleEnabled(); }, on);

await setup(); await press('ctrl+Tab');
check('ON  + Ctrl+Tab -> MRU tab (A, not D)', (await active()) === 'A', await active());
await press('ctrl+Tab');
check('ON  + Ctrl+Tab again -> back to C', (await active()) === 'C', await active());

await setup(); await press('ctrl+shift+Tab');
check('Ctrl+Shift+Tab -> least recently used tab (D), like Brave', (await active()) === 'D', await active());

await setEnabled(false);
await setup(); await press('ctrl+Tab');
check("OFF + Ctrl+Tab -> Chrome's next tab (D)", (await active()) === 'D', await active());
await press('ctrl+Tab');
check('OFF + Ctrl+Tab wraps around to first tab', (await active()) !== 'D' && (await active()) !== 'A', await active());

// Back on Alt+Y, OFF must still mean "do nothing".
await shortcutsPage.evaluate(snippet.replace("'Ctrl+Tab'", "'Alt+Y'"));
await sleep(300);
await setup(); await press('alt+y');
check('OFF + Alt+Y -> no switch (stays C)', (await active()) === 'C', { shortcut: await shortcut(), active: await active() });
await setEnabled(true);
await press('alt+y');
check('ON  + Alt+Y -> MRU tab (A)', (await active()) === 'A', await active());
await ctx.close();
