import { createRequire } from 'module';
import { execSync } from 'child_process';
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
console.log('CYCLE_PAUSE_MS =', await ev(() => settings.pauseMs));
await ev(() => { globalThis.__t = []; chrome.commands.onCommand.addListener(() => __t.push(Date.now())); });
const tabs = await ev(async () => {
  const w = await chrome.windows.getLastFocused(); const ids = {};
  for (const n of ['A', 'B', 'C', 'D', 'E']) ids[n] = (await chrome.tabs.create({ windowId: w.id, url: `data:text/html,${n}`, active: false })).id;
  return ids;
});
const name = (id) => Object.keys(tabs).find(k => tabs[k] === id) ?? '_';
const active = async () => name(await ev(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id));
for (const n of ['A', 'B', 'C', 'D', 'E']) { await ev(id => chrome.tabs.update(id, { active: true }), tabs[n]); await sleep(250); }
const win = execSync('xdotool search --onlyvisible --class chromium | tail -1').toString().trim();
// Hold Alt, tap Y twice: the gap between the two presses is exactly gapMs.
const twoPresses = async (gapMs) => {
  await ev(() => { __t.length = 0; });
  execSync(`xdotool windowfocus --sync ${win} keydown alt key --delay ${gapMs} y y keyup alt`); await sleep(400);
  const a = await active(); const t = await ev(() => __t); await sleep(1000);
  return `${a} (measured gap ${t[1] - t[0]} ms)`;
};

let shown = await twoPresses(500);
check('2 presses 500 ms apart: E -> D -> C (keeps cycling)', shown.startsWith('C '), shown);
shown = await twoPresses(900);
check('2 presses 900 ms apart: C -> D, pause ends the cycle, then back to C', shown.startsWith('C '), shown);
shown = await twoPresses(500);
check('2 presses 500 ms apart again: C -> D -> E', shown.startsWith('E '), shown);
await ctx.close();
