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
const sp = await ctx.newPage(); await sp.goto('chrome://extensions/shortcuts'); await sp.evaluate(snippet); await sleep(300); await sp.close();

const tabs = await ev(async () => {
  const w = await chrome.windows.getLastFocused(); const ids = {};
  for (const n of ['A', 'B', 'C', 'D', 'E']) ids[n] = (await chrome.tabs.create({ windowId: w.id, url: `data:text/html,${n}`, active: false })).id;
  return ids;
});
const name = (id) => Object.keys(tabs).find(k => tabs[k] === id) ?? '_';
const active = async () => name(await ev(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id));
const order = async () => (await ev(async () => (await chrome.storage.session.get('mruStack')).mruStack)).map(name).join('');
const win = execSync('xdotool search --onlyvisible --class chromium | tail -1').toString().trim();
// Hold Ctrl, tap Tab n times (~150ms apart), release; then pause so the cycle ends.
const ctrlTab = async (n) => {
  execSync(`xdotool windowfocus --sync ${win} keydown ctrl ${'key --delay 150 Tab '.repeat(n)} keyup ctrl`);
  await sleep(300); const during = await active();
  await sleep(1200); return during;
};

for (const n of ['A', 'B', 'C', 'D', 'E']) { await ev(id => chrome.tabs.update(id, { active: true }), tabs[n]); await sleep(250); }
check('history', (await order()).startsWith('EDCBA'), await order());

let shown = await ctrlTab(1);
check('1 tap: E -> D (previous tab)', shown === 'D', shown);
check('   order: D first, nothing else moved', (await order()).startsWith('DECBA'), await order());

shown = await ctrlTab(1);
check('1 tap again: back to E (two-tab toggle still works)', shown === 'E', shown);

shown = await ctrlTab(3);
check('3 taps in a row: E -> D -> C -> B', shown === 'B', shown);
check('   order: passed-through D, C now count as used (Brave)', (await order()).startsWith('BCDEA'), await order());

shown = await ctrlTab(1);
check('1 tap after cycle: C, the last tab passed through (Brave)', shown === 'C', shown);

shown = await ctrlTab(6); // 6 tabs total -> full loop back to start
check('6 taps wrap all the way round to the start (C)', shown === 'C', shown);
check('   order after a full loop: each tab recorded as it was shown', (await order()).startsWith('C_AEDB'), await order());

// Clicking a tab mid-cycle ends the cycle and counts as a normal switch.
execSync(`xdotool windowfocus --sync ${win} keydown ctrl key Tab keyup ctrl`); await sleep(200);
await ev(id => chrome.tabs.update(id, { active: true }), tabs.A); await sleep(1300);
check('click mid-cycle: ends the cycle, A recorded first', (await order()).startsWith('A_C'), await order());

// Another window: Ctrl+Tab stays inside it, so a one-tab window does nothing.
const w2 = await ev(async () => { const w = await chrome.windows.create({ url: 'data:text/html,F', focused: true }); return { id: w.id, tab: w.tabs[0].id }; });
tabs.F = w2.tab; await sleep(800);
execSync('xdotool keydown ctrl key Tab keyup ctrl'); await sleep(1500);
const xw = await ev(async (F) => (await chrome.tabs.get(F)).active, tabs.F);
const w1Tab = name(await ev(async (A) => { const t = await chrome.tabs.get(A); return (await chrome.tabs.query({ active: true, windowId: t.windowId }))[0].id; }, tabs.A));
check("other window: F stays shown, window 1 untouched (still A)", xw && w1Tab === 'A', { F_active: xw, window1: w1Tab });

// OFF + Ctrl+Tab: native next-tab; rapid taps move right each time.
await ev(() => toggleEnabled()); await sleep(200);
await ev(id => chrome.tabs.update(id, { active: true }), tabs.B); await sleep(300);
shown = await ctrlTab(2);
check("OFF: 2 taps -> Chrome's next-next tab (B -> D)", shown === 'D', shown);
await ctx.close();
