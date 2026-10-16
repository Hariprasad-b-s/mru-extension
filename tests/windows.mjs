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
await sp.evaluate(readFileSync(`${ext}/scripts/set-ctrl-tab-shortcut.js`, 'utf8')); await sleep(300); await sp.close();

// Window 1: its starting tab "_" + A1..A5. Window 2: B1..B5.
const T = await ev(async () => {
  const w1 = await chrome.windows.getLastFocused(); const ids = { W1: w1.id };
  for (const n of ['A1', 'A2', 'A3', 'A4', 'A5']) ids[n] = (await chrome.tabs.create({ windowId: w1.id, url: `data:text/html,${n}`, active: false })).id;
  const w2 = await chrome.windows.create({ url: 'data:text/html,B1', focused: false }); ids.W2 = w2.id; ids.B1 = w2.tabs[0].id;
  for (const n of ['B2', 'B3', 'B4', 'B5']) ids[n] = (await chrome.tabs.create({ windowId: w2.id, url: `data:text/html,${n}`, active: false })).id;
  return ids;
});
const name = (id) => Object.keys(T).find(k => T[k] === id && !k.startsWith('W')) ?? '_';
const use = async (tab) => { await ev(async (id) => { const t = await chrome.tabs.update(id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); }, T[tab]); await sleep(350); };
const state = () => ev(async (T) => {
  const w = await chrome.windows.getLastFocused();
  const act = async (wid) => (await chrome.tabs.query({ active: true, windowId: wid }))[0].id;
  return { focused: w.id === T.W1 ? 'W1' : w.id === T.W2 ? 'W2' : 'other', w1: await act(T.W1), w2: await act(T.W2) };
}, T).then(s => ({ focused: s.focused, w1: name(s.w1), w2: name(s.w2) }));
const ctrlTab = async (n) => { execSync(`xdotool keydown ctrl ${'key --delay 150 Tab '.repeat(n)} keyup ctrl`); await sleep(400); const s = await state(); await sleep(1100); return s; };

for (const t of ['A1', 'A2', 'B1', 'B2', 'A3', 'B3']) await use(t);   // hop between windows
let s = await state();
console.log('start:', s, '(global history: B3 A3 B2 B1 A2 A1)');

s = await ctrlTab(1);
check('W2: 1 tap -> B2 (previous tab in THIS window, not A3)', s.w2 === 'B2' && s.focused === 'W2' && s.w1 === 'A3', s);

s = await ctrlTab(3);
check('W2: 3 taps -> B3, B1, B4 (unvisited tabs come last), stays in W2', s.w2 === 'B4' && s.focused === 'W2' && s.w1 === 'A3', s);

await use('A3');   // user clicks into window 1
s = await ctrlTab(1);
check('W1: 1 tap -> A2 (not B4 from the other window)', s.w1 === 'A2' && s.focused === 'W1' && s.w2 === 'B4', s);

s = await ctrlTab(5);
check('W1: 5 taps -> A3, A1, _, A4, A5, never touching W2', s.w1 === 'A5' && s.focused === 'W1' && s.w2 === 'B4', s);

s = await ctrlTab(6);
check('W1: 6 taps wrap round W1\'s 6 tabs to the start (A5)', s.w1 === 'A5' && s.focused === 'W1' && s.w2 === 'B4', s);

const solo = await ev(async () => { const w = await chrome.windows.create({ url: 'data:text/html,solo', focused: true }); return w.tabs[0].id; });
await sleep(800);
execSync('xdotool keydown ctrl key Tab keyup ctrl'); await sleep(700);
const after = await ev(async () => { const w = await chrome.windows.getLastFocused(); return { tab: (await chrome.tabs.query({ active: true, windowId: w.id }))[0].id }; });
s = await state();
check('one-tab window: Ctrl+Tab does nothing', after.tab === solo && s.w1 === 'A5' && s.w2 === 'B4', { ...s, soloStillShown: after.tab === solo });
await ctx.close();
