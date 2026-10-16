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
const sp = await ctx.newPage(); await sp.goto('chrome://extensions/shortcuts');
const logs = []; sp.on('console', m => logs.push(m.text()));
await sp.evaluate(readFileSync(`${ext}/scripts/set-ctrl-tab-shortcut.js`, 'utf8')); await sleep(600); await sp.close();
const bound = Object.fromEntries((await ev(() => chrome.commands.getAll())).map(c => [c.name, c.shortcut]));
check('script binds Ctrl+Tab and Ctrl+Shift+Tab', bound['switch-to-previous-tab'] === 'Ctrl+Tab' && bound['cycle-in-reverse'] === 'Ctrl+Shift+Tab', { bound, logs });

const tabs = await ev(async () => {
  const w = await chrome.windows.getLastFocused(); const ids = {};
  for (const n of ['A', 'B', 'C', 'D', 'E']) ids[n] = (await chrome.tabs.create({ windowId: w.id, url: `data:text/html,${n}`, active: false })).id;
  return ids;
});
const name = (id) => Object.keys(tabs).find(k => tabs[k] === id) ?? '_';
const active = async () => name(await ev(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id));
const order = async () => (await ev(async () => (await chrome.storage.session.get('mruStack')).mruStack)).map(name).join('');
const win = execSync('xdotool search --onlyvisible --class chromium | tail -1').toString().trim();
// Hold Ctrl, tap the given keys 150 ms apart (e.g. 'Tab', 'shift+Tab'), release, then pause past the cycle window.
const hold = async (...keys) => {
  execSync(`xdotool windowfocus --sync ${win} keydown ctrl key --delay 150 ${keys.join(' ')} keyup ctrl`);
  await sleep(300); const shown = await active(); await sleep(1000); return shown;
};
for (const n of ['A', 'B', 'C', 'D', 'E']) { await ev(id => chrome.tabs.update(id, { active: true }), tabs[n]); await sleep(250); }
check('history', (await order()) === 'EDCBA_', await order());

let shown = await hold('Tab', 'Tab', 'Tab');
check('Ctrl+Tab x3: E -> D -> C -> B', shown === 'B', shown);
check('   passed-through tabs count as used (Brave): order B C D E A', (await order()) === 'BCDEA_', await order());

shown = await hold('Tab');
check('next single Ctrl+Tab goes to C, the last tab passed through (Brave)', shown === 'C', shown);

shown = await hold('shift+Tab');
check('Ctrl+Shift+Tab alone: least recently used tab', shown === '_', { shown, order: await order() });

shown = await hold('Tab', 'Tab', 'shift+Tab');
check('one hold, both directions: _ -> C -> B, then back to C', shown === 'C', { shown, order: await order() });

await ev(() => toggleEnabled()); await sleep(200);
shown = await hold('shift+Tab');
check("OFF: Ctrl+Shift+Tab -> Chrome's previous tab to the left (C -> B)", shown === 'B', shown);
shown = await hold('Tab');
check("OFF: Ctrl+Tab -> Chrome's next tab to the right (B -> C)", shown === 'C', shown);
await ev(() => toggleEnabled());
await ctx.close();
